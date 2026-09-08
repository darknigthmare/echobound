const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  effect: Object.freeze({ ...profile.effect }),
});

/**
 * Combat identity for every playable form.
 *
 * The values are intentionally data-only: the browser game can use them for
 * labels, costs and damage calculation while the resolvers below handle the
 * deterministic secondary effects.
 */
export const FORM_TECHNIQUE_PROFILES = Object.freeze({
  mote_feral: freezeProfile({
    formName: 'MOTE PRÉDATEUR',
    technique: 'Morsure de Faille',
    stage: 1,
    cost: 16,
    scaling: 'power',
    damageMultiplier: 1.6,
    guardPierce: 0.08,
    criticalBonus: 0.04,
    syncGain: 18,
    unisonVariant: 'assault',
    effect: { id: 'feral_execute', threshold: 0.35, damageMultiplier: 1.12 },
  }),
  mote_aegis: freezeProfile({
    formName: 'GERME-CARAPACE',
    technique: 'Onde de Rempart',
    stage: 1,
    cost: 16,
    scaling: 'guard',
    damageMultiplier: 1.48,
    guardPierce: 0,
    criticalBonus: 0,
    syncGain: 16,
    unisonVariant: 'bastion',
    effect: { id: 'aegis_shell', grantsGuard: true, mpRestore: 4 },
  }),
  mote_veil: freezeProfile({
    formName: 'LUCIOLE DU VOILE',
    technique: 'Rayon Mnémique',
    stage: 1,
    cost: 16,
    scaling: 'spirit',
    damageMultiplier: 1.58,
    guardPierce: 0.05,
    criticalBonus: 0.03,
    syncGain: 21,
    unisonVariant: 'oracle',
    effect: { id: 'mnemonic_ray', mpRestore: 8, bonusSync: 4 },
  }),
  riftclaw: freezeProfile({
    formName: 'GRIFFE-FAILLE',
    technique: 'Ravage Dimensionnel',
    stage: 2,
    cost: 20,
    scaling: 'power',
    damageMultiplier: 1.88,
    guardPierce: 0.3,
    criticalBonus: 0.1,
    syncGain: 22,
    unisonVariant: 'assault',
    effect: { id: 'dimensional_ravage', breaksEnemyGuard: true, lifeSteal: 0.08 },
  }),
  ironhide: freezeProfile({
    formName: 'CUIRASSE ABYSSALE',
    technique: 'Bélier Sismique',
    stage: 2,
    cost: 20,
    scaling: 'guard',
    damageMultiplier: 1.72,
    guardPierce: 0.16,
    criticalBonus: 0.02,
    syncGain: 19,
    unisonVariant: 'bastion',
    effect: { id: 'seismic_ram', breaksEnemyGuard: true, grantsGuard: true },
  }),
  veilwing: freezeProfile({
    formName: 'PHALÈNE ORACLE',
    technique: 'Poussière du Songe',
    stage: 2,
    cost: 20,
    scaling: 'spirit',
    damageMultiplier: 1.78,
    guardPierce: 0.1,
    criticalBonus: 0.06,
    syncGain: 23,
    unisonVariant: 'oracle',
    effect: { id: 'dream_dust', enemyPowerMultiplier: 0.92 },
  }),
  nexusfox: freezeProfile({
    formName: 'RENARD DU NEXUS',
    technique: 'Arc de Convergence',
    stage: 2,
    cost: 20,
    scaling: 'hybrid',
    damageMultiplier: 1.82,
    guardPierce: 0.14,
    criticalBonus: 0.05,
    syncGain: 26,
    unisonVariant: 'nexus',
    effect: { id: 'convergence_arc', bonusSync: 10, bondGain: 0.25 },
  }),
  dreadmaw: freezeProfile({
    formName: 'GUEULE D’ÉCLIPSE',
    technique: 'Dévoration du Zénith',
    stage: 3,
    cost: 24,
    scaling: 'power',
    damageMultiplier: 2.12,
    guardPierce: 0.38,
    criticalBonus: 0.12,
    syncGain: 25,
    unisonVariant: 'assault',
    effect: { id: 'zenith_devour', lifeSteal: 0.18 },
  }),
  cathedral: freezeProfile({
    formName: 'TITAN-CATHÉDRALE',
    technique: 'Jugement Monolithique',
    stage: 3,
    cost: 24,
    scaling: 'guard',
    damageMultiplier: 1.94,
    guardPierce: 0.22,
    criticalBonus: 0.03,
    syncGain: 22,
    unisonVariant: 'bastion',
    effect: { id: 'monolithic_judgement', grantsGuard: true, healMaxHpRatio: 0.06 },
  }),
  seraph: freezeProfile({
    formName: 'SÉRAPHIN DU VOILE',
    technique: 'Chœur des Mondes Morts',
    stage: 3,
    cost: 24,
    scaling: 'spirit',
    damageMultiplier: 2.02,
    guardPierce: 0.18,
    criticalBonus: 0.08,
    syncGain: 27,
    unisonVariant: 'oracle',
    effect: { id: 'worlds_chorus', healMaxHpRatio: 0.1, mpRestoreMaxRatio: 0.12, fatigueRecovery: 6 },
  }),
  sovereign: freezeProfile({
    formName: 'SOUVERAIN DES ÉCHOS',
    technique: 'Unisson Absolu',
    stage: 3,
    cost: 24,
    scaling: 'hybrid',
    damageMultiplier: 2.08,
    guardPierce: 0.26,
    criticalBonus: 0.09,
    syncGain: 30,
    unisonVariant: 'nexus',
    effect: { id: 'absolute_resonance', bonusSync: 18, bondGain: 0.5, moraleGain: 4 },
  }),
});

export const UNISON_VARIANTS = Object.freeze({
  assault: Object.freeze({
    name: 'UNISSON PRÉDATEUR',
    damageMultiplier: 1.18,
    healMaxHpRatio: 0.12,
    mpRestoreMaxRatio: 0.12,
    syncRefund: 4,
    moraleGain: 6,
    bondGain: 0.8,
    grantsGuard: false,
    fatigueRecovery: 0,
  }),
  bastion: Object.freeze({
    name: 'UNISSON DU BASTION',
    damageMultiplier: 1,
    healMaxHpRatio: 0.24,
    mpRestoreMaxRatio: 0.16,
    syncRefund: 8,
    moraleGain: 7,
    bondGain: 0.9,
    grantsGuard: true,
    fatigueRecovery: 2,
  }),
  oracle: Object.freeze({
    name: 'UNISSON ORACLE',
    damageMultiplier: 1.06,
    healMaxHpRatio: 0.18,
    mpRestoreMaxRatio: 0.35,
    syncRefund: 10,
    moraleGain: 8,
    bondGain: 1,
    grantsGuard: false,
    fatigueRecovery: 8,
  }),
  nexus: Object.freeze({
    name: 'UNISSON DE CONVERGENCE',
    damageMultiplier: 1.12,
    healMaxHpRatio: 0.2,
    mpRestoreMaxRatio: 0.28,
    syncRefund: 16,
    moraleGain: 10,
    bondGain: 1.2,
    grantsGuard: false,
    fatigueRecovery: 5,
  }),
});

export const FINAL_BOSS_PHASE_TWO = Object.freeze({
  thresholdRatio: 0.5,
  recoveryRatio: 0.12,
  powerMultiplier: 1.18,
  spiritMultiplier: 1.2,
  speedBonus: 5,
});

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} doit être un nombre fini positif ou nul.`);
  }
  return value;
}

function restore(actor, key, maximumKey, amount) {
  if (!actor || !Number.isFinite(actor[key]) || !Number.isFinite(actor[maximumKey])) return 0;
  const before = actor[key];
  actor[key] = clamp(before + Math.max(0, amount), 0, actor[maximumKey]);
  return actor[key] - before;
}

function increaseCapped(actor, key, amount, maximum = 100) {
  if (!actor || !Number.isFinite(actor[key])) return 0;
  const before = actor[key];
  actor[key] = clamp(before + amount, 0, maximum);
  return actor[key] - before;
}

export function getTechniqueProfile(formId) {
  const profile = FORM_TECHNIQUE_PROFILES[formId];
  if (!profile) throw new RangeError(`Forme de combat inconnue : ${String(formId)}`);
  return profile;
}

/**
 * Consumes a one-use guard flag and reports whether the incoming hit is guarded.
 * The caller can pass allyGuard or enemyGuard to match the battle state.
 */
export function consumeGuard(holder, key = 'guard') {
  if (!holder || typeof holder !== 'object') return false;
  const guarded = holder[key] === true;
  if (guarded) holder[key] = false;
  return guarded;
}

/**
 * Applies damage while protecting the mandatory first-to-second phase transition.
 * A lethal phase-one hit therefore leaves the final boss alive in phase two; a
 * later lethal hit can defeat it normally.
 */
export function resolveFinalBossDamage(enemy, damage) {
  if (!enemy || typeof enemy !== 'object') throw new TypeError('Un ennemi est requis.');
  finiteNonNegative(damage, 'damage');

  const maximumHp = finiteNonNegative(enemy.maxHp, 'enemy.maxHp');
  const hpBefore = clamp(finiteNonNegative(enemy.hp, 'enemy.hp'), 0, maximumHp);
  enemy.hp = clamp(hpBefore - damage, 0, maximumHp);

  let transitioned = false;
  if (enemy.final === true && enemy.phaseTwo !== true && enemy.hp <= maximumHp * FINAL_BOSS_PHASE_TWO.thresholdRatio) {
    enemy.phaseTwo = true;
    enemy.power = Math.round((Number.isFinite(enemy.power) ? enemy.power : 0) * FINAL_BOSS_PHASE_TWO.powerMultiplier);
    enemy.spirit = Math.round((Number.isFinite(enemy.spirit) ? enemy.spirit : 0) * FINAL_BOSS_PHASE_TWO.spiritMultiplier);
    enemy.speed = (Number.isFinite(enemy.speed) ? enemy.speed : 0) + FINAL_BOSS_PHASE_TWO.speedBonus;
    enemy.hp = clamp(enemy.hp + maximumHp * FINAL_BOSS_PHASE_TWO.recoveryRatio, 1, maximumHp);
    transitioned = true;
  }

  return Object.freeze({
    transitioned,
    defeated: enemy.hp <= 0,
    hpBefore,
    hpAfter: enemy.hp,
    damageApplied: Math.min(damage, hpBefore),
  });
}

function applyTechniqueEffect(profile, actor, target, battle, damage) {
  const effect = profile.effect;
  const applied = { id: effect.id };

  if (effect.grantsGuard && battle) battle.allyGuard = true;
  if (effect.breaksEnemyGuard && battle) battle.enemyGuard = false;
  if (effect.mpRestore) applied.mpRestored = restore(actor, 'mp', 'maxMp', effect.mpRestore);
  if (effect.bonusSync && battle && Number.isFinite(battle.sync)) {
    const before = battle.sync;
    battle.sync = clamp(before + effect.bonusSync, 0, 100);
    applied.syncGained = battle.sync - before;
  }
  if (effect.bondGain) applied.bondGained = increaseCapped(actor, 'bond', effect.bondGain);
  if (effect.moraleGain) applied.moraleGained = increaseCapped(actor, 'morale', effect.moraleGain);
  if (effect.lifeSteal) applied.hpRestored = restore(actor, 'hp', 'maxHp', damage * effect.lifeSteal);
  if (effect.healMaxHpRatio) applied.hpRestored = restore(actor, 'hp', 'maxHp', actor.maxHp * effect.healMaxHpRatio);
  if (effect.mpRestoreMaxRatio) applied.mpRestored = restore(actor, 'mp', 'maxMp', actor.maxMp * effect.mpRestoreMaxRatio);
  if (effect.fatigueRecovery && Number.isFinite(actor.fatigue)) {
    const before = actor.fatigue;
    actor.fatigue = clamp(before - effect.fatigueRecovery, 0, 100);
    applied.fatigueRecovered = before - actor.fatigue;
  }
  if (effect.enemyPowerMultiplier && Number.isFinite(target.power)) {
    target.techniqueDebuffs ??= {};
    if (!target.techniqueDebuffs[effect.id]) {
      const before = target.power;
      target.power = Math.max(1, Math.round(before * effect.enemyPowerMultiplier));
      target.techniqueDebuffs[effect.id] = true;
      applied.enemyPowerReduced = before - target.power;
    } else {
      applied.enemyPowerReduced = 0;
    }
  }

  return Object.freeze(applied);
}

/**
 * Applies already-calculated technique damage and the form-specific side effect.
 * Damage calculation remains in the game; profile.damageMultiplier and related
 * fields provide the inputs for it.
 */
export function resolveTechnique({ formId, actor, target, battle = null, damage }) {
  if (!actor || typeof actor !== 'object') throw new TypeError('Un combattant allié est requis.');
  if (!target || typeof target !== 'object') throw new TypeError('Une cible est requise.');
  const profile = getTechniqueProfile(formId);
  let resolvedDamage = finiteNonNegative(damage, 'damage');

  if (
    profile.effect.threshold
    && Number.isFinite(target.hp)
    && Number.isFinite(target.maxHp)
    && target.maxHp > 0
    && target.hp / target.maxHp <= profile.effect.threshold
  ) {
    resolvedDamage *= profile.effect.damageMultiplier;
  }
  resolvedDamage = Math.max(0, Math.round(resolvedDamage));

  const damageResult = resolveFinalBossDamage(target, resolvedDamage);
  const effect = applyTechniqueEffect(profile, actor, target, battle, damageResult.damageApplied);

  return Object.freeze({ profile, damage: resolvedDamage, damageResult, effect });
}

/**
 * Resolves one of four Unison identities shared by related evolution lines.
 * The strike is deterministic and consumes the current synchronisation meter.
 */
export function resolveUnison({ formId, actor, target, battle, damage }) {
  if (!actor || typeof actor !== 'object') throw new TypeError('Un combattant allié est requis.');
  if (!target || typeof target !== 'object') throw new TypeError('Une cible est requise.');
  if (!battle || typeof battle !== 'object') throw new TypeError('Un état de combat est requis.');

  const profile = getTechniqueProfile(formId);
  const variant = UNISON_VARIANTS[profile.unisonVariant];
  const resolvedDamage = Math.max(0, Math.round(finiteNonNegative(damage, 'damage') * variant.damageMultiplier));
  const damageResult = resolveFinalBossDamage(target, resolvedDamage);

  const hpRestored = restore(actor, 'hp', 'maxHp', actor.maxHp * variant.healMaxHpRatio);
  const mpRestored = restore(actor, 'mp', 'maxMp', actor.maxMp * variant.mpRestoreMaxRatio);
  const moraleGained = increaseCapped(actor, 'morale', variant.moraleGain);
  const bondGained = increaseCapped(actor, 'bond', variant.bondGain);
  let fatigueRecovered = 0;
  if (Number.isFinite(actor.fatigue)) {
    const before = actor.fatigue;
    actor.fatigue = clamp(before - variant.fatigueRecovery, 0, 100);
    fatigueRecovered = before - actor.fatigue;
  }
  battle.sync = variant.syncRefund;
  if (variant.grantsGuard) battle.allyGuard = true;

  return Object.freeze({
    profile,
    variant,
    damage: resolvedDamage,
    damageResult,
    recovery: Object.freeze({ hpRestored, mpRestored, moraleGained, bondGained, fatigueRecovered }),
  });
}
