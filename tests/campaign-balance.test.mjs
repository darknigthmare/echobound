import assert from 'node:assert/strict';
import test from 'node:test';

import { runCampaignScenario } from './helpers/campaign-runner.mjs';

test('NOCTE termine quatre campagnes complètes sans aide injectée', async () => {
  for (const seed of [1, 4, 7, 42]) {
    const { h, summary, rows } = await runCampaignScenario({ starter: 'feral', seed });
    const context = `NOCTE · graine ${seed} · dernier résultat ${JSON.stringify(rows.at(-1))}`;

    assert.equal(summary.failed, false, `${context} : la campagne ne doit pas s’interrompre`);
    assert.equal(summary.patrols, 32, `${context} : les quatre régions doivent être achevées`);
    assert.equal(summary.recruits, 12, `${context} : les douze habitants doivent rejoindre la cité`);
    assert.equal(summary.shards, 4, `${context} : les quatre Éclats doivent être réunis`);
    assert.ok(h.game.state.partner.hp > 0, `${context} : NOCTE doit terminer vivant`);
  }
});
