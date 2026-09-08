const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const node = (id, sectorId, sectorName, x, y, label, lines) => ({
  id,
  sectorId,
  sectorName,
  x,
  y,
  radius: 48,
  label,
  lines,
});

const conclusion = (id, label, outcome, reward, lines) => ({ id, label, outcome, reward, lines });

/**
 * Quatre récits facultatifs transforment les décisions d'expédition en longs
 * voyages de retour. Ils ne verrouillent jamais la campagne principale : un
 * choix découvert, son habitant recruté et deux traces à retrouver suffisent.
 */
export const REGIONAL_CHRONICLES = deepFreeze({
  convoy_names: {
    id: 'convoy_names',
    title: 'LE CONVOI DES NOMS',
    region: 'wastes',
    regionName: 'Friches du Portail',
    giverId: 'brakk',
    giverName: 'BRAKK-9',
    service: 'forge',
    sourceEventId: 'wastes_caravan_blackbox',
    sourceEventTitle: 'Le Convoi sans destination',
    intro: [
      'Le choix pris devant l’enregistreur a laissé une fréquence que la route refuse d’oublier.',
      'Retourne à la Chute du Portail, puis jusqu’au Cratère. Si deux balises répondent encore, je pourrai forger une place à ces voix dans la cité.',
    ],
    sourceBranches: {
      restore_beacon: {
        intro: [
          'Tu as rallumé la balise du convoi. Depuis, elle prononce des noms au lieu d’indiquer une destination.',
          'Retourne à la Chute du Portail, puis jusqu’au Cratère. Deux relais devraient suffire pour offrir une place durable à ces voix dans la cité.',
        ],
      },
      salvage_core: {
        intro: [
          'Tu as démonté l’enregistreur, mais le noyau rapporté conserve la cadence des noms qu’il protégeait.',
          'La boîte noire n’existe plus. Cherche ses deux fréquences résiduelles, de la Chute du Portail jusqu’au Cratère, et nous forgerons ce qui peut encore être transmis.',
        ],
      },
    },
    nodes: [
      node('convoy_gate_echo', 'wastes_gatefall', 'Chute du Portail', 480, 185, 'Écouter la balise d’arrivée', [
        'Sous l’arche rompue, une balise énumère les voyageurs arrivés à Nox Arca avant le Grand Silence.',
        'Votre partenaire ajoute son souffle au signal. Une seconde fréquence répond depuis le Cratère de Mémoire.',
      ]),
      node('convoy_crater_echo', 'wastes_memory_crater', 'Cratère de Mémoire', 480, 430, 'Recueillir la dernière fréquence', [
        'La poussière remonte autour d’une plaque où chaque nom a été rayé, sauf ceux portés par la fréquence extraite du convoi.',
        'Les voix forment enfin un chœur stable. Brakk-9 peut maintenant décider quelle matière leur donner.',
      ]),
    ],
    choices: [
      conclusion('memorial_steel', 'Forger un mémorial vivant', 'Les noms vibrent dans l’acier de la Forge.', { credits: 110, inventory: { scrap: 2 }, bond: 4, morale: 3 }, [
        'Brakk-9 mêle les deux fréquences à une arche neuve. Chaque coup de marteau rend un nom audible dans Nox Arca.',
        'La Forge devient aussi un mémorial : aucune reconstruction ne pourra prétendre que la cité a commencé aujourd’hui.',
      ]),
      conclusion('road_compass', 'Forger une boussole de route', 'La Forge guide les convois encore perdus.', { credits: 160, inventory: { scrap: 1 }, discipline: 4, morale: 2 }, [
        'Brakk-9 enferme les voix dans une boussole qui pointe vers les portes sûres plutôt que vers le nord.',
        'Le premier convoi n’est pas revenu, mais les suivants sauront désormais trouver la cité.',
      ]),
    ],
  },
  remembering_seed: {
    id: 'remembering_seed',
    title: 'LA GRAINE QUI SE SOUVIENT',
    region: 'hive',
    regionName: 'Bio-Ruche de Verdance',
    giverId: 'mycella',
    giverName: 'MYCELLA',
    service: 'greenhouse',
    sourceEventId: 'hive_canopy_memory_bloom',
    sourceEventTitle: 'La Fleur qui se souvient',
    intro: [
      'La mémoire de cette fleur a voyagé jusque dans mes racines. Elle cherche un sol qui ne l’utilisera pas comme un outil.',
      'Écoute la Gueule-Racine, puis le Cœur Symbiotique. Nous saurons alors si sa descendance doit pousser seule ou parmi nous.',
    ],
    sourceBranches: {
      share_memory: {
        intro: [
          'En partageant la peur de la fleur, tu lui as appris qu’une mémoire peut circuler sans être dévorée.',
          'Écoute maintenant la Gueule-Racine, puis le Cœur Symbiotique. Nous saurons si sa descendance souhaite rejoindre ce partage.',
        ],
      },
      prune_memory: {
        intro: [
          'Tu as taillé la fleur pour protéger la Ruche. Les spores recueillies ont pourtant conservé une mémoire calme, distincte de sa douleur.',
          'Présente cette trace à la Gueule-Racine puis au Cœur Symbiotique. Sa descendance devra pouvoir pousser sans reproduire ce qui fut coupé.',
        ],
      },
    },
    nodes: [
      node('seed_root_pulse', 'hive_rootmouth', 'Gueule-Racine', 480, 400, 'Accorder la racine ancienne', [
        'La racine reconnaît la mémoire de la fleur et révèle qu’elle fut créée pour absorber la peur des jeunes Échos.',
        'Une graine se détache sans mourir. Son rythme indique le Cœur Symbiotique.',
      ]),
      node('seed_core_pulse', 'hive_symbiotic_core', 'Cœur Symbiotique', 480, 430, 'Présenter la graine au réseau', [
        'Le réseau offre à la graine mille souvenirs, mais attend votre consentement avant de refermer ses veines sur elle.',
        'Vous ramenez cette hésitation féconde à Mycella : la cité devra choisir une manière de cultiver la mémoire.',
      ]),
    ],
    choices: [
      conclusion('shared_garden', 'Ouvrir un jardin partagé', 'La Serre échange ses souvenirs avec la Ruche.', { credits: 90, inventory: { ration: 4, medgel: 2 }, bond: 5, morale: 3 }, [
        'Mycella plante la graine au centre d’un cercle ouvert. Habitants et partenaire peuvent lui confier une peur sans la perdre.',
        'La Serre nourrit désormais les corps et les récits qui leur permettent de tenir.',
      ]),
      conclusion('quiet_seedbank', 'Préserver une banque de graines', 'La Serre protège les mémoires fragiles.', { credits: 120, inventory: { spore: 3, coreSeed: 1 }, discipline: 3, morale: 2 }, [
        'Mycella sépare soigneusement les graines afin qu’aucune conscience collective ne les engloutisse.',
        'La Serre conserve une réserve vivante pour les jours où Nox Arca devra recommencer sans se répéter.',
      ]),
    ],
  },
  three_bells: {
    id: 'three_bells',
    title: 'LES TROIS GLAS',
    region: 'fog',
    regionName: 'Cathédrale de Brume',
    giverId: 'bellgrave',
    giverName: 'BELLGRAVE',
    service: 'training',
    sourceEventId: 'fog_mirror_lost_name',
    sourceEventTitle: 'Le Nom derrière le verre',
    intro: [
      'Le nom du miroir a fait sonner deux cloches, mais la troisième refuse de répondre. Ce silence n’est pas une absence : c’est un choix inachevé.',
      'Traverse la Nef Noyée et gagne l’Abside du Voile. Rapporte-moi ce que le premier et le dernier glas disent de cette voix.',
    ],
    sourceBranches: {
      carry_name: {
        intro: [
          'Le nom que tu as porté jusqu’à Nox Arca a fait sonner deux cloches. La troisième attend de savoir quelle place cette voix choisira.',
          'Traverse la Nef Noyée et gagne l’Abside du Voile. Rapporte-moi ce que le premier et le dernier glas disent de son geste.',
        ],
      },
      release_name: {
        intro: [
          'Tu as rendu le nom à la Brume. Deux cloches ont néanmoins conservé le geste de cette voix sans retenir son identité.',
          'Traverse la Nef Noyée et gagne l’Abside du Voile. La troisième cloche devra offrir un passage, jamais reprendre ce que tu as libéré.',
        ],
      },
    },
    nodes: [
      node('bells_nave_tone', 'fog_drowned_nave', 'Nef Noyée', 480, 390, 'Réveiller le premier glas', [
        'Le premier glas ne prononce aucun nom. Il restitue le bruit d’une porte tenue ouverte pendant que les autres fuyaient.',
        'Votre partenaire soutient la note jusqu’à ce qu’une réponse traverse toute la Cathédrale.',
      ]),
      node('bells_apse_tone', 'fog_veil_apse', 'Abside du Voile', 480, 430, 'Écouter le dernier glas', [
        'Le dernier glas révèle une voix qui ne demande ni statue ni oubli, seulement que son geste puisse encore guider quelqu’un.',
        'Bellgrave attend à Nox Arca. La troisième cloche sonnera selon la forme donnée à ce souvenir.',
      ]),
    ],
    choices: [
      conclusion('ring_the_name', 'Ouvrir la cloche au nom', 'Le Dojo offre un refuge sonore aux voix absentes.', { credits: 120, inventory: { incense: 2 }, bond: 5, morale: 5 }, [
        'Bellgrave ne grave rien de force. La troisième cloche offre au nom un refuge sonore ; la voix choisit elle-même d’y répondre.',
        'À chaque entraînement, le Dojo fait entendre une voix que la Brume ne peut plus confisquer.',
      ]),
      conclusion('ring_the_deed', 'Faire sonner le geste', 'Le Dojo transmet une veille sans propriétaire.', { credits: 145, inventory: { ether: 2 }, discipline: 4, fatigue: -14 }, [
        'Bellgrave laisse la cloche sans nom, mais règle sa vibration sur le battement de la porte autrefois gardée.',
        'Nox Arca n’impose pas une identité au disparu ; elle conserve ce qu’il a choisi de protéger.',
      ]),
    ],
  },
  last_watch: {
    id: 'last_watch',
    title: 'LA DERNIÈRE RONDE',
    region: 'foundry',
    regionName: 'Fonderie des Veilleurs',
    giverId: 'coiljack',
    giverName: 'COILJACK',
    service: 'shop',
    sourceEventId: 'foundry_mills_worker_protocol',
    sourceEventTitle: 'Le Poste resté ouvert',
    intro: [
      'La signature du dernier quart circule encore dans mes câbles. Quelqu’un a gardé ces machines éveillées pour une relève qui n’est jamais venue.',
      'Vérifie le Rail d’Admission puis la Chambre du Veilleur. Nous déciderons ensuite si ce protocole doit enfin se reposer ou changer de maître.',
    ],
    sourceBranches: {
      finish_shift: {
        intro: [
          'En achevant le dernier quart, tu as prouvé que le Veilleur était resté par choix, pas parce qu’une machine le retenait.',
          'Vérifie le Rail d’Admission puis la Chambre du Veilleur. Nous pourrons enfin donner une relève honnête à son protocole.',
        ],
      },
      forge_signature: {
        intro: [
          'Ta signature détournée a ouvert la route, mais le faux a révélé une anomalie : le Veilleur renouvelait volontairement son propre quart.',
          'Vérifie le Rail d’Admission puis la Chambre du Veilleur. Nous séparerons ce consentement ancien du protocole que tu as contourné.',
        ],
      },
    },
    nodes: [
      node('watch_rail_stamp', 'foundry_intake_rail', 'Rail d’Admission', 480, 365, 'Lire le registre d’admission', [
        'Le registre confirme qu’aucun ordre n’obligeait le Veilleur à rester. Sa ronde fut renouvelée volontairement, heure après heure.',
        'Une dernière validation subsiste dans la Chambre du Veilleur.',
      ]),
      node('watch_vault_stamp', 'foundry_overseer_vault', 'Chambre du Veilleur', 480, 430, 'Ouvrir le dernier registre', [
        'Le dernier registre ne contient pas une liste d’intrus, mais les trajectoires de tous ceux que le Veilleur a laissés sortir.',
        'Coiljack peut rendre ces protocoles à la Fonderie ou les adapter à une cité fondée sur le choix.',
      ]),
    ],
    choices: [
      conclusion('free_the_watch', 'Libérer les protocoles', 'Le Bazar a offert une fin aux anciennes rondes.', { credits: 170, inventory: { scrap: 2, coreSeed: 1 }, bond: 3, morale: 5 }, [
        'Coiljack envoie un ordre que la Fonderie n’avait jamais reçu : QUART TERMINÉ. Les machines s’arrêtent une seconde entière.',
        'Le Bazar conserve le registre, non comme propriété, mais comme preuve qu’un protocole peut choisir sa fin.',
      ]),
      conclusion('city_watch', 'Confier la veille à la cité', 'Le Bazar entretient une ronde consentie.', { credits: 220, inventory: { scrap: 3 }, discipline: 5, morale: 2 }, [
        'Coiljack réécrit la ronde : chaque Veilleur peut la quitter, chaque habitant peut volontairement prendre le relais.',
        'Le protocole ne surveille plus une usine vide. Il protège les arrivées de Nox Arca sans enfermer ses départs.',
      ]),
    ],
  },
});

export const CHRONICLE_IDS = Object.freeze(Object.keys(REGIONAL_CHRONICLES));
export const MAX_CHRONICLE_PROGRESS = 4;
export const CHRONICLE_CHOICE_IDS = deepFreeze(Object.fromEntries(CHRONICLE_IDS.map((id) => [
  id,
  REGIONAL_CHRONICLES[id].choices.map((choice) => choice.id),
])));

export function isChronicleChoiceId(chronicleId, choiceId) {
  return Object.prototype.hasOwnProperty.call(CHRONICLE_CHOICE_IDS, chronicleId)
    && CHRONICLE_CHOICE_IDS[chronicleId].includes(choiceId);
}

const progressOf = (chronicle, state) => {
  const value = Number(state?.chronicleProgress?.[chronicle.id] || 0);
  return Number.isInteger(value) && value >= 0 && value <= MAX_CHRONICLE_PROGRESS ? value : 0;
};

export function getChronicleSourceChoice(chronicle, state) {
  if (!chronicle || !REGIONAL_CHRONICLES[chronicle.id]) return null;
  const branches = chronicle.sourceBranches || {};
  const current = state?.expeditionChoices?.[chronicle.sourceEventId];
  if (Object.prototype.hasOwnProperty.call(branches, current)) return current;
  const inherited = state?.cycleEchoes?.[chronicle.sourceEventId];
  return Object.prototype.hasOwnProperty.call(branches, inherited) ? inherited : null;
}

export function getChronicleIntro(chronicle, state) {
  if (!chronicle || !REGIONAL_CHRONICLES[chronicle.id]) return Object.freeze([]);
  const sourceChoice = getChronicleSourceChoice(chronicle, state);
  return chronicle.sourceBranches?.[sourceChoice]?.intro || chronicle.intro;
}

export function getChronicleByService(service) {
  return Object.values(REGIONAL_CHRONICLES).find((chronicle) => chronicle.service === service) || null;
}

export function getChronicleStatus(chronicle, state) {
  if (!chronicle || !REGIONAL_CHRONICLES[chronicle.id]) return null;
  const sourceChoice = getChronicleSourceChoice(chronicle, state);
  const progress = sourceChoice ? progressOf(chronicle, state) : 0;
  const giverRecruited = Boolean(state?.recruited?.includes?.(chronicle.giverId));
  const conclusionId = state?.chronicleChoices?.[chronicle.id] || null;
  const conclusionChoice = chronicle.choices.find(({ id }) => id === conclusionId) || null;
  let status = 'undiscovered';
  if (progress === MAX_CHRONICLE_PROGRESS && conclusionChoice) status = 'complete';
  else if (progress === MAX_CHRONICLE_PROGRESS - 1) status = 'ready';
  else if (progress > 0) status = 'active';
  else if (sourceChoice && giverRecruited) status = 'available';
  else if (sourceChoice) status = 'giver-missing';
  return Object.freeze({
    id: chronicle.id,
    status,
    progress,
    sourceChoice,
    giverRecruited,
    conclusion: conclusionChoice,
  });
}

export function getChronicleNode(chronicle, state) {
  const status = getChronicleStatus(chronicle, state);
  if (!status || status.status !== 'active') return null;
  return chronicle.nodes[status.progress - 1] || null;
}

export function getChronicleObjective(chronicle, state) {
  const status = getChronicleStatus(chronicle, state);
  if (!status) return '';
  if (status.status === 'complete') return `Chronique achevée · ${status.conclusion.outcome}`;
  if (status.status === 'ready') return `Retourner auprès de ${chronicle.giverName} à Nox Arca`;
  if (status.status === 'active') {
    const currentNode = getChronicleNode(chronicle, state);
    return `${currentNode.label} · ${currentNode.sectorName}`;
  }
  if (status.status === 'available') return `Confier ${chronicle.sourceEventTitle} à ${chronicle.giverName}`;
  if (status.status === 'giver-missing') return `Retrouver ${chronicle.giverName} pour interpréter cette mémoire`;
  return `Découvrir ${chronicle.sourceEventTitle} dans ${chronicle.regionName}`;
}
