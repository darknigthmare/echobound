import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGION_IDS,
  WORLD_LAYOUTS,
  WORLD_LAYOUT_SCHEMA_VERSION,
  getSectorTransitions,
  getWorldLayout,
  getWorldSector,
  isConnectionUnlocked,
  validateWorldLayouts,
} from '../src/world-layouts.js';

const mutableLayouts = () => JSON.parse(JSON.stringify(WORLD_LAYOUTS));

test('les quatre régions forment des expéditions longues et valides', () => {
  const validation = validateWorldLayouts();

  assert.equal(WORLD_LAYOUT_SCHEMA_VERSION, 1);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.deepEqual(Object.keys(WORLD_LAYOUTS), REGION_IDS);
  assert.deepEqual(validation.totals, {
    regions: 4,
    sectors: 20,
    patrols: 32,
    events: 4,
    shortcuts: 4,
    residents: 12,
  });

  for (const region of Object.values(WORLD_LAYOUTS)) {
    assert.equal(region.sectors.length, 5);
    assert.ok(region.pacing.targetMinutes >= 20);
    assert.equal(region.mainPath.length, 5);
    assert.equal(new Set(region.mainPath).size, 5);
    assert.ok(region.sectors.every(({ bounds }) => bounds.width === 960 && bounds.height === 540));
  }
});

test('chaque parcours place un sanctuaire et son gardien juste avant l’Éclat', () => {
  for (const region of Object.values(WORLD_LAYOUTS)) {
    const guardianIndex = region.mainPath.indexOf(region.guardianSectorId);
    const shardIndex = region.mainPath.indexOf(region.shardSectorId);
    const guardianSector = getWorldSector(region.id, region.guardianSectorId);
    const shardSector = getWorldSector(region.id, region.shardSectorId);

    assert.equal(shardIndex, guardianIndex + 1);
    assert.equal(shardIndex, region.mainPath.length - 1);
    assert.equal(guardianSector.role, 'guardian-sanctuary');
    assert.ok(guardianSector.sanctuary);
    assert.ok(guardianSector.guardian);
    assert.equal(shardSector.role, 'shard-sanctum');
    assert.equal(shardSector.shard.requiresFlag, guardianSector.guardian.defeatFlag);
  }
});

test('la chambre de l’Éclat reste inaccessible tant que le gardien vit', () => {
  for (const region of Object.values(WORLD_LAYOUTS)) {
    const guardianSector = getWorldSector(region.id, region.guardianSectorId);
    const transitionsBefore = getSectorTransitions(region.id, region.guardianSectorId);
    const shardDoorBefore = transitionsBefore.find(({ to }) => to.sectorId === region.shardSectorId);

    assert.ok(shardDoorBefore);
    assert.equal(shardDoorBefore.available, false);
    assert.equal(shardDoorBefore.unlockFlag, guardianSector.guardian.defeatFlag);

    const progress = { flags: { [guardianSector.guardian.defeatFlag]: true } };
    const shardDoorAfter = getSectorTransitions(region.id, region.guardianSectorId, progress)
      .find(({ to }) => to.sectorId === region.shardSectorId);
    assert.equal(shardDoorAfter.available, true);
  }
});

test('deux paliers atteignables imposent un engagement avant le gardien', () => {
  for (const region of Object.values(WORLD_LAYOUTS)) {
    const gates = region.connections.filter(({ requiresRegionalWins }) => requiresRegionalWins !== undefined);
    const guardianIndex = region.mainPath.indexOf(region.guardianSectorId);
    assert.deepEqual(gates.map(({ requiresRegionalWins }) => requiresRegionalWins).sort((a, b) => a - b), [2, 5]);
    assert.ok(gates.every(({ kind }) => kind === 'route'));
    assert.ok(region.connections.filter(({ kind }) => kind === 'shortcut').every(({ requiresRegionalWins }) => requiresRegionalWins === undefined));

    const firstGate = gates.find(({ requiresRegionalWins }) => requiresRegionalWins === 2);
    assert.deepEqual(
      new Set([firstGate.from.sectorId, firstGate.to.sectorId]),
      new Set(region.mainPath.slice(0, 2)),
    );

    const guardianGate = gates.find(({ requiresRegionalWins }) => requiresRegionalWins === 5);
    assert.deepEqual(
      new Set([guardianGate.from.sectorId, guardianGate.to.sectorId]),
      new Set(region.mainPath.slice(guardianIndex - 1, guardianIndex + 1)),
    );

    for (const gate of gates) {
      const fromIndex = Math.min(
        region.mainPath.indexOf(gate.from.sectorId),
        region.mainPath.indexOf(gate.to.sectorId),
      );
      const patrolsAvailable = region.mainPath
        .slice(0, fromIndex + 1)
        .flatMap((sectorId) => getWorldSector(region.id, sectorId).patrols);
      assert.ok(patrolsAvailable.length >= gate.requiresRegionalWins);
      const oriented = getSectorTransitions(region.id, gate.from.sectorId)
        .find(({ connectionId }) => connectionId === gate.id);
      assert.equal(oriented.requiresRegionalWins, gate.requiresRegionalWins);
      const reverse = getSectorTransitions(region.id, gate.to.sectorId)
        .find(({ connectionId }) => connectionId === gate.id);
      assert.equal(reverse.requiresRegionalWins, 0, 'le retour ne doit jamais réclamer de nouvelles victoires');
    }
  }
});

test('les raccourcis sont persistants, bidirectionnels et ne sautent pas le gardien', () => {
  for (const region of Object.values(WORLD_LAYOUTS)) {
    const shortcuts = region.connections.filter(({ kind }) => kind === 'shortcut');
    assert.ok(shortcuts.length >= 1);

    for (const shortcut of shortcuts) {
      assert.equal(shortcut.bidirectional, true);
      assert.ok(shortcut.unlock.activation);
      assert.equal(isConnectionUnlocked(shortcut, {}), false);
      assert.equal(isConnectionUnlocked(shortcut, new Set([shortcut.unlock.flag])), true);
      assert.notEqual(shortcut.to.sectorId, region.shardSectorId);
      assert.notEqual(shortcut.from.sectorId, region.shardSectorId);
    }
  }
});

test('les habitants, événements et patrouilles sont répartis entre les secteurs', () => {
  const residents = [];
  const eventIds = [];
  const patrolIds = [];

  for (const region of Object.values(WORLD_LAYOUTS)) {
    const regionEvents = region.sectors.flatMap(({ events }) => events);
    assert.ok(regionEvents.length >= 1);
    assert.ok(region.sectors.every(({ patrols, obstacles }) => patrols.length >= 1 && obstacles.length >= 3));

    for (const sector of region.sectors) {
      residents.push(...sector.residentSpawns.map(({ residentId }) => residentId));
      eventIds.push(...sector.events.map(({ id }) => id));
      patrolIds.push(...sector.patrols.map(({ id }) => id));
    }
  }

  assert.deepEqual(new Set(residents), new Set([
    'brakk', 'mnemo', 'pylon',
    'mycella', 'vespera', 'skarn',
    'bellgrave', 'masks', 'nacre',
    'coiljack', 'rook', 'khepri',
  ]));
  assert.equal(new Set(eventIds).size, eventIds.length);
  assert.equal(new Set(patrolIds).size, patrolIds.length);
});

test('l’API refuse explicitement les régions et secteurs inconnus', () => {
  assert.equal(getWorldLayout('fog'), WORLD_LAYOUTS.fog);
  assert.equal(getWorldSector('fog', 'fog_drowned_nave').name, 'NEF NOYÉE');
  assert.throws(() => getWorldLayout('void'), /Région inconnue/);
  assert.throws(() => getWorldSector('fog', 'fog_absent'), /Secteur inconnu/);
});

test('les données publiées sont profondément immuables', () => {
  assert.equal(Object.isFrozen(WORLD_LAYOUTS), true);
  assert.equal(Object.isFrozen(WORLD_LAYOUTS.wastes), true);
  assert.equal(Object.isFrozen(WORLD_LAYOUTS.wastes.sectors), true);
  assert.equal(Object.isFrozen(WORLD_LAYOUTS.wastes.sectors[0].patrols[0].path), true);
  assert.throws(() => {
    WORLD_LAYOUTS.wastes.sectors.push({});
  }, TypeError);
});

test('le validateur détecte les parcours courts, doublons et portes contournables', () => {
  const tooShort = mutableLayouts();
  tooShort.wastes.sectors = tooShort.wastes.sectors.slice(0, 2);
  assert.equal(validateWorldLayouts(tooShort).valid, false);
  assert.match(validateWorldLayouts(tooShort).errors.join('\n'), /entre 3 et 5 secteurs/);

  const duplicatePatrol = mutableLayouts();
  duplicatePatrol.hive.sectors[1].patrols[0].id = duplicatePatrol.hive.sectors[0].patrols[0].id;
  const duplicateResult = validateWorldLayouts(duplicatePatrol);
  assert.equal(duplicateResult.valid, false);
  assert.match(duplicateResult.errors.join('\n'), /identifiant dupliqué/);

  const bypass = mutableLayouts();
  const guardianGate = bypass.fog.connections.find(({ to }) => to.sectorId === bypass.fog.shardSectorId);
  delete guardianGate.unlock;
  const bypassResult = validateWorldLayouts(bypass);
  assert.equal(bypassResult.valid, false);
  assert.match(bypassResult.errors.join('\n'), /Éclat est accessible avant|verrouillée par le gardien/);

  const malformedGate = mutableLayouts();
  malformedGate.wastes.connections.find(({ requiresRegionalWins }) => requiresRegionalWins === 2).requiresRegionalWins = 1;
  const malformedGateResult = validateWorldLayouts(malformedGate);
  assert.equal(malformedGateResult.valid, false);
  assert.match(malformedGateResult.errors.join('\n'), /doit exiger 2 victoires régionales/);

  const impossibleGate = mutableLayouts();
  impossibleGate.hive.sectors[0].patrols = impossibleGate.hive.sectors[0].patrols.slice(0, 1);
  const impossibleGateResult = validateWorldLayouts(impossibleGate);
  assert.equal(impossibleGateResult.valid, false);
  assert.match(impossibleGateResult.errors.join('\n'), /palier impossible/);

  const blockedShortcut = mutableLayouts();
  blockedShortcut.fog.connections.find(({ kind }) => kind === 'shortcut').requiresRegionalWins = 2;
  const blockedShortcutResult = validateWorldLayouts(blockedShortcut);
  assert.equal(blockedShortcutResult.valid, false);
  assert.match(blockedShortcutResult.errors.join('\n'), /raccourci ne doit pas ajouter/);
});
