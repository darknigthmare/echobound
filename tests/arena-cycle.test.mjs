import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameHarness } from './helpers/game-harness.mjs';

function winChampionTrial(harness) {
  const { game } = harness;
  game.serviceType = 'arena';
  harness.service('arena-elite');
  assert.equal(game.mode, 'battle');
  assert.equal(game.battle.enemy.id, 'arena_elite');
  game.resolveVictory();
  harness.finishDialogues();
}

test('la Graine du Champion est unique par cycle et le verrou survit à un transfert', async () => {
  const first = await createGameHarness({ starter: 'aegis', seed: 7 });
  first.game.state.flags.combatTutorialSeen = true;
  first.game.state.partner.level = 6;
  first.game.state.recruited.push('skarn');

  winChampionTrial(first);
  assert.equal(first.game.state.inventory.coreSeed, 1);
  assert.equal(first.game.state.arenaEliteRewardClaimed, true);

  winChampionTrial(first);
  assert.equal(first.game.state.inventory.coreSeed, 1);
  assert.equal(first.game.state.arenaEliteRewardClaimed, true);
  assert.equal(first.game.saveStore.load().state.arenaEliteRewardClaimed, true);

  const payload = first.game.exportSave('json');
  const restored = await createGameHarness({ starter: 'feral', seed: 11 });
  assert.equal(restored.game.importSave(payload), true);
  assert.equal(restored.game.state.inventory.coreSeed, 1);
  assert.equal(restored.game.state.arenaEliteRewardClaimed, true);

  restored.game.state.finalBossDefeated = true;
  restored.game.beginNewCycle('echo_storm');
  restored.finishDialogues();
  assert.equal(restored.game.state.cycleCount, 1);
  assert.equal(restored.game.state.arenaEliteRewardClaimed, false);
  const seedsAfterCycleGift = restored.game.state.inventory.coreSeed;

  winChampionTrial(restored);
  assert.equal(restored.game.state.inventory.coreSeed, seedsAfterCycleGift + 1);
  assert.equal(restored.game.state.arenaEliteRewardClaimed, true);
});
