import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  boundedInteger,
  boundedNumber,
  boundedString,
  escapeHtml,
  sanitizeBooleanRecord,
  sanitizeChoiceRecord,
  sanitizeNumberRecord,
} from '../src/save-schema.js';
import { discoverRuntimeFiles, EXPECTED_STANDALONE_HASH } from '../scripts/validate-pwa.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Bloc introuvable : ${start}`);
  return source.slice(startIndex, endIndex);
};

test('les primitives rejettent les charges XSS et bornent les valeurs importées', () => {
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  assert.equal(boundedInteger(payload, 90, { min: 0, max: 1000 }), 90);
  assert.equal(boundedInteger(1e30, 0, { min: 0, max: 1000 }), 1000);
  assert.equal(boundedNumber(-50, 12, { min: 0, max: 100 }), 0);
  assert.equal(boundedString('\u0000  ECHO-LONG  ', 'NOCTE', 4), 'ECHO');
  assert.equal(escapeHtml('<&"\''), '&lt;&amp;&quot;&#39;');

  const allowedItems = new Set(['ration', 'ether']);
  assert.deepEqual(sanitizeNumberRecord({
    ration: payload,
    ether: '7',
    unknown: 999,
  }, { allowedKeys: allowedItems, min: 0, max: 50, integer: true }), { ether: 7 });

  assert.deepEqual(
    sanitizeBooleanRecord({ safe: true, coerced: 1, unknown: false }, new Set(['safe', 'coerced'])),
    { safe: true },
  );
  assert.deepEqual(
    sanitizeChoiceRecord({ event: 'known', forged: payload }, new Map([['event', new Set(['known'])]])),
    { event: 'known' },
  );
});

test('la migration du jeu est un schéma fermé et reconstruit les récompenses', async () => {
  const game = await read('src/game.js');
  const migration = between(game, '    migrateState(parsed)', '\n    applyAccessibilitySettings()');

  assert.doesNotMatch(migration, /\.\.\.\s*parsed(?:\b|\.)/);
  assert.match(migration, /credits: boundedInteger\(parsed\.credits, base\.credits/);
  assert.match(migration, /name: boundedString\(sourcePartner\.name, base\.partner\.name, SAVE_VALUE_LIMITS\.nameLength\)/);
  assert.match(migration, /inventory = \{[\s\S]*sanitizeNumberRecord\(parsed\.inventory/);
  assert.match(migration, /flags: boolFlags/);
  assert.match(migration, /expeditionChoices: sanitizeChoiceRecord\(parsed\.expeditionChoices, WORLD_SAVE_METADATA\.choiceIds\)/);
  assert.match(migration, /rewardCredits: Math\.min\(240, 85 \+ currentDay \* 6\)/);
  assert.match(migration, /rewardItem: lootByMap\[contractMap\] \|\| 'ration'/);
  assert.doesNotMatch(migration, /rawContract\.(?:rewardCredits|rewardItem|rewardAmount)/);

  assert.match(game, /escapeHtml\(p\.name\)/);
  assert.match(game, /escapeHtml\(this\.getObjective\(\)\)/);
  assert.match(game, /data-service-action="\$\{escapeHtml\(action\)\}"/);
  assert.doesNotMatch(game, /\bsafeText\b/);
});

test('le standalone reste intact mais ne fait plus partie du runtime public', async () => {
  const [standalone, serviceWorker, runtimeFiles] = await Promise.all([
    readFile(resolve(root, 'ECHObound_standalone.html')),
    read('sw.js'),
    discoverRuntimeFiles(root),
  ]);
  assert.equal(createHash('sha256').update(standalone).digest('hex'), EXPECTED_STANDALONE_HASH);
  assert.equal(runtimeFiles.includes('ECHObound_standalone.html'), false);
  assert.equal(runtimeFiles.includes('src/save-schema.js'), true);
  assert.doesNotMatch(serviceWorker, /ECHObound_standalone\.html/);
  assert.doesNotMatch(serviceWorker, /ignoreSearch\s*:/);
  assert.doesNotMatch(serviceWorker, /handleSameOriginRequest/);
  assert.match(serviceWorker, /const cacheKey = canonicalRuntimeRequest\(request\)/);
  assert.match(serviceWorker, /if \(!cacheKey\) return/);
});

test('Vercel applique les politiques de contenu, cadrage et permissions', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const globalHeaders = config.headers.find(({ source }) => source === '/(.*)')?.headers || [];
  const values = Object.fromEntries(globalHeaders.map(({ key, value }) => [key, value]));

  assert.equal(values['X-Frame-Options'], 'DENY');
  assert.match(values['Permissions-Policy'], /camera=\(\)/);
  assert.match(values['Permissions-Policy'], /microphone=\(\)/);
  assert.match(values['Content-Security-Policy'], /default-src 'self'/);
  assert.match(values['Content-Security-Policy'], /script-src 'self'/);
  assert.match(values['Content-Security-Policy'], /object-src 'none'/);
  assert.match(values['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(values['Content-Security-Policy'], /script-src[^;]*'unsafe-inline'/);
});

test('le plafonnement visuel conserve update/input et les réglages audio sont dédupliqués', async () => {
  const game = await read('src/game.js');
  const loop = between(game, '    loop(now)', '\n    update(dt)');
  const audio = between(game, '  class AudioEngine', '\n  function drawShadow');

  assert.match(loop, /this\.update\(dt\)/);
  assert.match(loop, /renderInterval = reducedMotion \|\| this\.prefer30Fps \? 1000 \/ 30 : 0/);
  assert.match(loop, /this\.input\.endFrame\(\)/);
  assert.match(audio, /settingsSignature !== this\.directorSettingsSignature/);
  assert.equal((audio.match(/this\.director\.setSettings\(/g) || []).length, 1);
});
