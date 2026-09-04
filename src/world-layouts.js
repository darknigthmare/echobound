const VIEWPORT = Object.freeze({ width: 960, height: 540 });

export const WORLD_LAYOUT_SCHEMA_VERSION = 1;
export const REGION_IDS = Object.freeze(['wastes', 'hive', 'fog', 'foundry']);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const point = (x, y, facing = 'up') => ({ x, y, facing });
const endpoint = (sectorId, x, y, facing) => ({ sectorId, ...point(x, y, facing) });
const obstacle = (id, x, y, w, h, kind = 'terrain') => ({ id, x, y, w, h, kind });

const patrol = (id, name, level, style, color, x, y, path, loot = null) => ({
  id,
  name,
  level,
  style,
  color,
  x,
  y,
  path: path.map(([pathX, pathY]) => ({ x: pathX, y: pathY })),
  ...(loot ? { loot } : {}),
  respawn: 'next-day',
});

const resident = (residentId, x, y, facing = 'down') => ({ residentId, x, y, facing });

const sector = ({
  id,
  name,
  role,
  ambience,
  spawn,
  obstacles,
  patrols,
  residentSpawns = [],
  events = [],
  sanctuary,
  guardian,
  shard,
}) => ({
  id,
  name,
  role,
  ambience,
  bounds: { ...VIEWPORT },
  spawn,
  obstacles,
  patrols,
  residentSpawns,
  events,
  ...(sanctuary ? { sanctuary } : {}),
  ...(guardian ? { guardian } : {}),
  ...(shard ? { shard } : {}),
});

const connection = (id, from, to, options = {}) => ({
  id,
  kind: options.kind || 'route',
  bidirectional: options.bidirectional !== false,
  from,
  to,
  ...(Number.isInteger(options.requiresRegionalWins) ? { requiresRegionalWins: options.requiresRegionalWins } : {}),
  ...(options.unlock ? { unlock: options.unlock } : {}),
});

const choiceEvent = (id, title, x, y, onceFlag, lines, choices) => ({
  id,
  type: 'choice',
  trigger: { x, y, radius: 52 },
  onceFlag,
  title,
  lines,
  choices,
});

const sanctuary = (id, name, x, y) => ({
  id,
  name,
  x,
  y,
  radius: 48,
  rest: { hpRatio: 0.35, mpRatio: 0.35, fatigue: -12 },
  oncePerVisit: true,
});

const guardian = (id, name, level, style, color, x, y, defeatFlag) => ({
  id,
  name,
  level,
  style,
  color,
  x,
  y,
  defeatFlag,
  combatTag: 'region-guardian',
});

const shard = (id, name, x, y, collectFlag, requiresFlag) => ({
  id,
  name,
  x,
  y,
  collectFlag,
  requiresFlag,
});

/**
 * Les régions restent volontairement constituées de cartes séparées. Chaque
 * secteur conserve le format 960 x 540 du moteur actuel, mais la traversée
 * complète exige cinq changements de carte et plusieurs rencontres.
 */
export const WORLD_LAYOUTS = deepFreeze({
  wastes: {
    id: 'wastes',
    name: 'FRICHES DU PORTAIL',
    theme: 'wastes',
    accent: '#ff9a72',
    pacing: { targetMinutes: 26, mainEncounters: 8, optionalEncounters: 3 },
    entrySectorId: 'wastes_gatefall',
    guardianSectorId: 'wastes_silent_threshold',
    shardSectorId: 'wastes_memory_crater',
    mainPath: [
      'wastes_gatefall',
      'wastes_caravan_scars',
      'wastes_antenna_boneyard',
      'wastes_silent_threshold',
      'wastes_memory_crater',
    ],
    sectors: [
      sector({
        id: 'wastes_gatefall',
        name: 'CHUTE DU PORTAIL',
        role: 'entry',
        ambience: 'Des arches rompues vibrent encore au rythme du Cœur de Nox Arca.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('wastes_gatefall_arch_w', 90, 92, 170, 54, 'portal-rubble'),
          obstacle('wastes_gatefall_arch_e', 690, 88, 180, 58, 'portal-rubble'),
          obstacle('wastes_gatefall_crater', 360, 244, 240, 70, 'crater'),
          obstacle('wastes_gatefall_wreck', 90, 362, 170, 48, 'wreck'),
        ],
        patrols: [
          patrol('wastes_gatefall_hound', 'Molosse de Rouille', 1, 'feral', '#d77d61', 294, 194, [[294, 194], [650, 194], [650, 344]], null),
          patrol('wastes_gatefall_mite', 'Tique de Portail', 2, 'scarab', '#e5bf69', 724, 390, [[724, 390], [500, 390], [500, 330]], 'scrap'),
        ],
      }),
      sector({
        id: 'wastes_caravan_scars',
        name: 'CICATRICES DE LA CARAVANE',
        role: 'route',
        ambience: 'Une file de carcasses pointe vers une destination effacée des cartes.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('wastes_caravan_hulk_w', 92, 118, 210, 62, 'wreck'),
          obstacle('wastes_caravan_hulk_e', 650, 105, 210, 70, 'wreck'),
          obstacle('wastes_caravan_spine', 350, 260, 260, 54, 'metal-spine'),
          obstacle('wastes_caravan_scrap', 120, 382, 140, 46, 'scrap-pile'),
          obstacle('wastes_caravan_scrap_e', 704, 368, 130, 52, 'scrap-pile'),
        ],
        patrols: [
          patrol('wastes_caravan_drone', 'Drone Amnésique', 2, 'drone', '#76b8df', 210, 238, [[210, 238], [480, 205], [746, 238]], 'scrap'),
          patrol('wastes_caravan_hound', 'Molosse de Rouille', 2, 'feral', '#d77d61', 625, 355, [[625, 355], [370, 355], [370, 440]], null),
        ],
        residentSpawns: [resident('brakk', 790, 210, 'left')],
        events: [
          choiceEvent(
            'wastes_caravan_blackbox',
            'LE CONVOI SANS DESTINATION',
            480,
            192,
            'event_wastes_caravan_resolved',
            [
              'Un enregistreur répète les derniers battements d’une caravane qui refusait d’abandonner ses blessés.',
              'Le signal peut guider les égarés ou être démonté pour renforcer votre équipement.',
            ],
            [
              { id: 'restore_beacon', label: 'Rallumer la balise', result: { flags: ['wastes_beacon_restored'], bond: 3, morale: 2 } },
              { id: 'salvage_core', label: 'Récupérer le noyau', result: { flags: ['wastes_beacon_salvaged'], inventory: { scrap: 3 }, morale: -1 } },
            ],
          ),
        ],
      }),
      sector({
        id: 'wastes_antenna_boneyard',
        name: 'OSSUAIRE DES ANTENNES',
        role: 'crossroads',
        ambience: 'Les antennes mortes rediffusent des souvenirs dès que le vent tourne.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('wastes_antenna_mast_w', 205, 78, 72, 230, 'antenna'),
          obstacle('wastes_antenna_mast_e', 680, 90, 72, 220, 'antenna'),
          obstacle('wastes_antenna_dish', 390, 170, 180, 58, 'dish'),
          obstacle('wastes_antenna_trench_w', 78, 360, 235, 48, 'trench'),
          obstacle('wastes_antenna_trench_e', 650, 355, 235, 48, 'trench'),
        ],
        patrols: [
          patrol('wastes_antenna_mite', 'Tique de Portail', 2, 'scarab', '#e5bf69', 340, 328, [[340, 328], [480, 250], [620, 328]], 'scrap'),
          patrol('wastes_antenna_drone', 'Relais Prédateur', 3, 'drone', '#91c9e8', 810, 420, [[810, 420], [480, 420], [150, 420]], 'scrap'),
        ],
        residentSpawns: [resident('mnemo', 132, 176, 'right')],
      }),
      sector({
        id: 'wastes_silent_threshold',
        name: 'SEUIL DU SILENCE',
        role: 'guardian-sanctuary',
        ambience: 'Le bruit du métal s’éteint autour d’un ancien autel de recalibrage.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('wastes_threshold_pillar_w', 180, 110, 95, 190, 'monolith'),
          obstacle('wastes_threshold_pillar_e', 685, 110, 95, 190, 'monolith'),
          obstacle('wastes_threshold_wall_w', 70, 350, 260, 48, 'sealed-wall'),
          obstacle('wastes_threshold_wall_e', 630, 350, 260, 48, 'sealed-wall'),
        ],
        patrols: [
          patrol('wastes_threshold_hound', 'Cerbère de Limaille', 3, 'feral', '#ed8b69', 480, 352, [[330, 352], [480, 300], [630, 352]], 'scrap'),
        ],
        residentSpawns: [resident('pylon', 818, 420, 'left')],
        sanctuary: sanctuary('wastes_recalibration_altar', 'Autel de Recalibrage', 135, 432),
        guardian: guardian('wastes_gate_colossus', 'Colosse du Seuil', 3, 'shell', '#ef9b6d', 480, 155, 'guardian_wastes_defeated'),
      }),
      sector({
        id: 'wastes_memory_crater',
        name: 'CRATÈRE DE MÉMOIRE',
        role: 'shard-sanctum',
        ambience: 'La poussière remonte au lieu de tomber, attirée par une mémoire compacte.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('wastes_crater_rim_w', 80, 160, 260, 64, 'crater-rim'),
          obstacle('wastes_crater_rim_e', 620, 160, 260, 64, 'crater-rim'),
          obstacle('wastes_crater_rib_w', 180, 335, 170, 48, 'fossil-metal'),
          obstacle('wastes_crater_rib_e', 610, 335, 170, 48, 'fossil-metal'),
        ],
        patrols: [
          patrol('wastes_crater_echo', 'Écho de Fer', 3, 'mystic', '#f2ad86', 480, 312, [[300, 312], [480, 250], [660, 312]], 'scrap'),
        ],
        shard: shard('shard_wastes', 'Éclat des Friches', 480, 112, 'shard_wastes', 'guardian_wastes_defeated'),
      }),
    ],
    connections: [
      connection('wastes_gatefall_to_caravan', endpoint('wastes_gatefall', 480, 32, 'up'), endpoint('wastes_caravan_scars', 480, 508, 'up'), { requiresRegionalWins: 2 }),
      connection('wastes_caravan_to_antenna', endpoint('wastes_caravan_scars', 900, 270, 'right'), endpoint('wastes_antenna_boneyard', 60, 270, 'right')),
      connection('wastes_antenna_to_threshold', endpoint('wastes_antenna_boneyard', 480, 32, 'up'), endpoint('wastes_silent_threshold', 480, 508, 'up'), { requiresRegionalWins: 5 }),
      connection(
        'wastes_threshold_to_crater',
        endpoint('wastes_silent_threshold', 480, 32, 'up'),
        endpoint('wastes_memory_crater', 480, 508, 'up'),
        { unlock: { type: 'flag', flag: 'guardian_wastes_defeated', reason: 'Le Colosse du Seuil maintient la chambre close.' } },
      ),
      connection(
        'wastes_threshold_lift',
        endpoint('wastes_silent_threshold', 70, 432, 'left'),
        endpoint('wastes_gatefall', 890, 430, 'left'),
        {
          kind: 'shortcut',
          unlock: {
            type: 'flag',
            flag: 'shortcut_wastes_lift',
            reason: 'Le treuil doit être déployé depuis le Seuil du Silence.',
            activation: { sectorId: 'wastes_silent_threshold', x: 84, y: 430, label: 'Déployer le treuil de retour' },
          },
        },
      ),
    ],
  },

  hive: {
    id: 'hive',
    name: 'BIO-RUCHE DE VERDANCE',
    theme: 'hive',
    accent: '#bcff8d',
    pacing: { targetMinutes: 30, mainEncounters: 9, optionalEncounters: 3 },
    entrySectorId: 'hive_rootmouth',
    guardianSectorId: 'hive_heart_nursery',
    shardSectorId: 'hive_symbiotic_core',
    mainPath: [
      'hive_rootmouth',
      'hive_spore_galleries',
      'hive_vein_canopy',
      'hive_heart_nursery',
      'hive_symbiotic_core',
    ],
    sectors: [
      sector({
        id: 'hive_rootmouth',
        name: 'GUEULE-RACINE',
        role: 'entry',
        ambience: 'La porte organique respire lentement et referme derrière vous ses fibres de lumière.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('hive_rootmouth_root_w', 105, 90, 130, 250, 'root'),
          obstacle('hive_rootmouth_root_e', 725, 90, 130, 250, 'root'),
          obstacle('hive_rootmouth_pool', 360, 255, 240, 66, 'sap-pool'),
          obstacle('hive_rootmouth_bulb', 400, 165, 160, 52, 'bulb'),
        ],
        patrols: [
          patrol('hive_rootmouth_chitin', 'Chitineux Affamé', 3, 'scarab', '#96cd63', 285, 390, [[285, 390], [480, 340], [675, 390]], 'spore'),
          patrol('hive_rootmouth_spitter', 'Crache-Sève', 3, 'fungus', '#acd979', 700, 205, [[700, 205], [480, 205], [260, 205]], 'spore'),
        ],
      }),
      sector({
        id: 'hive_spore_galleries',
        name: 'GALERIES À SPORES',
        role: 'route',
        ambience: 'Chaque pas soulève des spores qui imitent brièvement la forme de votre partenaire.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('hive_spores_column_w', 220, 80, 95, 180, 'fungal-column'),
          obstacle('hive_spores_column_e', 645, 80, 95, 180, 'fungal-column'),
          obstacle('hive_spores_bed_w', 75, 330, 220, 62, 'spore-bed'),
          obstacle('hive_spores_bed_e', 665, 330, 220, 62, 'spore-bed'),
          obstacle('hive_spores_shelf', 385, 280, 190, 52, 'mycelium'),
        ],
        patrols: [
          patrol('hive_spores_maw', 'Gueule à Spores', 3, 'fungus', '#b7ed71', 480, 210, [[340, 210], [480, 150], [620, 210]], 'spore'),
          patrol('hive_spores_mite', 'Larve Lumineuse', 4, 'scarab', '#c6f28c', 480, 405, [[260, 405], [480, 405], [700, 405]], 'spore'),
        ],
        residentSpawns: [resident('mycella', 145, 430, 'right')],
      }),
      sector({
        id: 'hive_vein_canopy',
        name: 'CANOPÉE VEINEUSE',
        role: 'crossroads',
        ambience: 'Des veines suspendues transportent une sève chargée de voix contradictoires.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('hive_canopy_vein_n', 300, 150, 360, 45, 'suspended-vein'),
          obstacle('hive_canopy_trunk_w', 100, 160, 125, 240, 'root'),
          obstacle('hive_canopy_trunk_e', 735, 160, 125, 240, 'root'),
          obstacle('hive_canopy_node', 380, 275, 200, 72, 'nerve-node'),
        ],
        patrols: [
          patrol('hive_canopy_serpent', 'Serpent Veineux', 4, 'serpent', '#ca6b87', 480, 180, [[260, 180], [480, 145], [700, 180]], 'spore'),
          patrol('hive_canopy_wasp', 'Aile de Pollen', 4, 'bat', '#d3e982', 650, 405, [[650, 405], [480, 350], [310, 405]], 'spore'),
        ],
        residentSpawns: [resident('vespera', 790, 150, 'left')],
        events: [
          choiceEvent(
            'hive_canopy_memory_bloom',
            'LA FLEUR QUI SE SOUVIENT',
            480,
            238,
            'event_hive_bloom_resolved',
            [
              'Une fleur nerveuse rejoue la peur du premier Écho absorbé par la Ruche.',
              'Votre partenaire hésite : partager la mémoire l’apaisera, la tailler protégera la Ruche de sa douleur.',
            ],
            [
              { id: 'share_memory', label: 'Partager la mémoire', result: { flags: ['hive_bloom_shared'], bond: 4, fatigue: 3 } },
              { id: 'prune_memory', label: 'Tailler la fleur', result: { flags: ['hive_bloom_pruned'], inventory: { spore: 3 }, morale: 2 } },
            ],
          ),
        ],
      }),
      sector({
        id: 'hive_heart_nursery',
        name: 'NURSERIE DU CŒUR',
        role: 'guardian-sanctuary',
        ambience: 'La Ruche protège ici ses formes inachevées et refuse toute présence prédatrice.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('hive_nursery_pod_w', 170, 125, 120, 155, 'nursery-pod'),
          obstacle('hive_nursery_pod_e', 670, 125, 120, 155, 'nursery-pod'),
          obstacle('hive_nursery_bed_w', 75, 350, 250, 48, 'soft-mycelium'),
          obstacle('hive_nursery_bed_e', 635, 350, 250, 48, 'soft-mycelium'),
        ],
        patrols: [
          patrol('hive_nursery_guard', 'Nourrice Chitineuse', 5, 'scarab', '#9fdb70', 480, 340, [[330, 340], [480, 290], [630, 340]], 'spore'),
        ],
        residentSpawns: [resident('skarn', 810, 420, 'left')],
        sanctuary: sanctuary('hive_calm_basin', 'Bassin de Sève Calme', 145, 430),
        guardian: guardian('hive_blind_motherroot', 'Mère-Racine Aveugle', 5, 'fungus', '#c8f092', 480, 150, 'guardian_hive_defeated'),
      }),
      sector({
        id: 'hive_symbiotic_core',
        name: 'CŒUR SYMBIOTIQUE',
        role: 'shard-sanctum',
        ambience: 'Le réseau vivant cesse de se défendre et accorde son rythme au vôtre.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('hive_core_lobe_w', 105, 130, 250, 82, 'living-lobe'),
          obstacle('hive_core_lobe_e', 605, 130, 250, 82, 'living-lobe'),
          obstacle('hive_core_vein_w', 190, 330, 180, 46, 'root'),
          obstacle('hive_core_vein_e', 590, 330, 180, 46, 'root'),
        ],
        patrols: [
          patrol('hive_core_echo', 'Symbiote Mnémique', 5, 'mystic', '#c7ffa0', 480, 300, [[310, 300], [480, 250], [650, 300]], 'spore'),
        ],
        shard: shard('shard_hive', 'Éclat Symbiotique', 480, 110, 'shard_hive', 'guardian_hive_defeated'),
      }),
    ],
    connections: [
      connection('hive_rootmouth_to_spores', endpoint('hive_rootmouth', 480, 32, 'up'), endpoint('hive_spore_galleries', 480, 508, 'up'), { requiresRegionalWins: 2 }),
      connection('hive_spores_to_canopy', endpoint('hive_spore_galleries', 900, 270, 'right'), endpoint('hive_vein_canopy', 60, 450, 'right')),
      connection('hive_canopy_to_nursery', endpoint('hive_vein_canopy', 480, 32, 'up'), endpoint('hive_heart_nursery', 480, 508, 'up'), { requiresRegionalWins: 5 }),
      connection(
        'hive_nursery_to_core',
        endpoint('hive_heart_nursery', 480, 32, 'up'),
        endpoint('hive_symbiotic_core', 480, 508, 'up'),
        { unlock: { type: 'flag', flag: 'guardian_hive_defeated', reason: 'La Mère-Racine maintient le Cœur hors d’atteinte.' } },
      ),
      connection(
        'hive_nursery_rootslide',
        endpoint('hive_heart_nursery', 70, 430, 'left'),
        endpoint('hive_rootmouth', 890, 430, 'left'),
        {
          kind: 'shortcut',
          unlock: {
            type: 'flag',
            flag: 'shortcut_hive_rootslide',
            reason: 'Le passage doit être ouvert depuis la Nurserie du Cœur.',
            activation: { sectorId: 'hive_heart_nursery', x: 84, y: 430, label: 'Délier la racine de retour' },
          },
        },
      ),
    ],
  },

  fog: {
    id: 'fog',
    name: 'CATHÉDRALE DE BRUME',
    theme: 'fog',
    accent: '#d8e2ff',
    pacing: { targetMinutes: 33, mainEncounters: 9, optionalEncounters: 4 },
    entrySectorId: 'fog_drowned_nave',
    guardianSectorId: 'fog_vigil_crypt',
    shardSectorId: 'fog_veil_apse',
    mainPath: [
      'fog_drowned_nave',
      'fog_bell_cloister',
      'fog_mirror_transept',
      'fog_vigil_crypt',
      'fog_veil_apse',
    ],
    sectors: [
      sector({
        id: 'fog_drowned_nave',
        name: 'NEF NOYÉE',
        role: 'entry',
        ambience: 'La brume couvre le sol comme une eau sans surface et étouffe les pas.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('fog_nave_pew_w', 130, 165, 250, 42, 'stone-pew'),
          obstacle('fog_nave_pew_e', 580, 165, 250, 42, 'stone-pew'),
          obstacle('fog_nave_pew_w2', 130, 300, 250, 42, 'stone-pew'),
          obstacle('fog_nave_pew_e2', 580, 300, 250, 42, 'stone-pew'),
          obstacle('fog_nave_font', 420, 225, 120, 70, 'dry-font'),
        ],
        patrols: [
          patrol('fog_nave_mourner', 'Pleurant Sans-Visage', 5, 'wraith', '#b9c3db', 480, 255, [[260, 255], [480, 220], [700, 255]], null),
          patrol('fog_nave_mask', 'Masque Errant', 5, 'mask', '#e7a8c7', 760, 405, [[760, 405], [480, 405], [200, 405]], null),
        ],
      }),
      sector({
        id: 'fog_bell_cloister',
        name: 'CLOÎTRE DES CLOCHES',
        role: 'route',
        ambience: 'Des cloches sans battant sonnent lorsque quelqu’un ment à son partenaire.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('fog_cloister_bell_nw', 135, 100, 120, 150, 'bell-tower'),
          obstacle('fog_cloister_bell_ne', 705, 100, 120, 150, 'bell-tower'),
          obstacle('fog_cloister_walk_w', 75, 330, 260, 48, 'collapsed-arcade'),
          obstacle('fog_cloister_walk_e', 625, 330, 260, 48, 'collapsed-arcade'),
          obstacle('fog_cloister_garden', 390, 210, 180, 95, 'mist-garden'),
        ],
        patrols: [
          patrol('fog_cloister_bellshade', 'Spectre du Glas', 6, 'bat', '#a9b3db', 290, 285, [[290, 285], [480, 155], [670, 285]], null),
          patrol('fog_cloister_mourner', 'Pèlerin de Cendre', 6, 'wraith', '#c5cbdf', 480, 415, [[210, 415], [480, 415], [750, 415]], null),
        ],
        residentSpawns: [resident('bellgrave', 150, 430, 'right')],
      }),
      sector({
        id: 'fog_mirror_transept',
        name: 'TRANSEPT DES MIROIRS',
        role: 'crossroads',
        ambience: 'Chaque miroir renvoie une évolution que votre partenaire aurait pu devenir.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('fog_mirror_wall_w', 230, 75, 68, 255, 'black-mirror'),
          obstacle('fog_mirror_wall_e', 662, 75, 68, 255, 'black-mirror'),
          obstacle('fog_mirror_altar', 390, 185, 180, 56, 'altar'),
          obstacle('fog_mirror_screen_w', 80, 370, 250, 45, 'mist-screen'),
          obstacle('fog_mirror_screen_e', 630, 370, 250, 45, 'mist-screen'),
        ],
        patrols: [
          patrol('fog_mirror_mask', 'Masque de Regret', 6, 'mask', '#e7a8c7', 480, 295, [[310, 295], [480, 260], [650, 295]], null),
          patrol('fog_mirror_echo', 'Reflet Inachevé', 7, 'mystic', '#c5d2ef', 480, 420, [[250, 420], [480, 365], [710, 420]], null),
        ],
        residentSpawns: [resident('masks', 790, 160, 'left')],
        events: [
          choiceEvent(
            'fog_mirror_lost_name',
            'LE NOM DERRIÈRE LE VERRE',
            480,
            145,
            'event_fog_name_resolved',
            [
              'Un nom effacé frappe depuis l’autre côté du miroir et demande à être porté jusqu’à Nox Arca.',
              'Le retenir alourdira votre mémoire ; le rendre à la brume libérera ce qui reste de lui.',
            ],
            [
              { id: 'carry_name', label: 'Porter le nom', result: { flags: ['fog_name_carried'], bond: 3, morale: -2 } },
              { id: 'release_name', label: 'Rendre le nom', result: { flags: ['fog_name_released'], morale: 4, fatigue: -4 } },
            ],
          ),
        ],
      }),
      sector({
        id: 'fog_vigil_crypt',
        name: 'CRYPTE DE LA VIGILE',
        role: 'guardian-sanctuary',
        ambience: 'Une flamme froide veille sur ceux dont la ville a oublié le retour.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('fog_crypt_tomb_w', 140, 125, 170, 90, 'tomb'),
          obstacle('fog_crypt_tomb_e', 650, 125, 170, 90, 'tomb'),
          obstacle('fog_crypt_wall_w', 75, 330, 260, 50, 'crypt-wall'),
          obstacle('fog_crypt_wall_e', 625, 330, 260, 50, 'crypt-wall'),
        ],
        patrols: [
          patrol('fog_crypt_cantor', 'Choriste Sans Souffle', 7, 'wraith', '#ccd5eb', 480, 335, [[330, 335], [480, 285], [630, 335]], null),
        ],
        residentSpawns: [resident('nacre', 805, 425, 'left')],
        sanctuary: sanctuary('fog_vigil_flame', 'Flamme de la Vigile', 145, 430),
        guardian: guardian('fog_veil_cantor', 'Chantre du Voile', 7, 'seraph', '#e0e5fa', 480, 145, 'guardian_fog_defeated'),
      }),
      sector({
        id: 'fog_veil_apse',
        name: 'ABSIDE DU VOILE',
        role: 'shard-sanctum',
        ambience: 'La brume s’ouvre en couches concentriques autour d’un souvenir intact.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('fog_apse_arc_w', 100, 140, 260, 55, 'choir-arc'),
          obstacle('fog_apse_arc_e', 600, 140, 260, 55, 'choir-arc'),
          obstacle('fog_apse_screen_w', 185, 330, 175, 48, 'mist-screen'),
          obstacle('fog_apse_screen_e', 600, 330, 175, 48, 'mist-screen'),
        ],
        patrols: [
          patrol('fog_apse_memory', 'Mémoire Voilée', 7, 'mystic', '#d8e2ff', 480, 300, [[310, 300], [480, 250], [650, 300]], null),
        ],
        shard: shard('shard_fog', 'Éclat du Voile', 480, 108, 'shard_fog', 'guardian_fog_defeated'),
      }),
    ],
    connections: [
      connection('fog_nave_to_cloister', endpoint('fog_drowned_nave', 480, 32, 'up'), endpoint('fog_bell_cloister', 480, 508, 'up'), { requiresRegionalWins: 2 }),
      connection('fog_cloister_to_mirrors', endpoint('fog_bell_cloister', 900, 270, 'right'), endpoint('fog_mirror_transept', 60, 270, 'right')),
      connection('fog_mirrors_to_crypt', endpoint('fog_mirror_transept', 480, 32, 'up'), endpoint('fog_vigil_crypt', 480, 508, 'up'), { requiresRegionalWins: 5 }),
      connection(
        'fog_crypt_to_apse',
        endpoint('fog_vigil_crypt', 480, 32, 'up'),
        endpoint('fog_veil_apse', 480, 508, 'up'),
        { unlock: { type: 'flag', flag: 'guardian_fog_defeated', reason: 'Le Chantre du Voile retient le passage vers l’Abside.' } },
      ),
      connection(
        'fog_crypt_processional',
        endpoint('fog_vigil_crypt', 70, 430, 'left'),
        endpoint('fog_drowned_nave', 890, 430, 'left'),
        {
          kind: 'shortcut',
          unlock: {
            type: 'flag',
            flag: 'shortcut_fog_processional',
            reason: 'La porte processionnelle s’ouvre depuis la Crypte de la Vigile.',
            activation: { sectorId: 'fog_vigil_crypt', x: 84, y: 430, label: 'Lever le verrou processionnel' },
          },
        },
      ),
    ],
  },

  foundry: {
    id: 'foundry',
    name: 'FONDERIE DES VEILLEURS',
    theme: 'foundry',
    accent: '#ffd36b',
    pacing: { targetMinutes: 36, mainEncounters: 10, optionalEncounters: 4 },
    entrySectorId: 'foundry_intake_rail',
    guardianSectorId: 'foundry_judgement_crucible',
    shardSectorId: 'foundry_overseer_vault',
    mainPath: [
      'foundry_intake_rail',
      'foundry_copper_kennels',
      'foundry_watch_mills',
      'foundry_judgement_crucible',
      'foundry_overseer_vault',
    ],
    sectors: [
      sector({
        id: 'foundry_intake_rail',
        name: 'RAIL D’ADMISSION',
        role: 'entry',
        ambience: 'Des wagons vides circulent encore selon un horaire que personne ne consulte.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('foundry_rail_w', 110, 105, 120, 300, 'rail-machinery'),
          obstacle('foundry_rail_e', 730, 105, 120, 300, 'rail-machinery'),
          obstacle('foundry_rail_wagon', 355, 225, 250, 72, 'ore-wagon'),
          obstacle('foundry_rail_gate', 365, 150, 230, 52, 'security-gate'),
        ],
        patrols: [
          patrol('foundry_rail_sentry', 'Sentinelle Câblée', 7, 'drone', '#f2b95f', 300, 360, [[300, 360], [480, 330], [660, 360]], 'scrap'),
          patrol('foundry_rail_hound', 'Limier de Cuivre', 7, 'feral', '#d99757', 480, 420, [[220, 420], [480, 420], [740, 420]], 'scrap'),
        ],
      }),
      sector({
        id: 'foundry_copper_kennels',
        name: 'CHENILS DE CUIVRE',
        role: 'route',
        ambience: 'Des formes de chasse attendent un ordre qui ne viendra plus.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('foundry_kennel_w', 95, 105, 250, 90, 'machine-kennel'),
          obstacle('foundry_kennel_e', 615, 105, 250, 90, 'machine-kennel'),
          obstacle('foundry_kennel_cage_w', 155, 315, 170, 72, 'cage'),
          obstacle('foundry_kennel_cage_e', 635, 315, 170, 72, 'cage'),
          obstacle('foundry_kennel_press', 405, 225, 150, 80, 'press'),
        ],
        patrols: [
          patrol('foundry_kennel_hound', 'Limier de Cuivre', 7, 'feral', '#d99757', 315, 250, [[315, 250], [480, 205], [645, 250]], 'scrap'),
          patrol('foundry_kennel_handler', 'Dresseur Automate', 8, 'drone', '#ebc478', 480, 410, [[240, 410], [480, 350], [720, 410]], 'scrap'),
        ],
        residentSpawns: [resident('coiljack', 145, 425, 'right')],
      }),
      sector({
        id: 'foundry_watch_mills',
        name: 'MOULINS DE VEILLE',
        role: 'crossroads',
        ambience: 'Chaque roue dentée tourne comme un œil et compare votre passage aux anciens protocoles.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('foundry_mills_gear_w', 150, 90, 155, 155, 'watch-gear'),
          obstacle('foundry_mills_gear_e', 655, 90, 155, 155, 'watch-gear'),
          obstacle('foundry_mills_belt', 330, 300, 300, 58, 'conveyor'),
          obstacle('foundry_mills_pipe_w', 70, 410, 240, 48, 'pressure-pipe'),
          obstacle('foundry_mills_pipe_e', 650, 410, 240, 48, 'pressure-pipe'),
        ],
        patrols: [
          patrol('foundry_mills_scarab', 'Scarabée de Fusion', 8, 'scarab', '#ff884f', 480, 205, [[310, 205], [480, 160], [650, 205]], 'scrap'),
          patrol('foundry_mills_sentry', 'Œil de Contrôle', 8, 'drone', '#f2b95f', 480, 420, [[250, 420], [480, 355], [710, 420]], 'scrap'),
        ],
        residentSpawns: [resident('rook', 800, 180, 'left')],
        events: [
          choiceEvent(
            'foundry_mills_worker_protocol',
            'LE POSTE RESTÉ OUVERT',
            480,
            240,
            'event_foundry_protocol_resolved',
            [
              'Un terminal exige qu’un ouvrier disparu termine son quart avant d’autoriser l’arrêt des machines.',
              'Vous pouvez honorer son dernier protocole ou détourner sa signature pour accélérer la traversée.',
            ],
            [
              { id: 'finish_shift', label: 'Achever le protocole', result: { flags: ['foundry_shift_honored'], morale: 4, fatigue: 5, inventory: { scrap: 2 } } },
              { id: 'forge_signature', label: 'Détourner la signature', result: { flags: ['foundry_shift_forged'], fatigue: -3, inventory: { scrap: 4 } } },
            ],
          ),
        ],
      }),
      sector({
        id: 'foundry_judgement_crucible',
        name: 'CREUSET DU JUGEMENT',
        role: 'guardian-sanctuary',
        ambience: 'Le métal liquide trace au sol un verdict différent pour chaque visiteur.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('foundry_crucible_tank_w', 145, 110, 170, 170, 'smelter'),
          obstacle('foundry_crucible_tank_e', 645, 110, 170, 170, 'smelter'),
          obstacle('foundry_crucible_channel_w', 70, 355, 270, 48, 'molten-channel'),
          obstacle('foundry_crucible_channel_e', 620, 355, 270, 48, 'molten-channel'),
        ],
        patrols: [
          patrol('foundry_crucible_bailiff', 'Huissier de Fusion', 9, 'shell', '#f4ad58', 480, 335, [[330, 335], [480, 285], [630, 335]], 'scrap'),
        ],
        residentSpawns: [resident('khepri', 810, 425, 'left')],
        sanctuary: sanctuary('foundry_cooling_dais', 'Dais de Refroidissement', 145, 430),
        guardian: guardian('foundry_overseer_praetor', 'Prévôt des Veilleurs', 9, 'sovereign', '#ffc96a', 480, 145, 'guardian_foundry_defeated'),
      }),
      sector({
        id: 'foundry_overseer_vault',
        name: 'CHAMBRE DU VEILLEUR',
        role: 'shard-sanctum',
        ambience: 'Pour la première fois, les machines suspendent leur jugement et vous observent choisir.',
        spawn: point(480, 482, 'up'),
        obstacles: [
          obstacle('foundry_vault_bank_w', 100, 130, 260, 68, 'memory-bank'),
          obstacle('foundry_vault_bank_e', 600, 130, 260, 68, 'memory-bank'),
          obstacle('foundry_vault_coil_w', 185, 330, 175, 50, 'induction-coil'),
          obstacle('foundry_vault_coil_e', 600, 330, 175, 50, 'induction-coil'),
        ],
        patrols: [
          patrol('foundry_vault_echo', 'Archive Incandescente', 9, 'mystic', '#ffd983', 480, 300, [[310, 300], [480, 245], [650, 300]], 'scrap'),
        ],
        shard: shard('shard_foundry', 'Éclat du Veilleur', 480, 106, 'shard_foundry', 'guardian_foundry_defeated'),
      }),
    ],
    connections: [
      connection('foundry_rail_to_kennels', endpoint('foundry_intake_rail', 480, 32, 'up'), endpoint('foundry_copper_kennels', 480, 508, 'up'), { requiresRegionalWins: 2 }),
      connection('foundry_kennels_to_mills', endpoint('foundry_copper_kennels', 900, 270, 'right'), endpoint('foundry_watch_mills', 60, 270, 'right')),
      connection('foundry_mills_to_crucible', endpoint('foundry_watch_mills', 480, 32, 'up'), endpoint('foundry_judgement_crucible', 480, 508, 'up'), { requiresRegionalWins: 5 }),
      connection(
        'foundry_crucible_to_vault',
        endpoint('foundry_judgement_crucible', 480, 32, 'up'),
        endpoint('foundry_overseer_vault', 480, 508, 'up'),
        { unlock: { type: 'flag', flag: 'guardian_foundry_defeated', reason: 'Le Prévôt des Veilleurs refuse l’accès à la Chambre.' } },
      ),
      connection(
        'foundry_crucible_freightlift',
        endpoint('foundry_judgement_crucible', 70, 430, 'left'),
        endpoint('foundry_intake_rail', 890, 430, 'left'),
        {
          kind: 'shortcut',
          unlock: {
            type: 'flag',
            flag: 'shortcut_foundry_freightlift',
            reason: 'Le monte-charge doit être réactivé depuis le Creuset.',
            activation: { sectorId: 'foundry_judgement_crucible', x: 84, y: 430, label: 'Réactiver le monte-charge' },
          },
        },
      ),
    ],
  },
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const addError = (errors, path, message) => errors.push(`${path}: ${message}`);

const validatePoint = (errors, path, value, bounds, radius = 0) => {
  if (!isObject(value)) {
    addError(errors, path, 'point manquant ou invalide');
    return;
  }
  if (!isFiniteNumber(value.x) || value.x < radius || value.x > bounds.width - radius) {
    addError(errors, `${path}.x`, 'coordonnée hors limites');
  }
  if (!isFiniteNumber(value.y) || value.y < radius || value.y > bounds.height - radius) {
    addError(errors, `${path}.y`, 'coordonnée hors limites');
  }
};

const hasProgressFlag = (progress, flag) => {
  if (!flag) return false;
  if (progress instanceof Set) return progress.has(flag);
  const flags = progress?.flags ?? progress;
  if (flags instanceof Set) return flags.has(flag);
  return Boolean(flags && typeof flags === 'object' && flags[flag]);
};

export function isConnectionUnlocked(connectionData, progress = {}) {
  return !connectionData?.unlock || hasProgressFlag(progress, connectionData.unlock.flag);
}

export function getWorldLayout(regionId) {
  const layout = WORLD_LAYOUTS[regionId];
  if (!layout) throw new RangeError(`Région inconnue : ${String(regionId)}`);
  return layout;
}

export function getWorldSector(regionId, sectorId) {
  const layout = getWorldLayout(regionId);
  const found = layout.sectors.find(({ id }) => id === sectorId);
  if (!found) throw new RangeError(`Secteur inconnu dans ${regionId} : ${String(sectorId)}`);
  return found;
}

/**
 * Retourne des transitions déjà orientées depuis le secteur courant. Le jeu
 * peut afficher les sorties verrouillées sans dupliquer la logique des flags.
 */
export function getSectorTransitions(regionId, sectorId, progress = {}) {
  getWorldSector(regionId, sectorId);
  const layout = getWorldLayout(regionId);
  return Object.freeze(layout.connections.flatMap((link) => {
    let from;
    let to;
    let forward;

    if (link.from.sectorId === sectorId) {
      from = link.from;
      to = link.to;
      forward = true;
    } else if (link.bidirectional && link.to.sectorId === sectorId) {
      from = link.to;
      to = link.from;
      forward = false;
    } else {
      return [];
    }

    return [Object.freeze({
      connectionId: link.id,
      kind: link.kind,
      from,
      to,
      available: isConnectionUnlocked(link, progress),
      lockedReason: link.unlock?.reason || null,
      unlockFlag: link.unlock?.flag || null,
      requiresRegionalWins: forward ? (link.requiresRegionalWins || 0) : 0,
    })];
  }));
}

const reachableSectors = (region, flags) => {
  const visited = new Set([region.entrySectorId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const link of region.connections) {
      if (!isConnectionUnlocked(link, flags)) continue;
      if (visited.has(link.from.sectorId) && !visited.has(link.to.sectorId)) {
        visited.add(link.to.sectorId);
        changed = true;
      }
      if (link.bidirectional && visited.has(link.to.sectorId) && !visited.has(link.from.sectorId)) {
        visited.add(link.from.sectorId);
        changed = true;
      }
    }
  }

  return visited;
};

export function validateWorldLayouts(layouts = WORLD_LAYOUTS) {
  const errors = [];
  const totals = { regions: 0, sectors: 0, patrols: 0, events: 0, shortcuts: 0, residents: 0 };

  if (!isObject(layouts)) {
    return deepFreeze({ valid: false, errors: ['layouts: dictionnaire invalide'], totals });
  }

  const layoutIds = Object.keys(layouts);
  for (const requiredId of REGION_IDS) {
    if (!Object.hasOwn(layouts, requiredId)) addError(errors, 'layouts', `région obligatoire absente : ${requiredId}`);
  }
  for (const extraId of layoutIds.filter((id) => !REGION_IDS.includes(id))) {
    addError(errors, 'layouts', `région inattendue : ${extraId}`);
  }

  const globalIds = new Map();
  const globalFlags = new Map();
  const registerUnique = (registry, value, path, label) => {
    if (!isNonEmptyString(value)) {
      addError(errors, path, `${label} vide`);
      return;
    }
    if (registry.has(value)) addError(errors, path, `${label} dupliqué avec ${registry.get(value)} : ${value}`);
    else registry.set(value, path);
  };

  for (const [regionKey, region] of Object.entries(layouts)) {
    totals.regions += 1;
    const regionPath = `layouts.${regionKey}`;
    if (!isObject(region)) {
      addError(errors, regionPath, 'région invalide');
      continue;
    }
    if (region.id !== regionKey) addError(errors, `${regionPath}.id`, 'doit correspondre à la clé de région');
    if (!isNonEmptyString(region.name)) addError(errors, `${regionPath}.name`, 'nom manquant');
    if (!isObject(region.pacing) || !isFiniteNumber(region.pacing.targetMinutes) || region.pacing.targetMinutes < 20) {
      addError(errors, `${regionPath}.pacing.targetMinutes`, 'une expédition longue doit viser au moins 20 minutes');
    }

    if (!Array.isArray(region.sectors) || region.sectors.length < 3 || region.sectors.length > 5) {
      addError(errors, `${regionPath}.sectors`, 'doit contenir entre 3 et 5 secteurs');
      continue;
    }
    totals.sectors += region.sectors.length;

    const sectorById = new Map();
    for (const [sectorIndex, currentSector] of region.sectors.entries()) {
      const sectorPath = `${regionPath}.sectors[${sectorIndex}]`;
      if (!isObject(currentSector)) {
        addError(errors, sectorPath, 'secteur invalide');
        continue;
      }
      registerUnique(globalIds, currentSector.id, `${sectorPath}.id`, 'identifiant');
      if (sectorById.has(currentSector.id)) addError(errors, `${sectorPath}.id`, `secteur dupliqué : ${currentSector.id}`);
      else sectorById.set(currentSector.id, currentSector);

      if (!isNonEmptyString(currentSector.name)) addError(errors, `${sectorPath}.name`, 'nom manquant');
      if (!isNonEmptyString(currentSector.role)) addError(errors, `${sectorPath}.role`, 'rôle manquant');
      if (!isObject(currentSector.bounds)
        || currentSector.bounds.width !== VIEWPORT.width
        || currentSector.bounds.height !== VIEWPORT.height) {
        addError(errors, `${sectorPath}.bounds`, 'chaque secteur doit rester une carte 960 x 540 distincte');
      }
      const bounds = isObject(currentSector.bounds) ? currentSector.bounds : VIEWPORT;
      validatePoint(errors, `${sectorPath}.spawn`, currentSector.spawn, bounds);

      if (!Array.isArray(currentSector.obstacles) || currentSector.obstacles.length < 3) {
        addError(errors, `${sectorPath}.obstacles`, 'au moins trois obstacles sont requis');
      } else {
        for (const [obstacleIndex, currentObstacle] of currentSector.obstacles.entries()) {
          const obstaclePath = `${sectorPath}.obstacles[${obstacleIndex}]`;
          registerUnique(globalIds, currentObstacle?.id, `${obstaclePath}.id`, 'identifiant');
          if (!isFiniteNumber(currentObstacle?.x) || !isFiniteNumber(currentObstacle?.y)
            || !isFiniteNumber(currentObstacle?.w) || !isFiniteNumber(currentObstacle?.h)
            || currentObstacle.w <= 0 || currentObstacle.h <= 0
            || currentObstacle.x < 0 || currentObstacle.y < 0
            || currentObstacle.x + currentObstacle.w > bounds.width
            || currentObstacle.y + currentObstacle.h > bounds.height) {
            addError(errors, obstaclePath, 'rectangle hors limites ou invalide');
          }
        }
      }

      if (!Array.isArray(currentSector.patrols) || currentSector.patrols.length < 1) {
        addError(errors, `${sectorPath}.patrols`, 'au moins une patrouille est requise');
      } else {
        totals.patrols += currentSector.patrols.length;
        for (const [patrolIndex, currentPatrol] of currentSector.patrols.entries()) {
          const patrolPath = `${sectorPath}.patrols[${patrolIndex}]`;
          registerUnique(globalIds, currentPatrol?.id, `${patrolPath}.id`, 'identifiant');
          validatePoint(errors, patrolPath, currentPatrol, bounds);
          if (!isFiniteNumber(currentPatrol?.level) || currentPatrol.level < 1) addError(errors, `${patrolPath}.level`, 'niveau invalide');
          if (!Array.isArray(currentPatrol?.path) || currentPatrol.path.length < 2) {
            addError(errors, `${patrolPath}.path`, 'une patrouille doit avoir au moins deux points');
          } else {
            currentPatrol.path.forEach((pathPoint, pathIndex) => validatePoint(errors, `${patrolPath}.path[${pathIndex}]`, pathPoint, bounds));
          }
        }
      }

      if (!Array.isArray(currentSector.events)) {
        addError(errors, `${sectorPath}.events`, 'liste d’événements manquante');
      } else {
        totals.events += currentSector.events.length;
        for (const [eventIndex, currentEvent] of currentSector.events.entries()) {
          const eventPath = `${sectorPath}.events[${eventIndex}]`;
          registerUnique(globalIds, currentEvent?.id, `${eventPath}.id`, 'identifiant');
          registerUnique(globalFlags, currentEvent?.onceFlag, `${eventPath}.onceFlag`, 'flag');
          validatePoint(errors, `${eventPath}.trigger`, currentEvent?.trigger, bounds, currentEvent?.trigger?.radius || 0);
          if (!Array.isArray(currentEvent?.choices) || currentEvent.choices.length < 2) addError(errors, `${eventPath}.choices`, 'au moins deux choix sont requis');
        }
      }

      if (!Array.isArray(currentSector.residentSpawns)) {
        addError(errors, `${sectorPath}.residentSpawns`, 'liste de résidents manquante');
      } else {
        totals.residents += currentSector.residentSpawns.length;
        currentSector.residentSpawns.forEach((spawnData, spawnIndex) => {
          registerUnique(globalIds, `resident:${spawnData?.residentId}`, `${sectorPath}.residentSpawns[${spawnIndex}].residentId`, 'résident');
          validatePoint(errors, `${sectorPath}.residentSpawns[${spawnIndex}]`, spawnData, bounds);
        });
      }
    }

    const entry = sectorById.get(region.entrySectorId);
    const guardianSector = sectorById.get(region.guardianSectorId);
    const shardSector = sectorById.get(region.shardSectorId);
    if (!entry) addError(errors, `${regionPath}.entrySectorId`, 'secteur d’entrée introuvable');
    if (entry && entry.role !== 'entry') addError(errors, `${regionPath}.entrySectorId`, 'le secteur référencé doit avoir le rôle entry');
    if (!guardianSector) addError(errors, `${regionPath}.guardianSectorId`, 'sanctuaire du gardien introuvable');
    if (!shardSector) addError(errors, `${regionPath}.shardSectorId`, 'sanctuaire de l’Éclat introuvable');

    if (!Array.isArray(region.mainPath)
      || region.mainPath.length !== region.sectors.length
      || new Set(region.mainPath).size !== region.sectors.length
      || region.mainPath.some((sectorId) => !sectorById.has(sectorId))) {
      addError(errors, `${regionPath}.mainPath`, 'doit parcourir une fois chacun des secteurs');
    } else {
      if (region.mainPath[0] !== region.entrySectorId) addError(errors, `${regionPath}.mainPath`, 'doit commencer par le secteur d’entrée');
      const guardianIndex = region.mainPath.indexOf(region.guardianSectorId);
      const shardIndex = region.mainPath.indexOf(region.shardSectorId);
      if (guardianIndex < 0 || shardIndex !== guardianIndex + 1 || shardIndex !== region.mainPath.length - 1) {
        addError(errors, `${regionPath}.mainPath`, 'le gardien doit précéder immédiatement l’Éclat en fin de parcours');
      }
    }

    const guardianData = guardianSector?.guardian;
    if (guardianSector?.role !== 'guardian-sanctuary' || !isObject(guardianSector?.sanctuary) || !isObject(guardianData)) {
      addError(errors, `${regionPath}.guardianSectorId`, 'doit référencer un sanctuaire contenant un gardien');
    } else {
      registerUnique(globalIds, guardianData.id, `${regionPath}.guardian.id`, 'identifiant');
      registerUnique(globalFlags, guardianData.defeatFlag, `${regionPath}.guardian.defeatFlag`, 'flag');
      validatePoint(errors, `${regionPath}.guardian`, guardianData, guardianSector.bounds);
      registerUnique(globalIds, guardianSector.sanctuary.id, `${regionPath}.sanctuary.id`, 'identifiant');
      validatePoint(errors, `${regionPath}.sanctuary`, guardianSector.sanctuary, guardianSector.bounds, guardianSector.sanctuary.radius || 0);
    }

    const shardData = shardSector?.shard;
    if (shardSector?.role !== 'shard-sanctum' || !isObject(shardData)) {
      addError(errors, `${regionPath}.shardSectorId`, 'doit référencer un sanctuaire contenant un Éclat');
    } else {
      registerUnique(globalIds, shardData.id, `${regionPath}.shard.id`, 'identifiant');
      registerUnique(globalFlags, shardData.collectFlag, `${regionPath}.shard.collectFlag`, 'flag');
      validatePoint(errors, `${regionPath}.shard`, shardData, shardSector.bounds);
      if (guardianData && shardData.requiresFlag !== guardianData.defeatFlag) {
        addError(errors, `${regionPath}.shard.requiresFlag`, 'doit exiger la victoire contre le gardien');
      }
    }

    if (!Array.isArray(region.connections)) {
      addError(errors, `${regionPath}.connections`, 'liste de connexions manquante');
      continue;
    }

    const routePairs = new Set();
    for (const [connectionIndex, currentConnection] of region.connections.entries()) {
      const connectionPath = `${regionPath}.connections[${connectionIndex}]`;
      registerUnique(globalIds, currentConnection?.id, `${connectionPath}.id`, 'identifiant');
      if (!['route', 'shortcut'].includes(currentConnection?.kind)) addError(errors, `${connectionPath}.kind`, 'type de connexion invalide');
      if (currentConnection?.bidirectional !== true) addError(errors, `${connectionPath}.bidirectional`, 'les expéditions doivent permettre le retour');
      if (currentConnection?.requiresRegionalWins !== undefined
        && (!Number.isInteger(currentConnection.requiresRegionalWins) || currentConnection.requiresRegionalWins < 1)) {
        addError(errors, `${connectionPath}.requiresRegionalWins`, 'doit être un entier positif');
      }
      if (currentConnection?.kind === 'shortcut' && currentConnection?.requiresRegionalWins !== undefined) {
        addError(errors, `${connectionPath}.requiresRegionalWins`, 'un raccourci ne doit pas ajouter un verrou de victoires');
      }
      for (const endpointName of ['from', 'to']) {
        const endpointData = currentConnection?.[endpointName];
        const endpointSector = sectorById.get(endpointData?.sectorId);
        if (!endpointSector) addError(errors, `${connectionPath}.${endpointName}.sectorId`, 'secteur introuvable');
        else validatePoint(errors, `${connectionPath}.${endpointName}`, endpointData, endpointSector.bounds);
      }
      if (currentConnection?.from?.sectorId === currentConnection?.to?.sectorId) addError(errors, connectionPath, 'une connexion doit relier deux secteurs différents');

      if (currentConnection?.kind === 'route') {
        routePairs.add(`${currentConnection.from?.sectorId}->${currentConnection.to?.sectorId}`);
        routePairs.add(`${currentConnection.to?.sectorId}->${currentConnection.from?.sectorId}`);
      } else if (currentConnection?.kind === 'shortcut') {
        totals.shortcuts += 1;
        const activation = currentConnection?.unlock?.activation;
        if (!isNonEmptyString(currentConnection?.unlock?.flag) || !isObject(activation)) {
          addError(errors, `${connectionPath}.unlock`, 'un raccourci doit avoir un flag et une activation');
        } else {
          registerUnique(globalFlags, currentConnection.unlock.flag, `${connectionPath}.unlock.flag`, 'flag');
          const activationSector = sectorById.get(activation.sectorId);
          if (!activationSector) addError(errors, `${connectionPath}.unlock.activation.sectorId`, 'secteur introuvable');
          else validatePoint(errors, `${connectionPath}.unlock.activation`, activation, activationSector.bounds);
          if (![currentConnection.from.sectorId, currentConnection.to.sectorId].includes(activation.sectorId)) {
            addError(errors, `${connectionPath}.unlock.activation`, 'doit se trouver à une extrémité du raccourci');
          }
        }
      }
    }

    if (region.mainPath?.every((sectorId) => sectorById.has(sectorId))) {
      for (let index = 0; index < region.mainPath.length - 1; index += 1) {
        const fromId = region.mainPath[index];
        const toId = region.mainPath[index + 1];
        if (!routePairs.has(`${fromId}->${toId}`)) addError(errors, `${regionPath}.mainPath`, `route principale absente entre ${fromId} et ${toId}`);
      }

      const guardianIndex = region.mainPath.indexOf(region.guardianSectorId);
      const expectedProgressionGates = [
        { fromIndex: 0, toIndex: 1, wins: 2 },
        { fromIndex: guardianIndex - 1, toIndex: guardianIndex, wins: 5 },
      ];
      const regionalGates = region.connections.filter(({ requiresRegionalWins }) => requiresRegionalWins !== undefined);
      if (regionalGates.length !== expectedProgressionGates.length) {
        addError(errors, `${regionPath}.connections`, 'deux paliers de victoires régionales sont requis');
      }
      for (const gate of expectedProgressionGates) {
        const fromId = region.mainPath[gate.fromIndex];
        const toId = region.mainPath[gate.toIndex];
        const connectionData = region.connections.find((link) => (
          link.kind === 'route'
          && [link.from.sectorId, link.to.sectorId].includes(fromId)
          && [link.from.sectorId, link.to.sectorId].includes(toId)
        ));
        if (connectionData?.requiresRegionalWins !== gate.wins) {
          addError(errors, `${regionPath}.connections`, `la route ${fromId} → ${toId} doit exiger ${gate.wins} victoires régionales`);
          continue;
        }
        const availablePatrols = region.mainPath
          .slice(0, gate.fromIndex + 1)
          .reduce((count, sectorId) => count + (sectorById.get(sectorId)?.patrols?.length || 0), 0);
        if (availablePatrols < gate.wins) {
          addError(errors, `${regionPath}.connections`, `palier impossible avant ${toId} : ${availablePatrols} patrouilles pour ${gate.wins} victoires`);
        }
      }
    }

    const guardianGate = region.connections.find((link) => (
      link.kind === 'route'
      && [link.from.sectorId, link.to.sectorId].includes(region.guardianSectorId)
      && [link.from.sectorId, link.to.sectorId].includes(region.shardSectorId)
    ));
    if (!guardianGate || guardianGate.unlock?.flag !== guardianData?.defeatFlag) {
      addError(errors, `${regionPath}.connections`, 'la route vers l’Éclat doit être verrouillée par le gardien');
    }

    const beforeGuardian = reachableSectors(region, {});
    if (!beforeGuardian.has(region.guardianSectorId)) addError(errors, regionPath, 'le gardien doit être accessible depuis l’entrée');
    if (beforeGuardian.has(region.shardSectorId)) addError(errors, regionPath, 'l’Éclat est accessible avant la victoire contre le gardien');
    if (guardianData) {
      const afterGuardian = reachableSectors(region, { [guardianData.defeatFlag]: true });
      if (afterGuardian.size !== sectorById.size) addError(errors, regionPath, 'tous les secteurs doivent être accessibles après le gardien');
    }

    const regionEventCount = region.sectors.reduce((count, item) => count + (item.events?.length || 0), 0);
    const regionShortcutCount = region.connections.filter(({ kind }) => kind === 'shortcut').length;
    if (regionEventCount < 1) addError(errors, regionPath, 'au moins un événement de région est requis');
    if (regionShortcutCount < 1) addError(errors, regionPath, 'au moins un raccourci est requis');
  }

  if (totals.residents !== 12) addError(errors, 'layouts', `les douze habitants doivent être distribués dans le monde (reçu : ${totals.residents})`);

  return deepFreeze({ valid: errors.length === 0, errors, totals });
}
