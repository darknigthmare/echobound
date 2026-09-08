import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesUrl = new URL('../src/styles.css', import.meta.url);
const indexUrl = new URL('../index.html', import.meta.url);
const [styles, index] = await Promise.all([
  readFile(stylesUrl, 'utf8'),
  readFile(indexUrl, 'utf8'),
]);

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `Bloc introuvable : ${marker}`);
  const openIndex = source.indexOf('{', markerIndex + marker.length);
  assert.ok(openIndex >= 0, `Accolade ouvrante introuvable : ${marker}`);
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  assert.fail(`Accolade fermante introuvable : ${marker}`);
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Règle introuvable : ${selector}`);
  return match[1];
}

test('le HUD conserve une cible textuelle d’objectif accessible', () => {
  assert.match(index, /class="hud-panel objective-panel"/);
  assert.match(index, /<small>OBJECTIF<\/small>/);
  assert.match(index, /<span id="objective-text">[^<]+<\/span>/);
});

test('l’objectif mobile reste visible et compact sous les deux colonnes du HUD', () => {
  const mobile = blockAfter(styles, '@media (pointer: coarse), (max-width: 850px)');
  const objective = rule(mobile, '.objective-panel');
  const copy = rule(mobile, '.objective-panel span');

  assert.doesNotMatch(objective, /display\s*:\s*none/i);
  assert.match(objective, /display\s*:\s*flex/i);
  assert.match(objective, /grid-column\s*:\s*1\s*\/\s*-1/i);
  assert.match(objective, /max-height\s*:\s*38px/i);
  assert.match(objective, /flex-direction\s*:\s*row/i);
  assert.match(objective, /overflow\s*:\s*hidden/i);
  assert.doesNotMatch(objective, /position\s*:\s*(?:absolute|fixed)/i);

  assert.match(copy, /font-size\s*:\s*\.62rem/i);
  assert.match(copy, /line-height\s*:\s*1\.2/i);
  assert.match(copy, /overflow-wrap\s*:\s*anywhere/i);
  assert.match(copy, /-webkit-line-clamp\s*:\s*2/i);
  assert.ok(
    mobile.indexOf('.hud-panel {') < mobile.indexOf('.objective-panel {'),
    'La règle compacte de l’objectif doit surcharger la hauteur minimale générique du HUD.',
  );
});

test('le HUD compact réserve la largeur et décale les commandes flottantes en portrait', () => {
  const mobile = blockAfter(styles, '@media (pointer: coarse), (max-width: 850px)');
  const hud = rule(mobile, '#hud');
  assert.match(hud, /grid-template-columns\s*:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(0,\s*\.85fr\)/i);
  assert.match(hud, /align-content\s*:\s*start/i);

  const portrait = blockAfter(styles, '@media (max-width: 620px)');
  assert.match(
    portrait,
    /body\.game-active #mute-button,\s*body\.game-active #fullscreen-button\s*\{[^}]*top\s*:\s*calc\(120px \+ env\(safe-area-inset-top\)\)/i,
  );
  assert.match(portrait, /body\.game-active #hud\s*\{[^}]*right\s*:\s*calc\(7px \+ env\(safe-area-inset-right\)\)/i);
});
