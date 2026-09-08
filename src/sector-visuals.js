const UINT32_MAX = 0xffffffff;
const VISUAL_FAMILIES = Object.freeze([
  'mechanical',
  'organic',
  'ritual-fog',
  'terrain-ruin',
]);

const freezeList = (values) => Object.freeze([...values]);
const FAMILY_PALETTES = Object.freeze({
  mechanical: freezeList(['#ffd36b', '#ff9b53', '#8de7ff']),
  organic: freezeList(['#bcff8d', '#7de3a7', '#d797ff']),
  'ritual-fog': freezeList(['#d8e2ff', '#b394ff', '#ff93c5']),
  'terrain-ruin': freezeList(['#ff9a72', '#d77d61', '#e5bf69']),
});

const definition = (family, motif, detailBias = 0, alphaBias = 0) => Object.freeze({
  family,
  motif,
  detailBias,
  alphaBias,
});

// Every authored obstacle kind has an explicit visual language. Geometry remains
// owned by world-layouts; this table only supplies deterministic Canvas styling.
const OBSTACLE_VISUALS = Object.freeze({
  // Terrain and broken structures.
  'portal-rubble': definition('terrain-ruin', 'portal-fragments', 0.08, 0.03),
  crater: definition('terrain-ruin', 'concentric-cracks', -0.04, -0.02),
  wreck: definition('terrain-ruin', 'broken-panels', 0.04, 0.02),
  'scrap-pile': definition('terrain-ruin', 'scattered-shards', 0.12, 0.04),
  trench: definition('terrain-ruin', 'parallel-strata', -0.02, -0.03),
  'crater-rim': definition('terrain-ruin', 'fractured-rings', 0.02, 0),

  // Machines, fabricated barriers and conductive remains.
  'metal-spine': definition('mechanical', 'segmented-ribs', 0.05, 0),
  antenna: definition('mechanical', 'signal-bars', 0.1, 0.02),
  dish: definition('mechanical', 'signal-arcs', 0.03, -0.01),
  'sealed-wall': definition('mechanical', 'sealed-panels', -0.02, 0.01),
  'fossil-metal': definition('mechanical', 'oxidized-ribs', 0.01, -0.02),
  'rail-machinery': definition('mechanical', 'rail-teeth', 0.08, 0.02),
  'ore-wagon': definition('mechanical', 'riveted-panels', -0.03, 0),
  'security-gate': definition('mechanical', 'security-lattice', 0.04, 0.04),
  'machine-kennel': definition('mechanical', 'caged-panels', 0.02, 0.01),
  cage: definition('mechanical', 'vertical-bars', -0.02, -0.01),
  press: definition('mechanical', 'hydraulic-rams', 0.06, 0.03),
  'watch-gear': definition('mechanical', 'watch-cogs', 0.12, 0.03),
  conveyor: definition('mechanical', 'chevron-belt', 0.02, -0.02),
  'pressure-pipe': definition('mechanical', 'pipe-joints', 0.01, 0),
  smelter: definition('mechanical', 'furnace-vents', 0.08, 0.08),
  'molten-channel': definition('mechanical', 'molten-flow', -0.05, 0.12),
  'memory-bank': definition('mechanical', 'memory-cells', 0.09, 0.02),
  'induction-coil': definition('mechanical', 'induction-rings', 0.11, 0.06),

  // Living architecture of the Bio-Ruche.
  root: definition('organic', 'root-veins', 0.02, 0),
  'sap-pool': definition('organic', 'fluid-cells', -0.05, 0.05),
  bulb: definition('organic', 'pulsing-lobes', 0.03, 0.03),
  'fungal-column': definition('organic', 'fungal-gills', 0.08, 0.02),
  'spore-bed': definition('organic', 'spore-clusters', 0.12, 0.02),
  mycelium: definition('organic', 'mycelial-web', 0.09, -0.01),
  'suspended-vein': definition('organic', 'suspended-capillaries', 0.04, 0.02),
  'nerve-node': definition('organic', 'nerve-rings', 0.1, 0.05),
  'nursery-pod': definition('organic', 'nursery-seams', 0.03, 0.03),
  'soft-mycelium': definition('organic', 'soft-filaments', -0.01, -0.02),
  'living-lobe': definition('organic', 'living-folds', 0.06, 0.04),

  // Ritual architecture, memory surfaces and condensed mist.
  monolith: definition('ritual-fog', 'silent-glyphs', 0.05, 0.01),
  'stone-pew': definition('ritual-fog', 'procession-lines', -0.03, -0.03),
  'dry-font': definition('ritual-fog', 'empty-ripples', 0.02, -0.01),
  'bell-tower': definition('ritual-fog', 'bell-runes', 0.08, 0.02),
  'collapsed-arcade': definition('ritual-fog', 'broken-arches', 0.03, -0.02),
  'mist-garden': definition('ritual-fog', 'mist-rosettes', 0.1, 0.04),
  'black-mirror': definition('ritual-fog', 'mirror-facets', 0.04, 0.06),
  altar: definition('ritual-fog', 'altar-sigil', 0.06, 0.03),
  'mist-screen': definition('ritual-fog', 'layered-veil', -0.04, -0.01),
  tomb: definition('ritual-fog', 'funerary-lines', 0.01, -0.02),
  'crypt-wall': definition('ritual-fog', 'crypt-glyphs', 0.03, -0.01),
  'choir-arc': definition('ritual-fog', 'choir-arches', 0.07, 0.01),
});

const THEME_VISUALS = Object.freeze({
  city: Object.freeze({ family: 'mechanical', motifs: freezeList(['echo-grid', 'civic-orbits', 'signal-nodes']), accents: freezeList(['#8de7ff', '#b394ff', '#8bf0b2']) }),
  wastes: Object.freeze({ family: 'terrain-ruin', motifs: freezeList(['wind-strata', 'portal-scars', 'dust-rings']), accents: FAMILY_PALETTES['terrain-ruin'] }),
  hive: Object.freeze({ family: 'organic', motifs: freezeList(['living-cells', 'vein-canopy', 'spore-bloom']), accents: FAMILY_PALETTES.organic }),
  fog: Object.freeze({ family: 'ritual-fog', motifs: freezeList(['procession-veil', 'memory-arches', 'mirror-haze']), accents: FAMILY_PALETTES['ritual-fog'] }),
  foundry: Object.freeze({ family: 'mechanical', motifs: freezeList(['watch-grid', 'rail-circuit', 'furnace-flow']), accents: FAMILY_PALETTES.mechanical }),
  void: Object.freeze({ family: 'ritual-fog', motifs: freezeList(['void-orbits', 'broken-halo', 'silent-rays']), accents: freezeList(['#b394ff', '#d8e2ff', '#7c6bd8']) }),
  neutral: Object.freeze({ family: 'terrain-ruin', motifs: freezeList(['quiet-facets', 'soft-strata', 'distant-rings']), accents: freezeList(['#8de7ff', '#9aa9bc', '#b394ff']) }),
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const rounded = (value) => Math.round(value * 1000) / 1000;

function safeToken(value, fallback, maxLength = 96) {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const token = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return token || fallback;
}

function hashToken(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix(seed, salt) {
  let value = (seed ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

const sample = (seed, salt) => mix(seed, salt) / UINT32_MAX;
const pick = (values, seed) => values[seed % values.length];
const sectorSignatureCache = new Map();
const obstacleVisualCache = new Map();

export function getSectorVisualSignature(sectorId, theme) {
  const safeSectorId = safeToken(sectorId, 'unknown-sector');
  const safeTheme = safeToken(theme, 'neutral', 32);
  const cacheKey = `${safeTheme}:${safeSectorId}`;
  const cached = sectorSignatureCache.get(cacheKey);
  if (cached) return cached;
  const profile = THEME_VISUALS[safeTheme] || THEME_VISUALS.neutral;
  const seed = hashToken(`sector:${safeTheme}:${safeSectorId}`);

  const signature = Object.freeze({
    sectorId: safeSectorId,
    theme: safeTheme,
    family: profile.family,
    motif: pick(profile.motifs, mix(seed, 0x2c1b3c6d)),
    detail: rounded(clamp(0.42 + sample(seed, 0x165667b1) * 0.48, 0, 1)),
    angle: rounded((sample(seed, 0xd3a2646c) - 0.5) * 0.36),
    seed,
    accent: pick(profile.accents, mix(seed, 0x9e3779b9)),
    alpha: rounded(clamp(0.08 + sample(seed, 0x85ebca77) * 0.16, 0, 1)),
  });
  sectorSignatureCache.set(cacheKey, signature);
  return signature;
}

export function getObstacleVisual(kind, sectorId) {
  const safeKind = safeToken(kind, 'terrain');
  const safeSectorId = safeToken(sectorId, 'unknown-sector');
  const cacheKey = `${safeSectorId}:${safeKind}`;
  const cached = obstacleVisualCache.get(cacheKey);
  if (cached) return cached;
  const known = Object.prototype.hasOwnProperty.call(OBSTACLE_VISUALS, safeKind);
  const profile = known
    ? OBSTACLE_VISUALS[safeKind]
    : definition('terrain-ruin', 'quiet-facets', 0, 0);
  const seed = hashToken(`obstacle:${safeSectorId}:${safeKind}`);
  const palette = FAMILY_PALETTES[profile.family] || FAMILY_PALETTES['terrain-ruin'];

  const visual = Object.freeze({
    kind: safeKind,
    sectorId: safeSectorId,
    known,
    family: VISUAL_FAMILIES.includes(profile.family) ? profile.family : 'terrain-ruin',
    motif: profile.motif,
    detail: rounded(clamp(0.35 + sample(seed, 0x27d4eb2f) * 0.42 + profile.detailBias, 0, 1)),
    angle: rounded((sample(seed, 0x94d049bb) - 0.5) * 0.5),
    seed,
    accent: pick(palette, mix(seed, 0x369dea0f)),
    alpha: rounded(clamp(0.14 + sample(seed, 0x632be59b) * 0.28 + profile.alphaBias, 0, 1)),
  });
  obstacleVisualCache.set(cacheKey, visual);
  return visual;
}
