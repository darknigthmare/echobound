import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';
import {
  MAX_CHRONICLE_PROGRESS,
  REGIONAL_CHRONICLES,
  getChronicleStatus,
} from '../src/regional-chronicles.js';
import { WORLD_LAYOUTS } from '../src/world-layouts.js';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function sourceChoice(chronicle) {
  const event = WORLD_LAYOUTS[chronicle.region].sectors
    .flatMap((sector) => sector.events || [])
    .find(({ id }) => id === chronicle.sourceEventId);
  assert.ok(event, `événement source absent pour ${chronicle.id}`);
  assert.ok(event.choices?.[0]?.id, `choix source absent pour ${chronicle.id}`);
  return event.choices[0].id;
}

function unlockChronicle(harness, chronicle) {
  harness.game.state.expeditionChoices[chronicle.sourceEventId] = sourceChoice(chronicle);
  if (!harness.game.state.recruited.includes(chronicle.giverId)) {
    harness.game.state.recruited.push(chronicle.giverId);
  }
}

function persisted(harness) {
  const raw = harness.storage.getItem(harness.saveSystem.SAVE_KEY);
  assert.ok(raw, 'une sauvegarde principale doit avoir été écrite');
  return JSON.parse(raw);
}

function rewardSnapshot(state) {
  return {
    credits: state.credits,
    inventory: { ...state.inventory },
    partner: {
      bond: state.partner.bond,
      discipline: state.partner.discipline,
      morale: state.partner.morale,
      fatigue: state.partner.fatigue,
    },
    timeMinutes: state.timeMinutes,
    chronicleProgress: { ...state.chronicleProgress },
    chronicleChoices: { ...state.chronicleChoices },
  };
}

test('une sauvegarde v1 sans chroniques est migrée avec les deux nouveaux registres', async () => {
  const h = await createGameHarness();
  const legacy = JSON.parse(JSON.stringify(h.game.state));
  legacy.version = '1.0.0';
  delete legacy.chronicleProgress;
  delete legacy.chronicleChoices;

  const migrated = h.game.saveStore.decodeSave(JSON.stringify(legacy));

  assert.equal(migrated.version, '2.0.0');
  assert.deepEqual(Object.keys(migrated.chronicleProgress), []);
  assert.deepEqual(Object.keys(migrated.chronicleChoices), []);
  assert.equal(h.game.validateMigratedSave(migrated), true);
});

test('le runtime ouvre la branche narrative correspondant à chacun des huit choix sources', async () => {
  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    for (const [sourceChoiceId, branch] of Object.entries(chronicle.sourceBranches)) {
      const h = await createGameHarness();
      h.game.state.expeditionChoices[chronicle.sourceEventId] = sourceChoiceId;
      h.game.state.recruited.push(chronicle.giverId);
      h.game.state.map = 'city';
      h.game.serviceType = chronicle.service;

      assert.equal(h.game.beginChronicle(chronicle.id), true);
      assert.equal(h.DOM.dialogueText.textContent, branch.intro[0]);
      assert.equal(h.game.state.chronicleProgress[chronicle.id], 1);
    }
  }
});

test('un import forgé sans choix source rétrograde toute progression de chronique', async () => {
  const chronicle = REGIONAL_CHRONICLES.convoy_names;
  for (const progress of [1, 2, 3, 4]) {
    const h = await createGameHarness();
    const forged = JSON.parse(JSON.stringify(h.game.state));
    forged.recruited.push(chronicle.giverId);
    forged.chronicleProgress[chronicle.id] = progress;
    if (progress === 4) forged.chronicleChoices[chronicle.id] = chronicle.choices[0].id;

    assert.equal(h.game.importSave(JSON.stringify(forged), 'progression forgée'), true);
    assert.equal(h.game.state.chronicleProgress[chronicle.id], undefined);
    assert.equal(h.game.state.chronicleChoices[chronicle.id], undefined);
    assert.equal(getChronicleStatus(chronicle, h.game.state).status, 'undiscovered');
    h.game.state.map = 'city';
    h.game.serviceType = chronicle.service;
    assert.equal(h.game.completeChronicle(chronicle.id, chronicle.choices[0].id), false);
  }
});

test('le départ exige la ville, le service du donneur et refuse les actions forgées', async () => {
  const h = await createGameHarness();
  const chronicle = REGIONAL_CHRONICLES.convoy_names;
  const other = REGIONAL_CHRONICLES.last_watch;
  unlockChronicle(h, chronicle);
  unlockChronicle(h, other);

  h.game.state.map = chronicle.nodes[0].sectorId;
  h.game.serviceType = chronicle.service;
  h.service(`chronicle:start:${chronicle.id}`);
  assert.equal(h.game.state.chronicleProgress[chronicle.id], undefined);

  h.game.state.map = 'city';
  h.game.serviceType = other.service;
  h.service(`chronicle:start:${chronicle.id}`);
  assert.equal(h.game.state.chronicleProgress[chronicle.id], undefined);

  const beforeForged = rewardSnapshot(h.game.state);
  h.game.serviceType = chronicle.service;
  h.service(`chronicle:start:${other.id}`);
  h.service('chronicle:start:__proto__');
  h.service(`chronicle:complete:${chronicle.id}:choix_inexistant`);
  assert.deepEqual(rewardSnapshot(h.game.state), beforeForged);
  assert.equal(h.storage.getItem(h.saveSystem.SAVE_KEY), null);

  const beforeTime = h.game.state.timeMinutes;
  h.service(`chronicle:start:${chronicle.id}`);
  assert.equal(h.game.state.chronicleProgress[chronicle.id], 1);
  assert.equal(h.game.state.timeMinutes, beforeTime + 15);
  assert.equal(persisted(h).chronicleProgress[chronicle.id], 1);

  const afterStart = rewardSnapshot(h.game.state);
  h.service(`chronicle:start:${chronicle.id}`);
  assert.deepEqual(rewardSnapshot(h.game.state), afterStart, 'un second départ ne doit rien rejouer');
});

test('les deux traces apparaissent uniquement dans le bon ordre et chaque étape est sauvegardée', async () => {
  const h = await createGameHarness();
  const chronicle = REGIONAL_CHRONICLES.convoy_names;
  const [entryNode, shardNode] = chronicle.nodes;
  unlockChronicle(h, chronicle);
  h.game.state.map = 'city';
  h.game.serviceType = chronicle.service;
  assert.equal(h.game.beginChronicle(chronicle.id), true);
  h.finishDialogues();

  h.game.state.map = shardNode.sectorId;
  assert.equal(h.game.resolveChronicleNode(chronicle.id, shardNode.id), false, 'la seconde trace ne peut pas précéder la première');
  assert.equal(h.game.getInteractables().filter(({ type }) => type === 'chronicle-node').length, 0);

  h.game.state.map = entryNode.sectorId;
  let nodes = h.game.getInteractables().filter(({ type }) => type === 'chronicle-node');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, entryNode.id);
  h.game.nearestInteractable = nodes[0];
  h.game.handleAction();
  assert.equal(h.game.state.chronicleProgress[chronicle.id], 2);
  assert.equal(persisted(h).chronicleProgress[chronicle.id], 2);
  h.finishDialogues();

  assert.equal(h.game.resolveChronicleNode(chronicle.id, entryNode.id), false, 'la première trace ne peut pas être dupliquée');
  assert.equal(h.game.getInteractables().filter(({ type }) => type === 'chronicle-node').length, 0);

  h.game.state.map = shardNode.sectorId;
  nodes = h.game.getInteractables().filter(({ type }) => type === 'chronicle-node');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, shardNode.id);
  h.game.nearestInteractable = nodes[0];
  h.game.handleAction();
  assert.equal(h.game.state.chronicleProgress[chronicle.id], 3);
  assert.equal(persisted(h).chronicleProgress[chronicle.id], 3);
  h.finishDialogues();

  for (const mapId of [entryNode.sectorId, shardNode.sectorId]) {
    h.game.state.map = mapId;
    assert.equal(h.game.getInteractables().filter(({ type }) => type === 'chronicle-node').length, 0);
  }
});

test('le HUD et les passages privilégient la chronique active de la région courante', async () => {
  const h = await createGameHarness();
  const wastes = REGIONAL_CHRONICLES.convoy_names;
  const hive = REGIONAL_CHRONICLES.remembering_seed;
  unlockChronicle(h, wastes);
  unlockChronicle(h, hive);
  h.game.state.chronicleProgress[wastes.id] = 2;
  h.game.state.chronicleProgress[hive.id] = 2;
  h.game.state.map = 'hive_spore_galleries';

  assert.equal(h.game.getTrackedChronicle().chronicle.id, hive.id);
  assert.match(h.game.getObjective(), new RegExp(hive.nodes[1].sectorName));
  assert.equal(h.game.getTrackedTransitionId('hive', 'hive_spore_galleries'), 'hive_spores_to_canopy');
});

test('chaque conclusion est exclusive, applique sa récompense une seule fois et la sauvegarde immédiatement', async () => {
  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    for (const choice of chronicle.choices) {
      const h = await createGameHarness();
      unlockChronicle(h, chronicle);
      h.game.state.chronicleProgress[chronicle.id] = MAX_CHRONICLE_PROGRESS - 1;
      h.game.state.map = 'city';
      h.game.serviceType = chronicle.service;
      const before = rewardSnapshot(h.game.state);

      assert.equal(h.game.completeChronicle(chronicle.id, choice.id), true);
      const after = rewardSnapshot(h.game.state);
      const reward = choice.reward || {};
      assert.equal(after.credits, before.credits + Number(reward.credits || 0));
      assert.equal(after.timeMinutes, before.timeMinutes + 45);
      for (const [itemId, amount] of Object.entries(reward.inventory || {})) {
        assert.equal(after.inventory[itemId], before.inventory[itemId] + amount);
      }
      for (const stat of ['bond', 'discipline', 'morale', 'fatigue']) {
        if (Number.isFinite(reward[stat])) {
          const afterReward = clamp(before.partner[stat] + reward[stat]);
          const expected = stat === 'fatigue' ? clamp(afterReward + 45 * 0.012) : afterReward;
          assert.equal(after.partner[stat], expected);
        }
      }
      if (!Number.isFinite(reward.fatigue)) {
        assert.equal(after.partner.fatigue, clamp(before.partner.fatigue + 45 * 0.012));
      }
      assert.equal(after.chronicleProgress[chronicle.id], MAX_CHRONICLE_PROGRESS);
      assert.equal(after.chronicleChoices[chronicle.id], choice.id);
      assert.equal(persisted(h).chronicleChoices[chronicle.id], choice.id);

      const alternate = chronicle.choices.find(({ id }) => id !== choice.id);
      assert.equal(h.game.completeChronicle(chronicle.id, choice.id), false);
      assert.equal(h.game.completeChronicle(chronicle.id, alternate.id), false);
      assert.deepEqual(rewardSnapshot(h.game.state), after, `${chronicle.id}/${choice.id} ne doit pas être récompensée deux fois`);
    }
  }
});

test('export/import et Nouveau Cycle+ conservent les progressions et conclusions', async () => {
  const h = await createGameHarness();
  const complete = REGIONAL_CHRONICLES.convoy_names;
  const active = REGIONAL_CHRONICLES.remembering_seed;
  const available = REGIONAL_CHRONICLES.three_bells;
  unlockChronicle(h, complete);
  unlockChronicle(h, active);
  unlockChronicle(h, available);
  h.game.state.chronicleProgress[complete.id] = 3;
  h.game.state.map = 'city';
  h.game.serviceType = complete.service;
  assert.equal(h.game.completeChronicle(complete.id, complete.choices[1].id), true);
  h.game.state.chronicleProgress[active.id] = 2;
  h.game.saveGame(false);

  const exported = h.game.exportSave('base64');
  const importedHarness = await createGameHarness();
  assert.equal(importedHarness.game.importSave(exported, 'test chroniques'), true);
  assert.equal(importedHarness.game.state.chronicleProgress[complete.id], 4);
  assert.equal(importedHarness.game.state.chronicleChoices[complete.id], complete.choices[1].id);
  assert.equal(importedHarness.game.state.chronicleProgress[active.id], 2);
  assert.equal(getChronicleStatus(available, importedHarness.game.state).status, 'available');

  const progressBeforeCycle = JSON.parse(JSON.stringify(importedHarness.game.state.chronicleProgress));
  const choicesBeforeCycle = JSON.parse(JSON.stringify(importedHarness.game.state.chronicleChoices));
  importedHarness.game.beginNewCycle('iron_oath');
  assert.deepEqual(JSON.parse(JSON.stringify(importedHarness.game.state.chronicleProgress)), progressBeforeCycle);
  assert.deepEqual(JSON.parse(JSON.stringify(importedHarness.game.state.chronicleChoices)), choicesBeforeCycle);
  assert.equal(getChronicleStatus(available, importedHarness.game.state).status, 'available');
  importedHarness.finishDialogues();
  importedHarness.game.state.finalBossDefeated = true;
  importedHarness.game.beginNewCycle('echo_storm');
  assert.deepEqual(JSON.parse(JSON.stringify(importedHarness.game.state.chronicleProgress)), progressBeforeCycle);
  assert.deepEqual(JSON.parse(JSON.stringify(importedHarness.game.state.chronicleChoices)), choicesBeforeCycle);
  assert.equal(getChronicleStatus(active, importedHarness.game.state).status, 'active');
  assert.equal(getChronicleStatus(available, importedHarness.game.state).status, 'available');
  assert.equal(importedHarness.game.state.cycleEchoes[available.sourceEventId], sourceChoice(available));
  const saved = persisted(importedHarness);
  assert.deepEqual(saved.chronicleProgress, progressBeforeCycle);
  assert.deepEqual(saved.chronicleChoices, choicesBeforeCycle);
  assert.equal(saved.cycleEchoes[available.sourceEventId], sourceChoice(available));
});
