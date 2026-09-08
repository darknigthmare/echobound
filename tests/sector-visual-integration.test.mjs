import assert from 'node:assert/strict';
import test from 'node:test';

import { getObstacleVisual, getSectorVisualSignature } from '../src/sector-visuals.js';
import { WORLD_LAYOUTS } from '../src/world-layouts.js';
import { createGameHarness } from './helpers/game-harness.mjs';

const createRecordingContext = () => {
  const operations = [];
  let fillStyle = null;
  let gradientIndex = 0;
  const record = (method) => (...args) => operations.push({ method, args });
  const createGradient = (method, args) => {
    const gradient = {
      id: `${method}-${gradientIndex += 1}`,
      stops: [],
      addColorStop(offset, color) { this.stops.push([offset, color]); },
    };
    operations.push({ method, args, gradient });
    return gradient;
  };
  const context = {
    operations,
    reset() { operations.length = 0; },
    createLinearGradient(...args) { return createGradient('createLinearGradient', args); },
    createRadialGradient(...args) { return createGradient('createRadialGradient', args); },
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    bezierCurveTo: record('bezierCurveTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    arcTo: record('arcTo'),
    ellipse: record('ellipse'),
    rect: record('rect'),
    clip: record('clip'),
    stroke: record('stroke'),
    fill: record('fill'),
    strokeRect: record('strokeRect'),
    setLineDash: record('setLineDash'),
    translate: record('translate'),
    rotate: record('rotate'),
    fillRect(...args) { operations.push({ method: 'fillRect', args, fillStyle }); },
  };
  Object.defineProperty(context, 'fillStyle', {
    get: () => fillStyle,
    set(value) { fillStyle = value; operations.push({ method: 'setFillStyle', args: [value] }); },
  });
  return context;
};

const allSectors = Object.values(WORLD_LAYOUTS).flatMap((region) => (
  region.sectors.map((sector) => ({ region, sector }))
));

const operationCount = (context, method) => context.operations.filter((operation) => operation.method === method).length;

test('fog rendering reuses one animated band gradient across frames', async () => {
  const context = createRecordingContext();
  const { game } = await createGameHarness({ canvasContext: context });
  const map = { id: 'fog_drowned_nave', theme: 'fog' };

  game.elapsed = 0;
  game.renderMapBackground(map);
  assert.equal(operationCount(context, 'createLinearGradient'), 2, 'base fog and band gradients are created once');
  const firstBands = context.operations.filter(({ method, args }) => method === 'fillRect' && args[0] === 0 && args[2] === 960 && args[3] === 35);
  assert.equal(firstBands.length, 15);
  assert.equal(new Set(firstBands.map(({ fillStyle: style }) => style?.id)).size, 1, 'all bands share one CanvasGradient');
  const firstPositions = firstBands.map(({ args }) => args[1]);

  context.reset();
  game.elapsed = 3;
  game.renderMapBackground(map);
  assert.equal(operationCount(context, 'createLinearGradient'), 0, 'the next frame creates no gradient');
  const secondBands = context.operations.filter(({ method, args }) => method === 'fillRect' && args[0] === 0 && args[2] === 960 && args[3] === 35);
  assert.equal(secondBands.length, 15);
  assert.notDeepEqual(secondBands.map(({ args }) => args[1]), firstPositions, 'band positions remain animated');
});

test('every static background gradient is cached after its first render', async () => {
  const context = createRecordingContext();
  const { game } = await createGameHarness({ canvasContext: context });
  game.worldParticles = [];
  const maps = [
    { id: 'city_core', theme: 'city' },
    { id: 'wastes_gatefall', theme: 'wastes' },
    { id: 'hive_rootmouth', theme: 'hive' },
    { id: 'fog_drowned_nave', theme: 'fog' },
    { id: 'foundry_intake_rail', theme: 'foundry' },
    { id: 'void_threshold', theme: 'void' },
  ];

  for (const map of maps) game.renderMapBackground(map);
  assert.equal(operationCount(context, 'createLinearGradient') + operationCount(context, 'createRadialGradient'), 7);
  assert.equal(game.visualGradientCache.size, 7);

  context.reset();
  for (const map of maps) game.renderMapBackground(map);
  assert.equal(operationCount(context, 'createLinearGradient') + operationCount(context, 'createRadialGradient'), 0);
});

test('all 20 authored sector motifs execute as distinct Canvas signatures', async () => {
  const context = createRecordingContext();
  const { game } = await createGameHarness({ canvasContext: context });
  assert.equal(allSectors.length, 20);
  const signatures = new Set();

  for (const { region, sector } of allSectors) {
    context.reset();
    assert.doesNotThrow(() => game.drawSectorIdentity({ id: sector.id, theme: region.theme }));
    const visual = getSectorVisualSignature(sector.id, region.theme);
    assert.ok(visual.motif);
    const signature = context.operations
      .filter(({ method }) => ['arc', 'ellipse', 'strokeRect', 'moveTo', 'lineTo', 'bezierCurveTo', 'translate', 'rotate', 'setLineDash'].includes(method))
      .map(({ method, args }) => `${method}:${args.map((value) => typeof value === 'number' ? value.toFixed(3) : String(value)).join(',')}`)
      .join('|');
    assert.ok(signature.length > 0, `${sector.id} must emit semantic Canvas geometry`);
    signatures.add(signature);
  }

  assert.equal(signatures.size, 20);
});

test('every authored obstacle motif executes and representative families use semantic primitives', async () => {
  const context = createRecordingContext();
  const { game } = await createGameHarness({ canvasContext: context });
  const methodsByKind = new Map();

  for (const { region, sector } of allSectors) {
    for (const obstacle of sector.obstacles) {
      context.reset();
      assert.doesNotThrow(() => game.drawObstacle(obstacle, region.theme, region.accent, sector.id));
      const visual = getObstacleVisual(obstacle.kind, sector.id);
      assert.ok(visual.motif);
      assert.ok(operationCount(context, 'clip') > 0, `${obstacle.kind} must remain clipped to collision geometry`);
      const methods = methodsByKind.get(obstacle.kind) || new Set();
      context.operations.forEach(({ method }) => methods.add(method));
      methodsByKind.set(obstacle.kind, methods);
    }
  }

  assert.equal(methodsByKind.size, 47);
  const expectPrimitive = (kind, method) => assert.ok(methodsByKind.get(kind)?.has(method), `${kind} should render with ${method}`);
  expectPrimitive('watch-gear', 'ellipse');
  expectPrimitive('conveyor', 'quadraticCurveTo');
  expectPrimitive('security-gate', 'setLineDash');
  expectPrimitive('spore-bed', 'ellipse');
  expectPrimitive('root', 'bezierCurveTo');
  expectPrimitive('black-mirror', 'rotate');
  expectPrimitive('choir-arc', 'ellipse');
  expectPrimitive('crater', 'ellipse');
  expectPrimitive('trench', 'quadraticCurveTo');
});

test('map geometry forwards the sector identity at runtime', async () => {
  const context = createRecordingContext();
  const { game } = await createGameHarness({ canvasContext: context });
  const calls = [];
  game.drawObstacle = (...args) => calls.push(args);
  const obstacle = { x: 1, y: 2, w: 3, h: 4, kind: 'crater' };
  game.renderMapGeometry({ id: 'wastes_memory_crater', theme: 'wastes', accent: '#fff', obstacles: [obstacle] });
  assert.deepEqual(calls, [[obstacle, 'wastes', '#fff', 'wastes_memory_crater']]);
});
