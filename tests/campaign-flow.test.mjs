import assert from 'node:assert/strict';
import test from 'node:test';
import { runCampaignScenario } from './helpers/campaign-runner.mjs';

for (const starter of ['feral', 'aegis', 'veil']) {
  test(`${starter}: les quatre longs territoires sont traversables avec progression et services acquis`, async () => {
    const { h, summary, rows, ending } = await runCampaignScenario({ starter, seed: 7, finish: starter === 'aegis' });
    assert.equal(summary.failed, false, JSON.stringify(rows.at(-1)));
    assert.equal(summary.shards, 4);
    assert.equal(summary.score, 120);
    assert.equal(summary.recruits, 12);
    assert.equal(summary.patrols, 32);
    assert.equal(summary.forge, 3);
    assert.equal(summary.training, 6);
    assert.equal(h.game.state.discoveredSectors.length, starter === 'aegis' ? 22 : 21);
    assert.ok(rows.every(({ result }) => result === 'victory'));
    if (starter !== 'aegis') {
      assert.ok(summary.extraTrainingBattles > 0, 'The less defensive builds train on ordinary respawned patrols.');
      return;
    }
    assert.equal(ending.result, 'victory');
    assert.equal(ending.phaseTwoSeen, true);
    assert.equal(h.game.state.finalBossDefeated, true);
    assert.equal(h.game.mode, 'ending');
    assert.equal(h.DOM.ending.classList.contains('hidden'), false);
    assert.equal(JSON.parse(h.storage.getItem(h.saveSystem.SAVE_KEY)).finalBossDefeated, true);
    h.game.beginNewCycle();
    while (h.game.dialogueQueue.length) h.game.advanceDialogue();
    const law = h.game.dialogueOptions.choices.find(({ id }) => id === 'iron_oath');
    assert.ok(law);
    h.game.selectDialogueChoice(law);
    h.finishDialogues();
    assert.equal(h.game.state.cycleCount, 1);
    assert.equal(h.game.state.cycleModifier, 'iron_oath');
    assert.equal(h.game.getShardCount(), 0);
    assert.equal(h.game.state.patrolVictories.length, 0);
    assert.equal(h.game.state.recruited.length, 12);
    assert.equal(h.game.state.finalBossDefeated, false);
    assert.equal(h.game.mode, 'world');
  });
}
