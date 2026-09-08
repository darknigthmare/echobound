import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORM_TECHNIQUE_PROFILES,
  UNISON_VARIANTS,
  consumeGuard,
  getTechniqueProfile,
  resolveFinalBossDamage,
  resolveTechnique,
  resolveUnison,
} from '../src/combat-rules.js';

const makeActor = () => ({
  hp: 40,
  maxHp: 100,
  mp: 10,
  maxMp: 50,
  morale: 50,
  bond: 70,
  fatigue: 30,
});

const makeEnemy = (overrides = {}) => ({
  hp: 100,
  maxHp: 100,
  power: 50,
  spirit: 40,
  speed: 20,
  final: false,
  phaseTwo: false,
  ...overrides,
});

test('les onze formes possèdent des techniques et effets distincts', () => {
  const profiles = Object.values(FORM_TECHNIQUE_PROFILES);

  assert.equal(profiles.length, 11);
  assert.equal(new Set(profiles.map(({ technique }) => technique)).size, 11);
  assert.equal(new Set(profiles.map(({ effect }) => effect.id)).size, 11);
  assert.deepEqual(new Set(profiles.map(({ stage }) => stage)), new Set([1, 2, 3]));

  for (const profile of profiles) {
    assert.ok(UNISON_VARIANTS[profile.unisonVariant], `${profile.formName} doit avoir une variante Unisson`);
    assert.ok(profile.damageMultiplier > 1);
    assert.ok(profile.cost > 0);
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.effect));
  }
});

test('une forme inconnue est rejetée explicitement', () => {
  assert.throws(() => getTechniqueProfile('forme_absente'), /Forme de combat inconnue/);
});

test('la garde est consommée une seule fois', () => {
  const battle = { allyGuard: true };

  assert.equal(consumeGuard(battle, 'allyGuard'), true);
  assert.equal(battle.allyGuard, false);
  assert.equal(consumeGuard(battle, 'allyGuard'), false);
  assert.equal(consumeGuard(null, 'allyGuard'), false);
});

test('un coup létal force la phase deux du boss final au lieu de donner la victoire', () => {
  const boss = makeEnemy({ hp: 60, maxHp: 100, final: true });

  const result = resolveFinalBossDamage(boss, 999);

  assert.equal(result.transitioned, true);
  assert.equal(result.defeated, false);
  assert.equal(boss.phaseTwo, true);
  assert.equal(boss.hp, 12);
  assert.equal(boss.power, 59);
  assert.equal(boss.spirit, 48);
  assert.equal(boss.speed, 25);
});

test('les bonus de phase deux ne peuvent pas être appliqués deux fois', () => {
  const boss = makeEnemy({ hp: 40, final: true });

  assert.equal(resolveFinalBossDamage(boss, 1).transitioned, true);
  const buffed = { power: boss.power, spirit: boss.spirit, speed: boss.speed };
  const lethal = resolveFinalBossDamage(boss, 999);

  assert.equal(lethal.transitioned, false);
  assert.equal(lethal.defeated, true);
  assert.equal(boss.hp, 0);
  assert.deepEqual({ power: boss.power, spirit: boss.spirit, speed: boss.speed }, buffed);
});

test('une cible ordinaire peut être vaincue sans transition artificielle', () => {
  const enemy = makeEnemy();
  const result = resolveFinalBossDamage(enemy, 100);

  assert.equal(result.transitioned, false);
  assert.equal(result.defeated, true);
  assert.equal(enemy.hp, 0);
});

test('les techniques appliquent leur identité sans aléatoire', () => {
  const predator = resolveTechnique({
    formId: 'mote_feral',
    actor: makeActor(),
    target: makeEnemy({ hp: 30 }),
    battle: { sync: 0 },
    damage: 25,
  });
  assert.equal(predator.damage, 28, 'la Morsure exécute une cible affaiblie');

  const bastionActor = makeActor();
  const bastionBattle = { sync: 0, allyGuard: false };
  const bastion = resolveTechnique({
    formId: 'mote_aegis',
    actor: bastionActor,
    target: makeEnemy(),
    battle: bastionBattle,
    damage: 20,
  });
  assert.equal(bastion.effect.id, 'aegis_shell');
  assert.equal(bastionBattle.allyGuard, true);
  assert.equal(bastionActor.mp, 14);

  const oracleTarget = makeEnemy();
  resolveTechnique({
    formId: 'veilwing',
    actor: makeActor(),
    target: oracleTarget,
    battle: { sync: 0 },
    damage: 20,
  });
  assert.equal(oracleTarget.power, 46);
});

test('Ravage Dimensionnel convertit 8 % des dégâts réellement infligés en PV', () => {
  const actor = makeActor();
  const target = makeEnemy({ hp: 80, maxHp: 100 });
  const result = resolveTechnique({
    formId: 'riftclaw',
    actor,
    target,
    battle: { sync: 0 },
    damage: 50,
  });

  assert.equal(result.damageResult.damageApplied, 50);
  assert.equal(result.effect.hpRestored, 4);
  assert.equal(actor.hp, 44);
  assert.equal(result.effect.enemyPowerReduced ?? 0, 0);
  assert.equal(target.power, 50);
});

test('le vol de vie de Ravage Dimensionnel respecte les dégâts effectifs et les PV maximum', () => {
  const woundedActor = { ...makeActor(), hp: 40 };
  const overkillTarget = makeEnemy({ hp: 25, maxHp: 100 });
  const overkill = resolveTechnique({
    formId: 'riftclaw',
    actor: woundedActor,
    target: overkillTarget,
    battle: { sync: 0 },
    damage: 100,
  });

  assert.equal(overkill.damageResult.damageApplied, 25);
  assert.equal(overkill.effect.hpRestored, 2);
  assert.equal(woundedActor.hp, 42);

  const cappedActor = { ...makeActor(), hp: 98 };
  const capped = resolveTechnique({
    formId: 'riftclaw',
    actor: cappedActor,
    target: makeEnemy({ hp: 80, maxHp: 100 }),
    battle: { sync: 0 },
    damage: 50,
  });

  assert.equal(capped.effect.hpRestored, 2);
  assert.equal(cappedActor.hp, cappedActor.maxHp);

  const untouchedActor = makeActor();
  const zero = resolveTechnique({
    formId: 'riftclaw',
    actor: untouchedActor,
    target: makeEnemy(),
    battle: { sync: 0 },
    damage: 0,
  });

  assert.equal(zero.damageResult.damageApplied, 0);
  assert.equal(zero.effect.hpRestored, 0);
  assert.equal(untouchedActor.hp, 40);
});

test('les quatre variantes Unisson produisent des résultats différents', () => {
  const forms = ['dreadmaw', 'cathedral', 'seraph', 'sovereign'];
  const results = forms.map((formId) => {
    const actor = makeActor();
    const target = makeEnemy();
    const battle = { sync: 100, allyGuard: false };
    const result = resolveUnison({ formId, actor, target, battle, damage: 50 });
    return {
      variant: result.variant.name,
      damage: result.damage,
      hp: actor.hp,
      mp: actor.mp,
      sync: battle.sync,
      guard: battle.allyGuard,
      fatigue: actor.fatigue,
    };
  });

  assert.equal(new Set(results.map(({ variant }) => variant)).size, 4);
  assert.equal(new Set(results.map(({ damage }) => damage)).size, 4);
  assert.equal(new Set(results.map(({ sync }) => sync)).size, 4);
  assert.equal(results.find(({ variant }) => variant === 'UNISSON DU BASTION').guard, true);
  assert.ok(results.find(({ variant }) => variant === 'UNISSON ORACLE').mp > 20);
});

test('une technique létale déclenche elle aussi la phase deux obligatoire', () => {
  const boss = makeEnemy({ hp: 20, final: true });
  const result = resolveTechnique({
    formId: 'dreadmaw',
    actor: makeActor(),
    target: boss,
    battle: { sync: 0 },
    damage: 500,
  });

  assert.equal(result.damageResult.transitioned, true);
  assert.equal(result.damageResult.defeated, false);
  assert.equal(boss.hp, 12);
});
