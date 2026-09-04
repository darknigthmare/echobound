import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CYCLE_LAWS,
  EVOLUTION_PATHS,
  FORM_STAGES,
  createNextCyclePlan,
  evaluateCare,
  evaluateEvolution,
  getCycleLaw,
  getCycleScaling,
  getEvolutionTarget,
  scaleEnemyForCycle,
  selectCycleAnomalies,
} from '../src/progression-rules.js';

const makePartner = (overrides = {}) => ({
  formId: 'mote_feral',
  level: 5,
  power: 15,
  guard: 9,
  spirit: 8,
  speed: 13,
  bond: 42,
  discipline: 48,
  morale: 70,
  hunger: 16,
  fatigue: 8,
  careMistakes: 0,
  ...overrides,
});

test('les onze formes et les quatre voies couvrent les deux paliers', () => {
  assert.equal(Object.keys(FORM_STAGES).length, 11);
  assert.deepEqual(new Set(Object.values(FORM_STAGES)), new Set([1, 2, 3]));
  assert.equal(Object.keys(EVOLUTION_PATHS).length, 4);
  for (const path of Object.values(EVOLUTION_PATHS)) {
    assert.ok(FORM_STAGES[path.targets[2]] === 2);
    assert.ok(FORM_STAGES[path.targets[3]] === 3);
    assert.ok(Object.isFrozen(path));
  }
});

test('les trois starters conservent une évolution naturelle liée à leurs statistiques', () => {
  assert.equal(getEvolutionTarget(makePartner()), 'riftclaw');
  assert.equal(getEvolutionTarget(makePartner({ formId: 'mote_aegis', power: 8, guard: 16, spirit: 9, speed: 8, discipline: 68 })), 'ironhide');
  assert.equal(getEvolutionTarget(makePartner({ formId: 'mote_veil', power: 7, guard: 8, spirit: 16, speed: 12, discipline: 50 })), 'veilwing');
});

test('le lien et l’équilibre ouvrent réellement la voie du Nexus', () => {
  const candidate = makePartner({ power: 14, guard: 14, spirit: 14, speed: 14, bond: 92, discipline: 64, morale: 86, hunger: 4, fatigue: 5 });
  const decision = evaluateEvolution(candidate);

  assert.equal(decision.pathId, 'concord');
  assert.equal(decision.targetFormId, 'nexusfox');
  assert.ok(decision.breakdown.concord.bond > 28);
  assert.equal(candidate.formId, 'mote_feral', 'l’évaluation ne mute pas le partenaire');
});

test('la discipline, la faim, la fatigue et les erreurs de soin modifient les scores', () => {
  const healthy = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 82, discipline: 70, hunger: 5, fatigue: 7, careMistakes: 0 }));
  const neglected = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 82, discipline: 20, hunger: 95, fatigue: 90, careMistakes: 6 }));

  assert.ok(healthy.scores.aegis > neglected.scores.aegis, 'discipline et stabilité renforcent le Rempart');
  assert.ok(healthy.scores.oracle > neglected.scores.oracle, 'les soins réguliers renforcent le Voile');
  assert.ok(healthy.scores.concord > neglected.scores.concord, 'la négligence ferme la Concorde');
  assert.ok(neglected.scores.feral > healthy.scores.feral, 'la pression nourrit la voie de la Faille');
  assert.equal(healthy.care.grade, 'exemplary');
  assert.equal(neglected.care.grade, 'critical');
});

test('les erreurs de soin sont plafonnées et les valeurs invalides sont assainies', () => {
  const care = evaluateCare({ hunger: 500, fatigue: Number.NaN, careMistakes: 1000 });
  assert.equal(care.hunger, 100);
  assert.equal(care.fatigue, 0);
  assert.equal(care.mistakePressure, 100);
  assert.ok(care.strain >= 0 && care.strain <= 100);
  assert.ok(Object.isFrozen(care));
});

test('un niveau insuffisant donne une prévision sans déclencher l’évolution', () => {
  const decision = evaluateEvolution(makePartner({ level: 4 }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'level-required');
  assert.equal(decision.requiredLevel, 5);
  assert.equal(decision.targetFormId, null);
  assert.equal(decision.previewTargetFormId, 'riftclaw');
});

test('le stade III exige le niveau 10 et respecte les soins de haute qualité', () => {
  const decision = evaluateEvolution(makePartner({
    formId: 'nexusfox', level: 10, power: 28, guard: 27, spirit: 29, speed: 28,
    bond: 94, discipline: 66, morale: 90, hunger: 7, fatigue: 9,
  }));
  assert.equal(decision.targetFormId, 'sovereign');
  assert.equal(decision.targetStage, 3);
});

test('les quatre voies du stade III restent accessibles par des histoires distinctes', () => {
  const candidates = [
    ['dreadmaw', makePartner({ formId: 'riftclaw', level: 10, power: 31, guard: 17, spirit: 16, speed: 28, bond: 50, discipline: 28, hunger: 72, fatigue: 68, careMistakes: 4 })],
    ['cathedral', makePartner({ formId: 'ironhide', level: 10, power: 18, guard: 31, spirit: 18, speed: 19, bond: 65, discipline: 90, hunger: 5, fatigue: 10 })],
    ['seraph', makePartner({ formId: 'veilwing', level: 10, power: 17, guard: 18, spirit: 31, speed: 26, bond: 75, discipline: 60, morale: 90, hunger: 5, fatigue: 8 })],
    ['sovereign', makePartner({ formId: 'nexusfox', level: 10, power: 28, guard: 27, spirit: 29, speed: 28, bond: 94, discipline: 66, morale: 90, hunger: 7, fatigue: 9 })],
  ];

  for (const [expected, partner] of candidates) {
    assert.equal(getEvolutionTarget(partner), expected, `${expected} doit rester atteignable`);
  }
});

test('chaque besoin de soin a un effet individuel et mesurable', () => {
  const baseline = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 80, discipline: 65, hunger: 0, fatigue: 0, careMistakes: 0 }));
  const hungry = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 80, discipline: 65, hunger: 80, fatigue: 0, careMistakes: 0 }));
  const tired = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 80, discipline: 65, hunger: 0, fatigue: 80, careMistakes: 0 }));
  const mistakes = evaluateEvolution(makePartner({ power: 12, guard: 12, spirit: 12, speed: 12, bond: 80, discipline: 65, hunger: 0, fatigue: 0, careMistakes: 5 }));

  for (const altered of [hungry, tired, mistakes]) {
    assert.ok(altered.care.stability < baseline.care.stability);
    assert.ok(altered.scores.oracle < baseline.scores.oracle);
    assert.ok(altered.scores.feral > baseline.scores.feral);
  }
});

test('les formes inconnues et finales ne peuvent pas évoluer', () => {
  assert.equal(evaluateEvolution(makePartner({ formId: 'missing' })).reason, 'unknown-form');
  const final = evaluateEvolution(makePartner({ formId: 'dreadmaw', level: 99 }));
  assert.equal(final.reason, 'maximum-stage');
  assert.equal(final.targetFormId, null);
});

test('exactement trois lois de cycle offrent des compromis distincts', () => {
  assert.equal(Object.keys(CYCLE_LAWS).length, 3);
  const signatures = Object.values(CYCLE_LAWS).map((law) => JSON.stringify(law.effects));
  assert.equal(new Set(signatures).size, 3);
  assert.ok(CYCLE_LAWS.echo_storm.effects.syncGainMultiplier > 1);
  assert.ok(CYCLE_LAWS.iron_oath.effects.sanctuaryMultiplier > 1);
  assert.ok(CYCLE_LAWS.hungry_horizon.effects.needRateMultiplier > 1);
  assert.throws(() => getCycleLaw('absente'), /Loi de cycle inconnue/);
});

test('le cycle zéro reste strictement neutre même avec un identifiant de loi', () => {
  const scaling = getCycleScaling(0, 'echo_storm');
  assert.equal(scaling.lawId, 'none');
  assert.equal(scaling.enemyLevelBonus, 0);
  assert.equal(scaling.enemyHpMultiplier, 1);
  assert.equal(scaling.xpMultiplier, 1);
});

test('le scalage augmente de façon contrôlée puis atteint un plafond', () => {
  const first = getCycleScaling(1, 'iron_oath');
  const eighth = getCycleScaling(8, 'iron_oath');
  const twentieth = getCycleScaling(20, 'iron_oath');

  assert.equal(first.enemyLevelBonus, 2);
  assert.ok(eighth.enemyHpMultiplier > first.enemyHpMultiplier);
  assert.equal(twentieth.enemyLevelBonus, 12);
  assert.equal(twentieth.enemyHpMultiplier, eighth.enemyHpMultiplier);
  assert.equal(twentieth.enemyPowerMultiplier, eighth.enemyPowerMultiplier);
  assert.equal(twentieth.xpMultiplier, eighth.xpMultiplier);
  assert.equal(twentieth.capped, true);
});

test('les anomalies régionales sont reproductibles et tournent entre les cycles', () => {
  const first = selectCycleAnomalies(1, 'echo_storm');
  const repeated = selectCycleAnomalies(1, 'echo_storm');
  const next = selectCycleAnomalies(2, 'echo_storm');

  assert.deepEqual(first, repeated);
  assert.equal(Object.values(first).filter(Boolean).length, 2);
  assert.notDeepEqual(first, next);
  assert.equal(Object.values(selectCycleAnomalies(1, 'hungry_horizon')).filter(Boolean).length, 3);
});

test('le plan NG+ migre un ancien bonus, ne mute pas la sauvegarde et expose le patch', () => {
  const legacy = { newCycleBonus: 6, cycleCount: 0, cycleModifier: 'none' };
  const snapshot = structuredClone(legacy);
  const plan = createNextCyclePlan(legacy, 'echo_storm');

  assert.equal(plan.cycleCount, 4);
  assert.equal(plan.newCycleBonus, 8);
  assert.equal(plan.cycleModifier, 'echo_storm');
  assert.equal(plan.bondBonus, 5);
  assert.equal(plan.coreSeedBonus, 1);
  assert.deepEqual(legacy, snapshot);
  assert.ok(Object.isFrozen(plan));
});

test('le helper ennemi applique niveaux, statistiques et récompenses sans mutation', () => {
  const enemy = { level: 4, hp: 80, maxHp: 100, power: 20, guard: 18, spirit: 16, speed: 12, xp: 50, credits: 40 };
  const snapshot = structuredClone(enemy);
  const scaled = scaleEnemyForCycle(enemy, { cycleCount: 2, cycleModifier: 'echo_storm' });

  assert.equal(scaled.level, 8);
  assert.ok(scaled.maxHp > enemy.maxHp);
  assert.ok(scaled.power > enemy.power);
  assert.ok(scaled.spirit > enemy.spirit);
  assert.ok(scaled.speed > enemy.speed);
  assert.ok(scaled.xp > enemy.xp);
  assert.ok(scaled.credits > enemy.credits);
  assert.deepEqual(enemy, snapshot);
});
