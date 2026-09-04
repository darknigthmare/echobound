import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/save-system.js';

const {
  SAVE_KEY,
  BACKUP_KEYS,
  LEGACY_SAVE_KEYS,
  SaveSystemError,
  buildBackupHistory,
  createSaveStore,
  decodeSave,
  encodeSave,
  sanitizeSaveState,
} = globalThis.ECHOboundSaveSystem;

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    this.failSet = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    const serialized = String(value);
    if (this.failSet?.(key, serialized)) throw new Error(`write blocked for ${key}`);
    this.values.set(key, serialized);
  }

  removeItem(key) {
    this.values.delete(key);
  }

  snapshot() {
    return Object.fromEntries([...this.values.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
}

function state(marker = 1, overrides = {}) {
  return {
    version: '2.0.0',
    createdAt: 1000,
    savedAt: 2000 + marker,
    map: 'city',
    partner: {
      name: 'Écho nocturne 🜂',
      starter: 'mote',
      formId: 'mote_feral',
      hp: 80,
      maxHp: 90,
    },
    recruited: [],
    flags: {},
    marker,
    ...overrides,
  };
}

test('le codec conserve le format v2 JSON et le Base64 historique, y compris en Unicode', () => {
  const original = state(7);
  const json = encodeSave(original, { format: 'json' });
  const base64 = encodeSave(original);
  const historicalCode = Buffer.from(JSON.stringify(original), 'utf8').toString('base64');

  assert.equal(json, JSON.stringify(original));
  assert.equal(base64, historicalCode);
  assert.deepEqual(decodeSave(json), original);
  assert.deepEqual(decodeSave(base64), original);
  assert.deepEqual(decodeSave(`  ${historicalCode}\n`), original);
  assert.deepEqual(decodeSave(original), original);
});

test('les sauvegardes v1 restent décodables et peuvent être migrées sans enveloppe propriétaire', () => {
  const legacy = state(1, { version: '1.0.0', coins: 42 });
  const code = Buffer.from(JSON.stringify(legacy), 'utf8').toString('base64');
  const storage = new MemoryStorage();
  const store = createSaveStore(storage, {
    migrate: (value) => ({ ...value, version: '2.0.0', credits: value.coins ?? value.credits ?? 0 }),
  });

  const imported = store.importSave(code);

  assert.equal(imported.state.version, '2.0.0');
  assert.equal(imported.state.credits, 42);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, '2.0.0');
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(SAVE_KEY)), 'payload'), false);
});

test('la sanitation clone les données et retire les clés de pollution de prototype à toute profondeur', () => {
  const hostile = JSON.parse(`{
    "version":"2.0.0",
    "map":"city",
    "partner":{"name":"Serein","__proto__":{"polluted":true}},
    "__proto__":{"polluted":true},
    "constructor":{"prototype":{"polluted":true}},
    "flags":{"safe":true,"prototype":{"polluted":true}}
  }`);

  const clean = sanitizeSaveState(hostile);

  assert.notEqual(clean, hostile);
  assert.equal(Object.hasOwn(clean, '__proto__'), false);
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
  assert.equal(Object.hasOwn(clean.partner, '__proto__'), false);
  assert.equal(Object.hasOwn(clean.flags, 'prototype'), false);
  assert.equal(clean.flags.safe, true);
  assert.equal({}.polluted, undefined);
});

test('la validation refuse les structures dangereuses, incomplètes ou excessives', () => {
  const circular = state();
  circular.loop = circular;
  const withGetter = state();
  Object.defineProperty(withGetter.partner, 'secret', { enumerable: true, get: () => 'non' });

  for (const invalid of [
    '',
    'not base64!',
    '[]',
    JSON.stringify({ version: '2.0.0', map: 'city' }),
    JSON.stringify({ version: '2.0.0', map: '', partner: {} }),
    { ...state(), partner: [] },
    { ...state(), recruited: {} },
    { ...state(), score: Number.POSITIVE_INFINITY },
    circular,
    withGetter,
  ]) {
    assert.throws(() => decodeSave(invalid), SaveSystemError);
  }
  assert.throws(
    () => decodeSave(state(1, { note: 'x'.repeat(20) }), { maxStringLength: 10 }),
    (error) => error instanceof SaveSystemError && error.code === 'STRING_TOO_LONG',
  );
});

test('la rotation garde trois générations, l’ancienne clé de secours restant la plus récente', () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage);

  for (let marker = 1; marker <= 5; marker += 1) store.save(state(marker));

  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).marker, 5);
  assert.equal(JSON.parse(storage.getItem(BACKUP_KEYS[0])).marker, 4);
  assert.equal(JSON.parse(storage.getItem(BACKUP_KEYS[1])).marker, 3);
  assert.equal(JSON.parse(storage.getItem(BACKUP_KEYS[2])).marker, 2);
  assert.deepEqual(buildBackupHistory('new', ['new', 'old', 'older']), ['new', 'old', 'older']);

  const before = storage.snapshot();
  const unchanged = store.save(state(5));
  assert.equal(unchanged.changed, false);
  assert.deepEqual(storage.snapshot(), before);
});

test('un import invalide est atomique et ne modifie aucune génération existante', () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage);
  store.save(state(1));
  store.save(state(2));
  const before = storage.snapshot();

  assert.throws(() => store.importSave('{"map":"city"}'), SaveSystemError);
  assert.deepEqual(storage.snapshot(), before);
});

test('une panne pendant l’écriture restaure la sauvegarde principale et les trois backups', () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage);
  for (let marker = 1; marker <= 4; marker += 1) store.save(state(marker));
  const before = storage.snapshot();
  storage.failSet = (key, value) => key === SAVE_KEY && value.includes('"marker":5');

  assert.throws(
    () => store.importSave(encodeSave(state(5))),
    (error) => error instanceof SaveSystemError
      && error.code === 'STORAGE_WRITE_FAILED'
      && error.details.rollbackSucceeded === true,
  );
  assert.deepEqual(storage.snapshot(), before);
});

test('le chargement récupère une sauvegarde legacy puis les backups sans écraser le stockage', () => {
  const validLegacy = JSON.stringify(state(8, { version: '1.0.0' }));
  const validBackup = JSON.stringify(state(9));
  const storage = new MemoryStorage({
    [SAVE_KEY]: '{corrompu',
    [LEGACY_SAVE_KEYS[0]]: validLegacy,
    [BACKUP_KEYS[0]]: validBackup,
  });
  const store = createSaveStore(storage);
  const before = storage.snapshot();

  const loadedLegacy = store.load();
  assert.equal(loadedLegacy.source, 'legacy');
  assert.equal(loadedLegacy.state.marker, 8);
  assert.deepEqual(storage.snapshot(), before);

  storage.removeItem(LEGACY_SAVE_KEYS[0]);
  const loadedBackup = store.load();
  assert.equal(loadedBackup.source, 'backup');
  assert.equal(loadedBackup.backupIndex, 1);
  assert.equal(loadedBackup.state.marker, 9);
});

test('l’API accepte une implémentation de stockage injectée et signale l’absence de données', () => {
  const storage = new MemoryStorage();
  const store = createSaveStore(storage);

  assert.equal(store.hasSave(), false);
  assert.equal(store.load(), null);
  store.save(state());
  assert.equal(store.hasSave(), true);
  assert.deepEqual(store.keys.backupKeys, BACKUP_KEYS);
});
