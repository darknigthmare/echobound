import { REGION_IDS, getWorldLayout, getSectorTransitions } from './world-layouts.js';

export const EXPEDITION_ATLAS_SCHEMA_VERSION = 1;
const UNKNOWN_SECTOR_TITLE = 'Secteur inexploré';

const freezeTree = (value) => {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
};

const ownTrue = (record, key) => Boolean(record && typeof record === 'object'
  && Object.hasOwn(record, key) && record[key] === true);

const directionOf = ({ x, y, facing }) => {
  if (y < 80) return 'nord';
  if (y > 460) return 'sud';
  if (x < 110) return 'ouest';
  if (x > 850) return 'est';
  return { up: 'nord', down: 'sud', left: 'ouest', right: 'est' }[facing] || 'indiquée';
};

/**
 * Pure, read-only route journal, schema 1. Unknown regions throw RangeError.
 * `state` uses the runtime save fields map, discoveredSectors, patrolVictories
 * and flags. A current sector counts as discovered, even in a legacy save.
 * Only unique patrol IDs in this region count; kills and regionWins do not.
 *
 * Returns { schemaVersion, regionId, name, currentSector, progress, sectors,
 * nextObjective }. Each sector has id, one-based index, title, discovered,
 * current, patrols, guardian, shard, sanctuary and routes. Unvisited titles are
 * generic; their encounter details are null and routes empty. Internal IDs are
 * stable navigation keys, never display labels. Global guardian/shard progress
 * is null until its sector is discovered. Routes include oriented direction,
 * destination title, availability and outstanding DISTINCT patrol requirements.
 * nextObjective has kind, text, sectorId, transitionId and remainingPatrols.
 * Its transitionId is the immediate suggested exit, not a teleport destination.
 * All returned objects are detached from the save/layout and deeply frozen.
 */
export function buildExpeditionAtlas(regionId, state = {}) {
  if (!REGION_IDS.includes(regionId)) throw new RangeError(`Région inconnue : ${String(regionId)}`);
  const layout = getWorldLayout(regionId);
  const sectorById = new Map(layout.sectors.map((sector) => [sector.id, sector]));
  const currentId = state?.map === regionId ? layout.entrySectorId
    : (sectorById.has(state?.map) ? state.map : null);
  const discovered = new Set((Array.isArray(state?.discoveredSectors) ? state.discoveredSectors : [])
    .filter((id) => sectorById.has(id)));
  if (currentId) discovered.add(currentId);
  const patrolIds = new Set(layout.sectors.flatMap((sector) => sector.patrols.map(({ id }) => id)));
  const victories = new Set((Array.isArray(state?.patrolVictories) ? state.patrolVictories : [])
    .filter((id) => patrolIds.has(id)));
  const flags = Object.create(null);
  for (const link of layout.connections) {
    if (link.unlock?.flag) flags[link.unlock.flag] = ownTrue(state?.flags, link.unlock.flag);
  }
  const guardian = sectorById.get(layout.guardianSectorId).guardian;
  const shard = sectorById.get(layout.shardSectorId).shard;
  const guardianDefeated = ownTrue(state?.flags, guardian.defeatFlag);
  const shardCollected = ownTrue(state?.flags, shard.collectFlag);
  const sectorTitle = (id) => discovered.has(id) ? sectorById.get(id).name : UNKNOWN_SECTOR_TITLE;

  // Keep the runtime's flag gates AND its forward-only 2/5 patrol seals.
  const routeMap = new Map(layout.mainPath.map((id) => [id,
    getSectorTransitions(regionId, id, { flags }).map((transition) => {
      const remainingPatrols = Math.max(0, transition.requiresRegionalWins - victories.size);
      const available = transition.available && remainingPatrols === 0;
      return {
        connectionId: transition.connectionId,
        kind: transition.kind,
        direction: directionOf(transition.from),
        destinationId: transition.to.sectorId,
        destinationTitle: sectorTitle(transition.to.sectorId),
        destinationDiscovered: discovered.has(transition.to.sectorId),
        available,
        requiredPatrols: transition.requiresRegionalWins,
        remainingPatrols,
        reason: available ? null : remainingPatrols > 0
          ? `Encore ${remainingPatrols} patrouille${remainingPatrols > 1 ? 's' : ''} différente${remainingPatrols > 1 ? 's' : ''} à vaincre (${victories.size}/${transition.requiresRegionalWins}).`
          : transition.kind === 'shortcut'
            ? layout.connections.find((link) => link.id === transition.connectionId)?.unlock?.activation?.sectorId === id
              ? 'Raccourci à ouvrir à proximité.' : 'Raccourci à ouvrir depuis son autre extrémité.'
            : 'Le gardien maintient ce passage fermé.',
      };
    }),
  ]));

  const sectors = layout.mainPath.map((id, index) => {
    const data = sectorById.get(id);
    const visible = discovered.has(id);
    return {
      id, index: index + 1, title: sectorTitle(id), discovered: visible, current: id === currentId,
      patrols: visible ? { cleared: data.patrols.filter(({ id: patrolId }) => victories.has(patrolId)).length, total: data.patrols.length } : null,
      guardian: visible && data.guardian ? { name: data.guardian.name, defeated: guardianDefeated } : null,
      shard: visible && data.shard ? { name: data.shard.name, collected: shardCollected } : null,
      sanctuary: visible && data.sanctuary ? { name: data.sanctuary.name } : null,
      routes: visible ? routeMap.get(id) : [],
    };
  });

  // Breadth-first routing uses only traversable exits. It can find a known
  // return shortcut, but cannot suggest crossing a locked seal to reach patrols.
  const findPath = (fromId, targetId, discoveredOnly = false) => {
    const queue = [{ id: fromId, path: [] }];
    const seen = new Set([fromId]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const next = queue[cursor];
      if (next.id === targetId) return next.path;
      for (const route of routeMap.get(next.id) || []) {
        if (!route.available || seen.has(route.destinationId)
          || (discoveredOnly && !discovered.has(route.destinationId))) continue;
        seen.add(route.destinationId);
        queue.push({ id: route.destinationId, path: [...next.path, route] });
      }
    }
    return null;
  };
  const objective = (kind, text, sectorId, route = null, remainingPatrols = 0) => ({
    kind, text, sectorId, transitionId: route?.connectionId || null, remainingPatrols,
  });
  const travelText = (route, returning = false) => {
    const direction = ['nord', 'sud'].includes(route.direction) ? `au ${route.direction}`
      : ['est', 'ouest'].includes(route.direction) ? `à l’${route.direction}` : 'indiquée';
    return `${returning ? 'Revenez par la sortie' : 'Prenez la sortie'} ${direction}${route.destinationDiscovered ? ` vers ${route.destinationTitle}` : ' vers un secteur inexploré'}.`;
  };

  const chooseObjective = () => {
    if (!currentId) return shardCollected
      ? objective('complete', 'Éclat rapporté. Vous pouvez revenir chercher les patrouilles et rencontres laissées en chemin.', null)
      : objective('depart', `Rejoignez ${layout.name} pour ${discovered.size ? 'reprendre' : 'commencer'} l’expédition.`, layout.entrySectorId);

    if (shardCollected) {
      if (currentId === layout.entrySectorId) return objective('return', 'Rentrez à la Cité des Échos par la sortie au sud.', currentId);
      const shortcut = routeMap.get(currentId).find((route) => route.kind === 'shortcut' && !route.available
        && layout.connections.find((link) => link.id === route.connectionId)?.unlock?.activation?.sectorId === currentId);
      if (shortcut) return objective('shortcut', 'Ouvrez le raccourci de retour à proximité pour écourter le trajet vers la Cité.', currentId, shortcut);
      const path = findPath(currentId, layout.entrySectorId);
      if (path?.length) return objective('return', travelText(path[0], true), layout.entrySectorId, path[0]);
    }

    const frontier = layout.mainPath.find((id) => !discovered.has(id));
    const targetId = guardianDefeated ? layout.shardSectorId
      : frontier && layout.mainPath.indexOf(frontier) <= layout.mainPath.indexOf(layout.guardianSectorId)
        ? frontier : layout.guardianSectorId;
    if (currentId === targetId) return guardianDefeated
      ? objective('shard', `Récupérez ${shard.name} dans ce secteur.`, targetId)
      : objective('guardian', `Préparez votre partenaire au sanctuaire puis affrontez ${guardian.name}.`, targetId);

    const path = findPath(currentId, targetId);
    if (path?.length) return objective(path[0].destinationDiscovered ? 'travel' : 'explore', travelText(path[0]), targetId, path[0]);

    // Find the first closed seal along the entire intended route. Looking only
    // at the immediate exit would send a returning patrol hunter back to the
    // distant seal instead of letting them fight in the sector they just reached.
    const currentIndex = layout.mainPath.indexOf(currentId);
    const targetIndex = layout.mainPath.indexOf(targetId);
    const step = Math.sign(targetIndex - currentIndex);
    let blockingRoute = null;
    for (let index = currentIndex; index !== targetIndex; index += step) {
      const route = routeMap.get(layout.mainPath[index]).find((item) => item.kind === 'route'
        && item.destinationId === layout.mainPath[index + step]);
      if (route && !route.available) { blockingRoute = route; break; }
    }
    const stepId = layout.mainPath[currentIndex + step];
    const nextRoute = routeMap.get(currentId).find((route) => route.kind === 'route' && route.destinationId === stepId);
    if (blockingRoute?.remainingPatrols > 0) {
      const candidates = sectors.filter((sector) => sector.discovered && sector.patrols.cleared < sector.patrols.total)
        .map((sector) => ({ sector, path: findPath(currentId, sector.id, true) }))
        .filter((candidate) => candidate.path !== null)
        .sort((a, b) => a.path.length - b.path.length || a.sector.index - b.sector.index);
      const nearest = candidates[0];
      const remaining = blockingRoute.remainingPatrols;
      const action = nearest?.path.length ? ` ${travelText(nearest.path[0])}` : nearest ? ' Cherchez une patrouille encore invaincue dans ce secteur.' : '';
      if (nearest) return objective('patrols', `Vainquez encore ${remaining} patrouille${remaining > 1 ? 's' : ''} différente${remaining > 1 ? 's' : ''} pour ouvrir la route.${action}`,
        nearest?.sector.id || currentId, nearest?.path[0], remaining);
    }
    if (nextRoute?.available) return objective(nextRoute.destinationDiscovered ? 'travel' : 'explore', travelText(nextRoute), targetId, nextRoute);
    return objective('guardian', discovered.has(layout.guardianSectorId)
      ? `Affrontez ${guardian.name} pour ouvrir la route de l’Éclat.`
      : 'Poursuivez les secteurs découverts et recherchez le passage du gardien.', layout.guardianSectorId);
  };

  return freezeTree({
    schemaVersion: EXPEDITION_ATLAS_SCHEMA_VERSION,
    regionId,
    name: layout.name,
    currentSector: currentId ? { id: currentId, index: layout.mainPath.indexOf(currentId) + 1, title: sectorTitle(currentId) } : null,
    progress: {
      discovered: discovered.size, total: sectors.length,
      patrolVictories: victories.size, patrolTotal: patrolIds.size,
      guardianDefeated: discovered.has(layout.guardianSectorId) ? guardianDefeated : null,
      shardCollected: discovered.has(layout.shardSectorId) ? shardCollected : null,
    },
    sectors,
    nextObjective: chooseObjective(),
  });
}
