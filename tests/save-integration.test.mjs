import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const [index, game, saveSystem] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/save-system.js', import.meta.url), 'utf8'),
]);

test('le gestionnaire de sauvegarde est chargé avant le jeu', () => {
  const saveScript = index.indexOf('<script src="src/save-system.js"></script>');
  const gameScript = index.indexOf('<script type="module" src="src/game.js"></script>');
  assert.ok(saveScript >= 0);
  assert.ok(gameScript > saveScript);
});

test('l’import fichier expose un contrôle accessible et limité aux formats texte', () => {
  assert.match(index, /id="save-file-input"/);
  assert.match(index, /type="file"/);
  assert.match(index, /accept="\.json,application\/json,text\/plain"/);
  assert.match(index, /aria-label="Choisir un fichier de sauvegarde ECHObound"/);
  assert.match(game, /importSaveFile\(file\)/);
});

test('le jeu délègue les écritures et imports au stockage atomique', () => {
  assert.match(game, /createSaveStore\(gameStorage/);
  assert.match(game, /this\.saveStore\.save\(this\.state\)/);
  assert.match(game, /this\.saveStore\.importSave\(payload\)/);
  assert.match(game, /this\.saveStore\.exportSave\(this\.state, format\)/);
  assert.doesNotMatch(game, /localStorage\.setItem\(SAVE_KEY/);
});

test('le menu accepte JSON, Base64, fichier et les secours rotatifs', () => {
  assert.match(game, /data-menu-action="import-file"/);
  assert.match(game, /COLLER DU JSON OU UN CODE/);
  assert.match(game, /restoreLatestBackup\(\)/);
  assert.match(saveSystem, /echobound_save_v2_backup_3/);
  assert.match(saveSystem, /l’état précédent a été restauré/);
});
