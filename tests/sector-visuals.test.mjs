import assert from 'node:assert/strict';
import test from 'node:test';

import { getObstacleVisual, getSectorVisualSignature } from '../src/sector-visuals.js';
import { WORLD_LAYOUTS } from '../src/world-layouts.js';

const FAMILY_KINDS = Object.freeze({
  'terrain-ruin': [
    'portal-rubble', 'crater', 'wreck', 'scrap-pile', 'trench', 'crater-rim',
  ],
  mechanical: [
    'metal-spine', 'antenna', 'dish', 'sealed-wall', 'fossil-metal',
    'rail-machinery', 'ore-wagon', 'security-gate', 'machine-kennel', 'cage',
    'press', 'watch-gear', 'conveyor', 'pressure-pipe', 'smelter',
    'molten-channel', 'memory-bank', 'induction-coil',
  ],
  organic: [
    'root', 'sap-pool', 'bulb', 'fungal-column', 'spore-bed', 'mycelium',
    'suspended-vein', 'nerve-node', 'nursery-pod', 'soft-mycelium', 'living-lobe',
  ],
  'ritual-fog': [
    'monolith', 'stone-pew', 'dry-font', 'bell-tower', 'collapsed-arcade',
    'mist-garden', 'black-mirror', 'altar', 'mist-screen', 'tomb',
    'crypt-wall', 'choir-arc',
  ],
});

const allSectors = Object.values(WORLD_LAYOUTS)
  .flatMap((region) => region.sectors.map((sector) => ({ ...sector, theme: region.theme })));
const authoredKinds = new Set(allSectors.flatMap((sector) => sector.obstacles.map(({ kind }) => kind)));
const expectedKinds = new Set(Object.values(FAMILY_KINDS).flat());
const allowedFamilies = new Set(Object.keys(FAMILY_KINDS));

function assertCanvasBounds(visual) {
  assert.ok(Number.isInteger(visual.seed));
  assert.ok(visual.seed >= 0 && visual.seed <= 0xffffffff);
  assert.ok(Number.isFinite(visual.detail) && visual.detail >= 0 && visual.detail <= 1);
  assert.ok(Number.isFinite(visual.angle) && visual.angle >= -Math.PI && visual.angle <= Math.PI);
  assert.ok(Number.isFinite(visual.alpha) && visual.alpha >= 0 && visual.alpha <= 1);
  assert.match(visual.accent, /^#[0-9a-f]{6}$/i);
  assert.match(visual.motif, /^[a-z0-9-]+$/);
  assert.ok(allowedFamilies.has(visual.family));
}

test('chaque kind authored possède une famille visuelle explicite et cohérente', () => {
  assert.deepEqual(authoredKinds, expectedKinds);

  for (const [family, kinds] of Object.entries(FAMILY_KINDS)) {
    for (const kind of kinds) {
      const visual = getObstacleVisual(kind, 'coverage-sector');
      assert.equal(visual.known, true, `Fallback interdit pour ${kind}`);
      assert.equal(visual.family, family, `Famille incohérente pour ${kind}`);
      assertCanvasBounds(visual);
    }
  }
});

test('les signatures des vingt secteurs sont stables et visuellement distinctes', () => {
  assert.equal(allSectors.length, 20);
  const signatures = allSectors.map(({ id, theme }) => {
    const first = getSectorVisualSignature(id, theme);
    const second = getSectorVisualSignature(id, theme);
    assert.deepEqual(first, second);
    assertCanvasBounds(first);
    assert.equal(Object.isFrozen(first), true);
    return JSON.stringify([
      first.seed, first.motif, first.detail, first.angle, first.accent, first.alpha,
    ]);
  });

  assert.equal(new Set(signatures).size, allSectors.length);
});

test('les variantes d’obstacle restent déterministes par kind et secteur', () => {
  for (const sector of allSectors) {
    for (const obstacle of sector.obstacles) {
      const first = getObstacleVisual(obstacle.kind, sector.id);
      const second = getObstacleVisual(obstacle.kind, sector.id);
      assert.deepEqual(first, second);
      assert.equal(Object.isFrozen(first), true);
      assertCanvasBounds(first);
    }
  }
});

test('les résultats sont immuables et les entrées inconnues utilisent un fallback borné', () => {
  const obstacle = getObstacleVisual('future crystal???', null);
  const sector = getSectorVisualSignature({}, []);

  assert.equal(obstacle.known, false);
  assert.equal(obstacle.kind, 'future-crystal');
  assert.equal(obstacle.sectorId, 'unknown-sector');
  assert.equal(obstacle.family, 'terrain-ruin');
  assert.equal(sector.sectorId, 'unknown-sector');
  assert.equal(sector.theme, 'neutral');
  assertCanvasBounds(obstacle);
  assertCanvasBounds(sector);
  assert.equal(Object.isFrozen(obstacle), true);
  assert.equal(Object.isFrozen(sector), true);
  assert.throws(() => { obstacle.alpha = 2; }, TypeError);
  assert.throws(() => { sector.seed = -1; }, TypeError);
});
