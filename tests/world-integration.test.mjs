import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REGION_IDS,
  WORLD_LAYOUTS,
  getSectorTransitions,
} from '../src/world-layouts.js';

const PLAYER = Object.freeze({ minX: 22, maxX: 938, minY: 78, maxY: 518, radius: 13 });
const STEP = 6;

const circleRectCollision = (x, y, radius, rect) => {
  const nearestX = Math.max(rect.x, Math.min(rect.x + rect.w, x));
  const nearestY = Math.max(rect.y, Math.min(rect.y + rect.h, y));
  return Math.hypot(x - nearestX, y - nearestY) < radius;
};

const isWalkable = (sector, point) => (
  point.x >= PLAYER.minX
  && point.x <= PLAYER.maxX
  && point.y >= PLAYER.minY
  && point.y <= PLAYER.maxY
  && !sector.obstacles.some((rect) => circleRectCollision(point.x, point.y, PLAYER.radius, rect))
);

const nudgeFromEdge = (endpoint) => ({
  x: endpoint.x <= 90 ? endpoint.x + 52 : endpoint.x >= 960 - 90 ? endpoint.x - 52 : endpoint.x,
  y: endpoint.y <= 90 ? endpoint.y + 62 : endpoint.y >= 540 - 60 ? endpoint.y - 42 : endpoint.y,
});

function gridPoint(column, row) {
  return { x: PLAYER.minX + column * STEP, y: PLAYER.minY + row * STEP };
}

function walkableGrid(sector) {
  const columns = Math.floor((PLAYER.maxX - PLAYER.minX) / STEP) + 1;
  const rows = Math.floor((PLAYER.maxY - PLAYER.minY) / STEP) + 1;
  const open = new Set();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (isWalkable(sector, gridPoint(column, row))) open.add(`${column}:${row}`);
    }
  }
  return { columns, rows, open };
}

function nearestOpenCell(grid, point) {
  let best = null;
  for (const key of grid.open) {
    const [column, row] = key.split(':').map(Number);
    const candidate = gridPoint(column, row);
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (!best || distance < best.distance) best = { key, distance };
  }
  return best;
}

function reachableCells(grid, origin) {
  const start = nearestOpenCell(grid, origin);
  assert.ok(start && start.distance <= STEP * 1.5, `origine non marchable (${origin.x}, ${origin.y})`);
  const reached = new Set([start.key]);
  const queue = [start.key];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length) {
    const key = queue.shift();
    const [column, row] = key.split(':').map(Number);
    for (const [dx, dy] of directions) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= grid.columns || nextRow >= grid.rows) continue;
      const nextKey = `${nextColumn}:${nextRow}`;
      if (!grid.open.has(nextKey) || reached.has(nextKey)) continue;
      reached.add(nextKey);
      queue.push(nextKey);
    }
  }
  return reached;
}

function canInteract(reached, target) {
  for (const key of reached) {
    const [column, row] = key.split(':').map(Number);
    const point = gridPoint(column, row);
    if (Math.hypot(point.x - target.x, point.y - target.y) <= target.range + STEP) return true;
  }
  return false;
}

function interactionTargets(region, sector) {
  const targets = [];
  for (const transition of getSectorTransitions(region.id, sector.id)) {
    const connection = region.connections.find(({ id }) => id === transition.connectionId);
    const activation = connection?.unlock?.activation;
    if (!transition.available && activation?.sectorId === sector.id) {
      targets.push({ id: `${transition.connectionId}:activation`, ...activation, range: 52 });
    } else {
      targets.push({ id: transition.connectionId, ...transition.from, range: transition.kind === 'shortcut' ? 52 : 58 });
    }
  }
  targets.push(...sector.residentSpawns.map((entry) => ({ id: `resident:${entry.residentId}`, ...entry, range: 62 })));
  targets.push(...sector.events.map((entry) => ({ id: `event:${entry.id}`, ...entry.trigger, range: entry.trigger.radius })));
  for (const patrol of sector.patrols) {
    patrol.path.forEach((from, index) => {
      const to = patrol.path[(index + 1) % patrol.path.length];
      for (let sample = 0; sample < 8; sample += 1) {
        const amount = sample / 8;
        targets.push({
          id: `patrol:${patrol.id}:${index}:${sample}`,
          x: from.x + (to.x - from.x) * amount,
          y: from.y + (to.y - from.y) * amount,
          range: 52,
        });
      }
    });
  }
  if (sector.sanctuary) targets.push({ id: `sanctuary:${sector.sanctuary.id}`, ...sector.sanctuary, range: sector.sanctuary.radius });
  if (sector.guardian) targets.push({ id: `guardian:${sector.guardian.id}`, ...sector.guardian, range: 72 });
  if (sector.shard) targets.push({ id: `shard:${sector.shard.id}`, ...sector.shard, range: 48 });
  if (sector.role === 'entry') targets.push({ id: 'city-return', x: 480, y: 518, range: 38 });
  return targets;
}

test('chaque arrivée, sortie et interaction de secteur est réellement accessible à pied', () => {
  const issues = [];
  for (const region of Object.values(WORLD_LAYOUTS)) {
    for (const sector of region.sectors) {
      const grid = walkableGrid(sector);
      const reached = reachableCells(grid, sector.spawn);

      const arrivals = region.connections.flatMap((connection) => {
        if (connection.from.sectorId === sector.id) return [nudgeFromEdge(connection.from)];
        if (connection.bidirectional && connection.to.sectorId === sector.id) return [nudgeFromEdge(connection.to)];
        return [];
      });
      for (const arrival of arrivals) {
        if (!isWalkable(sector, arrival)) issues.push(`${sector.id}: arrivée bloquée à (${arrival.x}, ${arrival.y})`);
        else if (!canInteract(reached, { ...arrival, range: STEP })) issues.push(`${sector.id}: arrivée isolée à (${arrival.x}, ${arrival.y})`);
      }

      for (const target of interactionTargets(region, sector)) {
        if (!canInteract(reached, target)) issues.push(`${sector.id}: interaction inaccessible ${target.id}`);
      }
    }
  }
  assert.deepEqual(issues, []);
});

test('le moteur relie les alias historiques aux secteurs et persiste la progression d’expédition', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(source, /WORLD_LAYOUTS[\s\S]*getSectorTransitions[\s\S]*from '\.\/world-layouts\.js'/);
  assert.match(source, /const resolveMapId = \(mapId\) => WORLD_LAYOUTS\[mapId\]\?\.entrySectorId \|\| mapId/);
  assert.match(source, /delete MAPS\[region\.id\]/);
  assert.match(source, /const resolvedMap = resolveMapId\(boundedString\(parsed\.map, 'city', 128\)\)/);
  assert.match(source, /const legacyRegionMap = REGION_IDS\.includes\(parsed\?\.map\)/);
  assert.match(source, /const invalidPosition = legacyRegionMap[\s\S]*circleRectCollision\(safeX, safeY, 13, rect\)/);
  assert.match(source, /if \(merged\.flags\[`shard_\${regionId}`\]\) merged\.flags\[`guardian_\${regionId}_defeated`\] = true/);
  assert.match(source, /sectorVisits: sanitizeNumberRecord\(parsed\.sectorVisits, \{ allowedKeys: SAVE_MAP_IDS/);
  assert.match(source, /sanctuaryVisits: sanitizeNumberRecord\(parsed\.sanctuaryVisits, \{ allowedKeys: WORLD_SAVE_METADATA\.sanctuaryIds/);
  assert.match(source, /expeditionChoices: sanitizeChoiceRecord\(parsed\.expeditionChoices, WORLD_SAVE_METADATA\.choiceIds\)/);
  assert.match(source, /this\.state\.flags\[flag\] = true/);
  assert.match(source, /this\.state\.flags\[enemy\.guardianFlag\] = true/);
  assert.match(source, /this\.state\.flags\[shardFlag\] = true/);
  assert.match(source, /getTransitionStatus\(transition, regionId\)[\s\S]*currentWins >= requiredWins/);
  assert.ok((source.match(/getTransitionStatus\(transition, map\.region\)/g) || []).length >= 2);
});

test('les douze recrutables historiques sont tous distribués dans les expéditions', () => {
  const expected = [
    'bellgrave', 'brakk', 'coiljack', 'khepri', 'masks', 'mnemo',
    'mycella', 'nacre', 'pylon', 'rook', 'skarn', 'vespera',
  ];
  const actual = Object.values(WORLD_LAYOUTS)
    .flatMap(({ sectors }) => sectors)
    .flatMap(({ residentSpawns }) => residentSpawns)
    .map(({ residentId }) => residentId)
    .sort();
  assert.deepEqual(actual, expected);
  assert.deepEqual(Object.keys(WORLD_LAYOUTS), [...REGION_IDS]);
});
