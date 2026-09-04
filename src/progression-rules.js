/**
 * Pure progression rules for ECHObound.
 *
 * The runtime owns presentation and mutations. This module only evaluates a
 * partner's history and produces deterministic evolution / New Cycle+ plans.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const bounded = (value, fallback = 0) => clamp(number(value, fallback), 0, 100);
const round = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const FORM_STAGES = deepFreeze({
  mote_feral: 1,
  mote_aegis: 1,
  mote_veil: 1,
  riftclaw: 2,
  ironhide: 2,
  veilwing: 2,
  nexusfox: 2,
  dreadmaw: 3,
  cathedral: 3,
  seraph: 3,
  sovereign: 3,
});

export const EVOLUTION_PATHS = deepFreeze({
  feral: {
    id: 'feral',
    name: 'VOIE DE LA FAILLE',
    targets: { 2: 'riftclaw', 3: 'dreadmaw' },
    description: 'Puissance et vitesse canalisent la pression accumulée par le lien.',
  },
  aegis: {
    id: 'aegis',
    name: 'VOIE DU REMPART',
    targets: { 2: 'ironhide', 3: 'cathedral' },
    description: 'Garde, discipline et repos stable bâtissent une présence protectrice.',
  },
  oracle: {
    id: 'oracle',
    name: 'VOIE DU VOILE',
    targets: { 2: 'veilwing', 3: 'seraph' },
    description: 'Esprit, moral et soins constants ouvrent les couches profondes de la mémoire.',
  },
  concord: {
    id: 'concord',
    name: 'VOIE DU NEXUS',
    targets: { 2: 'nexusfox', 3: 'sovereign' },
    description: 'Un lien élevé et des aptitudes équilibrées permettent une forme de concorde.',
  },
});

const EVOLUTION_LEVELS = deepFreeze({ 1: 5, 2: 10 });
const PATH_ORDER = deepFreeze(['concord', 'aegis', 'oracle', 'feral']);

/**
 * Summarises care without mutating the partner. High needs and repeated care
 * mistakes create strain; they never permanently lock a player out of evolving.
 */
export function evaluateCare(partner = {}) {
  const hunger = bounded(partner.hunger);
  const fatigue = bounded(partner.fatigue);
  const careMistakes = Math.max(0, Math.floor(number(partner.careMistakes)));
  const mistakePressure = clamp(careMistakes * 12, 0, 100);
  const strain = round(hunger * 0.34 + fatigue * 0.4 + mistakePressure * 0.26);
  const stability = round(100 - strain);
  const grade = stability >= 82 ? 'exemplary'
    : stability >= 64 ? 'steady'
      : stability >= 42 ? 'strained'
        : 'critical';

  return deepFreeze({ hunger, fatigue, careMistakes, mistakePressure, strain, stability, grade });
}

const normalizeStats = (partner) => {
  const raw = {
    power: Math.max(0, number(partner.power)),
    guard: Math.max(0, number(partner.guard)),
    spirit: Math.max(0, number(partner.spirit)),
    speed: Math.max(0, number(partner.speed)),
  };
  const highest = Math.max(1, ...Object.values(raw));
  const normalized = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(value / highest * 100)]));
  const spread = Math.max(...Object.values(normalized)) - Math.min(...Object.values(normalized));
  return { raw, normalized, balance: round(100 - spread) };
};

const scoreEvolutionPaths = (partner, care, stats, targetStage) => {
  const bond = bounded(partner.bond);
  const discipline = bounded(partner.discipline, 50);
  const morale = bounded(partner.morale, 50);
  const n = stats.normalized;
  const disciplineBalance = clamp(100 - Math.abs(discipline - 65) * 2.5, 0, 100);

  const breakdown = {
    feral: {
      power: n.power * 0.46,
      speed: n.speed * 0.24,
      instinct: (100 - discipline) * 0.12,
      strain: care.strain * (targetStage === 3 ? 0.18 : 0.12),
      morale: morale * 0.06,
    },
    aegis: {
      guard: n.guard * 0.48,
      discipline: discipline * 0.23,
      stability: care.stability * 0.17,
      bond: bond * 0.07,
      power: n.power * 0.05,
    },
    oracle: {
      spirit: n.spirit * 0.48,
      speed: n.speed * 0.1,
      stability: care.stability * 0.18,
      morale: morale * 0.14,
      bond: bond * 0.1,
    },
    concord: {
      bond: bond * (targetStage === 3 ? 0.42 : 0.38),
      balance: stats.balance * 0.2,
      stability: care.stability * 0.2,
      disciplineBalance: disciplineBalance * 0.12,
      morale: morale * 0.14,
    },
  };

  // Concord is an earned route, not an accidental result of middling stats.
  const concordBondFloor = targetStage === 3 ? 84 : 76;
  const concordStabilityFloor = targetStage === 3 ? 58 : 48;
  const concordPenalty = Math.max(0, concordBondFloor - bond) * 1.35
    + Math.max(0, concordStabilityFloor - care.stability) * 0.65;

  const scores = Object.fromEntries(Object.entries(breakdown).map(([pathId, parts]) => {
    const baseScore = Object.values(parts).reduce((sum, value) => sum + value, 0);
    return [pathId, round(baseScore - (pathId === 'concord' ? concordPenalty : 0))];
  }));

  return { scores, breakdown, concordPenalty: round(concordPenalty) };
};

/**
 * Returns a complete, explainable evolution decision. The selection is stable:
 * ties use PATH_ORDER, so saves produce the same result on every device.
 */
export function evaluateEvolution(partner = {}) {
  const formId = String(partner.formId || '');
  const currentStage = FORM_STAGES[formId] || 0;
  const requiredLevel = EVOLUTION_LEVELS[currentStage] || null;
  const level = Math.max(0, Math.floor(number(partner.level)));
  const care = evaluateCare(partner);
  const stats = normalizeStats(partner);

  if (!currentStage) {
    return deepFreeze({
      eligible: false,
      reason: 'unknown-form',
      currentFormId: formId,
      currentStage,
      requiredLevel,
      level,
      targetFormId: null,
      targetStage: null,
      pathId: null,
      scores: {},
      breakdown: {},
      care,
      stats,
    });
  }

  if (currentStage >= 3) {
    return deepFreeze({
      eligible: false,
      reason: 'maximum-stage',
      currentFormId: formId,
      currentStage,
      requiredLevel: null,
      level,
      targetFormId: null,
      targetStage: null,
      pathId: null,
      scores: {},
      breakdown: {},
      care,
      stats,
    });
  }

  const targetStage = currentStage + 1;
  const scored = scoreEvolutionPaths(partner, care, stats, targetStage);
  const pathId = PATH_ORDER.reduce((best, candidate) => (
    scored.scores[candidate] > scored.scores[best] ? candidate : best
  ), PATH_ORDER[0]);
  const targetFormId = EVOLUTION_PATHS[pathId].targets[targetStage];
  const eligible = level >= requiredLevel;

  return deepFreeze({
    eligible,
    reason: eligible ? 'ready' : 'level-required',
    currentFormId: formId,
    currentStage,
    requiredLevel,
    level,
    targetFormId: eligible ? targetFormId : null,
    previewTargetFormId: targetFormId,
    targetStage,
    pathId,
    pathName: EVOLUTION_PATHS[pathId].name,
    scores: scored.scores,
    breakdown: scored.breakdown,
    concordPenalty: scored.concordPenalty,
    care,
    stats,
  });
}

export function getEvolutionTarget(partner) {
  return evaluateEvolution(partner).targetFormId;
}

const BASE_CYCLE_EFFECTS = deepFreeze({
  enemyHpMultiplier: 1,
  enemyPowerMultiplier: 1,
  enemyGuardMultiplier: 1,
  enemySpiritMultiplier: 1,
  enemySpeedBonus: 0,
  xpMultiplier: 1,
  creditMultiplier: 1,
  materialMultiplier: 1,
  needRateMultiplier: 1,
  syncGainMultiplier: 1,
  sanctuaryMultiplier: 1,
  patrolRespawnMultiplier: 1,
  anomalyCount: 0,
});

export const CYCLE_LAWS = deepFreeze({
  echo_storm: {
    id: 'echo_storm',
    name: 'TEMPÊTE D’ÉCHOS',
    description: 'Les souvenirs combattent plus vite et plus fort, mais leur résonance accélère aussi l’Unisson et enrichit les victoires.',
    effects: {
      enemyPowerMultiplier: 1.08,
      enemySpiritMultiplier: 1.12,
      enemySpeedBonus: 2,
      xpMultiplier: 1.18,
      creditMultiplier: 1.1,
      syncGainMultiplier: 1.2,
      anomalyCount: 2,
    },
  },
  iron_oath: {
    id: 'iron_oath',
    name: 'SERMENT DE FER',
    description: 'Les adversaires deviennent des remparts, tandis que les sanctuaires et les leçons tirées de chaque victoire gagnent en valeur.',
    effects: {
      enemyHpMultiplier: 1.16,
      enemyGuardMultiplier: 1.14,
      xpMultiplier: 1.28,
      sanctuaryMultiplier: 1.25,
      anomalyCount: 2,
    },
  },
  hungry_horizon: {
    id: 'hungry_horizon',
    name: 'HORIZON AFFAMÉ',
    description: 'Les longues expéditions éprouvent davantage les besoins du duo; patrouilles, crédits et matériaux reviennent en abondance.',
    effects: {
      enemyHpMultiplier: 1.05,
      creditMultiplier: 1.25,
      materialMultiplier: 1.35,
      needRateMultiplier: 1.28,
      patrolRespawnMultiplier: 0.68,
      anomalyCount: 3,
    },
  },
});

export const CYCLE_REGION_IDS = deepFreeze(['wastes', 'hive', 'fog', 'foundry']);

export function getCycleLaw(lawId) {
  const law = CYCLE_LAWS[lawId];
  if (!law) throw new RangeError(`Loi de cycle inconnue : ${String(lawId)}`);
  return law;
}

const normalizeCycleCount = (value) => clamp(Math.floor(number(value)), 0, 99);

/**
 * Controlled scaling: opposition stops growing after cycle 8 and raw level
 * bonuses stop at +12. Rewards stop at cycle 6, preventing runaway farming.
 */
export function getCycleScaling(cycleOrState = 0, explicitLawId = null) {
  const isState = cycleOrState && typeof cycleOrState === 'object';
  const cycleCount = normalizeCycleCount(isState ? cycleOrState.cycleCount : cycleOrState);
  const lawId = explicitLawId || (isState ? cycleOrState.cycleModifier : null) || null;
  const law = cycleCount > 0 && lawId && lawId !== 'none' ? getCycleLaw(lawId) : null;
  const pressureStep = Math.min(cycleCount, 8);
  const rewardStep = Math.min(cycleCount, 6);
  const lawEffects = law?.effects || {};

  const multiply = (base, key) => round(base * number(lawEffects[key], 1), 3);
  return deepFreeze({
    cycleCount,
    lawId: law?.id || 'none',
    lawName: law?.name || 'CYCLE LIBRE',
    enemyLevelBonus: Math.min(12, cycleCount * 2),
    enemyHpMultiplier: multiply(1 + pressureStep * 0.055, 'enemyHpMultiplier'),
    enemyPowerMultiplier: multiply(1 + pressureStep * 0.035, 'enemyPowerMultiplier'),
    enemyGuardMultiplier: multiply(1 + pressureStep * 0.03, 'enemyGuardMultiplier'),
    enemySpiritMultiplier: multiply(1 + pressureStep * 0.035, 'enemySpiritMultiplier'),
    enemySpeedBonus: Math.min(8, Math.floor(cycleCount * 1.25)) + number(lawEffects.enemySpeedBonus),
    xpMultiplier: multiply(1 + rewardStep * 0.04, 'xpMultiplier'),
    creditMultiplier: multiply(1 + rewardStep * 0.035, 'creditMultiplier'),
    materialMultiplier: multiply(1, 'materialMultiplier'),
    needRateMultiplier: multiply(1, 'needRateMultiplier'),
    syncGainMultiplier: multiply(1, 'syncGainMultiplier'),
    sanctuaryMultiplier: multiply(1, 'sanctuaryMultiplier'),
    patrolRespawnMultiplier: multiply(1, 'patrolRespawnMultiplier'),
    anomalyCount: Math.floor(number(lawEffects.anomalyCount)),
    capped: cycleCount >= 8,
  });
}

/** Selects rotating anomaly regions deterministically, keeping every run reproducible. */
export function selectCycleAnomalies(cycleCount, lawId, regionIds = CYCLE_REGION_IDS) {
  const scaling = getCycleScaling(cycleCount, lawId);
  const uniqueRegions = Array.from(new Set(regionIds.map(String))).filter(Boolean);
  const result = Object.fromEntries(uniqueRegions.map((regionId) => [regionId, false]));
  if (!uniqueRegions.length || !scaling.anomalyCount) return deepFreeze(result);

  const lawIndex = Object.keys(CYCLE_LAWS).indexOf(scaling.lawId);
  const offset = (scaling.cycleCount + Math.max(0, lawIndex) * 2) % uniqueRegions.length;
  const count = Math.min(scaling.anomalyCount, uniqueRegions.length);
  for (let index = 0; index < count; index += 1) {
    result[uniqueRegions[(offset + index) % uniqueRegions.length]] = true;
  }
  return deepFreeze(result);
}

/**
 * Builds the small patch the runtime needs when the player chooses a law.
 * Legacy saves that only contain newCycleBonus are inferred safely.
 */
export function createNextCyclePlan(state = {}, lawId) {
  const legacyCount = Math.floor(Math.max(0, number(state.newCycleBonus)) / 2);
  const currentCycle = Math.max(normalizeCycleCount(state.cycleCount), legacyCount);
  const cycleCount = Math.min(99, currentCycle + 1);
  const law = getCycleLaw(lawId);
  const scaling = getCycleScaling(cycleCount, law.id);
  const cycleAnomalies = selectCycleAnomalies(cycleCount, law.id);

  return deepFreeze({
    cycleCount,
    cycleModifier: law.id,
    cycleAnomalies,
    newCycleBonus: scaling.enemyLevelBonus,
    bondBonus: 5,
    coreSeedBonus: 1,
    scaling,
  });
}

/**
 * Convenience helper for enemy factories. It returns a new object and leaves
 * both the template and cycle state untouched.
 */
export function scaleEnemyForCycle(enemy = {}, cycleOrState = 0, explicitLawId = null) {
  const scaling = getCycleScaling(cycleOrState, explicitLawId);
  const scaled = {
    ...enemy,
    level: Math.max(1, Math.round(number(enemy.level, 1) + scaling.enemyLevelBonus)),
    maxHp: Math.max(1, Math.round(number(enemy.maxHp, 1) * scaling.enemyHpMultiplier)),
    power: Math.max(1, Math.round(number(enemy.power, 1) * scaling.enemyPowerMultiplier)),
    guard: Math.max(0, Math.round(number(enemy.guard) * scaling.enemyGuardMultiplier)),
    spirit: Math.max(0, Math.round(number(enemy.spirit) * scaling.enemySpiritMultiplier)),
    speed: Math.max(0, Math.round(number(enemy.speed) + scaling.enemySpeedBonus), 0),
    xp: Math.max(0, Math.round(number(enemy.xp) * scaling.xpMultiplier)),
    credits: Math.max(0, Math.round(number(enemy.credits) * scaling.creditMultiplier)),
  };
  scaled.hp = Math.max(0, Math.min(scaled.maxHp, Math.round(number(enemy.hp, enemy.maxHp || 1) * scaling.enemyHpMultiplier)));
  return scaled;
}

export { BASE_CYCLE_EFFECTS };
