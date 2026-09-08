import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

const neutralPad = { x: 0, y: 0, action: false, cancel: false, menu: false, navX: 0, navY: 0 };

test('getter localStorage refusé : titre et audio démarrent, partie exportable en mémoire', async () => {
  const { Game, AudioEngine, DOM, gameStorage } = await createGameHarness({ storageDenied: true });
  assert.equal(gameStorage.persistent, false);
  const audio = new AudioEngine();
  assert.doesNotThrow(() => audio.toggle());
  const game = new Game();
  assert.equal(game.mode, 'title');
  assert.match(DOM.toast.textContent, /cet onglet uniquement/);
  assert.equal(DOM.starterCards.children.length, 3);
  game.startNewGame('aegis', 'standard');
  game.finishDialogue();
  assert.equal(game.mode, 'world');
  assert.equal(game.saveGame(false), false, 'une copie mémoire ne prétend jamais être persistante');
  const exported = game.exportSave('json');
  assert.equal(JSON.parse(exported).partner.starter, 'aegis');
  game.renderSystemMenu();
  assert.match(DOM.menuContent.innerHTML, /STOCKAGE NON PERSISTANT/);
  assert.equal(game.importSave(exported), true);
  assert.equal(game.state.partner.starter, 'aegis');
  game.refreshContinueButton();
  assert.equal(DOM.continueGame.textContent, 'CONTINUER DANS CET ONGLET');
});

test('une panne après rotation des secours restaure le disque avant de passer en mémoire', async (t) => {
  const { game, storage, gameStorage } = await createGameHarness();
  for (let index = 0; index < 4; index += 1) { game.state.credits += 1; assert.equal(game.saveGame(false), true); }
  const keys = [game.saveStore.keys.saveKey, ...game.saveStore.keys.backupKeys];
  const original = new Map(keys.map((key) => [key, storage.getItem(key)]));
  const write = storage.setItem;
  let failed = false;
  let backupWrites = 0;
  let errors = 0;
  t.mock.method(console, 'error', () => { errors += 1; });
  t.mock.method(storage, 'setItem', (key, value) => {
    if (game.saveStore.keys.backupKeys.includes(key)) backupWrites += 1;
    if (!failed && key === game.saveStore.keys.saveKey) { failed = true; throw new Error('Panne ponctuelle après rotation'); }
    write(key, value);
  });
  game.state.credits += 123;
  assert.equal(game.saveGame(false), false);
  assert.ok(backupWrites >= 3, 'la panne arrive après de vraies écritures des secours');
  for (const key of keys) assert.equal(storage.getItem(key), original.get(key), `rollback disque ${key}`);
  assert.equal(gameStorage.persistent, false);
  assert.equal(game.saveGame(false), false, 'la prochaine copie mémoire reste signalée non persistante');
  for (const key of keys) assert.equal(storage.getItem(key), original.get(key));
  assert.equal(JSON.parse(game.exportSave('json')).credits, game.state.credits);
  assert.equal(errors, 1, 'pas de journalisation répétée une fois le stockage dégradé');
});

test('un combat interrompu recharge le checkpoint sans dépenses ni gains partiels', async () => {
  const harness = await createGameHarness();
  const { game, storage, realmClone } = harness;
  game.state.flags.combatTutorialSeen = true;
  game.state.partner.hp -= 35;
  const enemy = game.makeEnemy({ id: 'checkpoint', name: 'Écho', level: 2, color: '#ff7fa8', style: 'feral' });
  game.startBattle(enemy);
  const checkpoint = storage.getItem('echobound_save_v2');
  const initial = JSON.parse(checkpoint);
  assert.equal(game.mode, 'battle');
  // Exécuter les vrais ordres; le passage à player isole les dépenses des dés ennemis.
  harness.setRandom(.5);
  game.battleCommand('skill');
  assert.ok(game.state.partner.mp < initial.partner.mp);
  game.battle.phase = 'player';
  game.battleCommand('item');
  assert.ok(game.state.inventory.medgel < initial.inventory.medgel);
  game.state.partner.hp = 1;
  game.state.partner.xp += 15;
  game.autosaveTimer = 31;
  game.achievementTimer = 0;
  game.update(0);
  assert.equal(game.saveGame(false), false);
  assert.equal(storage.getItem('echobound_save_v2'), checkpoint);
  const resumed = await createGameHarness();
  assert.equal(resumed.game.loadGame(checkpoint), true);
  assert.equal(resumed.game.mode, 'world');
  for (const field of ['hp', 'mp', 'xp']) assert.equal(resumed.game.state.partner[field], initial.partner[field]);
  assert.equal(resumed.game.state.inventory.medgel, initial.inventory.medgel);
  assert.equal(resumed.game.state.credits, initial.credits);
  game.state.partner = realmClone(initial.partner);
  game.resolveDefeat();
  const defeated = JSON.parse(storage.getItem('echobound_save_v2'));
  assert.equal(defeated.map, 'city');
  assert.equal(defeated.partner.careMistakes, initial.partner.careMistakes + 1);
  assert.notEqual(storage.getItem('echobound_save_v2'), checkpoint);
});

test('le tutoriel ne double pas le checkpoint et garde les choix antérieurs', async () => {
  const { game, DOM } = await createGameHarness();
  game.state.inventory.scrap += 4;
  const expectedScrap = game.state.inventory.scrap;
  const writes = [];
  const store = game.saveStore;
  game.saveStore = { ...store, save(state) { const result = store.save(state); writes.push(result.state); return result; } };
  const enemy = game.makeEnemy({ id: 'first-checkpoint', name: 'Écho', level: 1, color: '#ff7fa8', style: 'feral' });
  game.startBattle(enemy);
  assert.equal(DOM.dialogueSpeaker.textContent, 'PROTOCOLE DU LIEN');
  assert.equal(game.mode, 'world');
  assert.equal(writes.length, 0);
  game.finishDialogue();
  assert.equal(game.mode, 'battle');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].flags.combatTutorialSeen, true);
  assert.equal(writes[0].inventory.scrap, expectedScrap);
  game.saveGame(false);
  assert.equal(writes.length, 1);
  game.resolveDefeat();
  assert.equal(writes.length, 2, 'une seule sauvegarde résout la défaite');
});

test('un stockage refusé laisse le combat jouable avec un avertissement explicite', async (t) => {
  const { game, storage } = await createGameHarness();
  game.state.flags.combatTutorialSeen = true;
  const warnings = [];
  game.toast = (message) => warnings.push(message);
  t.mock.method(console, 'error', () => {});
  t.mock.method(storage, 'setItem', () => { throw new Error('QuotaExceededError'); });
  game.startBattle(game.makeEnemy({ id: 'refused', name: 'Écho', level: 1 }));
  assert.equal(game.mode, 'battle');
  assert.equal(game.battle.enemy.id, 'refused');
  assert.ok(warnings.some((message) => message.includes('recharger perdra les progrès')));
  assert.equal(storage.getItem('echobound_save_v2'), null);
});

test('les crédits reçoivent le clavier et la manette avant l’écran titre', async () => {
  const { game, DOM } = await createGameHarness();
  game.mode = 'title';
  game.state = null;
  game.showDialogue('CRÉDITS', ['Première page', 'Deuxième page', 'Dernière page']);
  game.input.consume = () => true;
  game.input.pollGamepad = () => neutralPad;
  game.update(0);
  assert.equal(DOM.dialogueText.textContent, 'Deuxième page');
  game.input.consume = () => false;
  game.input.pollGamepad = () => ({ ...neutralPad, action: true });
  game.update(0);
  assert.equal(DOM.dialogueText.textContent, 'Dernière page');
  assert.equal(game.mode, 'title');
});

test('la sélection du partenaire et son retour changent la racine de navigation', async () => {
  const { game, DOM } = await createGameHarness();
  let openStarter;
  let backToTitle;
  DOM.newGame.addEventListener = (event, handler) => { if (event === 'click') openStarter = handler; };
  DOM.starterBack.addEventListener = (event, handler) => { if (event === 'click') backToTitle = handler; };
  game.mode = 'title';
  game.bindUi();
  openStarter();
  assert.equal(game.mode, 'starter');
  assert.equal(DOM.starter.classList.contains('hidden'), false);
  const roots = [];
  game.updateGamepadUi = (_pad, root) => roots.push(root);
  game.update(0);
  assert.equal(roots.at(-1), DOM.starter);
  backToTitle();
  assert.equal(game.mode, 'title');
  assert.equal(DOM.title.classList.contains('hidden'), false);
  game.update(0);
  assert.equal(roots.at(-1), DOM.title);
});

function resolveLevelVictory(harness, extra = {}) {
  const { game } = harness;
  game.state.flags.combatTutorialSeen = true;
  game.state.partner.xp = game.xpToNext(game.state.partner.level) - 1;
  const enemy = game.makeEnemy({ id: 'state-audit', name: 'Écho', level: 2, color: '#ff7fa8', style: 'feral' }, { boss: true });
  Object.assign(enemy, { xp: 2, credits: 10, patrolId: null }, extra);
  game.startBattle(enemy);
  const snapshots = [];
  const store = game.saveStore;
  game.saveStore = { ...store, save(state) { const result = store.save(state); snapshots.push(result.state); return result; } };
  game.resolveVictory();
  assert.equal(harness.DOM.dialogueSpeaker.textContent, 'PROGRESSION');
  assert.ok(snapshots.length > 0);
  return snapshots;
}

test('la première sauvegarde après victoire finale contient la fin même pendant la progression', async () => {
  const harness = await createGameHarness();
  const snapshots = resolveLevelVictory(harness, { final: true });
  for (const saved of snapshots) {
    assert.equal(saved.finalBossDefeated, true);
    assert.equal(saved.flags.endingSeen, false);
    assert.equal(saved.partner.level, 2);
  }
  const reloaded = await createGameHarness();
  assert.equal(reloaded.game.loadGame(JSON.stringify(snapshots[0])), true);
  assert.equal(reloaded.game.mode, 'ending');
});

test('recrue, coût, service et portail sont acquis avant le dialogue de niveau', async () => {
  const harness = await createGameHarness();
  const { game } = harness;
  game.state.recruited = ['brakk', 'mnemo', 'pylon', 'vespera'];
  game.state.unlockedMaps = ['wastes', 'hive'];
  game.state.inventory.spore = 5;
  const beforeRations = game.state.inventory.ration;
  const snapshots = resolveLevelVictory(harness, { recruitId: 'mycella', recruitConsume: { spore: 3 } });
  for (const saved of snapshots) {
    assert.ok(saved.recruited.includes('mycella'));
    assert.equal(saved.inventory.spore, 2);
    assert.equal(saved.inventory.ration, beforeRations + 1);
    assert.ok(saved.unlockedMaps.includes('fog'));
  }
  game.finishDialogue();
  assert.equal(harness.DOM.dialogueSpeaker.textContent, 'MYCELLA');
  harness.finishDialogues();
  assert.equal(game.state.inventory.spore, 2, 'la présentation ne consomme pas une seconde fois');
  assert.equal(game.state.recruited.filter((id) => id === 'mycella').length, 1);
});

test('le gardien et l’Éclat final sont persistés avant leur narration', async () => {
  const guardian = await createGameHarness();
  const snapshots = resolveLevelVictory(guardian, { guardianFlag: 'guardian_wastes_defeated', guardianRegion: 'wastes' });
  assert.equal(snapshots[0].flags.guardian_wastes_defeated, true);
  const { game, RESIDENTS, DOM } = await createGameHarness();
  game.state.recruited = Object.keys(RESIDENTS);
  for (const region of ['wastes', 'hive', 'fog']) game.state.flags[`shard_${region}`] = true;
  game.state.flags.guardian_foundry_defeated = true;
  game.collectShard({ id: 'shard_foundry', requiresFlag: 'guardian_foundry_defeated', name: 'Éclat', x: 480, y: 112 });
  assert.equal(DOM.dialogueSpeaker.textContent, 'ÉCLAT MNÉMIQUE');
  const saved = game.saveStore.load().state;
  assert.equal(saved.flags.shard_foundry, true);
  assert.equal(saved.flags.finalUnlocked, true);
  assert.ok(saved.unlockedMaps.includes('void'));
});

for (const value of ['toString', '__proto__', 'constructor', 'valueOf', 'hasOwnProperty']) {
  test(`migration: la valeur héritée ${value} ne devient jamais un identifiant de contenu`, async () => {
    const { game } = await createGameHarness();
    const candidate = JSON.parse(JSON.stringify(game.state));
    candidate.difficulty = value;
    candidate.partner.formId = value;
    candidate.partner.evolutions = [value];
    candidate.recruited = [value];
    candidate.cityProjects = [value];
    candidate.unlockedMaps = [value];
    candidate.flags.trackedResident = value;
    const migrated = game.saveStore.decodeSave(JSON.stringify(candidate));
    assert.equal(migrated.difficulty, 'standard');
    assert.equal(migrated.partner.formId, 'mote_feral');
    assert.deepEqual(Array.from(migrated.partner.evolutions), ['mote_feral']);
    assert.deepEqual(Array.from(migrated.recruited), []);
    assert.deepEqual(Array.from(migrated.cityProjects), []);
    assert.deepEqual(Array.from(migrated.unlockedMaps), ['wastes']);
    assert.equal(migrated.flags.trackedResident, undefined);
    assert.equal(game.validateMigratedSave(migrated), true);
  });
}
