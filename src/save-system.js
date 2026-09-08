(function exposeSaveSystem(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.ECHOboundSaveSystem = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SAVE_VERSION = '2.0.0';
  const SAVE_KEY = 'echobound_save_v2';
  const BACKUP_KEYS = Object.freeze([
    'echobound_save_v2_backup',
    'echobound_save_v2_backup_2',
    'echobound_save_v2_backup_3',
  ]);
  const LEGACY_SAVE_KEYS = Object.freeze(['echobound_save_v1']);
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const DEFAULT_LIMITS = Object.freeze({
    maxBytes: 2 * 1024 * 1024,
    maxDepth: 32,
    maxEntries: 20000,
    maxArrayLength: 10000,
    maxStringLength: 250000,
    maxKeyLength: 256,
  });
  const OBJECT_FIELDS = Object.freeze([
    'player', 'partner', 'inventory', 'flags', 'settings', 'regionWins', 'wins', 'worldDefeated',
    'sectorVisits', 'sanctuaryVisits', 'expeditionChoices', 'cycleAnomalies', 'cycleEchoes',
    'chronicleProgress', 'chronicleChoices',
  ]);
  const ARRAY_FIELDS = Object.freeze([
    'recruited', 'unlockedMaps', 'discoveredSectors', 'patrolVictories', 'journalSeen', 'cityProjects', 'achievements',
  ]);

  class SaveSystemError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'SaveSystemError';
      this.code = code;
      if (options.cause !== undefined) this.cause = options.cause;
      if (options.details !== undefined) this.details = options.details;
    }
  }

  function saveError(code, message, cause, details) {
    return new SaveSystemError(code, message, { cause, details });
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch (error) {
      throw saveError('UNSAFE_VALUE', 'Impossible d’inspecter la sauvegarde.', error);
    }
    return prototype === Object.prototype || prototype === null;
  }

  function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  function resolveLimits(options = {}) {
    const source = options.limits || options;
    return {
      maxBytes: positiveInteger(source.maxBytes, DEFAULT_LIMITS.maxBytes),
      maxDepth: positiveInteger(source.maxDepth, DEFAULT_LIMITS.maxDepth),
      maxEntries: positiveInteger(source.maxEntries, DEFAULT_LIMITS.maxEntries),
      maxArrayLength: positiveInteger(source.maxArrayLength, DEFAULT_LIMITS.maxArrayLength),
      maxStringLength: positiveInteger(source.maxStringLength, DEFAULT_LIMITS.maxStringLength),
      maxKeyLength: positiveInteger(source.maxKeyLength, DEFAULT_LIMITS.maxKeyLength),
    };
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
      return Buffer.byteLength(value, 'utf8');
    }
    return unescape(encodeURIComponent(value)).length;
  }

  function assertPayloadSize(value, limits) {
    if (utf8ByteLength(value) > limits.maxBytes) {
      throw saveError('SAVE_TOO_LARGE', 'La sauvegarde dépasse la taille autorisée.');
    }
  }

  function cloneJsonValue(input, limits) {
    const ancestors = new WeakSet();
    let entries = 0;

    const visit = (value, path, depth) => {
      entries += 1;
      if (entries > limits.maxEntries) {
        throw saveError('SAVE_TOO_COMPLEX', 'La sauvegarde contient trop d’éléments.');
      }
      if (depth > limits.maxDepth) {
        throw saveError('SAVE_TOO_DEEP', 'La sauvegarde est trop profondément imbriquée.');
      }

      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (value.length > limits.maxStringLength) {
          throw saveError('STRING_TOO_LONG', `Le texte ${path} dépasse la taille autorisée.`);
        }
        return value;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw saveError('INVALID_NUMBER', `Le nombre ${path} n’est pas fini.`);
        }
        return value;
      }
      if (typeof value !== 'object') {
        throw saveError('UNSUPPORTED_VALUE', `La valeur ${path} ne peut pas être sauvegardée.`);
      }
      if (ancestors.has(value)) {
        throw saveError('CYCLIC_SAVE', `Une référence circulaire a été détectée dans ${path}.`);
      }

      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          if (value.length > limits.maxArrayLength) {
            throw saveError('ARRAY_TOO_LONG', `La liste ${path} dépasse la taille autorisée.`);
          }
          return value.map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
        }
        if (!isPlainObject(value)) {
          throw saveError('UNSAFE_OBJECT', `L’objet ${path} n’est pas un objet JSON sûr.`);
        }

        const output = {};
        let keys;
        try {
          keys = Object.keys(value);
          if (Object.getOwnPropertySymbols(value).length) {
            throw saveError('UNSUPPORTED_VALUE', `L’objet ${path} contient des clés non JSON.`);
          }
        } catch (error) {
          if (error instanceof SaveSystemError) throw error;
          throw saveError('UNSAFE_VALUE', `Impossible d’inspecter ${path}.`, error);
        }

        for (const key of keys) {
          if (FORBIDDEN_KEYS.has(key)) continue;
          if (key.length > limits.maxKeyLength) {
            throw saveError('KEY_TOO_LONG', `Une clé de ${path} dépasse la taille autorisée.`);
          }
          let descriptor;
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, key);
          } catch (error) {
            throw saveError('UNSAFE_VALUE', `Impossible d’inspecter ${path}.${key}.`, error);
          }
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw saveError('UNSAFE_PROPERTY', `La propriété ${path}.${key} n’est pas une donnée JSON sûre.`);
          }
          Object.defineProperty(output, key, {
            value: visit(descriptor.value, `${path}.${key}`, depth + 1),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return output;
      } finally {
        ancestors.delete(value);
      }
    };

    return visit(input, '$', 0);
  }

  function assertSaveShape(state) {
    if (!isPlainObject(state)) {
      throw saveError('INVALID_ROOT', 'La sauvegarde doit être un objet JSON.');
    }
    if (!isPlainObject(state.partner)) {
      throw saveError('INVALID_PARTNER', 'La sauvegarde ne contient pas de partenaire valide.');
    }
    if (typeof state.map !== 'string' || state.map.trim().length === 0 || state.map.length > 128) {
      throw saveError('INVALID_MAP', 'La sauvegarde ne contient pas de carte valide.');
    }
    state.map = state.map.trim();

    if (state.version !== undefined
      && typeof state.version !== 'string'
      && typeof state.version !== 'number') {
      throw saveError('INVALID_VERSION', 'La version de sauvegarde est invalide.');
    }
    for (const field of OBJECT_FIELDS) {
      if (state[field] !== undefined && !isPlainObject(state[field])) {
        throw saveError('INVALID_FIELD', `Le champ ${field} doit être un objet.`);
      }
    }
    for (const field of ARRAY_FIELDS) {
      if (state[field] !== undefined && !Array.isArray(state[field])) {
        throw saveError('INVALID_FIELD', `Le champ ${field} doit être une liste.`);
      }
    }
    return state;
  }

  function runStatePipeline(input, options = {}) {
    const limits = resolveLimits(options);
    let state = cloneJsonValue(input, limits);

    const transforms = [options.migrate, options.normalize].filter((entry) => typeof entry === 'function');
    for (const transform of transforms) {
      try {
        state = transform(state);
      } catch (error) {
        throw saveError('MIGRATION_FAILED', 'La migration de la sauvegarde a échoué.', error);
      }
      state = cloneJsonValue(state, limits);
    }

    assertSaveShape(state);
    if (typeof options.validate === 'function') {
      let result;
      try {
        result = options.validate(state);
      } catch (error) {
        throw saveError('VALIDATION_FAILED', 'La validation de la sauvegarde a échoué.', error);
      }
      if (result === false) {
        throw saveError('VALIDATION_FAILED', 'La sauvegarde a été refusée par le validateur.');
      }
    }

    const serialized = JSON.stringify(state);
    assertPayloadSize(serialized, limits);
    return { state, serialized };
  }

  function sanitizeSaveState(input, options = {}) {
    return runStatePipeline(input, options).state;
  }

  function validateSaveState(input, options = {}) {
    return sanitizeSaveState(input, options);
  }

  function bytesToBase64(text) {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(text, 'utf8').toString('base64');
    }
    if (typeof TextEncoder !== 'function' || typeof btoa !== 'function') {
      return btoa(unescape(encodeURIComponent(text)));
    }
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(code, limits) {
    let normalized = code.replace(/[\t\n\r ]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
      throw saveError('INVALID_BASE64', 'Le code de sauvegarde Base64 est invalide.');
    }
    normalized = normalized.replace(/=+$/, '');
    normalized += '='.repeat((4 - (normalized.length % 4)) % 4);
    if (normalized.length > Math.ceil(limits.maxBytes * 4 / 3) + 4) {
      throw saveError('SAVE_TOO_LARGE', 'La sauvegarde dépasse la taille autorisée.');
    }

    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        const buffer = Buffer.from(normalized, 'base64');
        if (buffer.byteLength > limits.maxBytes) {
          throw saveError('SAVE_TOO_LARGE', 'La sauvegarde dépasse la taille autorisée.');
        }
        return buffer.toString('utf8');
      }
      const binary = atob(normalized);
      if (binary.length > limits.maxBytes) {
        throw saveError('SAVE_TOO_LARGE', 'La sauvegarde dépasse la taille autorisée.');
      }
      if (typeof TextDecoder === 'function') {
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      return decodeURIComponent(escape(binary));
    } catch (error) {
      if (error instanceof SaveSystemError) throw error;
      throw saveError('INVALID_BASE64', 'Le code de sauvegarde Base64 est invalide.', error);
    }
  }

  function parsePayload(payload, options = {}) {
    if (payload !== null && typeof payload === 'object') return payload;
    if (typeof payload !== 'string') {
      throw saveError('INVALID_PAYLOAD', 'La sauvegarde doit être un objet, du JSON ou du Base64.');
    }

    const limits = resolveLimits(options);
    let text = payload.trim();
    if (!text) throw saveError('EMPTY_PAYLOAD', 'Le code de sauvegarde est vide.');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const looksLikeJson = text.startsWith('{') || text.startsWith('[');
    if (!looksLikeJson) text = base64ToBytes(text, limits);
    assertPayloadSize(text, limits);

    try {
      return JSON.parse(text);
    } catch (error) {
      throw saveError('INVALID_JSON', 'Le contenu de la sauvegarde n’est pas un JSON valide.', error);
    }
  }

  function decodeSave(payload, options = {}) {
    return runStatePipeline(parsePayload(payload, options), options).state;
  }

  function encodeSave(state, options = {}) {
    const normalizedOptions = typeof options === 'string' ? { format: options } : options;
    const { serialized } = runStatePipeline(state, normalizedOptions);
    const format = normalizedOptions.format || 'base64';
    if (format === 'json') return serialized;
    if (format === 'base64') return bytesToBase64(serialized);
    throw saveError('INVALID_FORMAT', `Le format d’export ${format} n’est pas pris en charge.`);
  }

  function assertStorage(storage) {
    if (!storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function') {
      throw saveError('INVALID_STORAGE', 'Une API de stockage compatible localStorage est requise.');
    }
  }

  function safeGet(storage, key) {
    try {
      const value = storage.getItem(key);
      return value === null || value === undefined ? null : String(value);
    } catch (error) {
      throw saveError('STORAGE_READ_FAILED', `Impossible de lire ${key}.`, error);
    }
  }

  function restoreStorage(storage, keys, snapshot) {
    const failures = [];
    for (const key of keys) {
      try {
        const value = snapshot.get(key);
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch (error) {
        failures.push({ key, error });
      }
    }
    return failures;
  }

  function buildBackupHistory(primary, backups, count = BACKUP_KEYS.length) {
    const history = [];
    for (const value of [primary, ...backups]) {
      if (typeof value !== 'string' || value.length === 0 || history.includes(value)) continue;
      history.push(value);
      if (history.length === count) break;
    }
    return history;
  }

  function resolveKeys(options = {}) {
    const saveKey = typeof options.saveKey === 'string' && options.saveKey ? options.saveKey : SAVE_KEY;
    const backupKeys = Array.isArray(options.backupKeys) && options.backupKeys.length
      ? options.backupKeys.map(String)
      : [...BACKUP_KEYS];
    const legacySaveKeys = Array.isArray(options.legacySaveKeys)
      ? options.legacySaveKeys.map(String)
      : [...LEGACY_SAVE_KEYS];
    const allKeys = [saveKey, ...backupKeys, ...legacySaveKeys];
    if (allKeys.some((key) => !key) || new Set(allKeys).size !== allKeys.length) {
      throw saveError('INVALID_KEYS', 'Les clés de sauvegarde doivent être uniques et non vides.');
    }
    return { saveKey, backupKeys, legacySaveKeys };
  }

  function createSaveStore(storage, options = {}) {
    assertStorage(storage);
    const keys = resolveKeys(options);
    const pipelineOptions = {
      limits: resolveLimits(options),
      migrate: options.migrate,
      normalize: options.normalize,
      validate: options.validate,
    };

    const commit = (serialized) => {
      const mutableKeys = [keys.saveKey, ...keys.backupKeys];
      const snapshot = new Map(mutableKeys.map((key) => [key, safeGet(storage, key)]));
      const previous = snapshot.get(keys.saveKey);
      if (previous === serialized) {
        return { changed: false, previous, backups: keys.backupKeys.map((key) => snapshot.get(key)) };
      }

      const backupValues = buildBackupHistory(
        previous,
        keys.backupKeys.map((key) => snapshot.get(key)),
        keys.backupKeys.length,
      );
      try {
        for (let index = keys.backupKeys.length - 1; index >= 0; index -= 1) {
          const key = keys.backupKeys[index];
          const value = backupValues[index];
          if (value === undefined) storage.removeItem(key);
          else storage.setItem(key, value);
        }
        // La sauvegarde active est écrite en dernier : une rotation incomplète ne la remplace jamais.
        storage.setItem(keys.saveKey, serialized);
        if (safeGet(storage, keys.saveKey) !== serialized) {
          throw saveError('STORAGE_VERIFY_FAILED', 'La sauvegarde relue diffère de la sauvegarde écrite.');
        }
      } catch (error) {
        const rollbackFailures = restoreStorage(storage, mutableKeys, snapshot);
        throw saveError('STORAGE_WRITE_FAILED', 'La sauvegarde n’a pas été écrite ; l’état précédent a été restauré.', error, {
          rollbackSucceeded: rollbackFailures.length === 0,
          rollbackFailures,
        });
      }
      return { changed: true, previous, backups: backupValues };
    };

    const normalizeForWrite = (state) => runStatePipeline(state, pipelineOptions);

    return Object.freeze({
      keys: Object.freeze({
        saveKey: keys.saveKey,
        backupKeys: Object.freeze([...keys.backupKeys]),
        legacySaveKeys: Object.freeze([...keys.legacySaveKeys]),
      }),

      exportSave(state, format = 'base64') {
        return encodeSave(state, { ...pipelineOptions, format });
      },

      decodeSave(payload) {
        return decodeSave(payload, pipelineOptions);
      },

      save(state) {
        const normalized = normalizeForWrite(state);
        const result = commit(normalized.serialized);
        return { ...result, state: normalized.state, serialized: normalized.serialized };
      },

      importSave(payload) {
        // Décodage, migration, sanitation et validation sont terminés avant la première écriture.
        const state = decodeSave(payload, pipelineOptions);
        const serialized = JSON.stringify(state);
        const result = commit(serialized);
        return { ...result, state, serialized };
      },

      load() {
        const candidates = [
          { key: keys.saveKey, source: 'primary' },
          ...keys.legacySaveKeys.map((key) => ({ key, source: 'legacy' })),
          ...keys.backupKeys.map((key, index) => ({ key, source: 'backup', backupIndex: index + 1 })),
        ];
        const errors = [];
        let found = false;
        for (const candidate of candidates) {
          const raw = safeGet(storage, candidate.key);
          if (raw === null || raw.length === 0) continue;
          found = true;
          try {
            const state = decodeSave(raw, pipelineOptions);
            return { ...candidate, state, raw, recovered: candidate.source !== 'primary' };
          } catch (error) {
            errors.push({ key: candidate.key, error });
          }
        }
        if (!found) return null;
        throw saveError('NO_READABLE_SAVE', 'Toutes les sauvegardes disponibles sont illisibles.', undefined, { errors });
      },

      hasSave() {
        return [keys.saveKey, ...keys.legacySaveKeys, ...keys.backupKeys]
          .some((key) => safeGet(storage, key) !== null);
      },
    });
  }

  function importSave(payload, storage, options = {}) {
    return createSaveStore(storage, options).importSave(payload);
  }

  function saveToStorage(state, storage, options = {}) {
    return createSaveStore(storage, options).save(state);
  }

  return Object.freeze({
    SAVE_VERSION,
    SAVE_KEY,
    BACKUP_KEYS,
    LEGACY_SAVE_KEYS,
    DEFAULT_LIMITS,
    SaveSystemError,
    sanitizeSaveState,
    validateSaveState,
    encodeSave,
    decodeSave,
    buildBackupHistory,
    createSaveStore,
    importSave,
    saveToStorage,
  });
}));
