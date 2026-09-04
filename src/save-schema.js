/* ECHObound — primitives de normalisation pour les sauvegardes non fiables. */

export const SAVE_VALUE_LIMITS = Object.freeze({
  counter: 1_000_000_000,
  stat: 1_000_000,
  level: 999,
  nameLength: 16,
  recordEntries: 512,
  identifierLength: 96,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function boundedNumber(value, fallback = 0, {
  min = -SAVE_VALUE_LIMITS.counter,
  max = SAVE_VALUE_LIMITS.counter,
  integer = false,
} = {}) {
  const candidate = typeof value === 'number' ? value : Number(value);
  const safeFallback = Number.isFinite(fallback) ? fallback : 0;
  if (!Number.isFinite(candidate)) return clamp(safeFallback, min, max);
  const normalized = integer ? Math.trunc(candidate) : candidate;
  return clamp(normalized, min, max);
}

export function boundedInteger(value, fallback = 0, options = {}) {
  return boundedNumber(value, fallback, { ...options, integer: true });
}

export function boundedString(value, fallback = '', maxLength = 128) {
  if (typeof value !== 'string') return String(fallback ?? '').slice(0, maxLength);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (normalized || String(fallback ?? '')).slice(0, maxLength);
}

export function strictBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : Boolean(fallback);
}

export function safeIdentifier(value, maxLength = SAVE_VALUE_LIMITS.identifierLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && /^[a-z0-9_:-]+$/i.test(value);
}

const allowed = (key, allowedKeys) => !allowedKeys || allowedKeys.has(key);

export function sanitizeNumberRecord(input, {
  allowedKeys = null,
  min = 0,
  max = SAVE_VALUE_LIMITS.counter,
  integer = true,
  maxEntries = SAVE_VALUE_LIMITS.recordEntries,
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= maxEntries) break;
    if (!safeIdentifier(key) || !allowed(key, allowedKeys)) continue;
    const candidate = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(candidate)) continue;
    output[key] = boundedNumber(candidate, 0, { min, max, integer });
    count += 1;
  }
  return output;
}

export function sanitizeBooleanRecord(input, allowedKeys) {
  const output = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const key of allowedKeys || []) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  return output;
}

export function sanitizeChoiceRecord(input, allowedChoices, maxEntries = SAVE_VALUE_LIMITS.recordEntries) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  let count = 0;
  for (const [eventId, choiceId] of Object.entries(input)) {
    if (count >= maxEntries) break;
    const choices = allowedChoices.get(eventId);
    if (!choices?.has(choiceId)) continue;
    output[eventId] = choiceId;
    count += 1;
  }
  return output;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
