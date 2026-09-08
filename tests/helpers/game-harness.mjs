import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const gameUrl = new URL('../../src/game.js', import.meta.url);

/** Runs the real Game methods; only rendering, audio and the browser loop are absent. */
export async function createGameHarness({ starter = 'feral', difficulty = 'standard', seed = 1, storageDenied = false } = {}) {
  const elements = new Map();
  class ElementStub {
    constructor() {
      const classes = new Set(['hidden']);
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); return force; },
      };
      this.style = { setProperty() {} }; this.dataset = {}; this.attributes = {}; this.children = [];
      this.textContent = ''; this.innerHTML = ''; this.disabled = false;
      this.isConnected = true;
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    addEventListener() {}
    removeEventListener() {}
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    getContext() { return {}; }
    appendChild(child) { this.children.push(child); return child; }
    focus() { document.activeElement = this; }
    closest() { return null; }
  }
  const document = {
    body: new ElementStub(), documentElement: new ElementStub(), activeElement: null,
    getElementById(id) { if (!elements.has(id)) elements.set(id, new ElementStub()); return elements.get(id); },
    createElement() { return new ElementStub(); },
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  };
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
  };
  let randomState = seed >>> 0;
  let randomOverride = null;
  const math = Object.create(Math);
  math.random = () => {
    if (randomOverride) return randomOverride();
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  let source = await readFile(gameUrl, 'utf8');
  const bindings = {};
  for (const match of source.matchAll(/^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/gm)) {
    const imported = await import(new URL(match[2], gameUrl));
    for (const name of match[1].split(',').map((value) => value.trim()).filter(Boolean)) {
      assert.ok(name in imported, `Missing runtime import ${name}`);
      bindings[name] = imported[name];
    }
  }
  source = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '');
  const startup = source.indexOf('  const game = new Game();');
  assert.ok(startup > 0, 'The isolated harness must stop before the browser startup.');
  source = `${source.slice(0, startup)}globalThis.RUNTIME = { Game, AudioEngine, gameStorage, makeDefaultState, STARTERS, RESIDENTS, MAPS, ITEMS, DOM };})();`;
  const context = vm.createContext({
    ...bindings, console, Date, Math: math, TextEncoder, TextDecoder, URL, structuredClone, performance, btoa, atob,
    Element: ElementStub, HTMLElement: ElementStub, document, localStorage: storage,
    window: { matchMedia: () => ({ matches: false }), confirm: () => true, addEventListener() {}, removeEventListener() {} },
    navigator: { maxTouchPoints: 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  });
  if (storageDenied) Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError: storage denied'); } });
  vm.runInContext(await readFile(new URL('../../src/save-system.js', import.meta.url), 'utf8'), context);
  const realmJson = vm.runInContext('JSON', context);
  const realmClone = (value) => realmJson.parse(JSON.stringify(value));
  const realSaveSystem = context.ECHOboundSaveSystem;
  context.ECHOboundSaveSystem = {
    ...realSaveSystem,
    createSaveStore(storageApi, options) {
      return realSaveSystem.createSaveStore(storageApi, {
        ...options, migrate: (candidate) => realmClone(options.migrate(candidate)),
      });
    },
  };
  vm.runInContext(source, context, { filename: 'game.js', timeout: 5000 });
  const { Game, makeDefaultState, STARTERS, DOM } = context.RUNTIME;
  const game = Object.create(Game.prototype);
  game.state = makeDefaultState(STARTERS.find(({ id }) => id === starter) || STARTERS[0]);
  game.state.difficulty = difficulty;
  game.mode = 'world'; game.elapsed = 0; game.serviceType = null;
  game.dialogueQueue = []; game.dialogueCallback = null; game.dialogueOptions = {};
  game.selectedDifficulty = difficulty; game.menuTab = 'partner';
  game.input = {
    down: new Set(), pressed: new Set(), consume: () => false, isDown: () => false,
    pollGamepad: () => ({ x: 0, y: 0, action: false, cancel: false, menu: false, navX: 0, navY: 0 }),
  };
  game.audio = { muted: false, play() {}, setSettings() {}, update() {} };
  game.particles = []; game.partnerTrail = []; game.gamepadCommandIndex = 0;
  for (const method of ['spawnParticles', 'announce', 'updateHud', 'toast', 'applyAccessibilitySettings', 'buildBattleCommands', 'updateBattleUi']) {
    game[method] = () => {};
  }
  game.saveStore = context.ECHOboundSaveSystem.createSaveStore(context.RUNTIME.gameStorage, {
    migrate: (candidate) => { game.assertSaveCandidate(candidate); return realmClone(game.migrateState(candidate)); },
    validate: (candidate) => game.validateMigratedSave(candidate),
  });
  return {
    game, Game, DOM, storage, elements, realmClone, saveSystem: context.ECHOboundSaveSystem, ...context.RUNTIME,
    setRandom(value) { randomOverride = typeof value === 'function' ? value : () => value; },
    setSeed(value) { randomState = value >>> 0; randomOverride = null; },
    service(action) { game.handleServiceClick({ target: { closest: () => ({ disabled: false, dataset: { serviceAction: action } }) } }); },
    finishDialogues() { for (let count = 0; count < 20 && !DOM.dialogue.classList.contains('hidden'); count += 1) game.finishDialogue(); },
  };
}
