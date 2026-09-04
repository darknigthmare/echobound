import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_DIRECTOR_LIMITS,
  AUDIO_THEME_IDS,
  AUDIO_THEME_PROFILES,
  AudioDirector,
  buildAmbientSchedule,
  emitAmbientTone,
  getEffectiveAudioMix,
  normalizeAudioSettings,
  scaleSfxGain,
  toAudioEngineTone,
} from '../src/audio-director.js';

test('les six territoires possèdent un profil procédural original et distinct', () => {
  assert.deepEqual(Object.keys(AUDIO_THEME_PROFILES), AUDIO_THEME_IDS);
  const signatures = AUDIO_THEME_IDS.map((id) => {
    const profile = AUDIO_THEME_PROFILES[id];
    return `${profile.rootHz}|${profile.scale.join(',')}|${profile.wave}|${profile.stepSeconds}`;
  });
  assert.equal(new Set(signatures).size, AUDIO_THEME_IDS.length);
  assert.ok(Object.isFrozen(AUDIO_THEME_PROFILES));
  assert.ok(Object.isFrozen(AUDIO_THEME_PROFILES.hive.scale));
});

test('les réglages audio sont assainis et bornés', () => {
  assert.deepEqual(normalizeAudioSettings({
    muted: 0,
    master: 4,
    ambience: -3,
    sfx: '0.35',
    reducedMotion: 1,
  }), {
    muted: false,
    master: 1,
    ambience: 0,
    sfx: 0.35,
    reducedMotion: true,
  });

  assert.deepEqual(normalizeAudioSettings(null), {
    muted: false,
    master: 0.82,
    ambience: 0.58,
    sfx: 0.86,
    reducedMotion: false,
  });
});

test('mute, master, ambiance et SFX contrôlent réellement leurs bus', () => {
  assert.deepEqual(getEffectiveAudioMix({ master: 0.5, ambience: 0.4, sfx: 0.8 }), {
    master: 0.5,
    ambience: 0.2,
    sfx: 0.4,
  });
  assert.deepEqual(getEffectiveAudioMix({ muted: true, master: 1, ambience: 1, sfx: 1 }), {
    master: 0,
    ambience: 0,
    sfx: 0,
  });
  assert.equal(scaleSfxGain(0.5, { master: 0.5, sfx: 0.8 }), 0.2);
  assert.equal(scaleSfxGain(0.5, { muted: true }), 0);
});

test('une même graine et une même fenêtre rendent exactement le même plan', () => {
  const options = {
    theme: 'fog',
    seed: 'cycle-4-save-917',
    startTime: 12.5,
    horizonSeconds: 18,
    settings: { master: 0.8, ambience: 0.7 },
  };
  const first = buildAmbientSchedule(options);
  const second = buildAmbientSchedule(options);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every(Object.isFrozen));
});

test('le plan reste borné même avec un horizon et une limite démesurés', () => {
  const startTime = 3;
  const schedule = buildAmbientSchedule({
    theme: 'foundry',
    seed: 'stress',
    startTime,
    horizonSeconds: 9999,
    maxEvents: 9999,
    settings: { master: 1, ambience: 1 },
  });

  assert.ok(schedule.length > 0);
  assert.ok(schedule.length <= AUDIO_DIRECTOR_LIMITS.maxEventsPerPlan);
  for (const event of schedule) {
    assert.ok(event.at >= startTime);
    assert.ok(event.at < startTime + AUDIO_DIRECTOR_LIMITS.maxLookAheadSeconds);
    assert.ok(event.delaySeconds >= 0);
    assert.ok(event.frequency >= 35 && event.frequency <= 1800);
    assert.ok(event.duration >= 0.1 && event.duration <= 3.25);
    assert.ok(event.gain > 0 && event.gain <= 1);
    assert.equal(event.bus, 'ambience');
  }
});

test('les territoires produisent des identités sonores différentes', () => {
  const plans = AUDIO_THEME_IDS.map((theme) => buildAmbientSchedule({
    theme,
    seed: 'same-world',
    horizonSeconds: 20,
    settings: { master: 1, ambience: 1 },
  }));
  const signatures = plans.map((events) => events
    .slice(0, 6)
    .map((event) => `${event.wave}:${event.frequency}:${event.duration}`)
    .join('|'));
  assert.equal(new Set(signatures).size, AUDIO_THEME_IDS.length);
});

test('le mouvement réduit calme les pulsations et supprime les glissés', () => {
  const base = {
    theme: 'hive',
    seed: 'accessibility',
    horizonSeconds: 24,
    settings: { master: 1, ambience: 1 },
  };
  const animated = buildAmbientSchedule(base);
  const reduced = buildAmbientSchedule({
    ...base,
    settings: { ...base.settings, reducedMotion: true },
  });

  assert.ok(animated.length > 0);
  assert.ok(reduced.length < animated.length);
  assert.ok(reduced.every((event) => event.slideHz === 0));
  assert.ok(reduced.filter((event) => event.layer === 'accent').length
    <= animated.filter((event) => event.layer === 'accent').length);
});

test('mute ou une ambiance à zéro ne programme aucun oscillateur', () => {
  assert.deepEqual(buildAmbientSchedule({ settings: { muted: true } }), []);
  assert.deepEqual(buildAmbientSchedule({ settings: { ambience: 0 } }), []);
  assert.deepEqual(buildAmbientSchedule({ maxEvents: 0 }), []);
});

test('AudioDirector avance son curseur sans doublon et se recale au changement de thème', () => {
  const director = new AudioDirector({
    seed: 'save-42',
    theme: 'wastes',
    settings: { master: 1, ambience: 1 },
  });
  const first = director.plan(0, 8);
  const second = director.plan(4, 8);
  assert.ok(first.length > 0);
  assert.ok(second.every((event) => event.at >= 8));
  assert.equal(new Set([...first, ...second].map((event) => event.id)).size, first.length + second.length);

  director.setTheme('void', 20);
  const voidPlan = director.plan(20, 8);
  assert.ok(voidPlan.every((event) => event.theme === 'void' && event.at >= 20));
  assert.equal(director.getSfxGain(0.5), 0.43);
});

test('l’adaptateur cible directement AudioEngine.tone sans créer de timer', () => {
  const event = buildAmbientSchedule({
    theme: 'city',
    seed: 'adapter',
    horizonSeconds: 12,
    settings: { master: 1, ambience: 1 },
  })[0];
  assert.ok(event);
  const tone = toAudioEngineTone(event);
  assert.equal(tone.frequency, event.frequency);
  assert.equal(tone.type, event.wave);
  assert.equal(tone.delaySeconds, event.delaySeconds);

  const calls = [];
  const engine = { tone: (...args) => calls.push(args) };
  assert.equal(emitAmbientTone(engine, event), true);
  assert.deepEqual(calls[0], [event.frequency, event.duration, event.wave, event.gain, event.slideHz]);
  assert.equal(emitAmbientTone(null, event), false);
  assert.equal(toAudioEngineTone({ bus: 'sfx', wave: 'sine' }), null);
});
