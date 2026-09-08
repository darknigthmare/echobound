import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gameUrl = new URL('../src/game.js', import.meta.url);
const platformUrl = new URL('../src/platform.js', import.meta.url);
const indexUrl = new URL('../index.html', import.meta.url);

const [gameSource, platformSource, indexSource] = await Promise.all([
  readFile(gameUrl, 'utf8'),
  readFile(platformUrl, 'utf8'),
  readFile(indexUrl, 'utf8'),
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Début de contrat introuvable : ${start}`);
  assert.ok(endIndex > startIndex, `Fin de contrat introuvable : ${end}`);
  return source.slice(startIndex, endIndex);
}

function importedNames(source, modulePath) {
  const escapedPath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = source.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from ['"]${escapedPath}['"];`));
  assert.ok(declaration, `Import ESM introuvable : ${modulePath}`);
  return declaration[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function assertOrdered(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor + 1);
    assert.ok(index > cursor, `Contrat absent ou désordonné : ${fragment}`);
    cursor = index;
  }
}

test('le moteur branche réellement les directeurs audio et progression modulaires', () => {
  const progressionImports = importedNames(gameSource, './progression-rules.js');
  const audioImports = importedNames(gameSource, './audio-director.js');

  assert.deepEqual(
    new Set(progressionImports),
    new Set(['CYCLE_LAWS', 'createNextCyclePlan', 'evaluateEvolution', 'getCycleScaling']),
  );
  assert.deepEqual(new Set(audioImports), new Set(['AudioDirector', 'emitAmbientTone']));
  assert.match(gameSource, /this\.director = new AudioDirector\(/);
  assert.match(gameSource, /this\.ambientQueue\.push\(\.\.\.this\.director\.plan\(/);
  assert.match(gameSource, /emitAmbientTone\(this, event\)/);
  assert.match(gameSource, /const decision = evaluateEvolution\(p\)/);
  assert.match(gameSource, /const plan = createNextCyclePlan\(this\.state, lawId\)/);
  assert.match(gameSource, /getCycleScaling\(this\.state/);
});

test('les tutoriels expédition et combat sont des portes one-shot persistées', () => {
  const defaults = between(gameSource, 'function makeDefaultState', '\n  class InputManager');
  const expedition = between(gameSource, '    changeMap(target,', '\n    getCurrentRegionId()');
  const combat = between(gameSource, '    startBattle(enemy)', '\n    updateBattleUi()');

  assert.match(defaults, /expeditionTutorialSeen:\s*false/);
  assert.match(defaults, /combatTutorialSeen:\s*false/);

  assertOrdered(expedition, [
    "if (map.region && !this.state.flags.expeditionTutorialSeen)",
    'this.state.flags.expeditionTutorialSeen = true',
    "this.showDialogue('PROTOCOLE D’EXPÉDITION'",
    '() => this.saveGame(false)',
  ]);
  assert.equal((expedition.match(/expeditionTutorialSeen\s*=\s*true/g) || []).length, 1);

  assertOrdered(combat, [
    'if (!this.state.flags.combatTutorialSeen)',
    'this.state.flags.combatTutorialSeen = true',
    "this.showDialogue('PROTOCOLE DU LIEN'",
    'this.startBattle(enemy)',
    'return',
  ]);
  assert.equal((combat.match(/combatTutorialSeen\s*=\s*true/g) || []).length, 1);
});

test('la migration résout les alias, sécurise la position et assainit les formes', () => {
  const migration = between(gameSource, '    migrateState(parsed)', '\n    applyAccessibilitySettings()');

  assertOrdered(migration, [
    'const legacyRegionMap = REGION_IDS.includes(parsed?.map)',
    "const resolvedMap = resolveMapId(boundedString(parsed.map, 'city', 128))",
    "const mapId = SAVE_MAP_IDS.has(resolvedMap) ? resolvedMap : 'city'",
    'const currentMap = MAPS[mapId]',
    'const safeX = merged.player.x',
    'const safeY = merged.player.y',
    'const invalidPosition = legacyRegionMap',
    'circleRectCollision(safeX, safeY, 13, rect)',
    'merged.player.x = invalidPosition ? spawn.x : safeX',
    'merged.player.y = invalidPosition ? spawn.y : safeY',
  ]);
  assert.match(migration, /formId: hasOwn\(FORMS, sourcePartner\.formId\) \? sourcePartner\.formId : starter\.formId/);
  assert.match(migration, /evolutions: uniqueKnown\(sourcePartner\.evolutions, \(formId\) => typeof formId === 'string' && hasOwn\(FORMS, formId\)/);
  assert.match(migration, /if \(!merged\.partner\.evolutions\.includes\(merged\.partner\.formId\)\) merged\.partner\.evolutions\.unshift\(merged\.partner\.formId\)/);
  assert.match(migration, /expeditionChoices: sanitizeChoiceRecord\(parsed\.expeditionChoices, WORLD_SAVE_METADATA\.choiceIds\)/);
});

test('les paliers et contrats ne progressent qu’avec des patrouilles identifiées distinctes', () => {
  const gates = between(gameSource, '    getTransitionStatus(transition, regionId)', '\n    getTrackedTransitionId(');
  const victory = between(gameSource, '    resolveVictory()', '\n    resolveDefeat()');
  const contract = between(gameSource, '    updateDailyContract(enemy)', '\n    claimDailyContract()');

  assert.match(gates, /const currentWins = this\.getRegionPatrolWinCount\(regionId\)/);
  assert.match(gates, /currentWins >= requiredWins/);
  assert.match(gates, /const regionalIds = new Set\(layout\.sectors\.flatMap/);
  assert.match(gates, /this\.state\.patrolVictories \|\| \[\]\)\.filter\(\(id\) => regionalIds\.has\(id\)\)\.length/);
  assertOrdered(victory, [
    'if (enemy.patrolId)',
    'if (!this.state.patrolVictories.includes(enemy.patrolId)) this.state.patrolVictories.push(enemy.patrolId)',
    'this.state.worldDefeated[enemy.patrolId]',
  ]);
  assert.match(contract, /if \(!contract \|\| contract\.claimed \|\| !enemy\?\.patrolId\) return/);
  assert.match(contract, /this\.getCurrentRegionId\(\) !== contract\.map/);
});

test('le Nouveau Cycle+ est relançable depuis Système et reconstruit les expéditions', () => {
  const systemMenu = between(gameSource, '    renderSystemMenu()', '\n    handleMenuClick(event)');
  const menuActions = between(gameSource, '    handleMenuClick(event)', '\n    spendCredits(amount)');
  const newCycle = between(gameSource, '    beginNewCycle(lawId = null)', '\n  }\n\n  const game = new Game()');

  assert.match(systemMenu, /this\.state\.finalBossDefeated \? '<button data-menu-action="new-cycle">CHOISIR UN NOUVEAU CYCLE \+<\/button>' : ''/);
  assert.match(menuActions, /action === 'new-cycle'[\s\S]*this\.beginNewCycle\(\)/);
  assert.match(newCycle, /choices: laws\.map\(\(law\) => \(\{ id: law\.id, label: law\.name \}\)\)/);

  for (const reset of [
    'this.state.worldDefeated = {}',
    "this.state.regionWins = { wastes: 0, hive: 0, fog: 0, foundry: 0, void: 0 }",
    "this.state.discoveredSectors = ['city']",
    'this.state.patrolVictories = []',
    'this.state.sectorVisits = {}',
    'this.state.sanctuaryVisits = {}',
    'this.state.expeditionChoices = {}',
  ]) assert.ok(newCycle.includes(reset), `Reset NG+ manquant : ${reset}`);

  assert.match(newCycle, /for \(const regionId of REGION_IDS\)/);
  assert.match(newCycle, /this\.state\.flags\[`shard_\$\{regionId\}`\] = false/);
  assert.match(newCycle, /this\.state\.flags\[`guardian_\$\{regionId\}_defeated`\] = false/);
  assert.match(newCycle, /connection\.kind === 'shortcut'[\s\S]*this\.state\.flags\[connection\.unlock\.flag\] = false/);
  assert.match(newCycle, /for \(const event of sector\.events \|\| \[\]\) this\.state\.flags\[event\.onceFlag\] = false/);
  assert.match(newCycle, /this\.state\.unlockedMaps = this\.state\.unlockedMaps\.filter\(\(id\) => id !== 'void'\)/);
});

test('les choix de dialogue attendent le relâchement de la touche qui les révèle', () => {
  const choices = between(gameSource, '    renderDialogueChoices() {', '\n    selectDialogueChoice(choice)');
  assert.match(indexSource, /id="dialogue"[^>]*tabindex="-1"/);
  assert.match(gameSource, /requestAnimationFrame\(\(\) => DOM\.dialogue\.focus\(\)\)/);
  assert.doesNotMatch(gameSource, /requestAnimationFrame\(\(\) => DOM\.dialogueSkip\.focus\(\)\)/);
  assert.match(choices, /this\.input\.isDown\(key\)/);
  assert.match(choices, /window\.addEventListener\('keyup', focusAfterRelease\)/);
  assert.match(choices, /window\.removeEventListener\('keyup', focusAfterRelease\)/);
  assert.match(choices, /requestAnimationFrame\(focusFirstChoice\)/);
});

test('les choix d’expédition rejoignent un historique cumulatif avant leur remise à zéro en NG+', () => {
  const echoes = between(gameSource, '    applyCycleEchoes(choices = {})', '\n    beginNewCycle(lawId = null)');
  const newCycle = between(gameSource, '    beginNewCycle(lawId = null)', '\n  }\n\n  const game = new Game()');

  assert.match(echoes, /const inherited = new Set\(Object\.values\(choices\)\)/);
  for (const choice of [
    'restore_beacon', 'salvage_core', 'share_memory', 'prune_memory',
    'carry_name', 'release_name', 'finish_shift', 'forge_signature',
  ]) assert.ok(echoes.includes(`inherited.has('${choice}')`), `Héritage absent : ${choice}`);

  assertOrdered(newCycle, [
    'const previousChoices = { ...this.state.expeditionChoices }',
    'const inheritedChoiceHistory = { ...this.state.cycleEchoes, ...previousChoices }',
    'this.state.cycleEchoes = inheritedChoiceHistory',
    'this.state.expeditionChoices = {}',
    'this.applyCycleEchoes(previousChoices)',
  ]);
});

test('l’enregistrement du service worker reste centralisé dans platform.js', () => {
  assert.doesNotMatch(gameSource, /(?:navigator\.)?serviceWorker\.register\s*\(/);
  assert.equal((platformSource.match(/navigator\.serviceWorker\.register\s*\(/g) || []).length, 1);
  assert.equal((indexSource.match(/<script src="src\/platform\.js" defer><\/script>/g) || []).length, 1);
});
