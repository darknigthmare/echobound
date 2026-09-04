const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const OSCILLATOR_TYPES = Object.freeze(['sine', 'triangle', 'square', 'sawtooth']);

export const AUDIO_THEME_IDS = Object.freeze([
  'city',
  'wastes',
  'hive',
  'fog',
  'foundry',
  'void',
]);

export const AUDIO_DIRECTOR_LIMITS = Object.freeze({
  minLookAheadSeconds: 0.25,
  maxLookAheadSeconds: 24,
  defaultLookAheadSeconds: 6,
  maxEventsPerPlan: 48,
  reducedMotionDensity: 0.62,
  reducedMotionTempoScale: 1.55,
});

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  muted: false,
  master: 0.82,
  ambience: 0.58,
  sfx: 0.86,
  reducedMotion: false,
});

const rawProfiles = {
  city: {
    label: 'Nox Arca renaissante',
    rootHz: 146.83,
    scale: [0, 5, 7, 12, 14],
    octaves: [-12, 0, 0, 12],
    wave: 'sine',
    accentWave: 'triangle',
    stepSeconds: 1.85,
    jitterSeconds: 0.22,
    activeChance: 0.76,
    duration: [0.8, 1.75],
    baseGain: 0.056,
    slideSemitones: [0, 0, 2, 5],
    accentChance: 0.27,
    accentSemitones: 12,
    accentDelay: 0.16,
  },
  wastes: {
    label: 'Friches du Portail',
    rootHz: 82.41,
    scale: [0, 2, 5, 7, 10],
    octaves: [0, 0, 12],
    wave: 'triangle',
    accentWave: 'square',
    stepSeconds: 1.48,
    jitterSeconds: 0.34,
    activeChance: 0.72,
    duration: [0.42, 1.18],
    baseGain: 0.047,
    slideSemitones: [-2, 0, 0, 3],
    accentChance: 0.2,
    accentSemitones: 7,
    accentDelay: 0.11,
  },
  hive: {
    label: 'Bio-Ruche de Verdance',
    rootHz: 110,
    scale: [0, 3, 7, 8, 12],
    octaves: [-12, 0, 0, 12],
    wave: 'sine',
    accentWave: 'triangle',
    stepSeconds: 0.92,
    jitterSeconds: 0.12,
    activeChance: 0.84,
    duration: [0.34, 0.92],
    baseGain: 0.044,
    slideSemitones: [-1, 0, 1, 3],
    accentChance: 0.31,
    accentSemitones: 3,
    accentDelay: 0.09,
  },
  fog: {
    label: 'Cathédrale de Brume',
    rootHz: 130.81,
    scale: [0, 1, 5, 8, 12],
    octaves: [-12, 0, 12],
    wave: 'sine',
    accentWave: 'sine',
    stepSeconds: 2.36,
    jitterSeconds: 0.52,
    activeChance: 0.69,
    duration: [1.25, 2.8],
    baseGain: 0.05,
    slideSemitones: [-5, -1, 0, 0, 1],
    accentChance: 0.38,
    accentSemitones: 13,
    accentDelay: 0.28,
  },
  foundry: {
    label: 'Fonderie des Veilleurs',
    rootHz: 73.42,
    scale: [0, 3, 6, 10, 12],
    octaves: [0, 0, 12, 24],
    wave: 'square',
    accentWave: 'triangle',
    stepSeconds: 0.78,
    jitterSeconds: 0.08,
    activeChance: 0.79,
    duration: [0.12, 0.48],
    baseGain: 0.032,
    slideSemitones: [-6, 0, 0, 6],
    accentChance: 0.24,
    accentSemitones: 18,
    accentDelay: 0.07,
  },
  void: {
    label: 'Cœur du Néant',
    rootHz: 55,
    scale: [0, 1, 6, 11, 12],
    octaves: [0, 12, 12, 24],
    wave: 'sine',
    accentWave: 'sawtooth',
    stepSeconds: 2.72,
    jitterSeconds: 0.64,
    activeChance: 0.74,
    duration: [1.4, 3.25],
    baseGain: 0.045,
    slideSemitones: [-12, -1, 0, 6],
    accentChance: 0.29,
    accentSemitones: 6,
    accentDelay: 0.33,
  },
};

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  scale: Object.freeze([...profile.scale]),
  octaves: Object.freeze([...profile.octaves]),
  duration: Object.freeze([...profile.duration]),
  slideSemitones: Object.freeze([...profile.slideSemitones]),
});

export const AUDIO_THEME_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(rawProfiles).map(([id, profile]) => [id, freezeProfile({ id, ...profile })]),
));

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeAudioSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return Object.freeze({
    muted: Boolean(source.muted ?? DEFAULT_AUDIO_SETTINGS.muted),
    master: clamp(finiteNumber(source.master, DEFAULT_AUDIO_SETTINGS.master), 0, 1),
    ambience: clamp(finiteNumber(source.ambience, DEFAULT_AUDIO_SETTINGS.ambience), 0, 1),
    sfx: clamp(finiteNumber(source.sfx, DEFAULT_AUDIO_SETTINGS.sfx), 0, 1),
    reducedMotion: Boolean(source.reducedMotion ?? DEFAULT_AUDIO_SETTINGS.reducedMotion),
  });
}

export function getEffectiveAudioMix(settings = {}) {
  const normalized = normalizeAudioSettings(settings);
  const master = normalized.muted ? 0 : normalized.master;
  return Object.freeze({
    master,
    ambience: master * normalized.ambience,
    sfx: master * normalized.sfx,
  });
}

export function scaleSfxGain(nominalGain, settings = {}) {
  const safeGain = clamp(finiteNumber(nominalGain, 0), 0, 1);
  return round(safeGain * getEffectiveAudioMix(settings).sfx);
}

export function normalizeAudioTheme(theme) {
  return AUDIO_THEME_IDS.includes(theme) ? theme : 'city';
}

// FNV-1a followed by a small avalanche keeps schedules stable across browsers.
export function hashAudioSeed(value) {
  const input = String(value ?? 'echobound');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function sample01(seed, slot, lane) {
  let value = (seed + Math.imul(slot + 1, 0x9e3779b1) + Math.imul(lane + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function pick(values, randomValue) {
  return values[Math.min(values.length - 1, Math.floor(randomValue * values.length))];
}

function frequencyFromSemitones(rootHz, semitones) {
  return clamp(rootHz * (2 ** (semitones / 12)), 35, 1800);
}

function makeEvent({
  id,
  theme,
  layer,
  slot,
  at,
  startTime,
  frequency,
  duration,
  wave,
  gain,
  slideHz,
}) {
  return Object.freeze({
    id,
    bus: 'ambience',
    theme,
    layer,
    slot,
    at: round(at),
    delaySeconds: round(Math.max(0, at - startTime)),
    frequency: round(frequency, 3),
    duration: round(duration, 3),
    wave: OSCILLATOR_TYPES.includes(wave) ? wave : 'sine',
    gain: round(clamp(gain, 0, 1)),
    slideHz: round(slideHz, 3),
  });
}

/**
 * Produit un plan absolu et déterministe de sons d'ambiance.
 *
 * Le découpage en créneaux dépend du temps absolu : deux appels contigus ne
 * rejouent pas un son à leur frontière et une même graine rend le même plan.
 * Aucun timer ni AudioContext n'est créé ici, ce qui laisse l'AudioEngine
 * choisir son propre mécanisme de programmation.
 */
export function buildAmbientSchedule({
  theme = 'city',
  seed = 'echobound',
  startTime = 0,
  horizonSeconds = AUDIO_DIRECTOR_LIMITS.defaultLookAheadSeconds,
  maxEvents = AUDIO_DIRECTOR_LIMITS.maxEventsPerPlan,
  settings = DEFAULT_AUDIO_SETTINGS,
} = {}) {
  const themeId = normalizeAudioTheme(theme);
  const profile = AUDIO_THEME_PROFILES[themeId];
  const normalizedSettings = normalizeAudioSettings(settings);
  const mix = getEffectiveAudioMix(normalizedSettings);
  if (mix.ambience <= 0) return Object.freeze([]);

  const safeStart = Math.max(0, finiteNumber(startTime, 0));
  const safeHorizon = clamp(
    finiteNumber(horizonSeconds, AUDIO_DIRECTOR_LIMITS.defaultLookAheadSeconds),
    AUDIO_DIRECTOR_LIMITS.minLookAheadSeconds,
    AUDIO_DIRECTOR_LIMITS.maxLookAheadSeconds,
  );
  const eventLimit = Math.floor(clamp(
    finiteNumber(maxEvents, AUDIO_DIRECTOR_LIMITS.maxEventsPerPlan),
    0,
    AUDIO_DIRECTOR_LIMITS.maxEventsPerPlan,
  ));
  if (eventLimit === 0) return Object.freeze([]);

  const motionScale = normalizedSettings.reducedMotion
    ? AUDIO_DIRECTOR_LIMITS.reducedMotionTempoScale
    : 1;
  const densityScale = normalizedSettings.reducedMotion
    ? AUDIO_DIRECTOR_LIMITS.reducedMotionDensity
    : 1;
  const stepSeconds = profile.stepSeconds * motionScale;
  const jitterSeconds = profile.jitterSeconds * (normalizedSettings.reducedMotion ? 0.25 : 1);
  const endTime = safeStart + safeHorizon;
  const firstSlot = Math.max(0, Math.floor(safeStart / stepSeconds) - 1);
  const lastSlot = Math.ceil(endTime / stepSeconds) + 1;
  const scheduleSeed = hashAudioSeed(`${seed}|${themeId}|ambient-v1`);
  const events = [];

  for (let slot = firstSlot; slot <= lastSlot && events.length < eventLimit; slot += 1) {
    if (sample01(scheduleSeed, slot, 0) >= profile.activeChance * densityScale) continue;

    const jitter = (sample01(scheduleSeed, slot, 1) * 2 - 1) * jitterSeconds;
    const at = Math.max(0, slot * stepSeconds + jitter);
    if (at + 1e-7 < safeStart || at >= endTime) continue;

    const scaleStep = pick(profile.scale, sample01(scheduleSeed, slot, 2));
    const octave = pick(profile.octaves, sample01(scheduleSeed, slot, 3));
    const frequency = frequencyFromSemitones(profile.rootHz, scaleStep + octave);
    const duration = profile.duration[0]
      + (profile.duration[1] - profile.duration[0]) * sample01(scheduleSeed, slot, 4);
    const gainVariance = 0.78 + sample01(scheduleSeed, slot, 5) * 0.22;
    const slideSemitones = normalizedSettings.reducedMotion
      ? 0
      : pick(profile.slideSemitones, sample01(scheduleSeed, slot, 6));
    const slideHz = frequency * ((2 ** (slideSemitones / 12)) - 1);

    events.push(makeEvent({
      id: `${themeId}:${slot}:bed`,
      theme: themeId,
      layer: 'bed',
      slot,
      at,
      startTime: safeStart,
      frequency,
      duration,
      wave: profile.wave,
      gain: profile.baseGain * gainVariance * mix.ambience,
      slideHz,
    }));

    const accentChance = profile.accentChance * (normalizedSettings.reducedMotion ? 0.25 : 1);
    const accentAt = at + profile.accentDelay;
    if (
      events.length < eventLimit
      && accentAt < endTime
      && sample01(scheduleSeed, slot, 7) < accentChance
    ) {
      const accentFrequency = frequencyFromSemitones(frequency, profile.accentSemitones);
      events.push(makeEvent({
        id: `${themeId}:${slot}:accent`,
        theme: themeId,
        layer: 'accent',
        slot,
        at: accentAt,
        startTime: safeStart,
        frequency: accentFrequency,
        duration: Math.max(0.1, duration * 0.48),
        wave: profile.accentWave,
        gain: profile.baseGain * 0.58 * gainVariance * mix.ambience,
        slideHz: 0,
      }));
    }
  }

  events.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  return Object.freeze(events.slice(0, eventLimit));
}

/** Convertit un événement du directeur vers la signature AudioEngine.tone. */
export function toAudioEngineTone(event) {
  if (!event || event.bus !== 'ambience' || !OSCILLATOR_TYPES.includes(event.wave)) return null;
  return Object.freeze({
    frequency: event.frequency,
    duration: event.duration,
    type: event.wave,
    volume: event.gain,
    slide: event.slideHz,
    delaySeconds: event.delaySeconds,
  });
}

/**
 * Petit adaptateur pour un événement arrivé à échéance. Le délai reste géré
 * par l'appelant afin que ce module n'accumule jamais de timers invisibles.
 */
export function emitAmbientTone(audioEngine, event) {
  const tone = toAudioEngineTone(event);
  if (!tone || !audioEngine || typeof audioEngine.tone !== 'function' || tone.volume <= 0) return false;
  audioEngine.tone(tone.frequency, tone.duration, tone.type, tone.volume, tone.slide);
  return true;
}

export class AudioDirector {
  constructor({
    seed = 'echobound',
    theme = 'city',
    settings = DEFAULT_AUDIO_SETTINGS,
  } = {}) {
    this.seed = String(seed ?? 'echobound');
    this.theme = normalizeAudioTheme(theme);
    this.settings = normalizeAudioSettings(settings);
    this.cursor = 0;
  }

  setTheme(theme, at = this.cursor) {
    const nextTheme = normalizeAudioTheme(theme);
    if (nextTheme !== this.theme) {
      this.theme = nextTheme;
      this.reset(at);
    }
    return this.theme;
  }

  setSettings(settings = {}) {
    this.settings = normalizeAudioSettings({ ...this.settings, ...settings });
    return this.settings;
  }

  reset(at = 0) {
    this.cursor = Math.max(0, finiteNumber(at, 0));
  }

  getMix() {
    return getEffectiveAudioMix(this.settings);
  }

  getSfxGain(nominalGain) {
    return scaleSfxGain(nominalGain, this.settings);
  }

  /**
   * Retourne uniquement la tranche qui n'a pas encore été programmée.
   * L'horizon et le nombre d'événements sont bornés par construction.
   */
  plan(now = 0, horizonSeconds = AUDIO_DIRECTOR_LIMITS.defaultLookAheadSeconds) {
    const safeNow = Math.max(0, finiteNumber(now, 0));
    if (this.cursor < safeNow) this.cursor = safeNow;
    const safeHorizon = clamp(
      finiteNumber(horizonSeconds, AUDIO_DIRECTOR_LIMITS.defaultLookAheadSeconds),
      AUDIO_DIRECTOR_LIMITS.minLookAheadSeconds,
      AUDIO_DIRECTOR_LIMITS.maxLookAheadSeconds,
    );
    const endTime = safeNow + safeHorizon;
    if (this.cursor >= endTime) return Object.freeze([]);

    const startTime = this.cursor;
    const events = buildAmbientSchedule({
      theme: this.theme,
      seed: this.seed,
      startTime,
      horizonSeconds: endTime - startTime,
      settings: this.settings,
    });
    this.cursor = endTime;
    return events;
  }
}
