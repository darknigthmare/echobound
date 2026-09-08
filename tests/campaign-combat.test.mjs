import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';
import { getTechniqueProfile } from '../src/combat-rules.js';
import { WORLD_LAYOUTS } from '../src/world-layouts.js';

test('le calcul réel applique perforation et critique sans modifier les attaques ordinaires', async () => {
  const h = await createGameHarness();
  const actor = { power: 40, spirit: 35, speed: 20, level: 5 };
  const defender = { guard: 40, speed: 20 };
  h.setRandom(.08);
  const ordinary = h.game.calculateDamage(actor, defender);
  const technique = h.game.calculateDamage(actor, defender, 1, false, false, getTechniqueProfile('riftclaw'));
  assert.equal(ordinary.critical, false);
  assert.equal(technique.critical, true);
  assert.equal(ordinary.amount, 45);
  assert.equal(technique.amount, 78);
  h.setRandom(.5);
  const withoutPierce = h.game.calculateDamage(actor, defender, 1, true);
  const withPierce = h.game.calculateDamage(actor, defender, 1, true, false, getTechniqueProfile('mote_veil'));
  assert.equal(withPierce.critical, false);
  assert.ok(withPierce.amount > withoutPierce.amount);
});

test('Ravage Dimensionnel brise la garde avant sa frappe, les autres techniques la respectent', async () => {
  async function strike(formId, guarding) {
    const h = await createGameHarness();
    const g = h.game;
    g.state.flags.combatTutorialSeen = true;
    Object.assign(g.state.partner, { formId, power: 40, guard: 30, spirit: 35, speed: 20, level: 5, hp: 500, maxHp: 500, mp: 100, maxMp: 100, discipline: 100, bond: 100, morale: 100, hunger: 0, fatigue: 0 });
    g.startBattle({ id: 'guard-target', name: 'Cible', hp: 1000, maxHp: 1000, maxMp: 10, mp: 10, guard: 40, speed: 20, power: 10, spirit: 10, level: 5 });
    g.battle.enemyGuard = guarding;
    let cursor = 0;
    h.setRandom(() => [.2, .08, .4][cursor++] ?? .5);
    g.battleCommand('skill');
    assert.equal(g.battle.enemyGuard, false);
    return 1000 - g.battle.enemy.hp;
  }
  assert.equal(await strike('riftclaw', true), await strike('riftclaw', false));
  assert.ok(await strike('mote_feral', true) < await strike('mote_feral', false));
});

test('le Cœur propose les trois essentiels sans usurper les services recrutés', async () => {
  const h = await createGameHarness();
  h.game.serviceType = 'core';
  h.game.renderService();
  const html = h.DOM.serviceContent.innerHTML;
  for (const id of ['ration', 'medgel', 'ether']) assert.ok(html.includes(`core-supply:${id}`));
  for (const id of ['stimulant', 'incense', 'scrap', 'spore', 'coreSeed']) assert.equal(html.includes(`core-supply:${id}`), false);
  const credits = h.game.state.credits;
  const stock = h.game.state.inventory.medgel;
  h.service('core-supply:medgel');
  assert.equal(h.game.state.credits, credits - h.ITEMS.medgel.price);
  assert.equal(h.game.state.inventory.medgel, stock + 1);
  const saved = JSON.parse(h.storage.getItem(h.saveSystem.SAVE_KEY));
  assert.equal(saved.credits, credits - h.ITEMS.medgel.price);
  assert.equal(saved.inventory.medgel, stock + 1);
});

test('le ravitaillement refuse argent insuffisant, stock invalide et achats hors Cœur', async () => {
  const h = await createGameHarness();
  const g = h.game;
  g.serviceType = 'core';
  for (const id of ['coreSeed', '__proto__', 'ration:0', 'stimulant']) assert.equal(g.purchaseCoreSupply(id), false);
  g.state.credits = 44;
  assert.equal(g.purchaseCoreSupply('medgel'), false);
  assert.equal(g.state.credits, 44);
  g.state.credits = 90;
  for (const stock of [-1, 1.5, NaN, 1_000_000_000]) {
    g.state.inventory.medgel = stock;
    assert.equal(g.purchaseCoreSupply('medgel'), false);
    assert.equal(g.state.credits, 90);
  }
  g.state.inventory.medgel = 2;
  g.state.map = 'wastes_gatefall';
  assert.equal(g.purchaseCoreSupply('medgel'), false);
  g.state.map = 'city'; g.serviceType = 'shop';
  assert.equal(g.purchaseCoreSupply('medgel'), false);
  g.serviceType = 'core'; g.mode = 'battle';
  assert.equal(g.purchaseCoreSupply('medgel'), false);
  assert.equal(g.state.inventory.medgel, 2);
  assert.equal(g.state.credits, 90);
});

test('Rook attend trois patrouilles distinctes, pas des duels ou un gardien', async () => {
  const h = await createGameHarness();
  h.game.state.regionWins.foundry = 99;
  const patrolIds = WORLD_LAYOUTS.foundry.sectors.flatMap(({ patrols }) => patrols.map(({ id }) => id));
  h.game.state.patrolVictories.push(...patrolIds.slice(0, 2));
  assert.equal(h.RESIDENTS.rook.requires(h.game), false);
  h.game.state.patrolVictories.push(patrolIds[2]);
  assert.equal(h.RESIDENTS.rook.requires(h.game), true);
});

function interact(h, predicate) {
  const entity = h.game.getInteractables().find(predicate);
  assert.ok(entity, 'The requested interaction must really exist on this map.');
  h.game.nearestInteractable = entity;
  h.game.handleAction();
  h.finishDialogues();
}

function resolveCommandBattle(h) {
  const g = h.game;
  let result = null;
  let ticks = 0;
  while (g.battle && ticks++ < 500) {
    if (g.battle.phase === 'player') {
      const p = g.state.partner;
      const command = g.battle.sync >= 100 ? 'sync'
        : p.hp < p.maxHp * .55 && g.state.inventory.medgel > 0 ? 'item'
          : p.mp >= getTechniqueProfile(p.formId).cost ? 'skill' : 'encourage';
      g.battleCommand(command);
    }
    if (g.battle?.ended) result = g.battle.result;
    g.updateBattle(2, {});
    h.finishDialogues();
  }
  assert.ok(ticks < 500, 'Combat must terminate using real commands.');
  assert.equal(result, 'victory');
}

for (const starter of ['feral', 'aegis', 'veil']) for (const seed of [1, 7, 42]) {
  test(`${starter}, graine ${seed}: Brakk après deux patrouilles avec son économie de départ`, async () => {
    const h = await createGameHarness({ starter, seed });
    const g = h.game;
    g.startNewGame(starter);
    h.finishDialogues();
    interact(h, ({ type }) => type === 'core');
    h.service('core-supply:medgel');
    g.closeOverlays();
    interact(h, ({ id }) => id === 'portal_wastes');
    for (const patrol of WORLD_LAYOUTS.wastes.sectors[0].patrols) {
      interact(h, ({ type, id }) => type === 'enemy' && id === patrol.id);
      resolveCommandBattle(h);
    }
    assert.equal(g.getRegionPatrolWinCount('wastes'), 2);
    assert.equal(g.state.partner.level, 2);
    interact(h, ({ type }) => type === 'exit');
    interact(h, ({ type }) => type === 'core');
    h.service('sleep');
    while (g.state.partner.hunger > 35 && g.state.inventory.ration > 0) h.service('feed');
    while (g.state.inventory.medgel < 3 && g.state.credits >= h.ITEMS.medgel.price) h.service('core-supply:medgel');
    g.closeOverlays();
    interact(h, ({ id }) => id === 'portal_wastes');
    interact(h, ({ type, unlocked, data }) => type === 'transition' && unlocked && data.to.sectorId === 'wastes_caravan_scars');
    interact(h, ({ type, id }) => type === 'resident' && id === 'brakk');
    resolveCommandBattle(h);
    assert.equal(g.state.recruited.includes('brakk'), true);
    assert.ok(g.state.credits >= 0);
    assert.ok(Object.values(g.state.inventory).every((count) => count >= 0));
    assert.equal(JSON.parse(h.storage.getItem(h.saveSystem.SAVE_KEY)).recruited.includes('brakk'), true);
  });
}
