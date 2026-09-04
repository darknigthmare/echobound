import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedStandaloneHash = 'be0be47716fac4953df01044b1ae01c5da60a7317e99a78b146f33e7d99dd4c0';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const readProjectFile = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, 'Début de contrat introuvable: ' + start);
  assert.ok(endIndex > startIndex, 'Fin de contrat introuvable: ' + end);
  return source.slice(startIndex, endIndex);
};

const relativeModuleSpecifiers = (source) => {
  const values = [];
  const expression = /(?:\bimport\s*(?:[^'"]*?\sfrom\s*)?|\bexport\s+[^'"]*?\sfrom\s*)['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(expression)) values.push(match[1]);
  return values;
};

test('le standalone professionnel 2.0.0 conserve exactement ses octets LF vérifiés', async () => {
  const bytes = await readFile(resolve(root, 'ECHObound_standalone.html'));
  const html = bytes.toString('utf8');

  assert.equal(html.includes('\r'), false, 'Le standalone doit rester normalisé en LF, sans octets CR.');
  assert.equal(sha256(bytes), expectedStandaloneHash);
  assert.match(html, /<title>ECHObound — La Cité des Échos<\/title>/);
  assert.match(html, /const VERSION = '2\.0\.0'/);
  assert.match(html, /window\.__ECHObound\s*=/);
  assert.match(html, /ÉDITION CODEX PROFESSIONNELLE · VERSION 2\.0/);
  assert.match(html, /NOUVEAU CYCLE \+/);
  assert.match(html, /renderCodexMenu/);
});

test('le runtime est une enveloppe modularisée distincte du standalone canonique', async () => {
  const [index, standalone, styles, game] = await Promise.all([
    readProjectFile('index.html'),
    readProjectFile('ECHObound_standalone.html'),
    readProjectFile('src/styles.css'),
    readProjectFile('src/game.js'),
  ]);

  assert.notEqual(index, standalone);
  assert.ok(index.length < standalone.length / 4, 'index.html doit rester une enveloppe légère.');
  assert.doesNotMatch(index, /<style(?:\s|>)/i);
  assert.doesNotMatch(index, /<script>(?:[\s\S]*?)<\/script>/i);
  assert.match(index, /<link rel="stylesheet" href="src\/styles\.css"\s*\/?>/);
  assert.match(index, /<script src="src\/platform\.js" defer><\/script>/);
  assert.match(index, /<script type="module" src="src\/game\.js"><\/script>/);
  assert.ok(styles.length > 10000, 'La feuille de style extraite semble incomplète.');
  assert.ok(game.length > 100000, 'Le moteur de jeu extrait semble incomplet.');
  assert.ok(
    /const VERSION = '2\.0\.0'/.test(game) || /SAVE_VERSION:\s*VERSION/.test(game),
    'Le runtime doit dériver explicitement sa version de jeu 2.0.0.',
  );
  assert.match(game, /window\.__ECHObound\s*=/);
});

test('toutes les dépendances ESM locales déclarées par le moteur existent dans le projet', async () => {
  const gamePath = resolve(root, 'src/game.js');
  const game = await readFile(gamePath, 'utf8');
  const specifiers = relativeModuleSpecifiers(game);

  assert.ok(specifiers.includes('./combat-rules.js'), 'Le moteur doit utiliser les règles de combat modulaires.');
  assert.ok(specifiers.length >= 1, 'Le moteur doit déclarer au moins un module local.');

  for (const specifier of specifiers) {
    const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
    const dependencyPath = resolve(dirname(gamePath), cleanSpecifier);
    const pathFromRoot = relative(root, dependencyPath);
    assert.equal(isAbsolute(pathFromRoot), false, 'Dépendance absolue interdite: ' + specifier);
    assert.equal(pathFromRoot.startsWith('..'), false, 'Dépendance hors projet interdite: ' + specifier);
    await access(dependencyPath);
  }
});

test('les contrats de contenu de la campagne professionnelle restent présents', async () => {
  const standalone = await readProjectFile('ECHObound_standalone.html');
  const starters = between(standalone, '  const STARTERS = [', '  const FORMS = {');
  const forms = between(standalone, '  const FORMS = {', '  const ITEMS = {');
  const residents = between(standalone, '  const RESIDENTS = {', '  const BUILDINGS = {');
  const maps = between(standalone, '  const MAPS = {', '  const REGION_UNLOCKS = [');
  const difficulties = between(standalone, '  const DIFFICULTIES = {', '  const CITY_PROJECTS = {');
  const achievements = between(standalone, '  const ACHIEVEMENTS = [', '  function makeDefaultState');

  assert.equal((starters.match(/^\s{4}\{$/gm) || []).length, 3, 'Trois partenaires initiaux sont requis.');
  assert.equal((forms.match(/^\s{4}[a-z0-9_]+:\s*\{\s*name:/gm) || []).length, 11, 'Onze formes sont requises.');
  assert.equal((residents.match(/^\s{4}[a-z0-9_]+:\s*\{$/gm) || []).length, 12, 'Douze résidents sont requis.');
  assert.equal((achievements.match(/\{\s*id:\s*'[^']+'/g) || []).length, 12, 'Douze succès sont requis.');

  for (const mapId of ['city', 'wastes', 'hive', 'fog', 'foundry', 'void']) {
    assert.match(maps, new RegExp('^\\s{4}' + mapId + ':', 'm'));
  }
  for (const difficultyId of ['story', 'standard', 'survival']) {
    assert.match(difficulties, new RegExp('^\\s{4}' + difficultyId + ':', 'm'));
  }
  for (const feature of ['Unisson', 'Éclat', 'L’Architecte Pâle', 'NOUVEAU CYCLE +']) {
    assert.ok(standalone.includes(feature), 'Fonction de campagne absente: ' + feature);
  }
});

test('l’enveloppe expose les contrats PWA et accessibilité essentiels', async () => {
  const index = await readProjectFile('index.html');

  assert.match(index, /<html lang="fr">/);
  assert.match(index, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"\s*\/?>/);
  assert.doesNotMatch(index, /user-scalable\s*=\s*no/i);
  assert.match(index, /<link rel="manifest" href="manifest\.webmanifest"\s*\/?>/);
  assert.match(index, /class="skip-link" href="#title-actions"/);
  assert.match(index, /id="game"[^>]*aria-label="Zone de jeu"[^>]*tabindex="0"/);
  assert.match(index, /id="screen-reader-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(index, /id="accessibility-panel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(index, /data-accessibility-setting="reducedMotion"/);
  assert.match(index, /data-accessibility-setting="highContrast"/);
  assert.match(index, /data-accessibility-setting="largeText"/);
  assert.match(index, /id="touch-controls"[^>]*aria-label="Contrôles tactiles"/);
  assert.match(index, /id="mute-button"[^>]*aria-pressed="false"/);
});
