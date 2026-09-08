import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpeditionAtlas, EXPEDITION_ATLAS_SCHEMA_VERSION } from '../src/expedition-atlas.js';
import { REGION_IDS, getWorldLayout, getSectorTransitions } from '../src/world-layouts.js';

const layout = getWorldLayout('wastes');
const sector = (index) => layout.sectors.find(({ id }) => id === layout.mainPath[index]);
const patrolsThrough = (index) => layout.mainPath.slice(0, index + 1)
  .flatMap((id) => layout.sectors.find((item) => item.id === id).patrols.map((patrol) => patrol.id));
const stateAt = (index, overrides = {}) => ({
  map: layout.mainPath[index], discoveredSectors: ['city', ...layout.mainPath.slice(0, index + 1)],
  patrolVictories: [], flags: {}, ...overrides,
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const assertFrozen = (value) => {
  if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(assertFrozen);
  }
};

test('un départ neuf conserve les vingt étapes sans dévoiler noms ni rencontres', () => {
  let total = 0;
  for (const regionId of REGION_IDS) {
    const atlas = buildExpeditionAtlas(regionId, { map: 'city' });
    const region = getWorldLayout(regionId);
    total += atlas.sectors.length;
    assert.equal(atlas.schemaVersion, EXPEDITION_ATLAS_SCHEMA_VERSION);
    assert.equal(atlas.currentSector, null);
    assert.deepEqual(atlas.progress, {
      discovered: 0, total: 5, patrolVictories: 0, patrolTotal: 8,
      guardianDefeated: null, shardCollected: null,
    });
    assert.equal(atlas.nextObjective.kind, 'depart');
    assert.equal(atlas.nextObjective.sectorId, region.entrySectorId);
    assert.deepEqual(atlas.sectors.map(({ id }) => id), region.mainPath);
    for (const [index, step] of atlas.sectors.entries()) {
      assert.equal(step.index, index + 1);
      assert.equal(step.title, 'Secteur inexploré');
      assert.equal(step.patrols, null);
      assert.equal(step.guardian, null);
      assert.equal(step.shard, null);
      assert.equal(step.sanctuary, null);
      assert.deepEqual(step.routes, []);
      assert.equal(JSON.stringify(atlas).includes(region.sectors[index].name), false);
      for (const patrol of region.sectors[index].patrols) assert.equal(JSON.stringify(atlas).includes(patrol.name), false);
    }
  }
  assert.equal(total, 20);
});

test('le secteur présent devient connu et oriente vers deux patrouilles distinctes', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(0, { discoveredSectors: ['city'] }));
  assert.equal(atlas.progress.discovered, 1);
  assert.deepEqual(atlas.currentSector, { id: sector(0).id, index: 1, title: sector(0).name });
  assert.equal(atlas.sectors[0].current, true);
  assert.deepEqual(atlas.sectors[0].patrols, { cleared: 0, total: 2 });
  const route = atlas.sectors[0].routes.find(({ kind }) => kind === 'route');
  assert.equal(route.available, false);
  assert.equal(route.requiredPatrols, 2);
  assert.equal(route.remainingPatrols, 2);
  assert.equal(route.destinationTitle, 'Secteur inexploré');
  assert.equal(route.direction, 'nord');
  assert.equal(atlas.nextObjective.kind, 'patrols');
  assert.equal(atlas.nextObjective.remainingPatrols, 2);
  assert.equal(atlas.nextObjective.sectorId, sector(0).id);
  assert.equal(atlas.nextObjective.transitionId, null);
});

test('doublons, victoires étrangères et anciens totaux ne contournent aucun sceau', () => {
  const first = sector(0).patrols[0].id;
  const atlas = buildExpeditionAtlas('wastes', stateAt(0, {
    patrolVictories: [first, first, first, 'unknown', getWorldLayout('hive').sectors[0].patrols[0].id],
    regionWins: { wastes: 999 }, wins: 999,
  }));
  assert.equal(atlas.progress.patrolVictories, 1);
  assert.equal(atlas.sectors[0].patrols.cleared, 1);
  assert.equal(atlas.nextObjective.remainingPatrols, 1);
  assert.equal(atlas.sectors[0].routes.find(({ kind }) => kind === 'route').available, false);
});

test('la deuxième victoire ouvre le chemin sans révéler la prochaine étape', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(0, { patrolVictories: patrolsThrough(0) }));
  const route = atlas.sectors[0].routes.find(({ kind }) => kind === 'route');
  assert.equal(route.available, true);
  assert.equal(route.reason, null);
  assert.equal(atlas.nextObjective.kind, 'explore');
  assert.equal(atlas.nextObjective.transitionId, route.connectionId);
  assert.match(atlas.nextObjective.text, /nord.*secteur inexploré/);
  assert.equal(JSON.stringify(atlas).includes(sector(1).name), false);
});

test('le sceau de mi-parcours demande cinq victoires même après quatre secteurs visités', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(2, {
    discoveredSectors: [...layout.mainPath.slice(0, 4)], patrolVictories: patrolsThrough(1),
  }));
  const forward = atlas.sectors[2].routes.find(({ destinationId }) => destinationId === sector(3).id);
  assert.equal(forward.available, false);
  assert.equal(forward.requiredPatrols, 5);
  assert.equal(forward.remainingPatrols, 1);
  assert.equal(atlas.nextObjective.kind, 'patrols');
  assert.equal(atlas.nextObjective.remainingPatrols, 1);
  assert.equal(atlas.nextObjective.sectorId, sector(2).id);
});

test('le carnet indique le retour vers une patrouille invaincue réellement accessible', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(2, {
    patrolVictories: [...sector(0).patrols, ...sector(2).patrols].map(({ id }) => id),
  }));
  const back = atlas.sectors[2].routes.find(({ destinationId }) => destinationId === sector(1).id);
  assert.equal(atlas.nextObjective.kind, 'patrols');
  assert.equal(atlas.nextObjective.sectorId, sector(1).id);
  assert.equal(atlas.nextObjective.transitionId, back.connectionId);
  assert.match(atlas.nextObjective.text, /ouest/);
  assert.match(atlas.nextObjective.text, /CICATRICES DE LA CARAVANE/);
});

test('après un retour chercher une patrouille, le carnet ne renvoie pas au sceau fermé', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(1, {
    discoveredSectors: layout.mainPath.slice(0, 3),
    patrolVictories: [...sector(0).patrols, ...sector(2).patrols].map(({ id }) => id),
  }));
  assert.equal(atlas.nextObjective.kind, 'patrols');
  assert.equal(atlas.nextObjective.sectorId, sector(1).id);
  assert.equal(atlas.nextObjective.transitionId, null);
  assert.equal(atlas.nextObjective.remainingPatrols, 1);
});

test('les retours ne réappliquent pas les sceaux régionaux de deux et cinq victoires', () => {
  const atlas = buildExpeditionAtlas('wastes', stateAt(3));
  const returnAfterFive = atlas.sectors[3].routes.find(({ destinationId }) => destinationId === sector(2).id);
  const returnAfterTwo = atlas.sectors[1].routes.find(({ destinationId }) => destinationId === sector(0).id);
  for (const route of [returnAfterFive, returnAfterTwo]) {
    assert.equal(route.available, true);
    assert.equal(route.requiredPatrols, 0);
    assert.equal(route.remainingPatrols, 0);
  }
});

test('gardien, sanctuaire et raccourci sont visibles uniquement à leur découverte', () => {
  const before = buildExpeditionAtlas('wastes', stateAt(2, { patrolVictories: patrolsThrough(2) }));
  assert.equal(before.sectors[3].guardian, null);
  assert.equal(before.sectors[3].sanctuary, null);
  assert.deepEqual(before.sectors[3].routes, []);
  assert.equal(JSON.stringify(before).includes(sector(3).guardian.name), false);
  const atlas = buildExpeditionAtlas('wastes', stateAt(3, { patrolVictories: patrolsThrough(2) }));
  assert.deepEqual(atlas.sectors[3].guardian, { name: sector(3).guardian.name, defeated: false });
  assert.deepEqual(atlas.sectors[3].sanctuary, { name: sector(3).sanctuary.name });
  assert.equal(atlas.nextObjective.kind, 'guardian');
  assert.match(atlas.nextObjective.text, /Colosse du Seuil/);
  assert.equal(atlas.progress.guardianDefeated, false);
  assert.equal(atlas.progress.shardCollected, null);
  const shortcut = atlas.sectors[3].routes.find(({ kind }) => kind === 'shortcut');
  assert.equal(shortcut.available, false);
  assert.match(shortcut.reason, /proximité/);
  const shardRoute = atlas.sectors[3].routes.find(({ destinationId }) => destinationId === sector(4).id);
  assert.equal(shardRoute.available, false);
  assert.equal(shardRoute.destinationTitle, 'Secteur inexploré');
});

test('vaincre le gardien ouvre la cinquième étape puis l’objectif de collecte', () => {
  const flags = { [sector(3).guardian.defeatFlag]: true };
  const before = buildExpeditionAtlas('wastes', stateAt(3, { flags, patrolVictories: patrolsThrough(2) }));
  assert.equal(before.nextObjective.kind, 'explore');
  assert.equal(before.progress.guardianDefeated, true);
  assert.equal(before.sectors[3].routes.find(({ destinationId }) => destinationId === sector(4).id).available, true);
  const atlas = buildExpeditionAtlas('wastes', stateAt(4, { flags, patrolVictories: patrolsThrough(2) }));
  assert.equal(atlas.nextObjective.kind, 'shard');
  assert.equal(atlas.progress.shardCollected, false);
  assert.deepEqual(atlas.sectors[4].shard, { name: sector(4).shard.name, collected: false });
  assert.match(atlas.nextObjective.text, /Éclat des Friches/);
});

test('après collecte le retour suggère d’ouvrir puis d’emprunter le raccourci', () => {
  const flags = { [sector(3).guardian.defeatFlag]: true, [sector(4).shard.collectFlag]: true };
  const shared = { flags, discoveredSectors: layout.mainPath, patrolVictories: patrolsThrough(4) };
  const atShard = buildExpeditionAtlas('wastes', stateAt(4, shared));
  assert.equal(atShard.nextObjective.kind, 'return');
  assert.match(atShard.nextObjective.text, /sud/);
  const atGuardian = buildExpeditionAtlas('wastes', stateAt(3, shared));
  assert.equal(atGuardian.nextObjective.kind, 'shortcut');
  const link = layout.connections.find(({ kind }) => kind === 'shortcut');
  assert.equal(atGuardian.nextObjective.transitionId, link.id);
  const opened = buildExpeditionAtlas('wastes', stateAt(3, {
    ...shared, flags: { ...flags, [link.unlock.flag]: true },
  }));
  assert.equal(opened.nextObjective.kind, 'return');
  assert.equal(opened.nextObjective.transitionId, link.id);
  assert.equal(opened.sectors[3].routes.find(({ kind }) => kind === 'shortcut').available, true);
  const atEntry = buildExpeditionAtlas('wastes', stateAt(0, shared));
  assert.match(atEntry.nextObjective.text, /Cité des Échos.*sud/);
  const completed = buildExpeditionAtlas('wastes', { ...shared, map: 'city' });
  assert.equal(completed.nextObjective.kind, 'complete');
  assert.deepEqual(completed.progress, {
    discovered: 5, total: 5, patrolVictories: 8, patrolTotal: 8, guardianDefeated: true, shardCollected: true,
  });
});

test('le Nouveau Cycle efface les connaissances et les sceaux sans utiliser les totaux hérités', () => {
  const atlas = buildExpeditionAtlas('wastes', {
    map: 'city', cycle: 3, recruited: ['brakk', 'mnemo', 'pylon'],
    discoveredSectors: ['city'], patrolVictories: [], flags: {}, regionWins: { wastes: 200 },
  });
  assert.equal(atlas.progress.discovered, 0);
  assert.equal(atlas.progress.patrolVictories, 0);
  assert.equal(atlas.nextObjective.kind, 'depart');
  assert.ok(atlas.sectors.every((step) => !step.discovered && step.patrols === null));
});

test('entrées inconnues, alias historique et propriétés héritées ne fabriquent aucun progrès', () => {
  for (const id of ['city', 'unknown', 'constructor', '__proto__', null, {}]) {
    assert.throws(() => buildExpeditionAtlas(id, {}), RangeError);
  }
  assert.equal(buildExpeditionAtlas('wastes', null).progress.discovered, 0);
  assert.equal(buildExpeditionAtlas('wastes', { map: 'unknown', discoveredSectors: [null, 'constructor', 'unknown'] }).currentSector, null);
  const legacy = buildExpeditionAtlas('wastes', { map: 'wastes', discoveredSectors: 'not-an-array', patrolVictories: 'not-an-array' });
  assert.equal(legacy.currentSector.id, layout.entrySectorId);
  assert.equal(legacy.progress.discovered, 1);
  const inheritedFlags = Object.create({ [sector(3).guardian.defeatFlag]: true });
  const guarded = buildExpeditionAtlas('wastes', stateAt(3, { flags: inheritedFlags }));
  assert.equal(guarded.progress.guardianDefeated, false);
  assert.equal(guarded.sectors[3].routes.find(({ destinationId }) => destinationId === sector(4).id).available, false);
});

test('les quatre expéditions orientent les sceaux, le gardien et le retour sur leurs vraies routes', () => {
  for (const regionId of REGION_IDS) {
    const region = getWorldLayout(regionId);
    const patrolIds = region.sectors.flatMap((step) => step.patrols.map(({ id }) => id));
    const guardianSector = region.sectors.find(({ id }) => id === region.guardianSectorId);
    const shardSector = region.sectors.find(({ id }) => id === region.shardSectorId);
    const progress = { map: region.entrySectorId, discoveredSectors: [region.entrySectorId], patrolVictories: patrolIds.slice(0, 2), flags: {} };
    let atlas = buildExpeditionAtlas(regionId, progress);
    assert.equal(atlas.nextObjective.kind, 'explore', regionId);
    assert.equal(atlas.nextObjective.transitionId, region.connections.find((link) => link.requiresRegionalWins === 2).id);
    progress.map = region.mainPath[2];
    progress.discoveredSectors = region.mainPath.slice(0, 3);
    progress.patrolVictories = patrolIds.slice(0, 4);
    atlas = buildExpeditionAtlas(regionId, progress);
    assert.equal(atlas.nextObjective.kind, 'patrols', regionId);
    assert.equal(atlas.nextObjective.remainingPatrols, 1);
    progress.patrolVictories = patrolIds.slice(0, 5);
    atlas = buildExpeditionAtlas(regionId, progress);
    assert.equal(atlas.nextObjective.kind, 'explore', regionId);
    assert.equal(atlas.nextObjective.transitionId, region.connections.find((link) => link.requiresRegionalWins === 5).id);
    progress.map = guardianSector.id;
    progress.discoveredSectors = region.mainPath.slice(0, 4);
    assert.equal(buildExpeditionAtlas(regionId, progress).nextObjective.kind, 'guardian', regionId);
    progress.flags[guardianSector.guardian.defeatFlag] = true;
    assert.equal(buildExpeditionAtlas(regionId, progress).nextObjective.kind, 'explore', regionId);
    progress.map = shardSector.id;
    progress.discoveredSectors = [...region.mainPath];
    assert.equal(buildExpeditionAtlas(regionId, progress).nextObjective.kind, 'shard', regionId);
    progress.flags[shardSector.shard.collectFlag] = true;
    atlas = buildExpeditionAtlas(regionId, progress);
    assert.equal(atlas.nextObjective.kind, 'return', regionId);
    assert.ok(atlas.sectors[4].routes.some((route) => route.available && route.connectionId === atlas.nextObjective.transitionId));
  }
});

test('BFS : chaque état d’exploration atteignable possède un guidage sans verrou ni boucle', (context) => {
  const countBits = (mask) => mask.toString(2).replaceAll('0', '').length;
  let totalStates = 0;
  for (const regionId of REGION_IDS) {
    const region = getWorldLayout(regionId);
    const steps = region.mainPath.map((id) => region.sectors.find((item) => item.id === id));
    const patrolIds = steps.flatMap((item) => item.patrols.map(({ id }) => id));
    const guardian = steps.find((item) => item.guardian).guardian;
    const shard = steps.find((item) => item.shard).shard;
    const shortcut = region.connections.find(({ kind }) => kind === 'shortcut');
    const key = (node) => [node.at, node.known, node.wins, node.flags].join(':');
    const saveOf = (node) => ({
      map: steps[node.at].id,
      discoveredSectors: steps.filter((_, index) => node.known & (1 << index)).map(({ id }) => id),
      patrolVictories: patrolIds.filter((_, index) => node.wins & (1 << index)),
      flags: {
        [guardian.defeatFlag]: Boolean(node.flags & 1),
        [shard.collectFlag]: Boolean(node.flags & 2),
        [shortcut.unlock.flag]: Boolean(node.flags & 4),
      },
    });
    const exitsOf = (node) => getSectorTransitions(regionId, steps[node.at].id, saveOf(node))
      .filter((route) => route.available && countBits(node.wins) >= route.requiresRegionalWins);
    const move = (node, route) => {
      const at = region.mainPath.indexOf(route.to.sectorId);
      return { ...node, at, known: node.known | (1 << at) };
    };
    const unbeaten = (node) => steps[node.at].patrols.map(({ id }) => patrolIds.indexOf(id))
      .filter((index) => !(node.wins & (1 << index)));
    const initial = { at: 0, known: 1, wins: 0, flags: 0 };
    const queue = [initial];
    const reachable = new Map([[key(initial), initial]]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      const successors = exitsOf(node).map((route) => move(node, route));
      for (const index of unbeaten(node)) successors.push({ ...node, wins: node.wins | (1 << index) });
      if (steps[node.at].guardian && !(node.flags & 1)) successors.push({ ...node, flags: node.flags | 1 });
      if (steps[node.at].shard && (node.flags & 1) && !(node.flags & 2)) successors.push({ ...node, flags: node.flags | 2 });
      if (shortcut.unlock.activation.sectorId === steps[node.at].id && !(node.flags & 4)) successors.push({ ...node, flags: node.flags | 4 });
      for (const next of successors) if (!reachable.has(key(next))) {
        reachable.set(key(next), next);
        queue.push(next);
      }
      assert.ok(queue.length < 10000, 'BFS must stay bounded');
    }
    assert.ok(queue.length > 200, `too few exploration combinations for ${regionId}`);
    totalStates += queue.length;
    const guidance = new Map();
    for (const node of queue) {
      const atlas = buildExpeditionAtlas(regionId, saveOf(node));
      const goal = atlas.nextObjective;
      const message = `${regionId} ${key(node)} : ${goal.kind} ${goal.text}`;
      let next;
      if (goal.transitionId) {
        if (goal.kind === 'shortcut') {
          assert.equal(goal.transitionId, shortcut.id, message);
          assert.equal(steps[node.at].id, shortcut.unlock.activation.sectorId, message);
          assert.equal(node.flags & 4, 0, message);
          next = { ...node, flags: node.flags | 4 };
        } else {
          const exit = exitsOf(node).find((route) => route.connectionId === goal.transitionId);
          assert.ok(exit, `closed or nonexistent suggested exit: ${message}`);
          next = move(node, exit);
        }
      } else if (goal.kind === 'patrols') {
        const index = unbeaten(node)[0];
        assert.notEqual(index, undefined, `no local unbeaten patrol: ${message}`);
        next = { ...node, wins: node.wins | (1 << index) };
      } else if (goal.kind === 'guardian') {
        assert.ok(steps[node.at].guardian && !(node.flags & 1), message);
        next = { ...node, flags: node.flags | 1 };
      } else if (goal.kind === 'shard') {
        assert.ok(steps[node.at].shard && (node.flags & 1) && !(node.flags & 2), message);
        next = { ...node, flags: node.flags | 2 };
      } else {
        assert.ok(goal.kind === 'return' && node.at === 0 && (node.flags & 2), `no actionable guidance: ${message}`);
        next = null;
      }
      assert.ok(next === null || reachable.has(key(next)), message);
      guidance.set(key(node), next === null ? null : key(next));
    }
    const finishes = new Set();
    for (const start of guidance.keys()) {
      let next = start;
      const path = new Set();
      while (next !== null && !finishes.has(next)) {
        assert.ok(!path.has(next), `guidance loop in ${regionId}: ${[...path, next].join(' -> ')}`);
        path.add(next);
        next = guidance.get(next);
      }
      for (const id of path) finishes.add(id);
    }
    assert.equal(finishes.size, queue.length);
  }
  context.diagnostic(`${totalStates} reachable route/progress states verified across four regions.`);
});

test('résultat déterministe et profondément immuable, sans modifier la sauvegarde', () => {
  const input = freeze(stateAt(3, { patrolVictories: patrolsThrough(2) }));
  const before = JSON.stringify(input);
  const atlas = buildExpeditionAtlas('wastes', input);
  assert.deepEqual(atlas, buildExpeditionAtlas('wastes', input));
  assert.equal(JSON.stringify(input), before);
  assertFrozen(atlas);
  assert.throws(() => { atlas.sectors[0].patrols.cleared = 999; }, TypeError);
  assert.throws(() => { atlas.sectors[0].routes.push({}); }, TypeError);
  assert.equal(sector(0).name, 'CHUTE DU PORTAIL');
});
