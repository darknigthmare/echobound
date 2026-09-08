import {
  consumeGuard,
  getTechniqueProfile,
  resolveFinalBossDamage,
  resolveTechnique,
  resolveUnison,
} from './combat-rules.js';
import {
  REGION_IDS,
  WORLD_LAYOUTS,
  getSectorTransitions,
  getWorldLayout,
} from './world-layouts.js';
import { buildExpeditionAtlas } from './expedition-atlas.js';
import {
  CHRONICLE_IDS,
  MAX_CHRONICLE_PROGRESS,
  REGIONAL_CHRONICLES,
  getChronicleByService,
  getChronicleIntro,
  getChronicleNode,
  getChronicleObjective,
  getChronicleSourceChoice,
  getChronicleStatus,
  isChronicleChoiceId,
} from './regional-chronicles.js';
import {
  getObstacleVisual,
  getSectorVisualSignature,
} from './sector-visuals.js';
import {
  CYCLE_LAWS,
  createNextCyclePlan,
  evaluateEvolution,
  getCycleScaling,
} from './progression-rules.js';
import {
  AudioDirector,
  emitAmbientTone,
} from './audio-director.js';
import {
  SAVE_VALUE_LIMITS,
  boundedInteger,
  boundedNumber,
  boundedString,
  escapeHtml,
  sanitizeBooleanRecord,
  sanitizeChoiceRecord,
  sanitizeNumberRecord,
  safeIdentifier,
  strictBoolean,
} from './save-schema.js';

(() => {
  'use strict';

  const SaveSystem = globalThis.ECHOboundSaveSystem;
  if (!SaveSystem) throw new Error('Le module de sauvegarde ECHObound est indisponible.');
  const {
    SAVE_VERSION: VERSION,
    SAVE_KEY,
    BACKUP_KEYS: BACKUP_SAVE_KEYS,
    LEGACY_SAVE_KEYS,
    createSaveStore,
  } = SaveSystem;
  const BACKUP_SAVE_KEY = BACKUP_SAVE_KEYS[0];
  const ACCESSIBILITY_KEY = 'echobound_accessibility_v2';
  // Un navigateur peut refuser jusqu'au getter localStorage. L'onglet reste exportable en mémoire.
  const gameStorage = (() => {
    const memory = new Map();
    let persistent = true;
    let backing = null;
    const unavailable = () => { persistent = false; };
    try { backing = globalThis.localStorage; } catch { unavailable(); }
    if (!backing) unavailable();
    return {
      get persistent() { return persistent; },
      useMemory() { unavailable(); },
      getItem(key) {
        if (persistent) {
          try {
            const value = backing.getItem(key);
            if (value === null) memory.delete(key); else memory.set(key, String(value));
            return value;
          } catch { unavailable(); }
        }
        return memory.get(key) ?? null;
      },
      setItem(key, value) {
        const text = String(value);
        if (persistent) {
          // Une écriture échouée doit laisser le stockage accessible au rollback transactionnel.
          backing.setItem(key, text);
        }
        memory.set(key, text);
      },
      removeItem(key) {
        if (persistent) {
          backing.removeItem(key);
        }
        memory.delete(key);
      },
    };
  })();
  const W = 960;
  const H = 540;
  const TAU = Math.PI * 2;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => Math.random() * (max - min) + min;
  const irand = (min, max) => Math.floor(rand(min, max + 1));
  const chance = (probability) => Math.random() < probability;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
  const pct = (value, max) => `${clamp((value / Math.max(1, max)) * 100, 0, 100)}%`;
  const DEFAULT_SETTINGS = Object.freeze({
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
    highContrast: false,
    largeText: false,
  });

  function readAccessibilitySettings() {
    try {
      const parsed = JSON.parse(gameStorage.getItem(ACCESSIBILITY_KEY) || '{}');
      return {
        reducedMotion: Boolean(parsed.reducedMotion ?? DEFAULT_SETTINGS.reducedMotion),
        highContrast: Boolean(parsed.highContrast),
        largeText: Boolean(parsed.largeText),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistAccessibilitySettings(settings) {
    const serialized = JSON.stringify({
      reducedMotion: Boolean(settings.reducedMotion),
      highContrast: Boolean(settings.highContrast),
      largeText: Boolean(settings.largeText),
    });
    try {
      gameStorage.setItem(ACCESSIBILITY_KEY, serialized);
    } catch {
      gameStorage.useMemory();
      gameStorage.setItem(ACCESSIBILITY_KEY, serialized);
      // Preferences remain active for the session when storage is unavailable.
    }
  }

  function seededNoise(seed) {
    let value = Math.sin(seed * 999.91) * 43758.5453;
    return value - Math.floor(value);
  }

  function formatTime(totalMinutes) {
    const day = Math.floor(totalMinutes / 1440) + 1;
    const minuteOfDay = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = Math.floor(minuteOfDay % 60);
    return { day, hours, minutes, label: `Jour ${day} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
  }

  function circleRectCollision(x, y, radius, rect) {
    const nearestX = clamp(x, rect.x, rect.x + rect.w);
    const nearestY = clamp(y, rect.y, rect.y + rect.h);
    return Math.hypot(x - nearestX, y - nearestY) < radius;
  }

  function roundRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const normalized = hex.replace('#', '');
    const bigint = parseInt(normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const DOM = {
    canvas: document.getElementById('game'),
    hud: document.getElementById('hud'),
    partnerName: document.getElementById('partner-name'),
    partnerForm: document.getElementById('partner-form'),
    hpBar: document.getElementById('hp-bar'),
    hpText: document.getElementById('hp-text'),
    mpBar: document.getElementById('mp-bar'),
    mpText: document.getElementById('mp-text'),
    levelText: document.getElementById('level-text'),
    bondText: document.getElementById('bond-text'),
    needText: document.getElementById('need-text'),
    mapName: document.getElementById('map-name'),
    clockText: document.getElementById('clock-text'),
    cityText: document.getElementById('city-text'),
    objectiveText: document.getElementById('objective-text'),
    prompt: document.getElementById('prompt'),
    promptKey: document.getElementById('prompt-key'),
    promptText: document.getElementById('prompt-text'),
    toast: document.getElementById('toast'),
    screenReaderStatus: document.getElementById('screen-reader-status'),
    dialogue: document.getElementById('dialogue'),
    dialogueSpeaker: document.getElementById('dialogue-speaker'),
    dialogueText: document.getElementById('dialogue-text'),
    dialogueChoices: document.getElementById('dialogue-choices'),
    dialogueSkip: document.getElementById('dialogue-skip'),
    menu: document.getElementById('menu'),
    menuTabs: document.getElementById('menu-tabs'),
    menuContent: document.getElementById('menu-content'),
    saveFileInput: document.getElementById('save-file-input'),
    service: document.getElementById('service'),
    serviceKicker: document.getElementById('service-kicker'),
    serviceTitle: document.getElementById('service-title'),
    serviceDescription: document.getElementById('service-description'),
    serviceContent: document.getElementById('service-content'),
    battleUi: document.getElementById('battle-ui'),
    battleLog: document.getElementById('battle-log'),
    battleAllyName: document.getElementById('battle-ally-name'),
    battleAllyHp: document.getElementById('battle-ally-hp'),
    battleAllyStatus: document.getElementById('battle-ally-status'),
    battleEnemyName: document.getElementById('battle-enemy-name'),
    battleEnemyHp: document.getElementById('battle-enemy-hp'),
    battleEnemyStatus: document.getElementById('battle-enemy-status'),
    battleCommands: document.getElementById('battle-commands'),
    title: document.getElementById('title-screen'),
    newGame: document.getElementById('new-game'),
    continueGame: document.getElementById('continue-game'),
    credits: document.getElementById('credits-button'),
    accessibilityButton: document.getElementById('accessibility-button'),
    accessibilityPanel: document.getElementById('accessibility-panel'),
    accessibilityClose: document.getElementById('accessibility-close'),
    starter: document.getElementById('starter-screen'),
    starterCards: document.getElementById('starter-cards'),
    starterBack: document.getElementById('starter-back'),
    ending: document.getElementById('ending-screen'),
    endingCopy: document.getElementById('ending-copy'),
    endingStats: document.getElementById('ending-stats'),
    continueAfterEnding: document.getElementById('continue-after-ending'),
    newCycle: document.getElementById('new-cycle'),
    mute: document.getElementById('mute-button'),
    fullscreen: document.getElementById('fullscreen-button'),
    touchAction: document.getElementById('touch-action'),
    touchMenu: document.getElementById('touch-menu'),
  };

  const ctx = DOM.canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const STARTERS = [
    {
      id: 'feral',
      name: 'NOCTE',
      form: 'MOTE PRÉDATEUR',
      formId: 'mote_feral',
      accent: '#ff7fa8',
      glyph: '◆',
      style: 'feral',
      description: 'Une créature nerveuse née dans les conduits du Nexus. Elle frappe vite, adore la chasse et déteste attendre les ordres trop longtemps.',
      strengths: ['Puissance et vitesse', 'Critiques fréquents', 'Évolutions bestiales'],
      stats: { power: 14, guard: 8, spirit: 7, speed: 13 },
      technique: 'Morsure de Faille',
    },
    {
      id: 'aegis',
      name: 'BASTION',
      form: 'GERME-CARAPACE',
      formId: 'mote_aegis',
      accent: '#8bf0b2',
      glyph: '⬢',
      style: 'shell',
      description: 'Un organisme minéral qui se nourrit des chocs. Lent mais discipliné, il protège son maître et transforme la douleur en énergie.',
      strengths: ['Défense supérieure', 'Obéissance stable', 'Évolutions colossales'],
      stats: { power: 10, guard: 15, spirit: 8, speed: 7 },
      technique: 'Onde de Rempart',
    },
    {
      id: 'veil',
      name: 'VESPER',
      form: 'LUCIOLE DU VOILE',
      formId: 'mote_veil',
      accent: '#b394ff',
      glyph: '✦',
      style: 'wing',
      description: 'Un écho sensible aux souvenirs et aux émotions. Fragile au départ, mais capable d’altérer l’espace et de soigner le lien qui vous unit.',
      strengths: ['Esprit et techniques', 'Lien rapide', 'Évolutions astrales'],
      stats: { power: 7, guard: 8, spirit: 15, speed: 11 },
      technique: 'Rayon Mnémique',
    },
  ];

  const FORMS = {
    mote_feral: { name: 'MOTE PRÉDATEUR', style: 'feral', stage: 1, color: '#ff7fa8', technique: 'Morsure de Faille' },
    mote_aegis: { name: 'GERME-CARAPACE', style: 'shell', stage: 1, color: '#8bf0b2', technique: 'Onde de Rempart' },
    mote_veil: { name: 'LUCIOLE DU VOILE', style: 'wing', stage: 1, color: '#b394ff', technique: 'Rayon Mnémique' },
    riftclaw: { name: 'GRIFFE-FAILLE', style: 'feral', stage: 2, color: '#ff6d96', technique: 'Ravage Dimensionnel' },
    ironhide: { name: 'CUIRASSE ABYSSALE', style: 'shell', stage: 2, color: '#72efb1', technique: 'Bélier Sismique' },
    veilwing: { name: 'PHALÈNE ORACLE', style: 'wing', stage: 2, color: '#ba93ff', technique: 'Poussière du Songe' },
    nexusfox: { name: 'RENARD DU NEXUS', style: 'mystic', stage: 2, color: '#8de7ff', technique: 'Arc de Convergence' },
    dreadmaw: { name: 'GUEULE D’ÉCLIPSE', style: 'dread', stage: 3, color: '#ff5d79', technique: 'Dévoration du Zénith' },
    cathedral: { name: 'TITAN-CATHÉDRALE', style: 'titan', stage: 3, color: '#8bf0b2', technique: 'Jugement Monolithique' },
    seraph: { name: 'SÉRAPHIN DU VOILE', style: 'seraph', stage: 3, color: '#c5a2ff', technique: 'Chœur des Mondes Morts' },
    sovereign: { name: 'SOUVERAIN DES ÉCHOS', style: 'sovereign', stage: 3, color: '#8de7ff', technique: 'Unisson Absolu' },
  };

  const ITEMS = {
    ration: { name: 'Ration organique', icon: '◒', description: 'Réduit la faim de 35 et améliore légèrement le moral.', price: 28, usable: true },
    medgel: { name: 'Gel de réparation', icon: '+', description: 'Restaure 55 PV, même pendant un combat.', price: 45, usable: true },
    ether: { name: 'Condensat d’écho', icon: '✧', description: 'Restaure 40 PE au partenaire.', price: 52, usable: true },
    stimulant: { name: 'Stimulant de veille', icon: '↯', description: 'Réduit la fatigue de 35. À ne pas surutiliser.', price: 60, usable: true },
    spore: { name: 'Spore luminescente', icon: '●', description: 'Composant vivant récolté dans la Bio-Ruche.', price: 18, usable: false },
    scrap: { name: 'Alliage mémoriel', icon: '⬡', description: 'Métal chargé de souvenirs, utile à la forge et à certaines recrues.', price: 22, usable: false },
    incense: { name: 'Encens du Voile', icon: '≈', description: 'Apaise le partenaire : +12 lien, +15 moral.', price: 70, usable: true },
    coreSeed: { name: 'Graine de Cœur', icon: '✺', description: 'Catalyseur rare utilisé pour les plus hautes améliorations de la cité.', price: 0, usable: false },
  };

  // The Core stocks essential expedition provisions only; recruited services keep
  // their crafting, advanced inventory and resale roles.
  const CORE_SUPPLIES = Object.freeze(['ration', 'medgel', 'ether']);

  const RESIDENTS = {
    brakk: {
      id: 'brakk', name: 'BRAKK-9', title: 'Forgeron des Carcasses', map: 'wastes', x: 705, y: 170,
      service: 'forge', building: 'forge', score: 10, style: 'feral', color: '#ff9a72', level: 2,
      intro: [
        'Tu viens d’une cité qui ne sait plus faire de bruit. Les cités silencieuses finissent mangées.',
        'Encaisse trois de mes coups sans détourner les yeux. Si ton écho tient, ma forge tiendra avec lui.',
      ],
      recruit: 'Bon. Ce n’est pas de l’acier que je cherchais, mais une raison de le battre. Je rentre à Nox Arca.',
      hint: 'Dans les Friches du Portail. Il cherche un adversaire capable d’encaisser.',
    },
    mnemo: {
      id: 'mnemo', name: 'MNÉMO-0', title: 'Archiviste Ossuaire', map: 'wastes', x: 150, y: 150,
      service: 'archive', building: 'archive', score: 10, style: 'drone', color: '#8de7ff', level: 2,
      requires: (g) => g.state.flags.shard_wastes,
      blocked: 'Je ne combats pas les mémoires vides. Retrouve l’Éclat mnémique des Friches, puis reviens.',
      intro: ['Tu portes enfin une mémoire étrangère. Voyons si tu sais la défendre lorsque quelqu’un tente de l’arracher.'],
      recruit: 'Index validé. Je transporterai les archives dans ta cité et j’y consignerai chaque créature retrouvée.',
      hint: 'Elle attend près des antennes brisées et réclame l’Éclat des Friches.',
    },
    pylon: {
      id: 'pylon', name: 'PYLÔNE-K', title: 'Serpent des Portes', map: 'wastes', x: 800, y: 390,
      service: 'transit', building: 'transit', score: 10, style: 'serpent', color: '#79d8ff', level: 3,
      requires: (g) => g.getCityScore() >= 10,
      blocked: 'Ton foyer ne génère pas encore assez d’écho. Ramène au moins une âme à Nox Arca.',
      intro: ['Je connais toutes les portes, mais aucune destination ne mérite mon obéissance. Prouve que la tienne existe réellement.'],
      recruit: 'Trajectoire reconnue : NOX ARCA. Je rétablirai les raccourcis entre les territoires.',
      hint: 'Au sud-est des Friches. Il ne suit que les cités déjà capables d’attirer une première recrue.',
    },
    mycella: {
      id: 'mycella', name: 'MYCELLA', title: 'Jardinière Symbiotique', map: 'hive', x: 165, y: 390,
      service: 'greenhouse', building: 'greenhouse', score: 10, style: 'fungus', color: '#bcff8d', level: 4,
      requires: (g) => (g.state.inventory.spore || 0) >= 3,
      blocked: 'Ta présence sent le métal mort. Apporte-moi trois spores luminescentes ; alors je croirai que tu sais nourrir le vivant.',
      consume: { spore: 3 },
      intro: ['Les spores t’acceptent. Moi, pas encore. Une symbiose ne se demande pas : elle se prouve.'],
      recruit: 'Tes coups savent s’arrêter avant de devenir cruauté. Je ferai pousser de quoi nourrir la cité et ton compagnon.',
      hint: 'Au sud-ouest de la Bio-Ruche. Elle exige trois spores luminescentes.',
    },
    vespera: {
      id: 'vespera', name: 'VESPERA', title: 'Chirurgienne Nocturne', map: 'hive', x: 760, y: 145,
      service: 'clinic', building: 'clinic', score: 10, style: 'bat', color: '#d797ff', level: 4,
      intro: ['Le parasite qui m’habite ne répond qu’à la violence. Bats-le sans détruire son hôte et je te suivrai.'],
      recruit: 'Le parasite se tait. À Nox Arca, j’ouvrirai une clinique pour réparer les corps que votre courage abîme.',
      hint: 'Dans les hauteurs de la Bio-Ruche. Son organisme est contrôlé par un parasite.',
    },
    skarn: {
      id: 'skarn', name: 'SKARN', title: 'Champion Chitineux', map: 'hive', x: 770, y: 395,
      service: 'arena', building: 'arena', score: 10, style: 'shell', color: '#ffcf6e', level: 5,
      requires: (g) => g.state.partner.level >= 4,
      blocked: 'Ton écho n’a pas encore survécu assez longtemps. Reviens au niveau 4.',
      intro: ['Une ville sans arène oublie pourquoi elle veut survivre. Offre-moi un combat digne et je construirai la sienne.'],
      recruit: 'Victoire propre. Je bâtirai une arène où la cité transformera sa peur en maîtrise.',
      hint: 'Au sud-est de la Bio-Ruche. Il refuse les partenaires sous le niveau 4.',
    },
    bellgrave: {
      id: 'bellgrave', name: 'BELLGRAVE', title: 'Maître du Glas', map: 'fog', x: 190, y: 170,
      service: 'training', building: 'training', score: 10, style: 'wraith', color: '#d8e2ff', level: 5,
      intro: ['Chaque cloche révèle une faiblesse. J’entends la tienne dans le pas de ton compagnon. Laisse-moi la frapper.'],
      recruit: 'Le son n’a pas brisé votre lien. Je vous entraînerai jusqu’à ce que même la peur obéisse.',
      hint: 'À l’ouest de la Cathédrale de Brume. Son glas attire les créatures.',
    },
    masks: {
      id: 'masks', name: 'BIFRONS', title: 'Les Deux Masques', map: 'fog', x: 742, y: 165,
      service: 'scout', building: 'scout', score: 10, style: 'mask', color: '#ff93c5', level: 6,
      requires: (g) => g.getTotalWins() >= 8,
      blocked: 'Nous ne racontons pas nos secrets aux chasseurs sans histoire. Remporte huit combats, puis reviens.',
      intro: ['Huit victoires font une réputation. Une neuvième peut faire une légende… ou une tombe.'],
      recruit: 'Nous avons perdu ensemble. Voilà une histoire assez rare pour être suivie. Nous ouvrirons le Bureau des pistes.',
      hint: 'Au nord-est de la Brume. Ils réclament huit victoires au total.',
    },
    nacre: {
      id: 'nacre', name: 'NACRE', title: 'Gardienne des Liens', map: 'fog', x: 490, y: 420,
      service: 'care', building: 'care', score: 10, style: 'mystic', color: '#8de7ff', level: 6,
      requires: (g) => g.state.partner.bond >= 55,
      blocked: 'Je vois un maître et une créature, pas encore deux êtres qui se choisissent. Reviens avec un lien de 55.',
      intro: ['Votre lien est réel. Maintenant je dois savoir s’il résiste à quelqu’un qui connaît exactement où le toucher.'],
      recruit: 'Vous vous êtes protégés au lieu de vous utiliser. Je veillerai sur les foyers, le repos et les renaissances de Nox Arca.',
      hint: 'Au sud de la Brume. Elle ne se montre qu’aux duos ayant au moins 55 de lien.',
    },
    coiljack: {
      id: 'coiljack', name: 'COILJACK', title: 'Marchand de Courant', map: 'foundry', x: 165, y: 165,
      service: 'shop', building: 'shop', score: 10, style: 'serpent', color: '#ffd36b', level: 7,
      requires: (g) => g.state.credits >= 150,
      blocked: 'Une cité sans fonds est une promesse sans câble. Montre-moi 150 fragments de crédit — je ne les prendrai pas, je veux seulement savoir qu’ils circulent.',
      intro: ['Tu sais faire circuler la richesse. Voyons si tu sais aussi faire circuler le sang.'],
      recruit: 'Marché conclu. Je transformerai vos déchets en outils et vos besoins en bonnes affaires.',
      hint: 'Au nord-ouest de la Fonderie. Il exige de voir 150 crédits avant le duel.',
    },
    rook: {
      id: 'rook', name: 'ROOK-Ø', title: 'Éclaireur Blindé', map: 'foundry', x: 770, y: 180,
      service: 'expedition', building: 'expedition', score: 10, style: 'drone', color: '#9ab7ff', level: 7,
      requires: (g) => g.getRegionPatrolWinCount('foundry') >= 3,
      blocked: 'Trois sentinelles verrouillent ma sortie. Nettoie au moins trois patrouilles de la Fonderie.',
      intro: ['Zone dégagée. Dernier protocole : vérifier que tu n’es pas simplement la prochaine menace.'],
      recruit: 'Identification alliée confirmée. Je mènerai des expéditions hors-carte pour ravitailler la cité.',
      hint: 'Au nord-est de la Fonderie. Il faut d’abord vaincre trois patrouilles de la région.',
    },
    khepri: {
      id: 'khepri', name: 'KHEPRI-7', title: 'Gardien du Dernier Sceau', map: 'foundry', x: 490, y: 410,
      service: 'security', building: 'security', score: 10, style: 'scarab', color: '#ffb75e', level: 8,
      requires: (g) => g.getCityScore() >= 70,
      blocked: 'Je ne protège pas des ruines. Élève Nox Arca à 70 points d’écho.',
      intro: ['Ta cité existe. Reste à savoir si elle mérite d’être protégée lorsque le Néant réclamera son dû.'],
      recruit: 'Sceau transféré. Je défendrai Nox Arca et j’ouvrirai le chemin vers l’Architecte lorsque les quatre mémoires seront réunies.',
      hint: 'Au sud de la Fonderie. Il ne rejoint qu’une cité ayant atteint 70 points d’écho.',
    },
  };

  const BUILDINGS = {
    forge: { x: 305, y: 185, w: 105, h: 70, label: 'FORGE', icon: '⚒', color: '#ff9a72' },
    archive: { x: 545, y: 165, w: 105, h: 72, label: 'ARCHIVES', icon: '⌘', color: '#8de7ff' },
    transit: { x: 720, y: 245, w: 112, h: 72, label: 'TRANSIT', icon: '◎', color: '#79d8ff' },
    greenhouse: { x: 140, y: 300, w: 115, h: 74, label: 'SERRE', icon: '♧', color: '#bcff8d' },
    clinic: { x: 660, y: 360, w: 105, h: 72, label: 'CLINIQUE', icon: '+', color: '#d797ff' },
    arena: { x: 715, y: 120, w: 118, h: 70, label: 'ARÈNE', icon: '◈', color: '#ffcf6e' },
    training: { x: 160, y: 145, w: 112, h: 70, label: 'DOJO', icon: '▲', color: '#d8e2ff' },
    scout: { x: 122, y: 410, w: 112, h: 70, label: 'PISTES', icon: '⌖', color: '#ff93c5' },
    care: { x: 330, y: 395, w: 110, h: 74, label: 'FOYER', icon: '♡', color: '#8de7ff' },
    shop: { x: 525, y: 390, w: 110, h: 72, label: 'BAZAR', icon: '¤', color: '#ffd36b' },
    expedition: { x: 125, y: 220, w: 112, h: 70, label: 'EXPÉDITIONS', icon: '↗', color: '#9ab7ff' },
    security: { x: 730, y: 420, w: 112, h: 72, label: 'BASTION', icon: '⬢', color: '#ffb75e' },
  };

  const MAPS = {
    city: {
      id: 'city', name: 'NOX ARCA — CITÉ DES ÉCHOS', theme: 'city', accent: '#8de7ff',
      spawn: { x: 480, y: 360 },
      obstacles: [],
    },
    wastes: {
      id: 'wastes', name: 'FRICHES DU PORTAIL', theme: 'wastes', accent: '#ff9a72',
      spawn: { x: 480, y: 475 },
      exit: { x: 430, y: 493, w: 100, h: 35, target: 'city', targetX: 480, targetY: 120, label: 'Retour à Nox Arca' },
      shard: { id: 'shard_wastes', x: 465, y: 115, name: 'Éclat des Friches' },
      obstacles: [
        { x: 285, y: 95, w: 110, h: 55 }, { x: 530, y: 88, w: 135, h: 48 },
        { x: 380, y: 245, w: 190, h: 50 }, { x: 85, y: 280, w: 150, h: 42 },
        { x: 700, y: 275, w: 155, h: 48 }, { x: 280, y: 390, w: 100, h: 52 },
      ],
      patrols: [
        { id: 'w_hound_1', name: 'Molosse de Rouille', x: 300, y: 190, style: 'feral', color: '#d77d61', level: 1 },
        { id: 'w_mite_1', name: 'Tique de Portail', x: 620, y: 335, style: 'scarab', color: '#e5bf69', level: 2, loot: 'scrap' },
        { id: 'w_drone_1', name: 'Drone Amnésique', x: 180, y: 405, style: 'drone', color: '#76b8df', level: 2, loot: 'scrap' },
        { id: 'w_hound_2', name: 'Molosse de Rouille', x: 835, y: 115, style: 'feral', color: '#d77d61', level: 2 },
      ],
    },
    hive: {
      id: 'hive', name: 'BIO-RUCHE DE VERDANCE', theme: 'hive', accent: '#bcff8d',
      spawn: { x: 480, y: 480 },
      exit: { x: 430, y: 493, w: 100, h: 35, target: 'city', targetX: 815, targetY: 270, label: 'Retour à Nox Arca' },
      shard: { id: 'shard_hive', x: 490, y: 95, name: 'Éclat Symbiotique' },
      obstacles: [
        { x: 345, y: 95, w: 75, h: 130 }, { x: 535, y: 100, w: 80, h: 128 },
        { x: 280, y: 285, w: 120, h: 58 }, { x: 555, y: 285, w: 125, h: 58 },
        { x: 55, y: 220, w: 120, h: 48 }, { x: 785, y: 235, w: 120, h: 48 },
      ],
      patrols: [
        { id: 'h_chitin_1', name: 'Chitineux Affamé', x: 275, y: 170, style: 'scarab', color: '#96cd63', level: 3, loot: 'spore' },
        { id: 'h_spore_1', name: 'Gueule à Spores', x: 480, y: 300, style: 'fungus', color: '#b7ed71', level: 3, loot: 'spore' },
        { id: 'h_serpent_1', name: 'Serpent Veineux', x: 685, y: 190, style: 'serpent', color: '#ca6b87', level: 4, loot: 'spore' },
        { id: 'h_chitin_2', name: 'Chitineux Affamé', x: 500, y: 410, style: 'scarab', color: '#96cd63', level: 4, loot: 'spore' },
      ],
    },
    fog: {
      id: 'fog', name: 'CATHÉDRALE DE BRUME', theme: 'fog', accent: '#d8e2ff',
      spawn: { x: 480, y: 480 },
      exit: { x: 430, y: 493, w: 100, h: 35, target: 'city', targetX: 480, targetY: 435, label: 'Retour à Nox Arca' },
      shard: { id: 'shard_fog', x: 480, y: 112, name: 'Éclat du Voile' },
      obstacles: [
        { x: 250, y: 90, w: 80, h: 210 }, { x: 630, y: 90, w: 80, h: 210 },
        { x: 395, y: 170, w: 170, h: 48 }, { x: 375, y: 330, w: 210, h: 42 },
        { x: 90, y: 330, w: 135, h: 48 }, { x: 735, y: 330, w: 135, h: 48 },
      ],
      patrols: [
        { id: 'f_mourner_1', name: 'Pleurant Sans-Visage', x: 355, y: 270, style: 'wraith', color: '#b9c3db', level: 5 },
        { id: 'f_mask_1', name: 'Masque Errant', x: 610, y: 270, style: 'mask', color: '#e7a8c7', level: 5 },
        { id: 'f_bell_1', name: 'Spectre du Glas', x: 130, y: 420, style: 'bat', color: '#a9b3db', level: 6 },
        { id: 'f_mourner_2', name: 'Pleurant Sans-Visage', x: 825, y: 420, style: 'wraith', color: '#b9c3db', level: 6 },
      ],
    },
    foundry: {
      id: 'foundry', name: 'FONDERIE DES VEILLEURS', theme: 'foundry', accent: '#ffd36b',
      spawn: { x: 480, y: 480 },
      exit: { x: 430, y: 493, w: 100, h: 35, target: 'city', targetX: 160, targetY: 270, label: 'Retour à Nox Arca' },
      shard: { id: 'shard_foundry', x: 490, y: 105, name: 'Éclat du Veilleur' },
      obstacles: [
        { x: 300, y: 90, w: 90, h: 145 }, { x: 570, y: 90, w: 90, h: 145 },
        { x: 410, y: 245, w: 140, h: 60 }, { x: 85, y: 280, w: 165, h: 52 },
        { x: 710, y: 280, w: 165, h: 52 }, { x: 290, y: 385, w: 110, h: 52 },
        { x: 560, y: 385, w: 110, h: 52 },
      ],
      patrols: [
        { id: 'y_sentry_1', name: 'Sentinelle Câblée', x: 270, y: 245, style: 'drone', color: '#f2b95f', level: 7, loot: 'scrap' },
        { id: 'y_hound_1', name: 'Limier de Cuivre', x: 690, y: 245, style: 'feral', color: '#d99757', level: 7, loot: 'scrap' },
        { id: 'y_smelter_1', name: 'Scarabée de Fusion', x: 480, y: 350, style: 'scarab', color: '#ff884f', level: 8, loot: 'scrap' },
        { id: 'y_sentry_2', name: 'Sentinelle Câblée', x: 480, y: 155, style: 'drone', color: '#f2b95f', level: 8, loot: 'scrap' },
      ],
    },
    void: {
      id: 'void', name: 'CŒUR DU NÉANT', theme: 'void', accent: '#b394ff',
      spawn: { x: 480, y: 475 },
      exit: { x: 430, y: 493, w: 100, h: 35, target: 'city', targetX: 805, targetY: 445, label: 'Retour à Nox Arca' },
      obstacles: [
        { x: 190, y: 145, w: 145, h: 50 }, { x: 625, y: 145, w: 145, h: 50 },
        { x: 350, y: 300, w: 260, h: 42 },
      ],
      patrols: [
        { id: 'v_echo_1', name: 'Écho Inversé', x: 300, y: 250, style: 'mystic', color: '#7c6bd8', level: 9 },
        { id: 'v_seraph_1', name: 'Séraphin Noir', x: 660, y: 250, style: 'seraph', color: '#8d72c7', level: 9 },
      ],
      boss: { id: 'architect', name: 'L’ARCHITECTE PÂLE', x: 480, y: 118, style: 'sovereign', color: '#e4e8ff', level: 11 },
    },
  };

  const CITY_RETURN_POINTS = Object.freeze({
    wastes: { x: 480, y: 132 },
    hive: { x: 815, y: 270 },
    fog: { x: 480, y: 423 },
    foundry: { x: 145, y: 270 },
  });

  const resolveMapId = (mapId) => WORLD_LAYOUTS[mapId]?.entrySectorId || mapId;
  const getMapRegionId = (mapId) => {
    if (REGION_IDS.includes(mapId)) return mapId;
    return MAPS[mapId]?.region || (mapId === 'void' ? 'void' : 'city');
  };
  const nudgeFromEdge = (endpoint) => ({
    x: endpoint.x <= 90 ? endpoint.x + 52 : endpoint.x >= W - 90 ? endpoint.x - 52 : endpoint.x,
    y: endpoint.y <= 90 ? endpoint.y + 62 : endpoint.y >= H - 60 ? endpoint.y - 42 : endpoint.y,
    facing: endpoint.x <= 90 ? 'right' : endpoint.x >= W - 90 ? 'left' : endpoint.y <= 90 ? 'down' : 'up',
  });

  for (const region of Object.values(WORLD_LAYOUTS)) {
    region.sectors.forEach((sector, sectorIndex) => {
      MAPS[sector.id] = {
        ...sector,
        region: region.id,
        regionName: region.name,
        theme: region.theme,
        accent: region.accent,
        sectorIndex: sectorIndex + 1,
        sectorCount: region.sectors.length,
      };
      for (const placement of sector.residentSpawns) {
        if (!RESIDENTS[placement.residentId]) continue;
        Object.assign(RESIDENTS[placement.residentId], {
          map: sector.id,
          region: region.id,
          x: placement.x,
          y: placement.y,
          facing: placement.facing,
        });
      }
    });
    delete MAPS[region.id];
  }

  const WORLD_SAVE_METADATA = (() => {
    const flagKeys = new Set([
      'introDone', 'expeditionTutorialSeen', 'combatTutorialSeen',
      'shard_wastes', 'shard_hive', 'shard_fog', 'shard_foundry',
      'guardian_wastes_defeated', 'guardian_hive_defeated',
      'guardian_fog_defeated', 'guardian_foundry_defeated',
      'finalUnlocked', 'endingSeen', 'ngPlus',
    ]);
    const choiceIds = new Map();
    const sanctuaryIds = new Set();
    const patrolIds = new Set();

    for (const layout of Object.values(WORLD_LAYOUTS)) {
      for (const connection of layout.connections) {
        if (connection.unlock?.flag) flagKeys.add(connection.unlock.flag);
        if (connection.unlock?.activation?.flag) flagKeys.add(connection.unlock.activation.flag);
      }
      for (const sector of layout.sectors) {
        if (sector.sanctuary?.id) sanctuaryIds.add(sector.sanctuary.id);
        if (sector.guardian?.defeatFlag) flagKeys.add(sector.guardian.defeatFlag);
        if (sector.shard?.collectFlag || sector.shard?.id) flagKeys.add(sector.shard.collectFlag || sector.shard.id);
        for (const patrol of sector.patrols || []) patrolIds.add(patrol.id);
        for (const event of sector.events || []) {
          flagKeys.add(event.onceFlag);
          const validChoices = new Set();
          for (const choice of event.choices || []) {
            validChoices.add(choice.id);
            for (const flag of choice.result?.flags || []) flagKeys.add(flag);
          }
          choiceIds.set(event.id, validChoices);
        }
      }
    }

    return Object.freeze({ flagKeys, choiceIds, sanctuaryIds, patrolIds });
  })();
  const SAVE_MAP_IDS = new Set(Object.keys(MAPS));
  const SAVE_REGION_IDS = new Set([...REGION_IDS, 'void']);
  const SAVE_ITEM_IDS = new Set(Object.keys(ITEMS));
  const SAVE_CHRONICLE_IDS = new Set(CHRONICLE_IDS);
  const SAVE_ROOT_KEYS = new Set([
    'version', 'createdAt', 'savedAt', 'difficulty', 'settings', 'playSeconds', 'map',
    'player', 'partner', 'credits', 'inventory', 'recruited', 'flags', 'unlockedMaps',
    'discoveredSectors', 'sectorVisits', 'sanctuaryVisits', 'expeditionChoices',
    'chronicleProgress', 'chronicleChoices',
    'patrolVictories', 'wins', 'regionWins', 'worldDefeated', 'timeMinutes',
    'lastSleepDay', 'dailyClinicDay', 'expeditionReadyAt', 'expeditionActive',
    'forgeLevel', 'trainingLevel', 'arenaWins', 'arenaEliteRewardClaimed', 'journalSeen', 'finalBossDefeated',
    'newCycleBonus', 'cycleCount', 'cycleModifier', 'cycleAnomalies', 'cycleEchoes',
    'cityProjects', 'achievements', 'contract',
  ]);

  const REGION_UNLOCKS = [
    { map: 'hive', score: 20, text: 'La Porte organique s’ouvre : la Bio-Ruche de Verdance est accessible.' },
    { map: 'fog', score: 45, text: 'La brume répond au Cœur : la Cathédrale de Brume est accessible.' },
    { map: 'foundry', score: 70, text: 'Les Veilleurs ont détecté Nox Arca : la Fonderie s’ouvre.' },
  ];

  const LORE = [
    { title: 'Le Grand Silence', text: 'Nox Arca fut jadis une halte entre des mondes incompatibles. Lorsque son Cœur cessa de battre, chaque habitant repartit protéger son propre territoire.' },
    { title: 'Les Échos', text: 'Les créatures ne sont ni des animaux ni des machines. Elles sont des souvenirs devenus biologiques, capables d’évoluer selon les soins, les combats et la relation avec leur gardien.' },
    { title: 'L’Architecte Pâle', text: 'Une intelligence ancienne estime que toute cité finit par corrompre les mondes qu’elle relie. Elle a donc isolé Nox Arca et dispersé ses mémoires.' },
    { title: 'Le Lien', text: 'Un ordre n’est jamais garanti. La discipline favorise l’obéissance ; le lien permet au partenaire de comprendre l’intention derrière l’ordre. Les deux voies sont valables, mais produisent des évolutions différentes.' },
  ];

  const DIFFICULTIES = {
    story: {
      id: 'story', name: 'EXPLORATION',
      description: 'Pour découvrir le monde et reconstruire la cité avec une pression modérée.',
      enemyHp: .78, enemyPower: .82, rewards: 1.1, obedience: .08, defeatLoss: .08,
    },
    standard: {
      id: 'standard', name: 'STANDARD',
      description: 'L’équilibre prévu pour la campagne principale.',
      enemyHp: 1, enemyPower: 1, rewards: 1, obedience: 0, defeatLoss: .18,
    },
    survival: {
      id: 'survival', name: 'SURVIE',
      description: 'Ennemis renforcés, ordres plus exigeants et récompenses supérieures.',
      enemyHp: 1.28, enemyPower: 1.2, rewards: 1.28, obedience: -.05, defeatLoss: .25,
    },
  };

  const CITY_PROJECTS = {
    beacon: {
      id: 'beacon', name: 'RÉSEAU DE BALISES', minScore: 20,
      description: 'Stabilise les routes commerciales : les victoires rapportent 15 % de crédits supplémentaires.',
      credits: 150, items: { scrap: 3 },
    },
    sanctuary: {
      id: 'sanctuary', name: 'SANCTUAIRE DU LIEN', minScore: 45,
      description: 'Les besoins du partenaire progressent 20 % moins vite pendant les voyages et les activités.',
      credits: 180, items: { spore: 4 },
    },
    resonator: {
      id: 'resonator', name: 'RÉSONATEUR D’UNISSON', minScore: 70,
      description: 'La jauge de synchronisation de combat se remplit 25 % plus vite.',
      credits: 260, items: { coreSeed: 1, scrap: 2 },
    },
  };

  const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'PREMIER ÉCHO', text: 'Remporter un premier combat.', test: (g) => g.getTotalWins() >= 1 },
    { id: 'first_resident', name: 'UNE LUMIÈRE DANS LA VILLE', text: 'Recruter un premier habitant.', test: (g) => g.state.recruited.length >= 1 },
    { id: 'refuge', name: 'LE REFUGE', text: 'Atteindre 20 points de cité.', test: (g) => g.getCityScore() >= 20 },
    { id: 'living_city', name: 'CITÉ VIVANTE', text: 'Atteindre 45 points de cité.', test: (g) => g.getCityScore() >= 45 },
    { id: 'bastion', name: 'LE BASTION', text: 'Atteindre 70 points de cité.', test: (g) => g.getCityScore() >= 70 },
    { id: 'all_shards', name: 'MÉMOIRE RECOMPOSÉE', text: 'Réunir les quatre Éclats mnésiques.', test: (g) => g.getShardCount() >= 4 },
    { id: 'stage_two', name: 'MÉTAMORPHOSE', text: 'Atteindre une forme de stade II.', test: (g) => (FORMS[g.state.partner.formId]?.stage || 1) >= 2 },
    { id: 'stage_three', name: 'FORME SOUVERAINE', text: 'Atteindre une forme de stade III.', test: (g) => (FORMS[g.state.partner.formId]?.stage || 1) >= 3 },
    { id: 'bond_ninety', name: 'LIEN INDISSOCIABLE', text: 'Atteindre 90 de lien.', test: (g) => g.state.partner.bond >= 90 },
    { id: 'veteran', name: 'CHASSEUR D’ÉCHOS', text: 'Remporter 25 combats.', test: (g) => g.getTotalWins() >= 25 },
    { id: 'city_complete', name: 'NOX ARCA COMPLÈTE', text: 'Recruter les douze habitants.', test: (g) => g.state.recruited.length >= Object.keys(RESIDENTS).length },
    { id: 'architect', name: 'LE SILENCE EST ROMPU', text: 'Vaincre l’Architecte Pâle.', test: (g) => g.state.finalBossDefeated },
  ];

  function makeDefaultState(starter) {
    return {
      version: VERSION,
      createdAt: Date.now(),
      savedAt: Date.now(),
      difficulty: 'standard',
      settings: readAccessibilitySettings(),
      playSeconds: 0,
      map: 'city',
      player: { x: 480, y: 360, facing: 'down' },
      partner: {
        name: starter.name,
        starter: starter.id,
        formId: starter.formId,
        level: 1,
        xp: 0,
        maxHp: 88 + starter.stats.guard * 2,
        hp: 88 + starter.stats.guard * 2,
        maxMp: 45 + starter.stats.spirit * 2,
        mp: 45 + starter.stats.spirit * 2,
        power: starter.stats.power,
        guard: starter.stats.guard,
        spirit: starter.stats.spirit,
        speed: starter.stats.speed,
        bond: 42,
        discipline: starter.id === 'aegis' ? 62 : 48,
        morale: 70,
        hunger: 16,
        fatigue: 8,
        careMistakes: 0,
        ageDays: 1,
        rebirths: 0,
        evolutions: [starter.formId],
      },
      credits: 90,
      inventory: { ration: 3, medgel: 2, ether: 1, stimulant: 0, spore: 0, scrap: 0, incense: 0, coreSeed: 0 },
      recruited: [],
      flags: {
        introDone: false,
        expeditionTutorialSeen: false,
        combatTutorialSeen: false,
        shard_wastes: false,
        shard_hive: false,
        shard_fog: false,
        shard_foundry: false,
        guardian_wastes_defeated: false,
        guardian_hive_defeated: false,
        guardian_fog_defeated: false,
        guardian_foundry_defeated: false,
        finalUnlocked: false,
        endingSeen: false,
        ngPlus: false,
      },
      unlockedMaps: ['wastes'],
      discoveredSectors: ['city'],
      sectorVisits: {},
      sanctuaryVisits: {},
      expeditionChoices: {},
      chronicleProgress: {},
      chronicleChoices: {},
      patrolVictories: [],
      wins: {},
      regionWins: { wastes: 0, hive: 0, fog: 0, foundry: 0, void: 0 },
      worldDefeated: {},
      timeMinutes: 480,
      lastSleepDay: 0,
      dailyClinicDay: 0,
      expeditionReadyAt: 0,
      expeditionActive: false,
      forgeLevel: 0,
      trainingLevel: 0,
      arenaWins: 0,
      arenaEliteRewardClaimed: false,
      journalSeen: [],
      finalBossDefeated: false,
      newCycleBonus: 0,
      cycleCount: 0,
      cycleModifier: 'none',
      cycleAnomalies: { wastes: false, hive: false, fog: false, foundry: false },
      cycleEchoes: {},
      cityProjects: [],
      achievements: [],
      contract: null,
    };
  }

  class InputManager {
    constructor() {
      this.down = new Set();
      this.pressed = new Set();
      this.touch = { up: false, down: false, left: false, right: false };
      this.gamepadPressed = new Set();
      this.bind();
    }

    bind() {
      const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);
      window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        const interactive = event.target instanceof Element && event.target.closest('button, a, input, textarea, select, summary, [contenteditable="true"]');
        if (interactive && key !== 'escape') return;
        if (block.has(event.key)) event.preventDefault();
        if (!this.down.has(key)) this.pressed.add(key);
        this.down.add(key);
      }, { passive: false });
      window.addEventListener('keyup', (event) => this.down.delete(event.key.toLowerCase()));
      window.addEventListener('blur', () => {
        this.down.clear();
        Object.keys(this.touch).forEach((key) => { this.touch[key] = false; });
      });

      document.querySelectorAll('[data-dir]').forEach((button) => {
        const dir = button.dataset.dir;
        const start = (event) => {
          event.preventDefault();
          this.touch[dir] = true;
          button.setPointerCapture?.(event.pointerId);
        };
        const end = (event) => {
          event.preventDefault();
          this.touch[dir] = false;
        };
        button.addEventListener('pointerdown', start);
        button.addEventListener('pointerup', end);
        button.addEventListener('pointercancel', end);
        button.addEventListener('pointerleave', end);
      });
    }

    isDown(...keys) {
      return keys.some((key) => this.down.has(key) || this.touch[key]);
    }

    consume(...keys) {
      for (const key of keys) {
        if (this.pressed.has(key)) {
          this.pressed.delete(key);
          return true;
        }
      }
      return false;
    }

    pollGamepad() {
      const pads = navigator.getGamepads?.() || [];
      const pad = Array.from(pads).find(Boolean);
      if (!pad) return { x: 0, y: 0, action: false, cancel: false, menu: false, navX: 0, navY: 0 };
      const x = Math.abs(pad.axes[0]) > 0.18 ? pad.axes[0] : 0;
      const y = Math.abs(pad.axes[1]) > 0.18 ? pad.axes[1] : 0;
      const actionDown = Boolean(pad.buttons[0]?.pressed);
      const cancelDown = Boolean(pad.buttons[1]?.pressed);
      const menuDown = Boolean(pad.buttons[9]?.pressed || pad.buttons[3]?.pressed);
      const leftDown = Boolean(pad.buttons[14]?.pressed || x < -.58);
      const rightDown = Boolean(pad.buttons[15]?.pressed || x > .58);
      const upDown = Boolean(pad.buttons[12]?.pressed || y < -.58);
      const downDown = Boolean(pad.buttons[13]?.pressed || y > .58);
      const action = actionDown && !this.gamepadPressed.has('action');
      const cancel = cancelDown && !this.gamepadPressed.has('cancel');
      const menu = menuDown && !this.gamepadPressed.has('menu');
      const navX = leftDown && !this.gamepadPressed.has('left') ? -1 : rightDown && !this.gamepadPressed.has('right') ? 1 : 0;
      const navY = upDown && !this.gamepadPressed.has('up') ? -1 : downDown && !this.gamepadPressed.has('down') ? 1 : 0;
      if (actionDown) this.gamepadPressed.add('action'); else this.gamepadPressed.delete('action');
      if (cancelDown) this.gamepadPressed.add('cancel'); else this.gamepadPressed.delete('cancel');
      if (menuDown) this.gamepadPressed.add('menu'); else this.gamepadPressed.delete('menu');
      if (leftDown) this.gamepadPressed.add('left'); else this.gamepadPressed.delete('left');
      if (rightDown) this.gamepadPressed.add('right'); else this.gamepadPressed.delete('right');
      if (upDown) this.gamepadPressed.add('up'); else this.gamepadPressed.delete('up');
      if (downDown) this.gamepadPressed.add('down'); else this.gamepadPressed.delete('down');
      return { x, y, action, cancel, menu, navX, navY };
    }

    endFrame() {
      this.pressed.clear();
    }
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = gameStorage.getItem('echobound_muted') === '1';
      this.director = new AudioDirector({
        seed: 'nox-arca-original-score-v2',
        settings: { muted: this.muted, master: 1, ambience: .58, sfx: 1 },
      });
      this.directorSettingsSignature = `${this.muted}|false`;
      this.ambientQueue = [];
      this.ambientTheme = 'city';
      DOM.mute.textContent = this.muted ? '×' : '♪';
      DOM.mute.setAttribute('aria-pressed', String(this.muted));
      const unlock = () => this.ensure();
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(this.ctx.destination);
      } catch (error) {
        console.warn('Audio indisponible', error);
      }
    }

    toggle() {
      this.muted = !this.muted;
      try { gameStorage.setItem('echobound_muted', this.muted ? '1' : '0'); } catch {
        gameStorage.useMemory();
        gameStorage.setItem('echobound_muted', this.muted ? '1' : '0');
        // Le son reste réglable pendant que le jeu signale le stockage indisponible.
      }
      this.directorSettingsSignature = '';
      if (this.muted) this.ambientQueue = [];
      DOM.mute.textContent = this.muted ? '×' : '♪';
      DOM.mute.setAttribute('aria-pressed', String(this.muted));
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.22, this.ctx.currentTime, 0.04);
    }

    tone(freq = 440, duration = 0.08, type = 'sine', volume = 0.25, slide = 0) {
      this.ensure();
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    chord(notes, duration = 0.3, type = 'sine', volume = 0.08) {
      notes.forEach((note, index) => setTimeout(() => this.tone(note, duration, type, volume, note * 0.02), index * 35));
    }

    play(name) {
      const sounds = {
        ui: () => this.tone(620, 0.055, 'square', 0.07, 80),
        cancel: () => this.tone(280, 0.07, 'triangle', 0.08, -80),
        hit: () => { this.tone(110, 0.11, 'sawtooth', 0.14, -55); this.tone(70, 0.08, 'square', 0.08, -20); },
        skill: () => { this.tone(330, 0.2, 'sine', 0.11, 510); this.tone(650, 0.17, 'triangle', 0.07, 180); },
        heal: () => this.chord([440, 554, 659], 0.26, 'sine', 0.07),
        victory: () => this.chord([392, 523, 659, 784], 0.35, 'triangle', 0.09),
        recruit: () => this.chord([261, 392, 523, 659], 0.5, 'sine', 0.08),
        portal: () => { this.tone(120, 0.45, 'sine', 0.12, 700); this.tone(900, 0.25, 'triangle', 0.05, -400); },
        discovery: () => this.chord([293.66, 440, 587.33], .38, 'sine', .065),
        evolution: () => this.chord([220, 330, 440, 660, 880], 0.75, 'sine', 0.08),
        defeat: () => this.chord([220, 185, 147], 0.45, 'sawtooth', 0.06),
      };
      sounds[name]?.();
    }

    update(theme, nowSeconds, reducedMotion = false, active = true) {
      const now = Math.max(0, Number(nowSeconds) || 0);
      const settingsSignature = `${this.muted}|${Boolean(reducedMotion)}`;
      if (settingsSignature !== this.directorSettingsSignature) {
        this.director.setSettings({
          muted: this.muted,
          master: 1,
          ambience: .58,
          sfx: 1,
          reducedMotion,
        });
        this.directorSettingsSignature = settingsSignature;
      }
      if (theme !== this.ambientTheme) {
        this.ambientTheme = theme;
        this.ambientQueue = [];
        this.director.setTheme(theme, now);
      }
      if (!active || !this.ctx || this.muted) {
        this.ambientQueue = [];
        this.director.reset(now);
        return;
      }
      if (this.director.cursor <= now + 2) {
        this.ambientQueue.push(...this.director.plan(now, 6));
      }
      while (this.ambientQueue.length && this.ambientQueue[0].at <= now + .035) {
        const event = this.ambientQueue.shift();
        if (event.at >= now - .5) emitAmbientTone(this, event);
      }
    }
  }

  function drawShadow(ctx, x, y, rx, ry, alpha = 0.28) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawMonster(ctx, x, y, scale, style, color, facing = 1, stage = 1, t = 0, options = {}) {
    const bob = Math.sin(t * 3 + x * 0.01) * 2.2 * scale;
    const pulse = 1 + Math.sin(t * 2.1 + y * 0.01) * 0.03;
    const s = scale * pulse;
    const dir = facing >= 0 ? 1 : -1;
    const outline = options.outline || '#08101a';
    const light = options.light || '#f6fbff';
    const dark = options.dark || '#1a2031';

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(dir * s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3 / Math.max(0.5, s);

    const fill = (pathColor = color) => {
      ctx.fillStyle = pathColor;
      ctx.fill();
      ctx.stroke();
    };

    if (style === 'feral' || style === 'dread') {
      const dread = style === 'dread' || stage >= 3;
      ctx.beginPath();
      ctx.moveTo(-30, 8); ctx.quadraticCurveTo(-18, -24, 10, -22); ctx.quadraticCurveTo(34, -18, 39, 2); ctx.quadraticCurveTo(33, 23, 5, 20); ctx.quadraticCurveTo(-20, 24, -30, 8); fill();
      ctx.beginPath();
      ctx.moveTo(18, -17); ctx.lineTo(30, -35 - stage * 2); ctx.lineTo(34, -14); fill(dark);
      ctx.beginPath();
      ctx.moveTo(-8, -21); ctx.lineTo(1, -36 - stage * 3); ctx.lineTo(8, -20); fill(dark);
      ctx.beginPath();
      ctx.moveTo(-24, 9); ctx.quadraticCurveTo(-48, -2, -43, -20); ctx.quadraticCurveTo(-31, -8, -24, -1); ctx.stroke();
      const legY = 17;
      [-16, 12, 27].forEach((lx, index) => {
        ctx.beginPath(); ctx.moveTo(lx, legY - index * 1.5); ctx.lineTo(lx - 3, 33 + index); ctx.lineTo(lx + 7, 33 + index); ctx.stroke();
      });
      ctx.fillStyle = dread ? '#ffffff' : light;
      ctx.beginPath(); ctx.ellipse(23, -4, 4.5, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = outline; ctx.beginPath(); ctx.arc(24.5, -4, 1.4, 0, TAU); ctx.fill();
      if (dread) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / s;
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath(); ctx.moveTo(-12 + i * 10, -20); ctx.lineTo(-6 + i * 10, -34 - i * 2); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(35, 4); ctx.lineTo(48, 10); ctx.lineTo(36, 15); ctx.fillStyle = '#f6fbff'; ctx.fill(); ctx.stroke();
      }
    } else if (style === 'shell' || style === 'titan' || style === 'scarab') {
      const titan = style === 'titan' || stage >= 3;
      ctx.beginPath();
      ctx.ellipse(0, -2, titan ? 34 : 28, titan ? 31 : 24, 0, 0, TAU); fill();
      ctx.beginPath();
      ctx.moveTo(-20, -22); ctx.lineTo(0, -35 - stage * 2); ctx.lineTo(20, -22); ctx.lineTo(10, 2); ctx.lineTo(-10, 2); ctx.closePath(); fill(dark);
      const limb = titan ? 38 : 31;
      [-1, 1].forEach((side) => {
        ctx.beginPath(); ctx.moveTo(side * 21, -5); ctx.lineTo(side * limb, 12); ctx.lineTo(side * (limb - 4), 28); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(side * 13, 20); ctx.lineTo(side * 18, 39); ctx.lineTo(side * 5, 39); ctx.stroke();
      });
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(-7, -7, 3.2, 0, TAU); ctx.arc(7, -7, 3.2, 0, TAU); ctx.fill();
      if (style === 'scarab') {
        ctx.strokeStyle = hexToRgba(light, .65);
        ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(0, 20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, -29); ctx.quadraticCurveTo(-26, -42, -31, -27); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, -29); ctx.quadraticCurveTo(26, -42, 31, -27); ctx.stroke();
      }
      if (titan) {
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(-30, -24); ctx.lineTo(-38, -46); ctx.lineTo(-12, -31); ctx.moveTo(30, -24); ctx.lineTo(38, -46); ctx.lineTo(12, -31); ctx.stroke();
        ctx.fillStyle = hexToRgba(light, .75);
        ctx.fillRect(-4, -45, 8, 18);
      }
    } else if (style === 'wing' || style === 'seraph' || style === 'bat') {
      const seraph = style === 'seraph' || stage >= 3;
      ctx.beginPath();
      ctx.ellipse(0, -2, seraph ? 18 : 15, seraph ? 25 : 19, 0, 0, TAU); fill();
      ctx.globalAlpha = .82;
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 8, -12);
        ctx.quadraticCurveTo(side * (seraph ? 52 : 40), -40, side * (seraph ? 48 : 34), 2);
        ctx.quadraticCurveTo(side * 30, 30, side * 8, 11);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(color, .62);
        ctx.fill(); ctx.stroke();
        if (seraph) {
          ctx.beginPath(); ctx.moveTo(side * 12, 2); ctx.quadraticCurveTo(side * 48, 10, side * 36, 35); ctx.quadraticCurveTo(side * 17, 27, side * 8, 12); ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(-10, -20); ctx.lineTo(-18, -32); ctx.lineTo(-5, -24); fill(dark);
      ctx.beginPath(); ctx.moveTo(10, -20); ctx.lineTo(18, -32); ctx.lineTo(5, -24); fill(dark);
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0, -8, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexToRgba(light, .72);
      ctx.beginPath(); ctx.arc(0, -8, seraph ? 19 : 14, 0, TAU); ctx.stroke();
      if (style === 'bat') {
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(-6, 16); ctx.lineTo(0, 27); ctx.lineTo(6, 16); ctx.fill();
      }
    } else if (style === 'mystic' || style === 'sovereign') {
      const sovereign = style === 'sovereign' || stage >= 3;
      ctx.beginPath();
      ctx.moveTo(-26, 12); ctx.quadraticCurveTo(-18, -23, 0, -24); ctx.quadraticCurveTo(18, -23, 27, 12); ctx.quadraticCurveTo(12, 29, 0, 23); ctx.quadraticCurveTo(-12, 29, -26, 12); fill();
      [-1, 1].forEach((side) => {
        ctx.beginPath(); ctx.moveTo(side * 14, -18); ctx.quadraticCurveTo(side * 26, -42, side * 38, -30); ctx.lineTo(side * 24, -9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(side * 18, 13); ctx.quadraticCurveTo(side * 42, 18, side * 38, 36); ctx.stroke();
      });
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-2, -10); ctx.lineTo(-4, -1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9, -6); ctx.lineTo(2, -10); ctx.lineTo(4, -1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexToRgba(light, .7);
      ctx.beginPath(); ctx.arc(0, -2, sovereign ? 38 : 30, 0, TAU); ctx.stroke();
      if (sovereign) {
        ctx.beginPath(); ctx.arc(0, -2, 49, 0, TAU); ctx.stroke();
        for (let i = 0; i < 8; i += 1) {
          const a = (i / 8) * TAU + t * .25;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * 40, -2 + Math.sin(a) * 40); ctx.lineTo(Math.cos(a) * 54, -2 + Math.sin(a) * 54); ctx.stroke();
        }
      }
    } else if (style === 'serpent') {
      ctx.beginPath();
      ctx.moveTo(-38, 15); ctx.bezierCurveTo(-15, -28, 13, 31, 39, -9); ctx.strokeStyle = color; ctx.lineWidth = 16 / s; ctx.stroke();
      ctx.strokeStyle = outline; ctx.lineWidth = 3 / s; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(36, -12, 15, 11, -.2, 0, TAU); fill();
      ctx.beginPath(); ctx.moveTo(43, -14); ctx.lineTo(55, -20); ctx.lineTo(47, -8); ctx.closePath(); fill(dark);
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(40, -15, 2.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexToRgba(light, .6); ctx.lineWidth = 2 / s;
      for (let i = -25; i < 22; i += 14) { ctx.beginPath(); ctx.moveTo(i, -3); ctx.lineTo(i + 7, 8); ctx.stroke(); }
    } else if (style === 'fungus') {
      ctx.beginPath(); ctx.ellipse(0, 3, 19, 25, 0, 0, TAU); fill(dark);
      ctx.beginPath(); ctx.ellipse(0, -18, 39, 21, 0, Math.PI, TAU); ctx.quadraticCurveTo(0, 2, -39, -18); fill();
      ctx.fillStyle = hexToRgba(light, .8);
      [-20, -4, 14, 25].forEach((px, index) => { ctx.beginPath(); ctx.arc(px, -21 + (index % 2) * 5, 4 + (index % 3), 0, TAU); ctx.fill(); });
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(-6, 4, 3, 0, TAU); ctx.arc(6, 4, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(-10, 24); ctx.lineTo(-17, 37); ctx.moveTo(10, 24); ctx.lineTo(17, 37); ctx.stroke();
    } else if (style === 'drone') {
      ctx.beginPath(); ctx.moveTo(-27, -12); ctx.lineTo(0, -28); ctx.lineTo(29, -10); ctx.lineTo(24, 18); ctx.lineTo(-22, 20); ctx.closePath(); fill(dark);
      ctx.beginPath(); ctx.ellipse(0, -3, 18, 13, 0, 0, TAU); fill();
      ctx.fillStyle = light; ctx.fillRect(-12, -6, 24, 6);
      ctx.fillStyle = color; ctx.fillRect(-3, -7, 7, 8);
      ctx.strokeStyle = color; [-1, 1].forEach((side) => { ctx.beginPath(); ctx.moveTo(side * 20, 8); ctx.lineTo(side * 38, 22); ctx.lineTo(side * 26, 29); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -40); ctx.arc(0, -43, 3, 0, TAU); ctx.stroke();
    } else if (style === 'wraith') {
      ctx.beginPath(); ctx.moveTo(-24, -22); ctx.quadraticCurveTo(0, -37, 24, -22); ctx.lineTo(18, 17); ctx.lineTo(8, 34); ctx.lineTo(0, 22); ctx.lineTo(-10, 35); ctx.lineTo(-20, 16); ctx.closePath(); fill(hexToRgba(color, .72));
      ctx.fillStyle = outline; ctx.beginPath(); ctx.ellipse(0, -13, 15, 11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(-6, -14, 2.6, 0, TAU); ctx.arc(6, -14, 2.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexToRgba(color, .5); ctx.beginPath(); ctx.arc(0, -5, 39, 0, TAU); ctx.stroke();
    } else if (style === 'mask') {
      ctx.beginPath(); ctx.ellipse(0, -4, 27, 34, 0, 0, TAU); fill(light);
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(-18, -11); ctx.lineTo(-4, -16); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(18, -11); ctx.lineTo(4, -16); ctx.lineTo(9, -3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 4 / s; ctx.beginPath(); ctx.arc(0, 6, 12, .2, Math.PI - .2); ctx.stroke();
      ctx.strokeStyle = hexToRgba(color, .65); ctx.beginPath(); ctx.moveTo(-24, 15); ctx.quadraticCurveTo(-43, 23, -38, 39); ctx.moveTo(24, 15); ctx.quadraticCurveTo(43, 23, 38, 39); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); fill();
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(-7, -5, 3, 0, TAU); ctx.arc(7, -5, 3, 0, TAU); ctx.fill();
    }

    if (options.mark) {
      ctx.strokeStyle = hexToRgba(light, .7);
      ctx.lineWidth = 1.5 / s;
      ctx.beginPath(); ctx.arc(0, -3, 48 + stage * 3, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  class Game {
    constructor() {
      this.input = new InputManager();
      this.audio = new AudioEngine();
      this.state = null;
      this.saveStore = createSaveStore(gameStorage, {
        migrate: (candidate) => {
          this.assertSaveCandidate(candidate);
          return this.migrateState(candidate);
        },
        validate: (candidate) => this.validateMigratedSave(candidate),
      });
      this.mode = 'title';
      this.lastTime = performance.now();
      this.elapsed = 0;
      this.autosaveTimer = 0;
      this.toastTimer = 0;
      this.flash = 0;
      this.fade = 0;
      this.fadeColor = '#050711';
      this.shake = 0;
      this.nearestInteractable = null;
      this.dialogueQueue = [];
      this.dialogueCallback = null;
      this.dialogueTyping = null;
      this.menuTab = 'partner';
      this.serviceType = null;
      this.battle = null;
      this.partnerTrail = Array.from({ length: 16 }, () => ({ x: 480, y: 380 }));
      this.particles = [];
      this.worldParticles = Array.from({ length: 70 }, (_, i) => ({
        x: seededNoise(i + 5) * W,
        y: seededNoise(i + 20) * H,
        z: .35 + seededNoise(i + 40) * .9,
        phase: seededNoise(i + 60) * TAU,
      }));
      this.screenMessage = '';
      this.pendingAfterDialogue = null;
      this.currentPromptType = '';
      this.debug = false;
      this.selectedDifficulty = 'standard';
      this.achievementTimer = 0;
      this.lastFocusedElement = null;
      this.gamepadCommandIndex = 0;
      this.lastHudSignature = '';
      this.lastRenderTime = 0;
      this.visualGradientCache = new Map();
      this.prefer30Fps = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches || false;
      this.applyAccessibilitySettings();
      this.bindUi();
      this.buildStarterCards();
      this.refreshContinueButton();
      this.refreshStorageWarning();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    bindUi() {
      DOM.newGame.addEventListener('click', () => {
        let hasExistingSave = false;
        try {
          hasExistingSave = this.saveStore.hasSave();
        } catch (error) {
          console.error('Impossible de vérifier les sauvegardes existantes.', error);
        }
        if (hasExistingSave && !window.confirm('Commencer une nouvelle campagne ? La campagne actuelle sera conservée dans les sauvegardes de secours.')) return;
        this.audio.play('ui');
        this.selectedDifficulty = 'standard';
        document.querySelectorAll('[data-difficulty]').forEach((button) => button.classList.toggle('active', button.dataset.difficulty === 'standard'));
        DOM.title.classList.add('hidden');
        DOM.starter.classList.remove('hidden');
        this.mode = 'starter';
        requestAnimationFrame(() => DOM.starterCards.querySelector('button')?.focus());
      });
      document.getElementById('difficulty-select')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-difficulty]');
        if (!button || !hasOwn(DIFFICULTIES, button.dataset.difficulty)) return;
        this.selectedDifficulty = button.dataset.difficulty;
        document.querySelectorAll('[data-difficulty]').forEach((entry) => entry.classList.toggle('active', entry === button));
        this.audio.play('ui');
      });
      DOM.starterBack.addEventListener('click', () => {
        this.audio.play('cancel');
        DOM.starter.classList.add('hidden');
        DOM.title.classList.remove('hidden');
        this.mode = 'title';
        requestAnimationFrame(() => DOM.newGame.focus());
      });
      DOM.continueGame.addEventListener('click', () => {
        this.audio.play('ui');
        this.loadGame();
      });
      DOM.credits.addEventListener('click', () => {
        this.audio.play('ui');
        this.showDialogue('CRÉDITS', [
          'ECHObound : La Cité des Échos — conception originale créée pour Darknigthmare.',
          'Direction : reconstruction d’une ville vide, recrutement de créatures, partenaire évolutif et atmosphère gothique science-fiction.',
          'Programmation, graphismes procéduraux, audio synthétique et outils de production : édition Codex professionnelle 2.0.',
        ], null, { allowOnTitle: true });
      });
      DOM.accessibilityButton.addEventListener('click', () => this.openAccessibilityPanel());
      DOM.accessibilityClose.addEventListener('click', () => this.closeAccessibilityPanel());
      DOM.accessibilityPanel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-accessibility-setting]');
        if (!button) return;
        const setting = button.dataset.accessibilitySetting;
        if (setting === 'audio') this.audio.toggle();
        else this.setAccessibilitySetting(setting, !this.getAccessibilitySettings()[setting]);
        this.refreshAccessibilityControls();
      });
      DOM.dialogueSkip.addEventListener('click', () => this.finishDialogue());
      DOM.dialogue.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return;
        this.advanceDialogue();
      });
      DOM.dialogueChoices.addEventListener('click', (event) => {
        const button = event.target.closest('[data-dialogue-choice]');
        if (!button) return;
        const choice = this.dialogueOptions?.choices?.[Number(button.dataset.dialogueChoice)];
        if (choice) this.selectDialogueChoice(choice);
      });
      DOM.canvas.addEventListener('pointerdown', () => DOM.canvas.focus());
      DOM.touchAction.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.handleAction();
      });
      DOM.touchMenu.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.toggleMenu();
      });
      DOM.mute.addEventListener('click', () => this.audio.toggle());
      DOM.fullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) document.getElementById('game-shell').requestFullscreen?.();
        else document.exitFullscreen?.();
      });
      document.querySelectorAll('[data-close]').forEach((button) => {
        button.addEventListener('click', () => {
          this.audio.play('cancel');
          this.closeOverlays();
        });
      });
      DOM.menuTabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tab]');
        if (!button) return;
        this.audio.play('ui');
        this.menuTab = button.dataset.tab;
        DOM.menuTabs.querySelectorAll('button').forEach((entry) => entry.classList.toggle('active', entry === button));
        this.renderMenu();
      });
      DOM.menuContent.addEventListener('click', (event) => this.handleMenuClick(event));
      DOM.saveFileInput?.addEventListener('change', async () => {
        const file = DOM.saveFileInput.files?.[0];
        DOM.saveFileInput.value = '';
        if (file) await this.importSaveFile(file);
      });
      DOM.serviceContent.addEventListener('click', (event) => this.handleServiceClick(event));
      DOM.battleCommands.addEventListener('click', (event) => {
        const button = event.target.closest('[data-command]');
        if (button) this.battleCommand(button.dataset.command);
      });
      DOM.continueAfterEnding.addEventListener('click', () => {
        DOM.ending.classList.add('hidden');
        DOM.hud.classList.remove('hidden');
        document.body.classList.add('game-active');
        document.body.classList.remove('in-battle');
        this.mode = 'world';
        this.state.flags.endingSeen = true;
        this.changeMap('city', 480, 360);
        this.saveGame();
      });
      DOM.newCycle.addEventListener('click', () => this.beginNewCycle());

      window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!DOM.accessibilityPanel.classList.contains('hidden')) {
          event.preventDefault();
          this.closeAccessibilityPanel();
        }
      });

      window.addEventListener('beforeunload', () => {
        if (this.state) this.saveGame(false);
      });
      window.addEventListener('pagehide', () => {
        if (this.state) this.saveGame(false);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state) this.saveGame(false);
      });
    }

    buildStarterCards() {
      DOM.starterCards.innerHTML = '';
      STARTERS.forEach((starter) => {
        const button = document.createElement('button');
        button.className = 'starter-card';
        button.style.setProperty('--accent', starter.accent);
        button.innerHTML = `
          <div class="starter-art">${starter.glyph}</div>
          <h3>${starter.name} · ${starter.form}</h3>
          <p>${starter.description}</p>
          <ul>${starter.strengths.map((entry) => `<li>${entry}</li>`).join('')}</ul>
        `;
        button.addEventListener('click', () => {
          this.audio.play('ui');
          this.startNewGame(starter.id, this.selectedDifficulty);
        });
        DOM.starterCards.appendChild(button);
      });
    }

    refreshContinueButton() {
      let hasSave = false;
      try {
        hasSave = this.saveStore.hasSave();
      } catch (error) {
        console.error('Impossible de lire le stockage des sauvegardes.', error);
      }
      DOM.continueGame.disabled = !hasSave;
      DOM.continueGame.textContent = hasSave ? (gameStorage.persistent ? 'CONTINUER' : 'CONTINUER DANS CET ONGLET') : 'AUCUNE SAUVEGARDE';
    }

    refreshStorageWarning() {
      if (gameStorage.persistent || this.storageNoticeShown) return;
      this.storageNoticeShown = true;
      const message = 'Stockage indisponible : partie conservée dans cet onglet uniquement. Exporte le JSON depuis Système avant de fermer ou recharger.';
      const titleHelp = DOM.title.querySelector('.title-help');
      if (titleHelp) titleHelp.textContent = message;
      this.toast(message, 9000);
    }

    startNewGame(starterId, difficultyId = this.selectedDifficulty) {
      const starter = STARTERS.find((entry) => entry.id === starterId) || STARTERS[0];
      this.state = makeDefaultState(starter);
      this.state.difficulty = hasOwn(DIFFICULTIES, difficultyId) ? difficultyId : 'standard';
      document.body.classList.add('game-active');
      document.body.classList.remove('in-battle');
      this.mode = 'world';
      this.partnerTrail = Array.from({ length: 16 }, () => ({ x: this.state.player.x, y: this.state.player.y + 24 }));
      DOM.starter.classList.add('hidden');
      DOM.title.classList.add('hidden');
      DOM.ending.classList.add('hidden');
      DOM.hud.classList.remove('hidden');
      this.fade = 1;
      this.applyAccessibilitySettings();
      this.ensureDailyContract();
      this.saveGame(false);
      this.updateHud();
      this.showDialogue('LE CŒUR DE NOX ARCA', [
        'Réveil incomplet. Population détectée : zéro. Quartiers opérationnels : zéro. Mémoire centrale : fragmentée.',
        `${starter.name} s’est matérialisé depuis le dernier battement du Cœur. Il n’obéira pas comme une arme : il grandira selon tes choix, tes soins et la manière dont tu lui parles.`,
        'La Porte nord mène aux Friches. Les anciens habitants de la cité s’y sont retranchés. Retrouve-les, affronte leurs raisons de rester et donne-leur envie de rentrer.',
        'Première cible probable : BRAKK-9, forgeron des Carcasses. Sans forge, Nox Arca ne survivra pas au prochain cycle.',
      ], () => {
        this.state.flags.introDone = true;
        this.toast('Objectif : trouver Brakk-9 dans les Friches du Portail.');
        this.saveGame(false);
      });
    }

    assertSaveCandidate(candidate) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('La racine de la sauvegarde doit être un objet.');
      }
      if (!candidate.partner || typeof candidate.partner !== 'object' || Array.isArray(candidate.partner)) {
        throw new Error('Le partenaire est absent ou invalide.');
      }
      if (typeof candidate.map !== 'string' || !candidate.map.trim()) {
        throw new Error('La zone de jeu est absente ou invalide.');
      }
      if (candidate.version !== undefined) {
        const match = String(candidate.version).match(/^(\d+)/);
        if (!match || Number(match[1]) > 2) {
          throw new Error('Cette sauvegarde provient d’une version future incompatible.');
        }
      }
      return true;
    }

    validateMigratedSave(candidate) {
      const finite = (value, min = 0, max = SAVE_VALUE_LIMITS.counter) => Number.isFinite(value) && value >= min && value <= max;
      const numericRecord = (value, min = 0, max = SAVE_VALUE_LIMITS.counter) => value
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.values(value).every((entry) => finite(entry, min, max));
      const exactRoot = candidate
        && Object.keys(candidate).length === SAVE_ROOT_KEYS.size
        && Object.keys(candidate).every((key) => SAVE_ROOT_KEYS.has(key));
      const partnerNumbers = [
        'level', 'xp', 'maxHp', 'hp', 'maxMp', 'mp', 'power', 'guard', 'spirit', 'speed',
        'bond', 'discipline', 'morale', 'hunger', 'fatigue', 'careMistakes', 'ageDays', 'rebirths',
      ];
      const rootNumbers = [
        'createdAt', 'savedAt', 'playSeconds', 'credits', 'timeMinutes', 'lastSleepDay',
        'dailyClinicDay', 'expeditionReadyAt', 'forgeLevel', 'trainingLevel', 'arenaWins',
        'newCycleBonus', 'cycleCount',
      ];
      const validContract = candidate?.contract === null || (
        candidate.contract
        && typeof candidate.contract === 'object'
        && !Array.isArray(candidate.contract)
        && REGION_IDS.includes(candidate.contract.map)
        && SAVE_ITEM_IDS.has(candidate.contract.rewardItem)
        && ['day', 'target', 'progress', 'rewardCredits', 'rewardAmount'].every((key) => finite(candidate.contract[key]))
        && typeof candidate.contract.completed === 'boolean'
        && typeof candidate.contract.claimed === 'boolean'
      );
      const validChronicles = candidate?.chronicleProgress
        && typeof candidate.chronicleProgress === 'object'
        && !Array.isArray(candidate.chronicleProgress)
        && candidate?.chronicleChoices
        && typeof candidate.chronicleChoices === 'object'
        && !Array.isArray(candidate.chronicleChoices)
        && Object.entries(candidate.chronicleProgress).every(([id, progress]) => (
          SAVE_CHRONICLE_IDS.has(id)
          && Number.isInteger(progress)
          && progress >= 0
          && progress <= MAX_CHRONICLE_PROGRESS
        ))
        && Object.entries(candidate.chronicleChoices).every(([id, choiceId]) => (
          isChronicleChoiceId(id, choiceId)
          && candidate.chronicleProgress[id] === MAX_CHRONICLE_PROGRESS
        ))
        && CHRONICLE_IDS.every((id) => {
          const progress = Number(candidate.chronicleProgress[id] || 0);
          const hasSource = Boolean(getChronicleSourceChoice(REGIONAL_CHRONICLES[id], candidate));
          return (progress < 1 || hasSource)
            && (progress !== MAX_CHRONICLE_PROGRESS || isChronicleChoiceId(id, candidate.chronicleChoices[id]));
        });
      return exactRoot
        && candidate.version === VERSION
        && Boolean(MAPS[candidate.map])
        && Boolean(candidate.partner)
        && typeof candidate.partner.name === 'string'
        && candidate.partner.name.length > 0
        && candidate.partner.name.length <= SAVE_VALUE_LIMITS.nameLength
        && finite(candidate.player?.x)
        && finite(candidate.player?.y)
        && partnerNumbers.every((key) => finite(candidate.partner[key], 0, key === 'level' ? SAVE_VALUE_LIMITS.level : SAVE_VALUE_LIMITS.counter))
        && candidate.partner.maxHp > 0
        && candidate.partner.level >= 1
        && rootNumbers.every((key) => finite(candidate[key], 0, key === 'createdAt' || key === 'savedAt' ? Number.MAX_SAFE_INTEGER : SAVE_VALUE_LIMITS.counter))
        && typeof candidate.expeditionActive === 'boolean'
        && typeof candidate.arenaEliteRewardClaimed === 'boolean'
        && typeof candidate.finalBossDefeated === 'boolean'
        && Object.values(candidate.settings).every((value) => typeof value === 'boolean')
        && numericRecord(candidate.inventory)
        && numericRecord(candidate.regionWins)
        && numericRecord(candidate.wins)
        && numericRecord(candidate.worldDefeated)
        && numericRecord(candidate.sectorVisits)
        && numericRecord(candidate.sanctuaryVisits)
        && validChronicles
        && Object.entries(candidate.flags).every(([key, value]) => (
          key === 'trackedResident'
            ? typeof value === 'string' && hasOwn(RESIDENTS, value)
            : WORLD_SAVE_METADATA.flagKeys.has(key) && typeof value === 'boolean'
        ))
        && validContract
        && hasOwn(DIFFICULTIES, candidate.difficulty)
        && hasOwn(FORMS, candidate.partner.formId)
        && Array.isArray(candidate.partner.evolutions)
        && candidate.partner.evolutions.every((formId) => hasOwn(FORMS, formId));
    }

    activateLoadedState(state, label = 'principale') {
      this.state = state;
      document.body.classList.add('game-active');
      document.body.classList.remove('in-battle');
      this.mode = this.state.finalBossDefeated && !this.state.flags.endingSeen ? 'ending' : 'world';
      DOM.title.classList.add('hidden');
      DOM.starter.classList.add('hidden');
      DOM.hud.classList.remove('hidden');
      DOM.ending.classList.toggle('hidden', this.mode !== 'ending');
      this.partnerTrail = Array.from({ length: 16 }, () => ({ x: this.state.player.x, y: this.state.player.y + 24 }));
      this.applyAccessibilitySettings();
      this.ensureDailyContract();
      this.updateHud();
      this.toast(label === 'principale' ? 'Sauvegarde chargée.' : `Sauvegarde ${label} récupérée et migrée.`, 3400);
      this.fade = 1;
      if (this.mode === 'ending') this.showEnding();
    }

    loadGame(raw = null) {
      try {
        const loaded = raw === null
          ? this.saveStore.load()
          : { state: this.saveStore.decodeSave(raw), source: 'import', raw: String(raw), recovered: false };
        if (!loaded) return false;

        const label = loaded.source === 'primary'
          ? 'principale'
          : loaded.source === 'legacy'
            ? 'ancienne version'
            : loaded.source === 'backup'
              ? `secours ${loaded.backupIndex}`
              : 'importée';
        this.activateLoadedState(loaded.state, label);

        const normalized = JSON.stringify(loaded.state);
        if (loaded.source !== 'primary' || loaded.raw !== normalized) {
          this.saveStore.save(loaded.state);
          this.refreshContinueButton();
        }
        return true;
      } catch (error) {
        console.error('Échec de chargement des sauvegardes disponibles.', error);
        this.toast('Toutes les sauvegardes disponibles sont illisibles. Aucune donnée n’a été écrasée.', 4800);
        return false;
      }
    }

    migrateState(parsed) {
      const legacyRegionMap = REGION_IDS.includes(parsed?.map);
      const starter = STARTERS.find((entry) => entry.id === parsed?.partner?.starter) || STARTERS[0];
      const base = makeDefaultState(starter);
      const sourcePlayer = parsed.player && typeof parsed.player === 'object' ? parsed.player : {};
      const sourcePartner = parsed.partner && typeof parsed.partner === 'object' ? parsed.partner : {};
      const sourceFlags = parsed.flags && typeof parsed.flags === 'object' ? parsed.flags : {};
      const uniqueKnown = (value, predicate, maxEntries = SAVE_VALUE_LIMITS.recordEntries) => Array.from(new Set(Array.isArray(value) ? value : []))
        .filter(predicate)
        .slice(0, maxEntries);
      const resolvedMap = resolveMapId(boundedString(parsed.map, 'city', 128));
      const mapId = SAVE_MAP_IDS.has(resolvedMap) ? resolvedMap : 'city';
      const currentMap = MAPS[mapId];
      const spawn = currentMap.spawn || { x: 480, y: 360, facing: 'down' };
      const maxHp = boundedNumber(sourcePartner.maxHp, base.partner.maxHp, { min: 1, max: SAVE_VALUE_LIMITS.stat });
      const maxMp = boundedNumber(sourcePartner.maxMp, base.partner.maxMp, { min: 0, max: SAVE_VALUE_LIMITS.stat });
      const inventory = {
        ...base.inventory,
        ...sanitizeNumberRecord(parsed.inventory, {
          allowedKeys: SAVE_ITEM_IDS,
          min: 0,
          max: SAVE_VALUE_LIMITS.counter,
          integer: true,
        }),
      };
      const recruited = uniqueKnown(parsed.recruited, (id) => typeof id === 'string' && hasOwn(RESIDENTS, id), Object.keys(RESIDENTS).length);
      const unlockedMaps = uniqueKnown(['wastes', ...(Array.isArray(parsed.unlockedMaps) ? parsed.unlockedMaps : [])], (id) => hasOwn(WORLD_LAYOUTS, id) || id === 'void', REGION_IDS.length + 1);
      const discoveredSectors = uniqueKnown(['city', ...(Array.isArray(parsed.discoveredSectors) ? parsed.discoveredSectors : []), mapId], (id) => SAVE_MAP_IDS.has(id), SAVE_MAP_IDS.size);
      const knownAchievementIds = new Set(ACHIEVEMENTS.map(({ id }) => id));
      const boolFlags = {
        ...base.flags,
        ...sanitizeBooleanRecord(sourceFlags, WORLD_SAVE_METADATA.flagKeys),
      };
      if (typeof sourceFlags.trackedResident === 'string' && hasOwn(RESIDENTS, sourceFlags.trackedResident)) {
        boolFlags.trackedResident = sourceFlags.trackedResident;
      }
      const newCycleBonus = boundedInteger(parsed.newCycleBonus, base.newCycleBonus, { min: 0, max: 10_000 });
      const requestedCycleCount = parsed.cycleCount ?? Math.floor(newCycleBonus / 2);
      const merged = {
        version: VERSION,
        createdAt: boundedInteger(parsed.createdAt, base.createdAt, { min: 0, max: Number.MAX_SAFE_INTEGER }),
        savedAt: boundedInteger(parsed.savedAt, base.savedAt, { min: 0, max: Number.MAX_SAFE_INTEGER }),
        difficulty: hasOwn(DIFFICULTIES, parsed.difficulty) ? parsed.difficulty : base.difficulty,
        settings: {
          reducedMotion: strictBoolean(parsed.settings?.reducedMotion, base.settings.reducedMotion),
          highContrast: strictBoolean(parsed.settings?.highContrast, base.settings.highContrast),
          largeText: strictBoolean(parsed.settings?.largeText, base.settings.largeText),
        },
        playSeconds: boundedNumber(parsed.playSeconds, base.playSeconds, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        map: mapId,
        player: {
          x: boundedNumber(sourcePlayer.x, spawn.x, { min: 22, max: W - 22 }),
          y: boundedNumber(sourcePlayer.y, spawn.y, { min: 78, max: H - 22 }),
          facing: ['up', 'down', 'left', 'right'].includes(sourcePlayer.facing) ? sourcePlayer.facing : (spawn.facing || 'down'),
        },
        partner: {
          name: boundedString(sourcePartner.name, base.partner.name, SAVE_VALUE_LIMITS.nameLength).toUpperCase(),
          starter: STARTERS.some(({ id }) => id === sourcePartner.starter) ? sourcePartner.starter : starter.id,
          formId: hasOwn(FORMS, sourcePartner.formId) ? sourcePartner.formId : starter.formId,
          level: boundedInteger(sourcePartner.level, base.partner.level, { min: 1, max: SAVE_VALUE_LIMITS.level }),
          xp: boundedInteger(sourcePartner.xp, base.partner.xp, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
          maxHp,
          hp: boundedNumber(sourcePartner.hp, maxHp, { min: 1, max: maxHp }),
          maxMp,
          mp: boundedNumber(sourcePartner.mp, maxMp, { min: 0, max: maxMp }),
          power: boundedNumber(sourcePartner.power, base.partner.power, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          guard: boundedNumber(sourcePartner.guard, base.partner.guard, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          spirit: boundedNumber(sourcePartner.spirit, base.partner.spirit, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          speed: boundedNumber(sourcePartner.speed, base.partner.speed, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          bond: boundedNumber(sourcePartner.bond, base.partner.bond, { min: 0, max: 100 }),
          discipline: boundedNumber(sourcePartner.discipline, base.partner.discipline, { min: 0, max: 100 }),
          morale: boundedNumber(sourcePartner.morale, base.partner.morale, { min: 0, max: 100 }),
          hunger: boundedNumber(sourcePartner.hunger, base.partner.hunger, { min: 0, max: 100 }),
          fatigue: boundedNumber(sourcePartner.fatigue, base.partner.fatigue, { min: 0, max: 100 }),
          careMistakes: boundedInteger(sourcePartner.careMistakes, base.partner.careMistakes, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          ageDays: boundedInteger(sourcePartner.ageDays, base.partner.ageDays, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          rebirths: boundedInteger(sourcePartner.rebirths, base.partner.rebirths, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
          evolutions: uniqueKnown(sourcePartner.evolutions, (formId) => typeof formId === 'string' && hasOwn(FORMS, formId), Object.keys(FORMS).length),
        },
        credits: boundedInteger(parsed.credits, base.credits, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        inventory,
        recruited,
        flags: boolFlags,
        unlockedMaps,
        discoveredSectors,
        sectorVisits: sanitizeNumberRecord(parsed.sectorVisits, { allowedKeys: SAVE_MAP_IDS, min: 0, max: SAVE_VALUE_LIMITS.counter, integer: true }),
        sanctuaryVisits: sanitizeNumberRecord(parsed.sanctuaryVisits, { allowedKeys: WORLD_SAVE_METADATA.sanctuaryIds, min: 0, max: SAVE_VALUE_LIMITS.counter, integer: true }),
        expeditionChoices: sanitizeChoiceRecord(parsed.expeditionChoices, WORLD_SAVE_METADATA.choiceIds),
        chronicleProgress: sanitizeNumberRecord(parsed.chronicleProgress, { allowedKeys: SAVE_CHRONICLE_IDS, min: 0, max: MAX_CHRONICLE_PROGRESS, integer: true }),
        chronicleChoices: sanitizeChoiceRecord(parsed.chronicleChoices, isChronicleChoiceId),
        patrolVictories: uniqueKnown(parsed.patrolVictories, (id) => WORLD_SAVE_METADATA.patrolIds.has(id), WORLD_SAVE_METADATA.patrolIds.size),
        wins: sanitizeNumberRecord(parsed.wins, { min: 0, max: SAVE_VALUE_LIMITS.counter, integer: true }),
        regionWins: {
          ...base.regionWins,
          ...sanitizeNumberRecord(parsed.regionWins, { allowedKeys: SAVE_REGION_IDS, min: 0, max: SAVE_VALUE_LIMITS.counter, integer: true }),
        },
        worldDefeated: sanitizeNumberRecord(parsed.worldDefeated, { allowedKeys: WORLD_SAVE_METADATA.patrolIds, min: 0, max: SAVE_VALUE_LIMITS.counter }),
        timeMinutes: boundedNumber(parsed.timeMinutes, base.timeMinutes, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        lastSleepDay: boundedInteger(parsed.lastSleepDay, base.lastSleepDay, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        dailyClinicDay: boundedInteger(parsed.dailyClinicDay, base.dailyClinicDay, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        expeditionReadyAt: boundedNumber(parsed.expeditionReadyAt, base.expeditionReadyAt, { min: 0, max: SAVE_VALUE_LIMITS.counter }),
        expeditionActive: strictBoolean(parsed.expeditionActive, base.expeditionActive),
        forgeLevel: boundedInteger(parsed.forgeLevel, base.forgeLevel, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
        trainingLevel: boundedInteger(parsed.trainingLevel, base.trainingLevel, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
        arenaWins: boundedInteger(parsed.arenaWins, base.arenaWins, { min: 0, max: SAVE_VALUE_LIMITS.stat }),
        arenaEliteRewardClaimed: strictBoolean(parsed.arenaEliteRewardClaimed, base.arenaEliteRewardClaimed),
        journalSeen: uniqueKnown(parsed.journalSeen, (id) => safeIdentifier(id), SAVE_VALUE_LIMITS.recordEntries),
        finalBossDefeated: strictBoolean(parsed.finalBossDefeated, base.finalBossDefeated),
        newCycleBonus,
        cycleCount: boundedInteger(requestedCycleCount, base.cycleCount, { min: 0, max: 99 }),
        cycleModifier: Object.prototype.hasOwnProperty.call(CYCLE_LAWS, parsed.cycleModifier) ? parsed.cycleModifier : base.cycleModifier,
        cycleAnomalies: {
          ...base.cycleAnomalies,
          ...sanitizeBooleanRecord(parsed.cycleAnomalies, new Set(REGION_IDS)),
        },
        cycleEchoes: sanitizeChoiceRecord(parsed.cycleEchoes, WORLD_SAVE_METADATA.choiceIds),
        cityProjects: uniqueKnown(parsed.cityProjects, (id) => typeof id === 'string' && hasOwn(CITY_PROJECTS, id), Object.keys(CITY_PROJECTS).length),
        achievements: uniqueKnown(parsed.achievements, (id) => knownAchievementIds.has(id), knownAchievementIds.size),
        contract: null,
      };
      const proposedX = Number(sourcePlayer.x);
      const proposedY = Number(sourcePlayer.y);
      const safeX = merged.player.x;
      const safeY = merged.player.y;
      const invalidPosition = legacyRegionMap
        || !Number.isFinite(proposedX)
        || !Number.isFinite(proposedY)
        || (currentMap.obstacles || []).some((rect) => circleRectCollision(safeX, safeY, 13, rect));
      merged.player.x = invalidPosition ? spawn.x : safeX;
      merged.player.y = invalidPosition ? spawn.y : safeY;
      merged.player.facing = ['up', 'down', 'left', 'right'].includes(merged.player.facing)
        ? merged.player.facing
        : (spawn.facing || 'down');
      if (legacyRegionMap) merged.player.facing = spawn.facing || 'down';
      for (const regionId of REGION_IDS) {
        if (merged.flags[`shard_${regionId}`]) merged.flags[`guardian_${regionId}_defeated`] = true;
      }
      if (!merged.partner.evolutions.includes(merged.partner.formId)) merged.partner.evolutions.unshift(merged.partner.formId);
      for (const chronicleId of CHRONICLE_IDS) {
        const chronicle = REGIONAL_CHRONICLES[chronicleId];
        if (Number(merged.chronicleProgress[chronicleId] || 0) >= 1 && !getChronicleSourceChoice(chronicle, merged)) {
          delete merged.chronicleProgress[chronicleId];
          delete merged.chronicleChoices[chronicleId];
          continue;
        }
        const completed = merged.chronicleProgress[chronicleId] === MAX_CHRONICLE_PROGRESS;
        const validChoice = isChronicleChoiceId(chronicleId, merged.chronicleChoices[chronicleId]);
        if (completed && !validChoice) merged.chronicleProgress[chronicleId] = MAX_CHRONICLE_PROGRESS - 1;
        if (!completed || !validChoice) delete merged.chronicleChoices[chronicleId];
      }

      const rawContract = parsed.contract;
      const currentDay = formatTime(merged.timeMinutes).day;
      if (rawContract && typeof rawContract === 'object' && !Array.isArray(rawContract)
        && boundedInteger(rawContract.day, -1, { min: -1, max: SAVE_VALUE_LIMITS.counter }) === currentDay) {
        const eligibleRegions = REGION_IDS.filter((id) => id === 'wastes' || merged.unlockedMaps.includes(id));
        const contractMap = eligibleRegions.includes(rawContract.map) ? rawContract.map : 'wastes';
        const target = 3 + (currentDay % 3);
        const progress = boundedInteger(rawContract.progress, 0, { min: 0, max: target });
        const completed = progress >= target;
        const lootByMap = { wastes: 'scrap', hive: 'spore', fog: 'incense', foundry: 'scrap' };
        merged.contract = {
          day: currentDay,
          map: contractMap,
          target,
          progress,
          completed,
          claimed: completed && strictBoolean(rawContract.claimed, false),
          rewardCredits: Math.min(240, 85 + currentDay * 6),
          rewardItem: lootByMap[contractMap] || 'ration',
          rewardAmount: 1 + (currentDay % 2),
        };
      }
      return merged;
    }

    applyAccessibilitySettings() {
      const settings = this.getAccessibilitySettings();
      if (this.state) this.state.settings = { ...settings };
      persistAccessibilitySettings(settings);
      document.body.classList.toggle('reduced-motion', Boolean(settings.reducedMotion));
      document.body.classList.toggle('high-contrast', Boolean(settings.highContrast));
      document.body.classList.toggle('large-text', Boolean(settings.largeText));
      if (settings.reducedMotion) {
        this.shake = 0;
        this.flash = 0;
        this.particles = [];
      }
      this.refreshAccessibilityControls();
    }

    getAccessibilitySettings() {
      return this.state?.settings || readAccessibilitySettings();
    }

    setAccessibilitySetting(setting, value) {
      if (!['reducedMotion', 'highContrast', 'largeText'].includes(setting)) return;
      const settings = { ...this.getAccessibilitySettings(), [setting]: Boolean(value) };
      if (this.state) this.state.settings = settings;
      persistAccessibilitySettings(settings);
      this.applyAccessibilitySettings();
      if (this.state) this.saveGame(false);
    }

    refreshAccessibilityControls() {
      if (!DOM.accessibilityPanel) return;
      const settings = this.getAccessibilitySettings();
      const labels = {
        reducedMotion: settings.reducedMotion ? 'RÉACTIVER LES ANIMATIONS' : 'RÉDUIRE LES ANIMATIONS',
        highContrast: settings.highContrast ? 'CONTRASTE NORMAL' : 'CONTRASTE RENFORCÉ',
        largeText: settings.largeText ? 'TAILLE DE TEXTE NORMALE' : 'AGRANDIR LE TEXTE',
        audio: this.audio?.muted ? 'ACTIVER LE SON' : 'COUPER LE SON',
      };
      DOM.accessibilityPanel.querySelectorAll('[data-accessibility-setting]').forEach((button) => {
        const setting = button.dataset.accessibilitySetting;
        const active = setting === 'audio' ? Boolean(this.audio?.muted) : Boolean(settings[setting]);
        button.textContent = labels[setting];
        button.setAttribute('aria-pressed', String(active));
      });
    }

    openAccessibilityPanel() {
      this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      DOM.accessibilityPanel.classList.remove('hidden');
      this.refreshAccessibilityControls();
      requestAnimationFrame(() => DOM.accessibilityClose.focus());
    }

    closeAccessibilityPanel() {
      DOM.accessibilityPanel.classList.add('hidden');
      this.restoreFocus();
    }

    restoreFocus() {
      if (this.lastFocusedElement?.isConnected) this.lastFocusedElement.focus();
      else DOM.canvas?.focus();
      this.lastFocusedElement = null;
    }

    announce(message) {
      if (!DOM.screenReaderStatus) return;
      DOM.screenReaderStatus.textContent = '';
      requestAnimationFrame(() => { DOM.screenReaderStatus.textContent = message; });
    }

    saveGame(showToast = true) {
      // Pendant un combat, le disque conserve le checkpoint monde antérieur aux dépenses/dégâts.
      if (!this.state || this.mode === 'battle') return false;
      try {
        this.state.version = VERSION;
        this.state.savedAt = Date.now();
        this.saveStore.save(this.state);
        this.refreshContinueButton();
        this.refreshStorageWarning();
        if (showToast) this.toast(gameStorage.persistent
          ? 'Sauvegarde effectuée · historique de secours sécurisé.'
          : 'Copie en mémoire seulement : télécharge le JSON avant de fermer ou recharger cet onglet.', 4200);
        return gameStorage.persistent;
      } catch (error) {
        // createSaveStore a terminé son rollback sur disque avant le passage en mémoire.
        if (error.code === 'STORAGE_WRITE_FAILED') gameStorage.useMemory();
        if (!this.storageWriteErrorReported) console.error('Échec de sauvegarde avec restauration atomique.', error);
        this.storageWriteErrorReported = true;
        this.refreshStorageWarning();
        if (showToast) this.toast('Impossible d’écrire la sauvegarde. La version précédente a été préservée.', 4200);
        return false;
      }
    }

    exportSave(format = 'base64') {
      if (!this.state) return '';
      return this.saveStore.exportSave(this.state, format);
    }

    importSave(payload, label = 'importée') {
      try {
        const imported = this.saveStore.importSave(payload);
        this.activateLoadedState(imported.state, label);
        this.refreshContinueButton();
        this.closeOverlays();
        this.toast('Sauvegarde importée et vérifiée. La partie précédente reste dans l’historique de secours.', 4800);
        return true;
      } catch (error) {
        if (error.code === 'STORAGE_WRITE_FAILED') gameStorage.useMemory();
        this.refreshStorageWarning();
        console.warn('Import de sauvegarde refusé avant écriture.', error);
        this.toast('Sauvegarde invalide ou incompatible. Aucune donnée n’a été modifiée.', 4500);
        return false;
      }
    }

    async importSaveFile(file) {
      if (file.size > SaveSystem.DEFAULT_LIMITS.maxBytes) {
        this.toast('Ce fichier dépasse la taille maximale autorisée de 2 Mio.', 4200);
        return false;
      }
      try {
        const payload = await file.text();
        return this.importSave(payload, 'fichier JSON');
      } catch (error) {
        console.warn('Lecture du fichier de sauvegarde impossible.', error);
        this.toast('Impossible de lire ce fichier de sauvegarde.', 4200);
        return false;
      }
    }

    downloadSaveFile() {
      try {
        const compactJson = this.exportSave('json');
        const payload = JSON.stringify(JSON.parse(compactJson), null, 2);
        const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `echobound-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        const objectUrl = link.href;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        this.toast('Fichier JSON vérifié et généré.');
      } catch (error) {
        console.error('Échec de l’export JSON.', error);
        this.toast('Impossible de générer le fichier de sauvegarde.', 3800);
      }
    }

    restoreLatestBackup() {
      const candidates = BACKUP_SAVE_KEYS
        .map((key, index) => ({ raw: gameStorage.getItem(key), index: index + 1 }))
        .filter((entry) => entry.raw);
      for (const candidate of candidates) {
        try {
          this.saveStore.decodeSave(candidate.raw);
          if (!window.confirm(`Restaurer la copie de secours ${candidate.index} ? La partie actuelle sera conservée dans l’historique.`)) return false;
          return this.importSave(candidate.raw, `secours ${candidate.index}`);
        } catch (error) {
          console.warn(`Copie de secours ${candidate.index} illisible.`, error);
        }
      }
      this.toast('Aucune copie de secours lisible.', 3600);
      return false;
    }

    loop(now) {
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      const reducedMotion = this.getAccessibilitySettings().reducedMotion;
      if (!reducedMotion) this.elapsed += dt;
      this.update(dt);
      const renderInterval = reducedMotion || this.prefer30Fps ? 1000 / 30 : 0;
      if (!renderInterval || this.lastRenderTime === 0 || now - this.lastRenderTime >= renderInterval) {
        this.render();
        this.lastRenderTime = renderInterval
          ? now - ((now - this.lastRenderTime) % renderInterval)
          : now;
      }
      this.input.endFrame();
      requestAnimationFrame(this.loop);
    }

    update(dt) {
      this.refreshStorageWarning();
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) DOM.toast.classList.add('hidden');
      }
      const reducedMotion = this.getAccessibilitySettings().reducedMotion;
      const audioTheme = MAPS[this.state?.map]?.theme || 'city';
      const audioActive = Boolean(this.state && !['title', 'starter', 'ending'].includes(this.mode));
      this.audio.update(audioTheme, performance.now() / 1000, reducedMotion, audioActive);
      if (reducedMotion) {
        this.flash = 0;
        this.fade = 0;
        this.shake = 0;
        this.particles = [];
      } else {
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
        if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 1.55);
        if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.8);
        this.updateParticles(dt);
      }

      const gamepad = this.input.pollGamepad();
      if (!DOM.accessibilityPanel.classList.contains('hidden')) {
        this.updateGamepadUi(gamepad, DOM.accessibilityPanel);
        return;
      }
      // Le dialogue peut couvrir le titre : la modale visible reçoit toujours les commandes.
      if (!DOM.dialogue.classList.contains('hidden')) {
        if (DOM.dialogueChoices.childElementCount) this.updateGamepadUi(gamepad, DOM.dialogue);
        else if (this.input.consume(' ', 'enter', 'e') || gamepad.action) this.advanceDialogue();
        return;
      }
      if (this.mode === 'title' || this.mode === 'starter' || this.mode === 'ending') {
        const root = this.mode === 'starter' ? DOM.starter : this.mode === 'ending' ? DOM.ending : DOM.title;
        this.updateGamepadUi(gamepad, root);
        return;
      }
      if (!this.state) return;

      this.state.playSeconds += dt;
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= 30) {
        this.autosaveTimer = 0;
        this.saveGame(false);
      }
      this.achievementTimer += dt;
      if (this.achievementTimer >= 1.25) {
        this.achievementTimer = 0;
        this.ensureDailyContract();
        this.checkAchievements();
      }

      if (!DOM.menu.classList.contains('hidden') || !DOM.service.classList.contains('hidden')) {
        const root = !DOM.menu.classList.contains('hidden') ? DOM.menu : DOM.service;
        this.updateGamepadUi(gamepad, root);
        if (this.input.consume('escape', 'm') || gamepad.menu || gamepad.cancel) this.closeOverlays();
        return;
      }
      if (this.mode === 'battle') {
        this.updateBattle(dt, gamepad);
        return;
      }
      if (this.input.consume('m') || gamepad.menu) {
        this.toggleMenu();
        return;
      }
      if (this.input.consume('e', ' ', 'enter') || gamepad.action) this.handleAction();
      this.updateWorld(dt, gamepad);
      this.updateHud();
    }

    updateGamepadUi(gamepad, root) {
      if (!root || (!gamepad.navX && !gamepad.navY && !gamepad.action)) return;
      const controls = [...root.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')]
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      let index = Math.max(0, controls.indexOf(document.activeElement));
      if (gamepad.navX || gamepad.navY) {
        const direction = gamepad.navX || gamepad.navY;
        index = (index + direction + controls.length) % controls.length;
        controls[index].focus();
        controls.forEach((element, itemIndex) => element.classList.toggle('gamepad-selected', itemIndex === index));
        this.audio.play('ui');
      }
      if (gamepad.action) {
        const target = controls.includes(document.activeElement) ? document.activeElement : controls[index];
        target.click();
      }
    }

    updateParticles(dt) {
      for (const particle of this.particles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += (particle.gravity || 0) * dt;
        particle.alpha = clamp(particle.life / particle.maxLife, 0, 1);
      }
      this.particles = this.particles.filter((particle) => particle.life > 0);
    }

    spawnParticles(x, y, color, amount = 12, speed = 80, gravity = 0) {
      if (this.getAccessibilitySettings().reducedMotion) return;
      for (let i = 0; i < amount; i += 1) {
        const angle = rand(0, TAU);
        const velocity = rand(speed * .35, speed);
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          gravity,
          size: rand(1.5, 4.5),
          color,
          life: rand(.35, .9),
          maxLife: 1,
          alpha: 1,
        });
      }
    }

    updateWorld(dt, gamepad) {
      let mx = 0;
      let my = 0;
      if (this.input.isDown('arrowleft', 'a', 'q', 'left')) mx -= 1;
      if (this.input.isDown('arrowright', 'd', 'right')) mx += 1;
      if (this.input.isDown('arrowup', 'w', 'z', 'up')) my -= 1;
      if (this.input.isDown('arrowdown', 's', 'down')) my += 1;
      mx += gamepad.x;
      my += gamepad.y;
      const magnitude = Math.hypot(mx, my);
      if (magnitude > 1) { mx /= magnitude; my /= magnitude; }

      const fatiguePenalty = this.state.partner.fatigue > 85 ? .72 : this.state.partner.fatigue > 65 ? .88 : 1;
      const speed = 150 * fatiguePenalty;
      const moving = Math.abs(mx) + Math.abs(my) > .08;
      if (moving) {
        const dx = mx * speed * dt;
        const dy = my * speed * dt;
        this.tryMove(dx, 0);
        this.tryMove(0, dy);
        if (Math.abs(mx) > Math.abs(my)) this.state.player.facing = mx > 0 ? 'right' : 'left';
        else this.state.player.facing = my > 0 ? 'down' : 'up';
        this.advanceTime(dt * .78, true);
      }

      this.partnerTrail.unshift({ x: this.state.player.x, y: this.state.player.y });
      if (this.partnerTrail.length > 18) this.partnerTrail.pop();

      const interactables = this.getInteractables();
      const nearest = interactables
        .map((entity) => ({ ...entity, distance: Math.hypot(this.state.player.x - entity.x, this.state.player.y - entity.y) }))
        .filter((entity) => entity.distance <= (entity.range || 55))
        .sort((a, b) => a.distance - b.distance)[0] || null;
      this.nearestInteractable = nearest;
      this.updatePrompt(nearest);
    }

    tryMove(dx, dy) {
      const player = this.state.player;
      const radius = 13;
      const nx = clamp(player.x + dx, 22, W - 22);
      const ny = clamp(player.y + dy, 78, H - 22);
      const obstacles = this.getObstacles();
      if (!obstacles.some((rect) => circleRectCollision(nx, ny, radius, rect))) {
        player.x = nx;
        player.y = ny;
      }
    }

    getObstacles() {
      const map = MAPS[this.state.map] || MAPS.city;
      const obstacles = [...(map.obstacles || [])];
      if (map.id === 'city') {
        obstacles.push({ x: 430, y: 230, w: 100, h: 90 });
        for (const residentId of this.state.recruited) {
          const resident = RESIDENTS[residentId];
          const building = resident && BUILDINGS[resident.building];
          if (building) obstacles.push({ x: building.x, y: building.y, w: building.w, h: building.h });
        }
      }
      return obstacles;
    }

    getInteractables() {
      if (!this.state) return [];
      const list = [];
      const map = MAPS[this.state.map];
      if (map.id === 'city') {
        list.push({ type: 'core', id: 'core', x: 480, y: 275, range: 72, label: 'Consulter le Cœur de Nox Arca' });
        for (const residentId of this.state.recruited) {
          const resident = RESIDENTS[residentId];
          const building = resident && BUILDINGS[resident.building];
          if (!resident || !building) continue;
          list.push({
            type: 'building', id: residentId,
            x: building.x + building.w / 2, y: building.y + building.h + 18,
            range: 58, label: `${building.label} · ${resident.name}`,
          });
        }
        for (const portal of this.getCityPortals()) list.push(portal);
      } else {
        if (map.exit) {
          list.push({
            type: 'exit', id: `${map.id}_exit`, x: map.exit.x + map.exit.w / 2, y: map.exit.y + map.exit.h / 2,
            range: 62, label: map.exit.label, data: map.exit,
          });
        }
        if (map.region && map.role === 'entry') {
          const cityPoint = CITY_RETURN_POINTS[map.region] || { x: 480, y: 360 };
          list.push({
            type: 'exit', id: `${map.id}_city_exit`, x: 480, y: 518, range: 38,
            label: 'Retourner à Nox Arca',
            data: { target: 'city', targetX: cityPoint.x, targetY: cityPoint.y },
          });
        }
        if (map.region) {
          const layout = getWorldLayout(map.region);
          for (const transition of getSectorTransitions(map.region, map.id, this.state)) {
            const status = this.getTransitionStatus(transition, map.region);
            const connectionData = layout.connections.find(({ id }) => id === transition.connectionId);
            const activation = connectionData?.unlock?.activation;
            const canActivate = !transition.available && activation?.sectorId === map.id;
            const destination = MAPS[transition.to.sectorId];
            list.push({
              type: canActivate ? 'shortcut-activation' : 'transition',
              id: transition.connectionId,
              x: canActivate ? activation.x : transition.from.x,
              y: canActivate ? activation.y : transition.from.y,
              range: transition.kind === 'shortcut' ? 52 : 58,
              label: canActivate
                ? activation.label
                : status.available
                  ? `${transition.kind === 'shortcut' ? 'Raccourci' : 'Passage'} · ${destination?.name || transition.to.sectorId}`
                  : `Passage scellé · ${status.lockedReason}`,
              unlocked: status.available,
              data: { ...transition, ...status },
            });
          }
          for (const event of map.events || []) {
            if (this.state.flags[event.onceFlag]) continue;
            list.push({ type: 'world-event', id: event.id, x: event.trigger.x, y: event.trigger.y, range: event.trigger.radius, label: `Examiner · ${event.title}`, data: event });
          }
          for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
            const chronicleNode = getChronicleNode(chronicle, this.state);
            if (!chronicleNode || chronicleNode.sectorId !== map.id) continue;
            list.push({
              type: 'chronicle-node',
              id: chronicleNode.id,
              x: chronicleNode.x,
              y: chronicleNode.y,
              range: chronicleNode.radius,
              label: `Chronique · ${chronicleNode.label}`,
              data: { chronicleId: chronicle.id, nodeId: chronicleNode.id },
            });
          }
          if (map.sanctuary) {
            const visit = Number(this.state.sectorVisits[map.id] || 0);
            const used = Number(this.state.sanctuaryVisits[map.sanctuary.id] || 0) === visit;
            list.push({ type: 'sanctuary', id: map.sanctuary.id, x: map.sanctuary.x, y: map.sanctuary.y, range: map.sanctuary.radius, label: used ? `${map.sanctuary.name} · déjà utilisé lors de cette visite` : `Se reposer · ${map.sanctuary.name}`, data: map.sanctuary });
          }
          if (map.guardian && !this.state.flags[map.guardian.defeatFlag]) {
            list.push({ type: 'guardian', id: map.guardian.id, x: map.guardian.x, y: map.guardian.y, range: 72, label: `Défier ${map.guardian.name}`, data: map.guardian });
          }
        }
        const shardFlag = map.shard?.collectFlag || map.shard?.id;
        const shardReady = !map.shard?.requiresFlag || this.state.flags[map.shard.requiresFlag];
        if (map.shard && shardReady && !this.state.flags[shardFlag]) {
          list.push({ type: 'shard', id: shardFlag, x: map.shard.x, y: map.shard.y, range: 48, label: `Recueillir : ${map.shard.name}`, data: map.shard });
        }
        for (const resident of Object.values(RESIDENTS)) {
          if (resident.map !== map.id || this.state.recruited.includes(resident.id)) continue;
          list.push({ type: 'resident', id: resident.id, x: resident.x, y: resident.y, range: 62, label: `Parler à ${resident.name}`, data: resident });
        }
        for (const patrol of map.patrols || []) {
          if (!this.isPatrolActive(patrol.id)) continue;
          const position = this.getPatrolPosition(patrol);
          list.push({ type: 'enemy', id: patrol.id, x: position.x, y: position.y, range: 52, label: `Affronter ${patrol.name}`, data: patrol });
        }
        if (map.boss && !this.state.finalBossDefeated) {
          list.push({ type: 'boss', id: map.boss.id, x: map.boss.x, y: map.boss.y, range: 72, label: `Affronter ${map.boss.name}`, data: map.boss });
        }
      }
      return list;
    }

    getCityPortals() {
      const score = this.getCityScore();
      const shardCount = this.getShardCount();
      return [
        { type: 'portal', id: 'portal_wastes', target: 'wastes', x: 480, y: 105, range: 55, label: 'Porte des Friches', unlocked: true },
        { type: 'portal', id: 'portal_hive', target: 'hive', x: 867, y: 270, range: 55, label: score >= 20 ? 'Porte de la Bio-Ruche' : 'Porte scellée · Cité 20 requise', unlocked: score >= 20 },
        { type: 'portal', id: 'portal_fog', target: 'fog', x: 480, y: 486, range: 55, label: score >= 45 ? 'Porte de la Brume' : 'Porte scellée · Cité 45 requise', unlocked: score >= 45 },
        { type: 'portal', id: 'portal_foundry', target: 'foundry', x: 92, y: 270, range: 55, label: score >= 70 ? 'Porte de la Fonderie' : 'Porte scellée · Cité 70 requise', unlocked: score >= 70 },
        {
          type: 'portal', id: 'portal_void', target: 'void', x: 830, y: 452, range: 58,
          label: this.canEnterVoid() ? 'Porte du Cœur du Néant' : `Sceau final · ${score}/100 · ${shardCount}/4 éclats`,
          unlocked: this.canEnterVoid(),
        },
      ];
    }

    updatePrompt(entity) {
      if (!entity || this.mode !== 'world') {
        DOM.prompt.classList.add('hidden');
        return;
      }
      DOM.prompt.classList.remove('hidden');
      DOM.promptText.textContent = entity.label;
      DOM.promptKey.textContent = 'E';
    }

    handleAction() {
      if (this.mode === 'battle') return;
      if (!DOM.dialogue.classList.contains('hidden')) {
        this.advanceDialogue();
        return;
      }
      if (!DOM.menu.classList.contains('hidden') || !DOM.service.classList.contains('hidden')) return;
      const entity = this.nearestInteractable;
      if (!entity) return;
      this.audio.play('ui');
      if (entity.type === 'core') {
        this.openService('core', 'CŒUR DE NOX ARCA');
      } else if (entity.type === 'building') {
        const resident = RESIDENTS[entity.id];
        if (resident) this.openService(resident.service, resident.name);
      } else if (entity.type === 'portal') {
        if (!entity.unlocked) {
          if (entity.target === 'void') this.toast('Il faut 100 points de cité, les quatre Éclats et Khepri-7 pour briser le dernier sceau.', 3800);
          else this.toast('La cité n’émet pas encore assez d’écho pour alimenter cette porte.');
          return;
        }
        this.changeMap(entity.target);
      } else if (entity.type === 'exit') {
        this.changeMap(entity.data.target, entity.data.targetX, entity.data.targetY);
      } else if (entity.type === 'transition') {
        if (!entity.unlocked) {
          this.toast(entity.data.lockedReason || 'Ce passage est encore scellé.', 3600);
          return;
        }
        const arrival = nudgeFromEdge(entity.data.to);
        this.changeMap(entity.data.to.sectorId, arrival.x, arrival.y, arrival.facing, 12);
      } else if (entity.type === 'shortcut-activation') {
        this.activateShortcut(entity);
      } else if (entity.type === 'world-event') {
        this.openWorldEvent(entity.data);
      } else if (entity.type === 'chronicle-node') {
        this.resolveChronicleNode(entity.data.chronicleId, entity.data.nodeId);
      } else if (entity.type === 'sanctuary') {
        this.useSanctuary(entity.data);
      } else if (entity.type === 'guardian') {
        this.startGuardianBattle(entity.data);
      } else if (entity.type === 'resident') {
        this.attemptResident(entity.id);
      } else if (entity.type === 'enemy') {
        this.startBattle(this.makeEnemy(entity.data));
      } else if (entity.type === 'shard') {
        this.collectShard(entity.data);
      } else if (entity.type === 'boss') {
        this.startFinalBattle();
      }
    }

    changeMap(target, x = null, y = null, facing = null, timeCost = 18) {
      const resolvedTarget = resolveMapId(target);
      if (!MAPS[resolvedTarget]) return;
      this.audio.play('portal');
      this.fade = 1;
      this.fadeColor = MAPS[resolvedTarget].accent || '#080b16';
      this.state.map = resolvedTarget;
      const spawn = MAPS[resolvedTarget].spawn || { x: 480, y: 400 };
      this.state.player.x = x ?? spawn.x;
      this.state.player.y = y ?? spawn.y;
      this.state.player.facing = facing || spawn.facing || this.state.player.facing;
      if (!this.state.discoveredSectors.includes(resolvedTarget)) {
        this.state.discoveredSectors.push(resolvedTarget);
        this.audio.play('discovery');
      }
      this.state.sectorVisits[resolvedTarget] = Number(this.state.sectorVisits[resolvedTarget] || 0) + 1;
      this.partnerTrail = Array.from({ length: 18 }, () => ({ x: this.state.player.x, y: this.state.player.y + 22 }));
      this.advanceTime(timeCost);
      this.nearestInteractable = null;
      this.updatePrompt(null);
      const map = MAPS[resolvedTarget];
      const sectorLabel = map.region ? ` · Secteur ${map.sectorIndex}/${map.sectorCount}` : '';
      this.toast(`${map.name}${sectorLabel}`, 2200);
      this.saveGame(false);
      if (map.region && !this.state.flags.expeditionTutorialSeen) {
        this.state.flags.expeditionTutorialSeen = true;
        this.showDialogue('PROTOCOLE D’EXPÉDITION', [
          'Une région se traverse désormais en cinq secteurs reliés. Cherchez les passages lumineux aux bords de chaque zone et utilisez E, Espace ou le bouton Action.',
          'Les détours cachent des recrues et des décisions durables. Un sanctuaire précède chaque gardien ; sa victoire ouvre le dernier secteur et l’Éclat. Un raccourci permanent facilite ensuite le retour.',
          'Le Journal du menu contient votre carnet de route : secteurs reconnus, passages et sceaux restants. Préparez vos réserves au Cœur avant de partir ; vous pourrez y acheter les soins essentiels.',
        ], () => this.saveGame(false));
      }
    }

    getCurrentRegionId() {
      return getMapRegionId(this.state?.map);
    }

    getRegionProgress(regionId) {
      const layout = WORLD_LAYOUTS[regionId];
      if (!layout || !this.state) return { discovered: 0, total: 0, guardianDefeated: false, shardCollected: false };
      const discovered = layout.sectors.filter(({ id }) => this.state.discoveredSectors.includes(id)).length;
      const guardian = MAPS[layout.guardianSectorId]?.guardian;
      const shard = MAPS[layout.shardSectorId]?.shard;
      return {
        discovered,
        total: layout.sectors.length,
        guardianDefeated: Boolean(guardian && this.state.flags[guardian.defeatFlag]),
        shardCollected: Boolean(shard && this.state.flags[shard.collectFlag || shard.id]),
      };
    }

    getChronicle(id) {
      return REGIONAL_CHRONICLES[id] || null;
    }

    getTrackedChronicle() {
      if (!this.state) return null;
      const active = Object.values(REGIONAL_CHRONICLES)
        .map((chronicle) => ({ chronicle, status: getChronicleStatus(chronicle, this.state) }))
        .filter(({ status }) => status && (status.status === 'active' || status.status === 'ready'));
      if (!active.length) return null;
      const local = active.find(({ chronicle, status }) => {
        if (status.status === 'ready') return this.state.map === 'city';
        return getChronicleNode(chronicle, this.state)?.sectorId === this.state.map;
      });
      const currentRegion = MAPS[this.state.map]?.region;
      const regional = currentRegion
        ? active.find(({ chronicle, status }) => status.status === 'active' && chronicle.region === currentRegion)
        : null;
      return local || regional || active[0];
    }

    beginChronicle(id) {
      const chronicle = this.getChronicle(id);
      const status = chronicle && getChronicleStatus(chronicle, this.state);
      if (!chronicle || status?.status !== 'available' || this.state.map !== 'city' || this.serviceType !== chronicle.service) return false;
      this.state.chronicleProgress[id] = 1;
      this.advanceTime(15);
      this.updateHud();
      this.saveGame(false);
      this.closeOverlays();
      this.audio.play('recruit');
      this.showDialogue(chronicle.giverName, getChronicleIntro(chronicle, this.state));
      return true;
    }

    resolveChronicleNode(id, nodeId) {
      const chronicle = this.getChronicle(id);
      const currentNode = chronicle && getChronicleNode(chronicle, this.state);
      if (!chronicle || !currentNode || currentNode.id !== nodeId || currentNode.sectorId !== this.state.map) return false;
      const progress = Number(this.state.chronicleProgress[id] || 0);
      this.state.chronicleProgress[id] = Math.min(MAX_CHRONICLE_PROGRESS - 1, progress + 1);
      this.advanceTime(25);
      this.audio.play('discovery');
      this.flash = .45;
      this.spawnParticles(currentNode.x, currentNode.y, MAPS[this.state.map]?.accent || '#8de7ff', 24, 90);
      this.updateHud();
      // La trace est acquise avant le récit : fermer l'onglet ne peut pas la dupliquer.
      this.saveGame(false);
      const nextObjective = getChronicleObjective(chronicle, this.state);
      this.showDialogue(currentNode.label, [...currentNode.lines, `Prochaine étape : ${nextObjective}.`]);
      return true;
    }

    formatChronicleReward(reward = {}) {
      const parts = [];
      if (reward.credits) parts.push(`${reward.credits} crédits`);
      for (const [itemId, amount] of Object.entries(reward.inventory || {})) parts.push(`${amount} × ${ITEMS[itemId]?.name || itemId}`);
      for (const [key, label] of [['bond', 'lien'], ['discipline', 'discipline'], ['morale', 'moral']]) {
        if (reward[key]) parts.push(`${reward[key] > 0 ? '+' : ''}${reward[key]} ${label}`);
      }
      if (reward.fatigue) parts.push(`${reward.fatigue} fatigue`);
      return parts.join(' · ');
    }

    completeChronicle(id, choiceId) {
      const chronicle = this.getChronicle(id);
      const status = chronicle && getChronicleStatus(chronicle, this.state);
      const choice = chronicle?.choices.find((entry) => entry.id === choiceId);
      if (!chronicle || !choice || status?.status !== 'ready' || this.state.map !== 'city' || this.serviceType !== chronicle.service) return false;
      const reward = choice.reward || {};
      this.state.chronicleProgress[id] = MAX_CHRONICLE_PROGRESS;
      this.state.chronicleChoices[id] = choice.id;
      this.state.credits = clamp(Number(this.state.credits || 0) + Number(reward.credits || 0), 0, SAVE_VALUE_LIMITS.counter);
      for (const [itemId, amount] of Object.entries(reward.inventory || {})) {
        if (!SAVE_ITEM_IDS.has(itemId)) continue;
        this.state.inventory[itemId] = clamp(Number(this.state.inventory[itemId] || 0) + Number(amount || 0), 0, SAVE_VALUE_LIMITS.counter);
      }
      for (const stat of ['bond', 'discipline', 'morale', 'fatigue']) {
        if (!Number.isFinite(reward[stat])) continue;
        this.state.partner[stat] = clamp(Number(this.state.partner[stat] || 0) + reward[stat], 0, 100);
      }
      this.advanceTime(45);
      this.audio.play('victory');
      this.updateHud();
      this.saveGame(false);
      this.closeOverlays();
      this.showDialogue(chronicle.giverName, [...choice.lines, `Chronique achevée : ${choice.outcome}`]);
      return true;
    }

    reviewChronicle(id) {
      const chronicle = this.getChronicle(id);
      const status = chronicle && getChronicleStatus(chronicle, this.state);
      if (!chronicle || !status || this.state.map !== 'city' || this.serviceType !== chronicle.service) return false;
      const lines = status.status === 'complete'
        ? [status.conclusion.outcome, ...status.conclusion.lines]
        : [`Prochaine étape : ${getChronicleObjective(chronicle, this.state)}.`];
      this.closeOverlays();
      this.showDialogue(chronicle.giverName, lines);
      return true;
    }

    getTransitionStatus(transition, regionId) {
      const requiredWins = Number(transition?.requiresRegionalWins || 0);
      const currentWins = this.getRegionPatrolWinCount(regionId);
      const progressionReady = !requiredWins || currentWins >= requiredWins;
      return {
        available: Boolean(transition?.available && progressionReady),
        lockedReason: !progressionReady
          ? `Le territoire exige ${requiredWins} victoires régionales (${currentWins}/${requiredWins}).`
          : (transition?.lockedReason || 'Ce passage est encore scellé.'),
      };
    }

    getRegionPatrolWinCount(regionId) {
      const layout = WORLD_LAYOUTS[regionId];
      if (!layout || !this.state) return 0;
      const regionalIds = new Set(layout.sectors.flatMap((sector) => (sector.patrols || []).map(({ id }) => id)));
      return (this.state.patrolVictories || []).filter((id) => regionalIds.has(id)).length;
    }

    getTrackedTransitionId(regionId, sectorId) {
      const trackedChronicle = this.getTrackedChronicle();
      const chronicleNode = trackedChronicle?.status?.status === 'active'
        ? getChronicleNode(trackedChronicle.chronicle, this.state)
        : null;
      const trackedId = this.state?.flags?.trackedResident;
      const resident = trackedId ? RESIDENTS[trackedId] : null;
      const targetSectorId = chronicleNode?.sectorId && trackedChronicle.chronicle.region === regionId
        ? chronicleNode.sectorId
        : resident && !this.state.recruited.includes(trackedId) && resident.region === regionId
          ? resident.map
          : null;
      if (!targetSectorId || targetSectorId === sectorId) return null;
      const layout = WORLD_LAYOUTS[regionId];
      const currentIndex = layout?.mainPath.indexOf(sectorId) ?? -1;
      const targetIndex = layout?.mainPath.indexOf(targetSectorId) ?? -1;
      if (currentIndex < 0 || targetIndex < 0) return null;
      const nextSectorId = layout.mainPath[currentIndex + Math.sign(targetIndex - currentIndex)];
      return getSectorTransitions(regionId, sectorId, this.state)
        .find((transition) => transition.to.sectorId === nextSectorId)?.connectionId || null;
    }

    activateShortcut(entity) {
      const flag = entity?.data?.unlockFlag;
      if (!flag || this.state.flags[flag]) return;
      this.state.flags[flag] = true;
      this.audio.play('discovery');
      this.flash = .45;
      this.spawnParticles(entity.x, entity.y, MAPS[this.state.map]?.accent || '#8de7ff', 22, 90);
      this.toast('Raccourci permanent ouvert. Le retour vers l’entrée est maintenant direct.', 4200);
      this.saveGame(false);
    }

    openWorldEvent(event) {
      if (!event || this.state.flags[event.onceFlag]) return;
      this.showDialogue(event.title, event.lines, null, {
        choices: event.choices,
        choicePrompt: 'Le Cœur attend votre décision. Ce choix restera inscrit dans cette campagne.',
        onChoice: (choice) => this.resolveWorldEvent(event, choice),
      });
    }

    resolveWorldEvent(event, choice) {
      if (!event || !choice || this.state.flags[event.onceFlag]) return;
      const result = choice.result || {};
      this.state.flags[event.onceFlag] = true;
      for (const flag of result.flags || []) this.state.flags[flag] = true;
      for (const [itemId, amount] of Object.entries(result.inventory || {})) {
        this.state.inventory[itemId] = Math.max(0, Number(this.state.inventory[itemId] || 0) + Number(amount || 0));
      }
      for (const stat of ['bond', 'morale', 'fatigue', 'discipline']) {
        if (!Number.isFinite(result[stat])) continue;
        this.state.partner[stat] = clamp(Number(this.state.partner[stat] || 0) + result[stat], 0, 100);
      }
      this.state.expeditionChoices[event.id] = choice.id;
      this.advanceTime(30);
      this.audio.play('recruit');
      this.checkAchievements();
      this.updateHud();
      this.saveGame(false);
      const chronicle = Object.values(REGIONAL_CHRONICLES).find(({ sourceEventId }) => sourceEventId === event.id);
      this.showDialogue('MÉMOIRE DE L’EXPÉDITION', [
        `Décision inscrite : ${choice.label}.`,
        chronicle
          ? `${chronicle.giverName} pourra interpréter cette mémoire à Nox Arca et ouvrir une chronique de retour à travers toute la région.`
          : 'Le territoire a changé subtilement autour de votre lien. Certaines conséquences accompagneront le prochain cycle.',
      ]);
    }

    useSanctuary(sanctuary) {
      if (!sanctuary) return;
      const visit = Number(this.state.sectorVisits[this.state.map] || 0);
      if (Number(this.state.sanctuaryVisits[sanctuary.id] || 0) === visit) {
        this.toast('Le sanctuaire doit se recharger. Quittez ce secteur avant de l’utiliser à nouveau.', 3400);
        return;
      }
      const rest = sanctuary.rest || {};
      const p = this.state.partner;
      const sanctuaryMultiplier = getCycleScaling(this.state).sanctuaryMultiplier;
      p.hp = clamp(p.hp + p.maxHp * Number(rest.hpRatio || 0) * sanctuaryMultiplier, 1, p.maxHp);
      p.mp = clamp(p.mp + p.maxMp * Number(rest.mpRatio || 0) * sanctuaryMultiplier, 0, p.maxMp);
      p.fatigue = clamp(p.fatigue + Number(rest.fatigue || 0) * sanctuaryMultiplier, 0, 100);
      this.state.sanctuaryVisits[sanctuary.id] = visit;
      this.advanceTime(35);
      this.audio.play('heal');
      this.spawnParticles(sanctuary.x, sanctuary.y, MAPS[this.state.map]?.accent || '#8de7ff', 26, 75);
      this.toast('Le sanctuaire restaure votre duo. Il ne répondra plus avant une nouvelle visite.', 3900);
      this.saveGame(false);
    }

    startGuardianBattle(guardian) {
      if (!guardian || this.state.flags[guardian.defeatFlag]) return;
      const map = MAPS[this.state.map];
      this.showDialogue(guardian.name, [
        map?.ambience || 'Le territoire retient son souffle.',
        'Le gardien maintient la chambre mnésique close. Il faut survivre à son jugement pour atteindre l’Éclat.',
      ], () => {
        const enemy = this.makeEnemy(guardian, { boss: true, patrolId: null, level: guardian.level });
        enemy.guardianFlag = guardian.defeatFlag;
        enemy.guardianRegion = map?.region;
        this.startBattle(enemy);
      });
    }

    isPatrolActive(id) {
      const respawnAt = Number(this.state.worldDefeated[id] || 0);
      return this.state.timeMinutes >= respawnAt;
    }

    getPatrolPosition(patrol) {
      if (!Array.isArray(patrol?.path) || patrol.path.length < 2 || this.getAccessibilitySettings().reducedMotion) {
        return { x: patrol.x, y: patrol.y };
      }
      const seed = [...patrol.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) * .013;
      const cursor = (this.elapsed * .13 + seed) % patrol.path.length;
      const index = Math.floor(cursor);
      const nextIndex = (index + 1) % patrol.path.length;
      const amount = cursor - index;
      return {
        x: lerp(patrol.path[index].x, patrol.path[nextIndex].x, amount),
        y: lerp(patrol.path[index].y, patrol.path[nextIndex].y, amount),
      };
    }

    makeEnemy(source, overrides = {}) {
      const baseLevel = overrides.level || source.level || 1;
      const cycle = getCycleScaling(this.state || 0);
      const levelBonus = cycle.cycleCount > 0 ? cycle.enemyLevelBonus : Number(this.state?.newCycleBonus || 0);
      const boss = Boolean(overrides.boss);
      const replayFloor = cycle.cycleCount > 0 && this.state?.partner
        ? Math.max(1, Number(this.state.partner.level || 1) - (boss ? 2 : 4))
        : 1;
      const level = Math.max(baseLevel + levelBonus, replayFloor);
      const difficulty = this.getDifficulty();
      const anomaly = Boolean(this.state?.cycleAnomalies?.[this.getCurrentRegionId()]);
      const anomalyPressure = anomaly ? 1.12 : 1;
      const anomalyReward = anomaly ? 1.15 : 1;
      const maxHp = Math.round(((boss ? 155 : 60) + level * (boss ? 24 : 17)) * difficulty.enemyHp * cycle.enemyHpMultiplier * anomalyPressure);
      return {
        id: overrides.id || source.id,
        name: overrides.name || source.name,
        style: overrides.style || source.style || 'feral',
        color: overrides.color || source.color || '#ff7fa8',
        level,
        maxHp,
        hp: maxHp,
        maxMp: 25 + level * 7,
        mp: 25 + level * 7,
        power: Math.round(((boss ? 15 : 8) + level * (boss ? 3.2 : 2.4)) * difficulty.enemyPower * cycle.enemyPowerMultiplier * anomalyPressure),
        guard: Math.round(((boss ? 12 : 5) + level * (boss ? 2.6 : 1.8)) * (1 + (difficulty.enemyHp - 1) * .45) * cycle.enemyGuardMultiplier * anomalyPressure),
        spirit: Math.round(((boss ? 14 : 6) + level * (boss ? 3 : 2)) * difficulty.enemyPower * cycle.enemySpiritMultiplier * anomalyPressure),
        speed: Math.round((boss ? 11 : 7) + level * 1.5 + cycle.enemySpeedBonus),
        xp: Math.round(((boss ? 150 : 25) + level * (boss ? 32 : 17)) * difficulty.rewards * cycle.xpMultiplier * anomalyReward),
        credits: Math.round(((boss ? 180 : 18) + level * (boss ? 18 : 10)) * difficulty.rewards * cycle.creditMultiplier * anomalyReward),
        loot: overrides.loot || source.loot || null,
        patrolId: Object.prototype.hasOwnProperty.call(overrides, 'patrolId') ? overrides.patrolId : (source.id && !RESIDENTS[source.id] ? source.id : null),
        recruitId: overrides.recruitId || null,
        boss,
        final: Boolean(overrides.final),
        cycleAnomaly: anomaly,
      };
    }

    makeResidentEnemy(resident) {
      const special = {
        brakk: { guard: 18, maxHp: 125 },
        vespera: { spirit: 24, speed: 20 },
        skarn: { guard: 28, maxHp: 190 },
        bellgrave: { spirit: 29 },
        masks: { speed: 29 },
        khepri: { guard: 36, maxHp: 270 },
      }[resident.id] || {};
      const enemy = this.makeEnemy(resident, { id: `recruit_${resident.id}`, recruitId: resident.id, level: resident.level, boss: true });
      const difficulty = this.getDifficulty();
      const cycle = getCycleScaling(this.state);
      const anomalyPressure = enemy.cycleAnomaly ? 1.12 : 1;
      if (special.maxHp) enemy.maxHp = Math.round(special.maxHp * difficulty.enemyHp * cycle.enemyHpMultiplier * anomalyPressure);
      if (special.guard) enemy.guard = Math.round(special.guard * (1 + (difficulty.enemyHp - 1) * .45) * cycle.enemyGuardMultiplier * anomalyPressure);
      if (special.spirit) enemy.spirit = Math.round(special.spirit * difficulty.enemyPower * cycle.enemySpiritMultiplier * anomalyPressure);
      if (special.speed) enemy.speed = Math.round(special.speed + cycle.enemySpeedBonus);
      enemy.hp = enemy.maxHp;
      return enemy;
    }

    attemptResident(id) {
      const resident = RESIDENTS[id];
      if (!resident || this.state.recruited.includes(id)) return;
      if (resident.requires && !resident.requires(this)) {
        this.showDialogue(resident.name, [resident.blocked || 'Tu n’es pas encore prêt.']);
        return;
      }
      if (resident.consume) {
        for (const [itemId, amount] of Object.entries(resident.consume)) {
          if ((this.state.inventory[itemId] || 0) < amount) {
            this.toast('Il te manque un composant demandé.');
            return;
          }
        }
      }
      this.showDialogue(resident.name, resident.intro || ['Montre-moi ce que vaut ta cité.'], () => {
        const enemy = this.makeResidentEnemy(resident);
        enemy.recruitConsume = resident.consume ? { ...resident.consume } : null;
        this.startBattle(enemy);
      });
    }

    collectShard(shard) {
      const shardFlag = shard?.collectFlag || shard?.id;
      if (!shardFlag || this.state.flags[shardFlag]) return;
      if (shard.requiresFlag && !this.state.flags[shard.requiresFlag]) {
        this.toast('Le gardien régional maintient encore cette mémoire hors d’atteinte.', 3600);
        return;
      }
      this.state.flags[shardFlag] = true;
      this.state.inventory.coreSeed += 1;
      const finalGateOpened = this.checkRegionUnlocks(false);
      this.checkAchievements();
      this.saveGame(false);
      this.audio.play('recruit');
      this.flash = .75;
      this.spawnParticles(shard.x, shard.y, '#8de7ff', 34, 135);
      this.showDialogue('ÉCLAT MNÉMIQUE', [
        `${shard.name} rejoint le Cœur. Une partie de l’histoire de Nox Arca redevient accessible.`,
        `Éclats réunis : ${this.getShardCount()} / 4. Chaque Éclat renforce aussi les services de la cité.`,
      ], () => {
        if (finalGateOpened) this.showFinalUnlockDialogue();
        else DOM.canvas.focus();
      });
    }

    recruitResident(id, { deferPresentation = false, deferSave = false } = {}) {
      const resident = RESIDENTS[id];
      if (!hasOwn(RESIDENTS, id) || this.state.recruited.includes(id)) return null;
      this.state.recruited.push(id);
      this.state.inventory.ration += 1;
      const finalGateOpened = this.checkRegionUnlocks(false);
      this.checkAchievements();
      if (!deferSave) this.saveGame(false);
      // La présentation est facultative : quitter pendant le récit ne perd aucun service ni accès.
      const present = () => {
        this.audio.play('recruit');
        this.flash = 1;
        this.showDialogue(resident.name, [resident.recruit, `Nouveau service à Nox Arca : ${BUILDINGS[resident.building]?.label || resident.title}.`], () => {
          this.toast(`${resident.name} a rejoint Nox Arca · Cité ${this.getCityScore()}.`, 3200);
          if (finalGateOpened) this.showFinalUnlockDialogue();
          else DOM.canvas.focus();
        });
      };
      if (!deferPresentation) present();
      return present;
    }

    getCityScore() {
      if (!this.state) return 0;
      return this.state.recruited.reduce((sum, id) => sum + (RESIDENTS[id]?.score || 0), 0) + (this.state.flags.ngPlus ? 5 : 0);
    }

    getCityRank() {
      const score = this.getCityScore();
      if (score >= 100) return { level: 5, name: 'MÉTROPOLE DU NEXUS' };
      if (score >= 70) return { level: 4, name: 'BASTION' };
      if (score >= 45) return { level: 3, name: 'CITÉ VIVANTE' };
      if (score >= 20) return { level: 2, name: 'REFUGE' };
      return { level: 1, name: 'RUINE HABITÉE' };
    }

    getShardCount() {
      if (!this.state) return 0;
      return ['shard_wastes', 'shard_hive', 'shard_fog', 'shard_foundry'].filter((id) => this.state.flags[id]).length;
    }

    getTotalWins() {
      if (!this.state) return 0;
      return Object.values(this.state.wins).reduce((sum, count) => sum + Number(count || 0), 0);
    }

    getDifficulty() {
      return hasOwn(DIFFICULTIES, this.state?.difficulty) ? DIFFICULTIES[this.state.difficulty] : DIFFICULTIES.standard;
    }

    hasCityProject(id) {
      return Boolean(this.state?.cityProjects?.includes(id));
    }

    formatProjectCost(project) {
      const itemLabels = { scrap: 'alliage(s)', spore: 'spore(s)', coreSeed: 'Graine(s) de Cœur' };
      const parts = [`${project.credits} crédits`];
      for (const [id, amount] of Object.entries(project.items || {})) parts.push(`${amount} ${itemLabels[id] || id}`);
      return parts.join(' + ');
    }

    buildCityProject(id) {
      const project = CITY_PROJECTS[id];
      if (!project || this.hasCityProject(id)) return false;
      if (this.getCityScore() < project.minScore) {
        this.toast(`Le projet exige une cité de niveau ${project.minScore}.`);
        return false;
      }
      if (this.state.credits < project.credits) {
        this.toast('Crédits insuffisants.');
        return false;
      }
      for (const [itemId, amount] of Object.entries(project.items || {})) {
        if ((this.state.inventory[itemId] || 0) < amount) {
          this.toast(`${ITEMS[itemId]?.name || itemId} insuffisant.`);
          return false;
        }
      }
      this.state.credits -= project.credits;
      for (const [itemId, amount] of Object.entries(project.items || {})) this.state.inventory[itemId] -= amount;
      this.state.cityProjects.push(id);
      this.audio.play('recruit');
      this.flash = .65;
      this.toast(`${project.name} achevé. Son effet est désormais permanent.`, 3900);
      this.checkAchievements();
      return true;
    }

    ensureDailyContract() {
      if (!this.state) return null;
      const day = formatTime(this.state.timeMinutes).day;
      if (this.state.contract?.day === day) return this.state.contract;
      const candidates = ['wastes', 'hive', 'fog', 'foundry'].filter((id) => id === 'wastes' || this.state.unlockedMaps.includes(id));
      const map = candidates[(day + this.state.recruited.length + this.state.partner.rebirths) % Math.max(1, candidates.length)] || 'wastes';
      const target = 3 + (day % 3);
      const lootByMap = { wastes: 'scrap', hive: 'spore', fog: 'incense', foundry: 'scrap' };
      this.state.contract = {
        day, map, target, progress: 0, completed: false, claimed: false,
        rewardCredits: Math.min(240, 85 + day * 6), rewardItem: lootByMap[map] || 'ration', rewardAmount: 1 + (day % 2),
      };
      return this.state.contract;
    }

    updateDailyContract(enemy) {
      const contract = this.ensureDailyContract();
      if (!contract || contract.claimed || !enemy?.patrolId) return;
      if (this.getCurrentRegionId() !== contract.map) return;
      contract.progress = clamp(contract.progress + 1, 0, contract.target);
      if (contract.progress >= contract.target && !contract.completed) {
        contract.completed = true;
        this.toast('Contrat du Cœur terminé. Récompense disponible dans le Journal.', 3900);
      }
    }

    claimDailyContract() {
      const contract = this.ensureDailyContract();
      if (!contract?.completed || contract.claimed) return false;
      contract.claimed = true;
      this.state.credits += contract.rewardCredits;
      this.state.inventory[contract.rewardItem] = (this.state.inventory[contract.rewardItem] || 0) + contract.rewardAmount;
      this.audio.play('victory');
      this.toast(`Contrat validé : +${contract.rewardCredits} crédits et +${contract.rewardAmount} ${ITEMS[contract.rewardItem]?.name || contract.rewardItem}.`, 3900);
      this.saveGame(false);
      return true;
    }

    checkAchievements(showToast = true) {
      if (!this.state) return [];
      const unlocked = [];
      for (const achievement of ACHIEVEMENTS) {
        if (this.state.achievements.includes(achievement.id)) continue;
        let complete = false;
        try { complete = Boolean(achievement.test(this)); } catch (error) { console.error(error); }
        if (!complete) continue;
        this.state.achievements.push(achievement.id);
        this.state.credits += 25;
        unlocked.push(achievement);
      }
      if (unlocked.length && showToast) {
        const first = unlocked[0];
        const suffix = unlocked.length > 1 ? ` +${unlocked.length - 1} autre(s)` : '';
        this.toast(`Succès : ${first.name}${suffix} · +${unlocked.length * 25} crédits`, 4200);
        this.audio.play('recruit');
      }
      return unlocked;
    }

    canEnterVoid() {
      if (!this.state) return false;
      return this.getCityScore() >= 100 && this.getShardCount() >= 4 && this.state.recruited.includes('khepri');
    }

    checkRegionUnlocks(showFinalDialogue = true) {
      const score = this.getCityScore();
      for (const unlock of REGION_UNLOCKS) {
        if (score >= unlock.score && !this.state.unlockedMaps.includes(unlock.map)) {
          this.state.unlockedMaps.push(unlock.map);
          this.toast(unlock.text, 4300);
          this.flash = .55;
        }
      }
      if (this.canEnterVoid() && !this.state.flags.finalUnlocked) {
        this.state.flags.finalUnlocked = true;
        this.state.unlockedMaps.push('void');
        if (showFinalDialogue) this.showFinalUnlockDialogue();
        return true;
      }
      return false;
    }

    showFinalUnlockDialogue() {
      this.showDialogue('KHEPRI-7', [
          'Les quatre Éclats chantent à l’unisson. Nox Arca a dépassé cent points d’écho.',
          'Le dernier sceau est ouvert. La Porte violette, au sud-est de la cité, mène au Cœur du Néant et à l’Architecte Pâle.',
          'N’y entre pas pour détruire. Entre pour prouver qu’une cité peut relier des mondes sans les dévorer.',
      ]);
    }

    advanceTime(minutes, walking = false) {
      if (!this.state || minutes <= 0) return;
      const previousDay = formatTime(this.state.timeMinutes).day;
      this.state.timeMinutes += minutes;
      const p = this.state.partner;
      const needFactor = (this.hasCityProject('sanctuary') ? .8 : 1) * getCycleScaling(this.state).needRateMultiplier;
      p.hunger = clamp(p.hunger + minutes * (walking ? .032 : .019) * needFactor, 0, 100);
      p.fatigue = clamp(p.fatigue + minutes * (walking ? .021 : .012) * needFactor, 0, 100);
      if (p.hunger > 82) p.morale = clamp(p.morale - minutes * .02, 0, 100);
      if (p.fatigue > 88) p.discipline = clamp(p.discipline - minutes * .007, 0, 100);
      const currentDay = formatTime(this.state.timeMinutes).day;
      if (currentDay > previousDay) {
        p.ageDays += currentDay - previousDay;
        if (p.ageDays === 10) this.toast('Ton partenaire atteint la maturité. Le Cœur peut désormais préparer une renaissance volontaire.', 4200);
      }
    }

    showDialogue(speaker, pages, callback = null, options = {}) {
      const normalized = Array.isArray(pages) ? pages : [String(pages)];
      this.dialogueQueue = normalized.filter(Boolean).map(String);
      this.dialogueCallback = callback;
      this.dialogueOptions = options;
      DOM.dialogueSpeaker.textContent = speaker || 'INCONNU';
      DOM.dialogueChoices.innerHTML = '';
      DOM.dialogueSkip.disabled = false;
      this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      DOM.dialogue.classList.remove('hidden');
      DOM.dialogue.setAttribute('aria-hidden', 'false');
      this.displayDialoguePage();
      requestAnimationFrame(() => DOM.dialogue.focus());
    }

    displayDialoguePage() {
      if (!this.dialogueQueue.length) {
        this.finishDialogue();
        return;
      }
      DOM.dialogueText.textContent = this.dialogueQueue[0];
    }

    advanceDialogue() {
      if (DOM.dialogue.classList.contains('hidden')) return;
      this.audio.play('ui');
      if (this.dialogueQueue.length === 1 && this.dialogueOptions?.choices?.length) {
        this.dialogueQueue = [];
        this.renderDialogueChoices();
        return;
      }
      this.dialogueQueue.shift();
      if (this.dialogueQueue.length) this.displayDialoguePage();
      else this.finishDialogue();
    }

    finishDialogue() {
      if (DOM.dialogue.classList.contains('hidden')) return;
      if (this.dialogueOptions?.choices?.length) {
        this.dialogueQueue = [];
        this.renderDialogueChoices();
        return;
      }
      DOM.dialogue.classList.add('hidden');
      DOM.dialogue.setAttribute('aria-hidden', 'true');
      DOM.dialogueChoices.innerHTML = '';
      DOM.dialogueSkip.disabled = false;
      this.dialogueQueue = [];
      const callback = this.dialogueCallback;
      this.dialogueCallback = null;
      this.dialogueOptions = {};
      if (typeof callback === 'function') callback();
      else this.restoreFocus();
    }

    renderDialogueChoices() {
      const choices = this.dialogueOptions?.choices || [];
      if (!choices.length) return;
      DOM.dialogueText.textContent = this.dialogueOptions.choicePrompt || 'Choisissez une réponse.';
      DOM.dialogueChoices.innerHTML = choices
        .map((choice, index) => `<button data-dialogue-choice="${index}">${escapeHtml(choice.label)}</button>`)
        .join('');
      DOM.dialogueSkip.disabled = true;
      const focusFirstChoice = () => DOM.dialogueChoices.querySelector('button')?.focus();
      const advanceKeys = new Set([' ', 'enter', 'e']);
      if ([...advanceKeys].some((key) => this.input.isDown(key))) {
        const focusAfterRelease = (event) => {
          if (!advanceKeys.has(event.key.toLowerCase())) return;
          window.removeEventListener('keyup', focusAfterRelease);
          requestAnimationFrame(focusFirstChoice);
        };
        window.addEventListener('keyup', focusAfterRelease);
      } else {
        requestAnimationFrame(focusFirstChoice);
      }
    }

    selectDialogueChoice(choice) {
      const onChoice = this.dialogueOptions?.onChoice;
      DOM.dialogue.classList.add('hidden');
      DOM.dialogue.setAttribute('aria-hidden', 'true');
      DOM.dialogueChoices.innerHTML = '';
      DOM.dialogueSkip.disabled = false;
      this.dialogueQueue = [];
      this.dialogueCallback = null;
      this.dialogueOptions = {};
      DOM.canvas?.focus();
      if (typeof onChoice === 'function') onChoice(choice);
      else this.restoreFocus();
    }

    closeOverlays() {
      const hadOpenOverlay = !DOM.menu.classList.contains('hidden') || !DOM.service.classList.contains('hidden');
      DOM.menu.classList.add('hidden');
      DOM.service.classList.add('hidden');
      this.serviceType = null;
      if (hadOpenOverlay) this.restoreFocus();
    }

    toggleMenu() {
      if (!this.state || this.mode !== 'world' || !DOM.dialogue.classList.contains('hidden')) return;
      const opening = DOM.menu.classList.contains('hidden');
      if (opening) {
        this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : DOM.canvas;
        DOM.service.classList.add('hidden');
        DOM.menu.classList.remove('hidden');
        this.renderMenu();
        this.audio.play('ui');
        requestAnimationFrame(() => DOM.menuTabs.querySelector('.active')?.focus());
      } else {
        DOM.menu.classList.add('hidden');
        this.audio.play('cancel');
        this.restoreFocus();
      }
    }

    toast(message, duration = 2600) {
      DOM.toast.textContent = message;
      DOM.toast.classList.remove('hidden');
      this.toastTimer = duration / 1000;
      this.announce(message);
    }

    updateHud() {
      if (!this.state) return;
      const p = this.state.partner;
      const form = FORMS[p.formId] || FORMS.mote_feral;
      const cityRank = this.getCityRank();
      let need = 'Stable';
      if (p.hunger >= 80) need = 'Très affamé';
      else if (p.hunger >= 55) need = 'Affamé';
      else if (p.fatigue >= 82) need = 'Épuisé';
      else if (p.fatigue >= 58) need = 'Fatigué';
      else if (p.morale >= 82) need = 'Inspiré';
      const mapName = MAPS[this.state.map]?.name || 'NOX ARCA';
      const clock = formatTime(this.state.timeMinutes).label;
      const objective = this.getObjective();
      const signature = [
        p.name, p.formId, Math.ceil(p.hp), p.maxHp, Math.ceil(p.mp), p.maxMp,
        p.level, Math.round(p.bond), need, mapName, clock, this.getCityScore(), cityRank.level, objective,
      ].join('|');
      if (signature === this.lastHudSignature) return;
      this.lastHudSignature = signature;
      DOM.partnerName.textContent = p.name;
      DOM.partnerForm.textContent = form.name;
      DOM.hpBar.style.width = pct(p.hp, p.maxHp);
      DOM.hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
      DOM.mpBar.style.width = pct(p.mp, p.maxMp);
      DOM.mpText.textContent = `${Math.ceil(p.mp)}/${p.maxMp}`;
      DOM.levelText.textContent = `Niv. ${p.level}`;
      DOM.bondText.textContent = `Lien ${Math.round(p.bond)}`;
      DOM.needText.textContent = need;
      DOM.mapName.textContent = mapName;
      DOM.clockText.textContent = clock;
      DOM.cityText.textContent = `Cité ${this.getCityScore()} · Rang ${cityRank.level}`;
      DOM.objectiveText.textContent = objective;
    }

    getObjective() {
      if (!this.state) return '';
      const trackedChronicle = this.getTrackedChronicle();
      if (trackedChronicle) return `Chronique : ${getChronicleObjective(trackedChronicle.chronicle, this.state)}`;
      const trackedId = this.state.flags.trackedResident;
      if (trackedId && RESIDENTS[trackedId] && !this.state.recruited.includes(trackedId)) {
        const resident = RESIDENTS[trackedId];
        const targetSector = MAPS[resident.map];
        if (this.state.map === resident.map) return `Piste : ${resident.name} se trouve dans ce secteur`;
        return `Piste : ${resident.name} · ${targetSector?.regionName || resident.region} · ${targetSector?.name || resident.hint}`;
      }
      if (this.state.finalBossDefeated) return 'Explorer librement Nox Arca restaurée';
      const score = this.getCityScore();
      if (!this.state.recruited.includes('brakk')) return 'Trouver et vaincre Brakk-9 dans les Friches';
      const currentRegion = this.getCurrentRegionId();
      if (WORLD_LAYOUTS[currentRegion]) {
        const progress = this.getRegionProgress(currentRegion);
        const currentMap = MAPS[this.state.map];
        if (!progress.guardianDefeated) {
          return currentMap?.guardian
            ? `Vaincre ${currentMap.guardian.name} pour ouvrir la chambre mnésique`
            : `Traverser ${WORLD_LAYOUTS[currentRegion].name} · ${progress.discovered}/${progress.total} secteurs découverts`;
        }
        if (!progress.shardCollected) return `Atteindre le sanctuaire final et recueillir l’Éclat · ${progress.discovered}/${progress.total} secteurs`;
      }
      if (score < 20) return `Recruter les habitants des Friches · Cité ${score}/20`;
      if (score < 45) return `Explorer la Bio-Ruche · Cité ${score}/45`;
      if (score < 70) return `Explorer la Cathédrale de Brume · Cité ${score}/70`;
      if (score < 100) return `Explorer la Fonderie des Veilleurs · Cité ${score}/100`;
      if (this.getShardCount() < 4) return `Réunir les Éclats mnésiques · ${this.getShardCount()}/4`;
      if (!this.state.recruited.includes('khepri')) return 'Convaincre Khepri-7 de protéger la cité';
      return 'Franchir la Porte du Néant et affronter l’Architecte Pâle';
    }

    renderMenu() {
      if (!this.state) return;
      if (this.menuTab === 'partner') this.renderPartnerMenu();
      else if (this.menuTab === 'inventory') this.renderInventoryMenu();
      else if (this.menuTab === 'city') this.renderCityMenu();
      else if (this.menuTab === 'journal') this.renderJournalMenu();
      else if (this.menuTab === 'codex') this.renderCodexMenu();
      else this.renderSystemMenu();
    }

    renderPartnerMenu() {
      const p = this.state.partner;
      const form = FORMS[p.formId];
      const nextXp = this.xpToNext(p.level);
      const stage = form?.stage || 1;
      const evolution = evaluateEvolution(p);
      const forecastForm = FORMS[evolution.previewTargetFormId];
      let evolutionHint = forecastForm
        ? `${evolution.pathName} vers ${forecastForm.name} · niveau ${evolution.requiredLevel} requis · stabilité des soins ${Math.round(evolution.care.stability)} %.`
        : 'Aucune évolution disponible pour cette forme.';
      if (stage >= 3) evolutionHint = 'Forme finale atteinte. Une renaissance volontaire après 10 jours transmettra une part des statistiques.';
      DOM.menuContent.innerHTML = `
        <div class="menu-grid">
          <article class="data-card">
            <h3>${escapeHtml(p.name)} · ${escapeHtml(form?.name || p.formId)}</h3>
            <p>Stade ${stage} · Âge ${p.ageDays} jour(s) · Renaissance ${p.rebirths}</p>
            <div class="stat-row"><span>Niveau</span><b>${p.level}</b></div>
            <div class="stat-row"><span>Expérience</span><b>${p.xp} / ${nextXp}</b></div>
            <div class="stat-row"><span>PV / PE</span><b>${Math.ceil(p.hp)}/${p.maxHp} · ${Math.ceil(p.mp)}/${p.maxMp}</b></div>
            <button data-menu-action="rename" style="margin-top:10px;padding:8px;width:100%;font-size:.58rem">RENOMMER</button>
          </article>
          <article class="data-card">
            <h3>APTITUDES</h3>
            <div class="stat-row"><span>Puissance</span><b>${Math.round(p.power)}</b></div>
            <div class="stat-row"><span>Défense</span><b>${Math.round(p.guard)}</b></div>
            <div class="stat-row"><span>Esprit</span><b>${Math.round(p.spirit)}</b></div>
            <div class="stat-row"><span>Vitesse</span><b>${Math.round(p.speed)}</b></div>
            <p>Technique actuelle : <strong>${form?.technique || 'Impulsion'}</strong></p>
          </article>
          <article class="data-card">
            <h3>LIEN & SOINS</h3>
            <div class="stat-row"><span>Lien</span><b>${Math.round(p.bond)} / 100</b></div>
            <div class="stat-row"><span>Discipline</span><b>${Math.round(p.discipline)} / 100</b></div>
            <div class="stat-row"><span>Moral</span><b>${Math.round(p.morale)} / 100</b></div>
            <div class="stat-row"><span>Faim</span><b>${Math.round(p.hunger)} / 100</b></div>
            <div class="stat-row"><span>Fatigue</span><b>${Math.round(p.fatigue)} / 100</b></div>
          </article>
          <article class="data-card">
            <h3>TRAJECTOIRE D’ÉVOLUTION</h3>
            <p>${escapeHtml(evolutionHint)}</p>
            <div>${p.evolutions.map((id) => `<span class="badge ok">${FORMS[id]?.name || id}</span>`).join('')}</div>
            <p>Le jeu n’utilise pas une simple expérience : les entraînements, le lien, la discipline, la faim et la fatigue influencent aussi la forme obtenue.</p>
          </article>
        </div>
      `;
    }

    renderInventoryMenu() {
      const rows = Object.entries(ITEMS).map(([id, item]) => {
        const amount = this.state.inventory[id] || 0;
        return `
          <div class="inventory-item">
            <div class="item-icon">${item.icon}</div>
            <div class="item-copy"><strong>${item.name} × ${amount}</strong><small>${item.description}</small></div>
            <button data-menu-action="use-item" data-item="${id}" ${!item.usable || amount <= 0 ? 'disabled' : ''}>UTILISER</button>
          </div>
        `;
      }).join('');
      DOM.menuContent.innerHTML = `<p style="margin-top:0;color:var(--muted);font-size:.7rem">Crédits disponibles : <b style="color:var(--amber)">${this.state.credits}</b></p>${rows}`;
    }

    renderCityMenu() {
      const score = this.getCityScore();
      const rank = this.getCityRank();
      const projects = Object.values(CITY_PROJECTS).map((project) => {
        const complete = this.hasCityProject(project.id);
        return `<span class="badge ${complete ? 'ok' : 'locked'}">${complete ? '✓' : '○'} ${project.name}</span>`;
      }).join('');
      const residents = Object.values(RESIDENTS).map((resident) => {
        const recruited = this.state.recruited.includes(resident.id);
        return `
          <div class="resident-item">
            <div class="resident-icon">${BUILDINGS[resident.building]?.icon || '◈'}</div>
            <div class="resident-copy">
              <strong>${recruited ? resident.name : '???'} · ${recruited ? resident.title : 'Habitant à retrouver'}</strong>
              <small>${recruited ? `Service : ${BUILDINGS[resident.building]?.label}. ${resident.score} points d’écho.` : resident.hint}</small>
            </div>
            <span class="badge ${recruited ? 'ok' : 'locked'}">${recruited ? 'RECRUTÉ' : (WORLD_LAYOUTS[resident.region]?.name || resident.region || resident.map).toUpperCase()}</span>
          </div>
        `;
      }).join('');
      DOM.menuContent.innerHTML = `
        <div class="menu-grid" style="margin-bottom:14px">
          <article class="data-card"><h3>${rank.name}</h3><div class="stat-row"><span>Écho de cité</span><b>${score} / ${this.state.flags.ngPlus ? 125 : 120}</b></div><div class="stat-row"><span>Habitants</span><b>${this.state.recruited.length} / 12</b></div><div class="stat-row"><span>Éclats</span><b>${this.getShardCount()} / 4</b></div></article>
          <article class="data-card"><h3>PROCHAINS SEUILS</h3><p>20 : Bio-Ruche · 45 : Brume · 70 : Fonderie · 100 + quatre Éclats + Khepri-7 : Cœur du Néant.</p></article>
          <article class="data-card"><h3>PROJETS URBAINS</h3><div class="codex-progress">${projects}</div><p>Les projets se construisent depuis le Cœur central et appliquent des bonus permanents.</p></article>
        </div>
        ${residents}
      `;
    }

    renderJournalMenu() {
      const contract = this.ensureDailyContract();
      const contractMap = WORLD_LAYOUTS[contract.map] || WORLD_LAYOUTS.wastes;
      const contractReady = contract.completed && !contract.claimed;
      const cycle = getCycleScaling(this.state);
      const anomalyNames = REGION_IDS
        .filter((regionId) => this.state.cycleAnomalies?.[regionId])
        .map((regionId) => WORLD_LAYOUTS[regionId].name);
      const mapInfo = [
        { id: 'wastes', name: 'Friches du Portail', unlocked: true, text: 'Ruines technologiques, alliages mémoriels et premiers habitants.' },
        { id: 'hive', name: 'Bio-Ruche de Verdance', unlocked: this.getCityScore() >= 20, text: 'Écosystème organique. Les spores servent aux soins et à l’alimentation.' },
        { id: 'fog', name: 'Cathédrale de Brume', unlocked: this.getCityScore() >= 45, text: 'Territoire mental. Le lien y compte autant que la force.' },
        { id: 'foundry', name: 'Fonderie des Veilleurs', unlocked: this.getCityScore() >= 70, text: 'Complexe industriel gardé par des sentinelles et des protocoles anciens.' },
        { id: 'void', name: 'Cœur du Néant', unlocked: this.canEnterVoid(), text: 'Dernière zone. L’Architecte Pâle y maintient le Grand Silence.' },
      ];
      const currentRegion = this.getCurrentRegionId();
      DOM.menuContent.innerHTML = `
        <article class="data-card" style="margin-bottom:12px"><h3>OBJECTIF ACTUEL</h3><p style="color:var(--text)">${escapeHtml(this.getObjective())}</p></article>
        <section class="expedition-journal" aria-label="Carnet de route des expéditions">
          <h3>CARNET DE ROUTE</h3>
          <p>Chaque région se traverse en cinq secteurs. Les lieux se révèlent à votre passage ; les victoires distinctes ouvrent les sceaux. Un raccourci ouvert reste disponible pour le retour.</p>
          ${mapInfo.filter((map) => map.id !== 'void' && map.unlocked).map((map) => this.renderExpeditionAtlas(map.id, currentRegion === map.id)).join('')}
        </section>
        ${this.renderChronicleJournal()}
        ${cycle.cycleCount ? `<article class="data-card" style="margin-bottom:12px"><h3>CYCLE ${cycle.cycleCount} · ${cycle.lawName}</h3><p>Opposition +${cycle.enemyLevelBonus} niveaux au maximum · récompenses et pression plafonnées. Anomalies : ${anomalyNames.length ? anomalyNames.join(' · ') : 'aucune'}.</p></article>` : ''}
        <article class="data-card" style="margin-bottom:12px">
          <h3>CONTRAT DU CŒUR · JOUR ${contract.day}</h3>
          <p>Neutraliser ${contract.target} patrouilles dans <strong>${contractMap.name}</strong>. Progression : ${contract.progress}/${contract.target}.</p>
          <p>Récompense : ${contract.rewardCredits} crédits et ${contract.rewardAmount} × ${ITEMS[contract.rewardItem]?.name || contract.rewardItem}.</p>
          <button data-menu-action="claim-contract" ${contractReady ? '' : 'disabled'}>${contract.claimed ? 'RÉCOMPENSE RÉCUPÉRÉE' : contractReady ? 'RÉCUPÉRER LA RÉCOMPENSE' : 'CONTRAT EN COURS'}</button>
        </article>
        <div class="menu-grid">
          ${mapInfo.map((map) => {
            const progress = this.getRegionProgress(map.id);
            const expeditionStatus = progress.total
              ? `<p><strong>${progress.discovered}/${progress.total} secteurs</strong> · ${this.getRegionPatrolWinCount(map.id)} patrouilles distinctes (sceaux 2/5) · ${progress.guardianDefeated ? 'gardien vaincu' : 'gardien actif'} · ${progress.shardCollected ? 'Éclat acquis' : 'Éclat absent'}${this.state.cycleAnomalies?.[map.id] ? ' · ANOMALIE ACTIVE' : ''}</p>`
              : '';
            return `<article class="data-card"><h3>${map.unlocked ? map.name : 'ZONE SCELLÉE'}</h3><p>${map.unlocked ? map.text : 'Le Cœur doit gagner davantage d’écho.'}</p>${map.unlocked ? expeditionStatus : ''}</article>`;
          }).join('')}
          ${LORE.map((entry, index) => `<article class="data-card"><h3>${this.getShardCount() > index || index === 0 ? entry.title : 'ARCHIVE CORROMPUE'}</h3><p>${this.getShardCount() > index || index === 0 ? entry.text : 'Réunir davantage d’Éclats mnésiques pour restaurer ce fragment.'}</p></article>`).join('')}
        </div>
      `;
    }

    renderChronicleJournal() {
      const completed = CHRONICLE_IDS.filter((id) => getChronicleStatus(REGIONAL_CHRONICLES[id], this.state)?.status === 'complete').length;
      const statusLabels = {
        undiscovered: 'MÉMOIRE À DÉCOUVRIR',
        'giver-missing': 'HABITANT ABSENT',
        available: 'À CONFIER EN CITÉ',
        active: 'EXPÉDITION ACTIVE',
        ready: 'RETOUR EN CITÉ',
        complete: 'ACHEVÉE',
      };
      const cards = Object.values(REGIONAL_CHRONICLES).map((chronicle) => {
        const status = getChronicleStatus(chronicle, this.state);
        const traceCount = status.status === 'complete' || status.status === 'ready'
          ? chronicle.nodes.length
          : Math.max(0, status.progress - 1);
        const detail = status.status === 'complete'
          ? status.conclusion.outcome
          : getChronicleObjective(chronicle, this.state);
        return `<article class="data-card chronicle-card ${status.status === 'complete' ? 'chronicle-complete' : ''}">
          <h3>${escapeHtml(chronicle.title)}</h3>
          <p>${escapeHtml(chronicle.regionName)} · ${traceCount}/${chronicle.nodes.length} traces · ${escapeHtml(chronicle.giverName)}</p>
          <p><strong>${escapeHtml(detail)}</strong></p>
          <span class="badge ${status.status === 'complete' ? 'ok' : status.status === 'undiscovered' ? 'locked' : ''}">${statusLabels[status.status]}</span>
        </article>`;
      }).join('');
      return `<section class="expedition-journal chronicle-journal" aria-label="Chroniques régionales">
        <h3>CHRONIQUES DE RETOUR · ${completed}/${CHRONICLE_IDS.length}</h3>
        <p>Les décisions trouvées au cœur des régions peuvent devenir des récits durables. Confiez-les à leur habitant, repartez écouter deux traces éloignées, puis revenez choisir ce que Nox Arca en conservera.</p>
        <div class="menu-grid">${cards}</div>
      </section>`;
    }

    renderExpeditionAtlas(regionId, current) {
      const atlas = buildExpeditionAtlas(regionId, this.state);
      if (!atlas) return '';
      const e = escapeHtml;
      return `<details class="expedition-atlas" ${current ? 'open' : ''}>
        <summary><span>${e(atlas.name)}</span><small>${atlas.progress.discovered}/${atlas.progress.total} secteurs${current ? ' · VOUS ÊTES ICI' : ''}</small></summary>
        <div class="atlas-body">
          <p class="atlas-objective"><strong>Prochaine étape</strong><br>${e(atlas.nextObjective.text)}</p>
          <ol class="atlas-route">
            ${atlas.sectors.map((sector) => `<li class="atlas-sector ${sector.discovered ? '' : 'atlas-unknown'}" ${sector.current ? 'aria-current="location"' : ''}>
              <div class="atlas-sector-heading"><span class="atlas-index" aria-hidden="true">${sector.index}</span><h4>${e(sector.title)}</h4>${sector.current ? '<span class="badge ok">ICI</span>' : ''}</div>
              ${sector.patrols ? `<p>Patrouilles neutralisées : <strong>${sector.patrols.cleared}/${sector.patrols.total}</strong></p>` : ''}
              ${sector.sanctuary ? `<p>Repos : ${e(sector.sanctuary.name)}</p>` : ''}
              ${sector.guardian ? `<p>${e(sector.guardian.name)} · <strong>${sector.guardian.defeated ? 'vaincu' : 'gardien actif'}</strong></p>` : ''}
              ${sector.shard ? `<p>${e(sector.shard.name)} · <strong>${sector.shard.collected ? 'Éclat acquis' : 'Éclat à récupérer'}</strong></p>` : ''}
              ${sector.routes.length ? `<ul class="atlas-passages">${sector.routes.map((route) => `<li><span>${route.kind === 'shortcut' ? 'Raccourci' : 'Passage'} ${e(route.direction)} → ${e(route.destinationTitle)}</span><small class="${route.available ? 'atlas-open' : ''}">${route.available ? 'Ouvert' : e(route.reason)}</small></li>`).join('')}</ul>` : ''}
            </li>`).join('')}
          </ol>
        </div>
      </details>`;
    }

    renderCodexMenu() {
      const enemyMap = new Map();
      for (const map of Object.values(MAPS)) {
        for (const enemy of map.patrols || []) if (!enemyMap.has(enemy.id)) enemyMap.set(enemy.id, { ...enemy, mapName: map.name });
      }
      const enemyRows = [...enemyMap.values()].map((enemy) => {
        const wins = Number(this.state.wins[enemy.id] || 0);
        const known = wins > 0;
        return `<div class="resident-item codex-entry ${known ? '' : 'locked'}"><div class="resident-icon">${known ? '◈' : '?'}</div><div class="resident-copy"><strong>${known ? enemy.name : 'ÉCHO NON IDENTIFIÉ'}</strong><small>${known ? `${enemy.mapName} · Niveau initial ${enemy.level} · Victoires ${wins}` : 'Vaincre cette créature pour restaurer sa fiche.'}</small></div><span class="badge ${known ? 'ok' : 'locked'}">${known ? 'ANALYSÉ' : 'INCONNU'}</span></div>`;
      }).join('');
      const formRows = Object.entries(FORMS).map(([id, form]) => {
        const known = this.state.partner.evolutions.includes(id);
        return `<article class="data-card codex-entry ${known ? '' : 'locked'}"><h3>${known ? form.name : 'FORME NON DÉCOUVERTE'}</h3><p>${known ? `Stade ${form.stage} · Technique : ${form.technique}` : 'Cette trajectoire doit être atteinte par l’évolution ou conservée après une renaissance.'}</p></article>`;
      }).join('');
      const achievementRows = ACHIEVEMENTS.map((achievement) => {
        const unlocked = this.state.achievements.includes(achievement.id);
        return `<article class="data-card codex-entry ${unlocked ? '' : 'locked'}"><h3>${unlocked ? '✓' : '○'} ${achievement.name}</h3><p>${achievement.text}${unlocked ? ' · Récompense obtenue.' : ''}</p></article>`;
      }).join('');
      const knownEnemies = [...enemyMap.values()].filter((enemy) => Number(this.state.wins[enemy.id] || 0) > 0).length;
      DOM.menuContent.innerHTML = `
        <div class="codex-progress"><span class="badge ok">FORMES ${this.state.partner.evolutions.length}/${Object.keys(FORMS).length}</span><span class="badge ok">ENNEMIS ${knownEnemies}/${enemyMap.size}</span><span class="badge ok">SUCCÈS ${this.state.achievements.length}/${ACHIEVEMENTS.length}</span></div>
        <h3 style="color:var(--cyan)">BESTIAIRE DES ÉCHOS</h3>${enemyRows}
        <h3 style="color:var(--cyan);margin-top:18px">TRAJECTOIRES D’ÉVOLUTION</h3><div class="menu-grid">${formRows}</div>
        <h3 style="color:var(--cyan);margin-top:18px">SUCCÈS</h3><div class="menu-grid">${achievementRows}</div>
      `;
    }

    renderSystemMenu() {
      const saveCode = this.exportSave();
      const difficulty = this.getDifficulty();
      const backupCount = BACKUP_SAVE_KEYS.filter((key) => gameStorage.getItem(key)).length;
      const hasBackup = backupCount > 0;
      DOM.menuContent.innerHTML = `
        <div class="system-actions">
          <button data-menu-action="save">SAUVEGARDER MAINTENANT</button>
          <button data-menu-action="download-save">TÉLÉCHARGER LA SAUVEGARDE JSON</button>
          <button data-menu-action="copy-save">COPIER LE CODE DE SAUVEGARDE</button>
          <button data-menu-action="import-file">IMPORTER UN FICHIER JSON</button>
          <button data-menu-action="import-save">COLLER DU JSON OU UN CODE</button>
          <button data-menu-action="restore-backup" ${hasBackup ? '' : 'disabled'}>RESTAURER UN SECOURS${backupCount ? ` (${backupCount})` : ''}</button>
          <button data-menu-action="toggle-audio">${this.audio.muted ? 'ACTIVER LE SON' : 'COUPER LE SON'}</button>
          <button data-menu-action="toggle-reduced-motion">${this.state.settings.reducedMotion ? 'RÉACTIVER LES ANIMATIONS' : 'RÉDUIRE LES ANIMATIONS'}</button>
          <button data-menu-action="toggle-contrast">${this.state.settings.highContrast ? 'CONTRASTE NORMAL' : 'CONTRASTE RENFORCÉ'}</button>
          <button data-menu-action="toggle-large-text">${this.state.settings.largeText ? 'TAILLE DE TEXTE NORMALE' : 'AGRANDIR LE TEXTE'}</button>
          <button data-menu-action="fullscreen">PLEIN ÉCRAN</button>
          ${this.state.finalBossDefeated ? '<button data-menu-action="new-cycle">CHOISIR UN NOUVEAU CYCLE +</button>' : ''}
          <button data-menu-action="return-title">RETOUR À L’ÉCRAN TITRE</button>
        </div>
        ${gameStorage.persistent ? '' : '<article class="data-card"><h3>STOCKAGE NON PERSISTANT</h3><p>Cette partie et ses secours existent uniquement dans cet onglet. Télécharge le JSON ou copie le code avant de fermer ou recharger. Tu pourras réimporter cet export lors de la prochaine session.</p></article>'}
        <article class="data-card" style="margin-top:12px">
          <h3>DIFFICULTÉ · ${difficulty.name}</h3><p>${difficulty.description} La difficulté est fixée pour ce cycle et sera conservée dans la sauvegarde.</p>
        </article>
        <article class="data-card" style="margin-top:12px">
          <h3>CODE DE SAUVEGARDE</h3>
          <p>Copie ce code Base64 ou télécharge le JSON pour transférer ta partie. Les deux formats sont vérifiés avant tout import.</p>
          <textarea class="save-code" readonly>${escapeHtml(saveCode)}</textarea>
        </article>
        <article class="data-card" style="margin-top:12px"><h3>COMMANDES</h3><p>ZQSD / WASD / flèches : déplacement · E / Espace : interaction · M : menu · Échap : fermer · Tab : navigation d’interface · 1 à 6 : commandes de combat · manette et tactile pris en charge.</p><p>Version ${VERSION} · sauvegarde automatique toutes les 30 secondes hors combat · trois copies de secours rotatives avec restauration atomique.</p><p>Quitter un combat reprend au point enregistré avant l’affrontement : PV, PE et objets sont restaurés à leur état d’entrée, sans récompense. La victoire ou la défaite enregistre ensuite son résultat.</p></article>
      `;
    }

    handleMenuClick(event) {
      const button = event.target.closest('[data-menu-action]');
      if (!button || !this.state) return;
      const action = button.dataset.menuAction;
      this.audio.play('ui');
      if (action === 'rename') {
        const name = window.prompt('Nom du partenaire (16 caractères maximum) :', this.state.partner.name);
        if (name?.trim()) {
          this.state.partner.name = name.trim().slice(0, 16).toUpperCase();
          this.updateHud();
          this.renderMenu();
          this.saveGame(false);
        }
      } else if (action === 'use-item') {
        this.useItem(button.dataset.item);
        this.renderMenu();
      } else if (action === 'save') {
        this.saveGame();
      } else if (action === 'download-save') {
        this.downloadSaveFile();
      } else if (action === 'copy-save') {
        const code = this.exportSave();
        navigator.clipboard?.writeText(code).then(() => this.toast('Code copié.')).catch(() => this.toast('Sélectionne manuellement le code affiché.'));
      } else if (action === 'import-file') {
        DOM.saveFileInput?.click();
      } else if (action === 'import-save') {
        const payload = window.prompt('Colle ici le JSON ou le code Base64 de sauvegarde :');
        if (payload) this.importSave(payload);
      } else if (action === 'restore-backup') {
        this.restoreLatestBackup();
      } else if (action === 'claim-contract') {
        this.claimDailyContract();
        this.renderMenu();
      } else if (action === 'toggle-audio') {
        this.audio.toggle();
        this.renderMenu();
      } else if (action === 'toggle-reduced-motion') {
        this.state.settings.reducedMotion = !this.state.settings.reducedMotion;
        this.applyAccessibilitySettings(); this.renderMenu(); this.saveGame(false);
      } else if (action === 'toggle-contrast') {
        this.state.settings.highContrast = !this.state.settings.highContrast;
        this.applyAccessibilitySettings(); this.renderMenu(); this.saveGame(false);
      } else if (action === 'toggle-large-text') {
        this.state.settings.largeText = !this.state.settings.largeText;
        this.applyAccessibilitySettings(); this.renderMenu(); this.saveGame(false);
      } else if (action === 'fullscreen') {
        if (!document.fullscreenElement) document.getElementById('game-shell').requestFullscreen?.();
        else document.exitFullscreen?.();
      } else if (action === 'new-cycle') {
        this.closeOverlays();
        this.beginNewCycle();
        return;
      } else if (action === 'return-title') {
        this.saveGame(false);
        this.closeOverlays();
        this.mode = 'title';
        document.body.classList.remove('game-active', 'in-battle');
        DOM.hud.classList.add('hidden');
        DOM.title.classList.remove('hidden');
        this.refreshContinueButton();
      }
    }

    useItem(id, inBattle = false) {
      const item = ITEMS[id];
      if (!item || !item.usable || (this.state.inventory[id] || 0) <= 0) {
        this.toast('Objet indisponible.');
        return false;
      }
      const p = this.state.partner;
      if (id === 'ration') {
        p.hunger = clamp(p.hunger - 35, 0, 100);
        p.morale = clamp(p.morale + 4, 0, 100);
      } else if (id === 'medgel') {
        if (p.hp >= p.maxHp) { this.toast('Les PV sont déjà au maximum.'); return false; }
        p.hp = clamp(p.hp + 55, 0, p.maxHp);
        this.audio.play('heal');
      } else if (id === 'ether') {
        if (p.mp >= p.maxMp) { this.toast('Les PE sont déjà au maximum.'); return false; }
        p.mp = clamp(p.mp + 40, 0, p.maxMp);
        this.audio.play('heal');
      } else if (id === 'stimulant') {
        p.fatigue = clamp(p.fatigue - 35, 0, 100);
        p.morale = clamp(p.morale - 2, 0, 100);
      } else if (id === 'incense') {
        p.bond = clamp(p.bond + 12, 0, 100);
        p.morale = clamp(p.morale + 15, 0, 100);
        this.audio.play('heal');
      }
      this.state.inventory[id] -= 1;
      if (!inBattle) this.toast(`${item.name} utilisé.`);
      this.updateHud();
      this.saveGame(false);
      return true;
    }

    openService(type, owner = '') {
      if (!this.state || this.mode !== 'world') return;
      this.serviceType = type;
      DOM.menu.classList.add('hidden');
      DOM.service.classList.remove('hidden');
      DOM.serviceKicker.textContent = type === 'core' ? 'CŒUR CENTRAL' : owner;
      const definitions = {
        core: ['NOX ARCA', 'Le Cœur central gère le repos, la sauvegarde, les renaissances et les grands projets permanents de la cité.'],
        forge: ['FORGE DES CARCASSES', 'Brakk-9 transforme les crédits et les alliages mémoriels en améliorations permanentes.'],
        archive: ['ARCHIVES OSSUAIRES', 'Mnémo-0 recense les habitants, restaure le lore et fournit des pistes de recrutement.'],
        transit: ['RÉSEAU DES PORTES', 'Pylône-K stabilise des raccourcis vers toutes les régions déjà alimentées par la cité.'],
        greenhouse: ['SERRE SYMBIOTIQUE', 'Mycella cultive nourriture et remèdes à partir de spores vivantes.'],
        clinic: ['CLINIQUE NOCTURNE', 'Vespera restaure les corps, les PE et la fatigue. Un soin gratuit est disponible chaque jour.'],
        arena: ['ARÈNE CHITINEUSE', 'Skarn organise des combats répétés dont la difficulté et les récompenses augmentent.'],
        training: ['DOJO DU GLAS', 'Bellgrave entraîne une statistique en échange de temps, de fatigue et de crédits.'],
        scout: ['BUREAU DES PISTES', 'Bifrons donne les conditions précises des habitants encore absents.'],
        care: ['FOYER DES LIENS', 'Nacre aide à renforcer le lien, la discipline ou le moral sans combat.'],
        shop: ['BAZAR DE COURANT', 'Coiljack vend des consommables et rachète les matériaux en surplus.'],
        expedition: ['HANGAR D’EXPÉDITION', 'Rook-Ø part six heures hors-carte et revient avec des ressources rares.'],
        security: ['BASTION DU DERNIER SCEAU', 'Khepri-7 surveille la défense de la cité et le chemin menant au Néant.'],
      };
      const [title, description] = definitions[type] || ['TERMINAL', 'Service non identifié.'];
      DOM.serviceTitle.textContent = title;
      DOM.serviceDescription.textContent = description;
      this.renderService();
    }

    serviceButton(action, title, description, cost = '', disabled = false) {
      return `<button class="service-action" data-service-action="${escapeHtml(action)}" ${disabled ? 'disabled' : ''}><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small>${cost ? `<em>${escapeHtml(cost)}</em>` : ''}</button>`;
    }

    renderChronicleService(chronicle) {
      const status = getChronicleStatus(chronicle, this.state);
      if (!status) return '';
      let html = '<div class="service-divider" aria-hidden="true"></div>';
      if (status.status === 'undiscovered') {
        return html + this.serviceButton('noop', 'Chronique régionale inconnue', `Une décision prise dans ${chronicle.regionName} pourrait réveiller ce récit.`, 'MÉMOIRE INTROUVABLE', true);
      }
      if (status.status === 'giver-missing') {
        return html + this.serviceButton('noop', chronicle.title, `Retrouvez ${chronicle.giverName} avant de confier cette mémoire.`, 'HABITANT ABSENT', true);
      }
      if (status.status === 'available') {
        return html + this.serviceButton(`chronicle:start:${chronicle.id}`, chronicle.title, `Interpréter ${chronicle.sourceEventTitle}, puis repartir chercher deux traces aux extrémités de ${chronicle.regionName}.`, 'COMMENCER LA CHRONIQUE');
      }
      if (status.status === 'active') {
        return html + this.serviceButton(`chronicle:review:${chronicle.id}`, chronicle.title, getChronicleObjective(chronicle, this.state), `${Math.max(0, status.progress - 1)}/${chronicle.nodes.length} TRACES`);
      }
      if (status.status === 'ready') {
        html += this.serviceButton('noop', `${chronicle.title} · conclusion`, 'Les deux traces sont réunies. Ce choix est permanent et restera visible dans la cité.', 'CHOISIR UN HÉRITAGE', true);
        for (const choice of chronicle.choices) {
          html += this.serviceButton(`chronicle:complete:${chronicle.id}:${choice.id}`, choice.label, choice.outcome, this.formatChronicleReward(choice.reward).toUpperCase());
        }
        return html;
      }
      return html + this.serviceButton(`chronicle:review:${chronicle.id}`, `${chronicle.title} · achevée`, status.conclusion.outcome, 'RELIRE LE RÉCIT');
    }

    renderService() {
      const p = this.state.partner;
      const type = this.serviceType;
      let html = '<div class="service-actions">';
      if (type === 'core') {
        const currentDay = formatTime(this.state.timeMinutes).day;
        const alreadySlept = Number(this.state.lastSleepDay || 0) === currentDay;
        html += this.serviceButton('sleep', 'Dormir jusqu’au matin', 'Restaure PV et PE, réduit presque toute la fatigue et fait avancer le temps. Une récupération complète est possible une fois par jour.', alreadySlept ? 'DÉJÀ REPOSÉ AUJOURD’HUI' : 'GRATUIT', alreadySlept);
        html += this.serviceButton('feed', 'Donner une ration', `Faim actuelle : ${Math.round(p.hunger)} / 100.`, `RATIONS : ${this.state.inventory.ration || 0}`, (this.state.inventory.ration || 0) <= 0);
        html += this.serviceButton('core-heal', 'Synchronisation du Cœur', 'Restaure 35 % des PV et PE sans faire passer la journée.', '25 CRÉDITS', this.state.credits < 25 || (p.hp >= p.maxHp && p.mp >= p.maxMp));
        for (const id of CORE_SUPPLIES) {
          const item = ITEMS[id];
          const count = Number(this.state.inventory[id] || 0);
          html += this.serviceButton(`core-supply:${id}`, `Provision · ${item.name}`, `${item.description} Stock du duo : ${count}.`, `${item.price} CRÉDITS`, this.state.credits < item.price || count >= SAVE_VALUE_LIMITS.counter);
        }
        html += this.serviceButton('save', 'Sauvegarder', 'Écrit immédiatement la progression dans le navigateur.', 'AUTOMATIQUE');
        html += this.serviceButton('rebirth', 'Renaissance volontaire', 'Recommence au stade I en conservant une partie des statistiques, du lien et toutes les infrastructures.', p.ageDays >= 10 ? 'DISPONIBLE' : `ÂGE ${p.ageDays}/10`, p.ageDays < 10);
        for (const project of Object.values(CITY_PROJECTS)) {
          const built = this.hasCityProject(project.id);
          const scoreLocked = this.getCityScore() < project.minScore;
          const itemLocked = Object.entries(project.items || {}).some(([itemId, amount]) => (this.state.inventory[itemId] || 0) < amount);
          const disabled = built || scoreLocked || this.state.credits < project.credits || itemLocked;
          const cost = built ? 'CONSTRUIT' : scoreLocked ? `CITÉ ${project.minScore} REQUISE` : this.formatProjectCost(project).toUpperCase();
          html += this.serviceButton(`project:${project.id}`, project.name, project.description, cost, disabled);
        }
      } else if (type === 'forge') {
        const cost = 70 + this.state.forgeLevel * 35;
        html += this.serviceButton('forge-power', 'Lame organique', '+2 Puissance permanente. Nécessite parfois un alliage mémoriel.', `${cost} CR + 1 ALLIAGE`, this.state.credits < cost || (this.state.inventory.scrap || 0) < 1);
        html += this.serviceButton('forge-guard', 'Plaques réactives', '+2 Défense et +8 PV maximum.', `${cost} CR + 1 ALLIAGE`, this.state.credits < cost || (this.state.inventory.scrap || 0) < 1);
        html += this.serviceButton('forge-spirit', 'Conducteur mnémique', '+2 Esprit et +6 PE maximum.', `${cost + 20} CR + 1 ÉCLAT-SEED`, this.state.credits < cost + 20 || (this.state.inventory.coreSeed || 0) < 1);
      } else if (type === 'archive') {
        html += this.serviceButton('archive-residents', 'Dossiers des habitants', `${this.state.recruited.length}/12 habitants retrouvés. Affiche les conditions de ceux qui manquent.`, 'CONSULTATION');
        html += this.serviceButton('archive-lore', 'Mémoire de Nox Arca', `${this.getShardCount()}/4 Éclats restaurés.`, 'CONSULTATION');
        html += this.serviceButton('archive-scan', 'Analyse du partenaire', 'Explique la prochaine évolution selon les statistiques actuelles.', 'CONSULTATION');
      } else if (type === 'transit') {
        const destinations = [
          ['city', 'Nox Arca'], ['wastes', 'Friches du Portail'], ['hive', 'Bio-Ruche'], ['fog', 'Cathédrale de Brume'], ['foundry', 'Fonderie'], ['void', 'Cœur du Néant'],
        ];
        for (const [id, name] of destinations) {
          const unlocked = id === 'city' || id === 'wastes' || this.state.unlockedMaps.includes(id) || (id === 'void' && this.canEnterVoid());
          const current = id === this.state.map || id === this.getCurrentRegionId();
          html += this.serviceButton(`travel:${id}`, name, current ? 'Région actuelle.' : `Voyage vers l’entrée de ${name}.`, unlocked ? '25 MINUTES' : 'SCELLÉ', !unlocked || current);
        }
      } else if (type === 'greenhouse') {
        html += this.serviceButton('craft-rations', 'Cultiver trois rations', 'Convertit une spore en nourriture organique.', '1 SPORE', (this.state.inventory.spore || 0) < 1);
        html += this.serviceButton('craft-medgel', 'Synthétiser deux gels', 'Remèdes de réparation utilisables en combat.', '2 SPORES', (this.state.inventory.spore || 0) < 2);
        html += this.serviceButton('craft-ether', 'Condensat d’écho', 'Restaure les PE. Mélange vivant et métal mémoriel.', '1 SPORE + 1 ALLIAGE', (this.state.inventory.spore || 0) < 1 || (this.state.inventory.scrap || 0) < 1);
      } else if (type === 'clinic') {
        const today = formatTime(this.state.timeMinutes).day;
        html += this.serviceButton('clinic-free', 'Soin quotidien', 'Restaure intégralement les PV et retire 15 fatigue.', this.state.dailyClinicDay === today ? 'DÉJÀ UTILISÉ' : 'GRATUIT', this.state.dailyClinicDay === today);
        html += this.serviceButton('clinic-full', 'Reconstruction complète', 'Restaure PV, PE et réduit la fatigue de 40.', '65 CRÉDITS', this.state.credits < 65);
        html += this.serviceButton('clinic-morale', 'Thérapie symbiotique', 'Moral +20 et lien +5.', '40 CRÉDITS', this.state.credits < 40);
      } else if (type === 'arena') {
        const level = Math.max(3, Math.min(12, p.level + this.state.arenaWins));
        html += this.serviceButton('arena-challenge', `Défi d’arène ${this.state.arenaWins + 1}`, `Affronte un adversaire de niveau ${level}. Aucune perte de crédits en cas de défaite.`, `${40 + level * 8} CRÉDITS DE RÉCOMPENSE`);
        const championReward = this.state.arenaEliteRewardClaimed ? 'Graine déjà obtenue ce cycle ; XP et crédits restent disponibles.' : 'Première victoire du cycle : une Graine de Cœur.';
        html += this.serviceButton('arena-elite', 'Épreuve du Champion', `Combat difficile contre une créature blindée. ${championReward}`, this.state.arenaEliteRewardClaimed ? 'REVANCHE DU CHAMPION' : 'GRAINE DU CHAMPION', p.level < 6);
      } else if (type === 'training') {
        const cost = 28 + this.state.trainingLevel * 4;
        const disabled = p.fatigue >= 88 || this.state.credits < cost;
        html += this.serviceButton('train:power', 'Frappe du Glas', '+2 Puissance. Deux heures et +18 fatigue.', `${cost} CRÉDITS`, disabled);
        html += this.serviceButton('train:guard', 'Mur de Résonance', '+2 Défense et +5 PV max. Deux heures et +18 fatigue.', `${cost} CRÉDITS`, disabled);
        html += this.serviceButton('train:spirit', 'Méditation Funèbre', '+2 Esprit et +4 PE max. Deux heures et +18 fatigue.', `${cost} CRÉDITS`, disabled);
        html += this.serviceButton('train:speed', 'Course entre les Cloches', '+2 Vitesse. Deux heures et +18 fatigue.', `${cost} CRÉDITS`, disabled);
      } else if (type === 'scout') {
        const missing = Object.values(RESIDENTS).filter((resident) => !this.state.recruited.includes(resident.id));
        if (!missing.length) html += this.serviceButton('noop', 'Tous retrouvés', 'Chaque habitant connu a rejoint Nox Arca.', 'VILLE COMPLÈTE', true);
        for (const resident of missing) html += this.serviceButton(`track:${resident.id}`, `${resident.name} · ${(WORLD_LAYOUTS[resident.region]?.name || resident.region || resident.map).toUpperCase()}`, resident.hint, 'SUIVRE LA PISTE');
      } else if (type === 'care') {
        html += this.serviceButton('care-bond', 'Rituel de confiance', '+12 lien, +8 moral et une heure de repos partagé.', '45 CRÉDITS', this.state.credits < 45);
        html += this.serviceButton('care-discipline', 'Exercice de communication', '+12 discipline sans réduire le lien.', '45 CRÉDITS', this.state.credits < 45);
        html += this.serviceButton('care-balance', 'Veillée silencieuse', 'Réduit faim et fatigue de 20, +5 lien.', '1 ENCENS', (this.state.inventory.incense || 0) < 1);
      } else if (type === 'shop') {
        const shopItems = ['ration', 'medgel', 'ether', 'stimulant', 'incense'];
        for (const id of shopItems) {
          const item = ITEMS[id];
          html += this.serviceButton(`buy:${id}`, item.name, item.description, `${item.price} CRÉDITS`, this.state.credits < item.price);
        }
        html += this.serviceButton('sell-spore', 'Vendre une spore', 'Coiljack la revend à la Bio-Ruche.', '+12 CRÉDITS', (this.state.inventory.spore || 0) <= 0);
        html += this.serviceButton('sell-scrap', 'Vendre un alliage', 'Utile à la forge, mais toujours monnayable.', '+16 CRÉDITS', (this.state.inventory.scrap || 0) <= 0);
      } else if (type === 'expedition') {
        const active = Boolean(this.state.expeditionActive);
        const ready = active && this.state.timeMinutes >= this.state.expeditionReadyAt;
        if (!active) html += this.serviceButton('expedition-start', 'Lancer une expédition', 'Rook-Ø part six heures. Récompenses : crédits, matériaux et parfois une Graine de Cœur.', '35 CRÉDITS', this.state.credits < 35);
        else if (ready) html += this.serviceButton('expedition-claim', 'Récupérer le convoi', 'L’expédition est revenue à Nox Arca.', 'RÉCOMPENSE DISPONIBLE');
        else {
          const remaining = Math.ceil(this.state.expeditionReadyAt - this.state.timeMinutes);
          html += this.serviceButton('noop', 'Expédition en cours', `Retour estimé dans ${Math.floor(remaining / 60)} h ${remaining % 60} min de temps de jeu.`, 'EN MISSION', true);
        }
      } else if (type === 'security') {
        html += this.serviceButton('security-report', 'Rapport de défense', `Cité ${this.getCityScore()} · ${this.getShardCount()}/4 Éclats · ${this.state.recruited.length}/12 habitants.`, this.canEnterVoid() ? 'SCEAU OUVERT' : 'SCEAU STABLE');
        html += this.serviceButton('security-drill', 'Simulation d’invasion', 'Combat d’élite contre une sentinelle. Récompense élevée, aucune perte de crédits.', 'ENTRAÎNEMENT');
        html += this.serviceButton('travel:void', 'Ouvrir la Porte du Néant', 'Accès direct au territoire de l’Architecte Pâle.', this.canEnterVoid() ? 'DISPONIBLE' : '100 CITÉ + 4 ÉCLATS', !this.canEnterVoid());
      }
      const chronicle = getChronicleByService(type);
      if (chronicle) html += this.renderChronicleService(chronicle);
      html += '</div>';
      DOM.serviceContent.innerHTML = html;
    }

    handleServiceClick(event) {
      const button = event.target.closest('[data-service-action]');
      if (!button || button.disabled || !this.state) return;
      const action = button.dataset.serviceAction;
      this.audio.play('ui');
      const p = this.state.partner;
      if (action === 'noop') return;
      if (action.startsWith('chronicle:')) {
        const [, operation, chronicleId, choiceId] = action.split(':');
        if (operation === 'start') this.beginChronicle(chronicleId);
        else if (operation === 'complete') this.completeChronicle(chronicleId, choiceId);
        else if (operation === 'review') this.reviewChronicle(chronicleId);
        return;
      }
      if (action === 'save') {
        this.saveGame();
      } else if (action === 'sleep') {
        const currentDay = formatTime(this.state.timeMinutes).day;
        if (Number(this.state.lastSleepDay || 0) === currentDay) { this.toast('Le Cœur a déjà accordé une récupération complète aujourd’hui.'); return; }
        const time = formatTime(this.state.timeMinutes);
        let untilMorning = (24 - time.hours + 7) * 60 - time.minutes;
        if (time.hours < 7) untilMorning = (7 - time.hours) * 60 - time.minutes;
        untilMorning = Math.max(240, untilMorning);
        this.advanceTime(untilMorning);
        this.state.lastSleepDay = formatTime(this.state.timeMinutes).day;
        p.hp = p.maxHp; p.mp = p.maxMp; p.fatigue = 4; p.hunger = clamp(p.hunger + 18, 0, 100); p.morale = clamp(p.morale + 8, 0, 100); p.bond = clamp(p.bond + 2, 0, 100);
        this.audio.play('heal'); this.toast('Le duo s’est reposé jusqu’au matin.');
      } else if (action === 'feed') {
        this.useItem('ration');
      } else if (action === 'core-heal') {
        if (this.spendCredits(25)) { p.hp = clamp(p.hp + p.maxHp * .35, 0, p.maxHp); p.mp = clamp(p.mp + p.maxMp * .35, 0, p.maxMp); this.audio.play('heal'); }
      } else if (action.startsWith('core-supply:')) {
        this.purchaseCoreSupply(action.slice('core-supply:'.length));
      } else if (action === 'rebirth') {
        this.confirmRebirth();
        return;
      } else if (action.startsWith('project:')) {
        this.buildCityProject(action.split(':')[1]);
      } else if (action.startsWith('forge-')) {
        const cost = 70 + this.state.forgeLevel * 35 + (action === 'forge-spirit' ? 20 : 0);
        const item = action === 'forge-spirit' ? 'coreSeed' : 'scrap';
        if (this.spendCredits(cost) && this.consumeItem(item, 1)) {
          if (action === 'forge-power') p.power += 2;
          if (action === 'forge-guard') { p.guard += 2; p.maxHp += 8; p.hp += 8; }
          if (action === 'forge-spirit') { p.spirit += 2; p.maxMp += 6; p.mp += 6; }
          this.state.forgeLevel += 1; this.audio.play('skill'); this.toast('Brakk-9 a terminé l’amélioration.');
        }
      } else if (action === 'archive-residents') {
        this.closeOverlays(); this.menuTab = 'city'; DOM.menu.classList.remove('hidden'); DOM.menuTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'city')); this.renderMenu(); return;
      } else if (action === 'archive-lore') {
        this.closeOverlays(); this.menuTab = 'journal'; DOM.menu.classList.remove('hidden'); DOM.menuTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'journal')); this.renderMenu(); return;
      } else if (action === 'archive-scan') {
        this.showEvolutionAnalysis(); return;
      } else if (action.startsWith('travel:')) {
        const target = action.split(':')[1]; this.closeOverlays(); this.changeMap(target); return;
      } else if (action === 'craft-rations') {
        if (this.consumeItem('spore', 1)) { this.state.inventory.ration += 3; this.toast('Trois rations cultivées.'); }
      } else if (action === 'craft-medgel') {
        if (this.consumeItem('spore', 2)) { this.state.inventory.medgel += 2; this.toast('Deux gels de réparation synthétisés.'); }
      } else if (action === 'craft-ether') {
        if (this.consumeItem('spore', 1) && this.consumeItem('scrap', 1)) { this.state.inventory.ether += 1; this.toast('Un condensat d’écho synthétisé.'); }
      } else if (action === 'clinic-free') {
        const today = formatTime(this.state.timeMinutes).day; this.state.dailyClinicDay = today; p.hp = p.maxHp; p.mp = p.maxMp; p.fatigue = clamp(p.fatigue - 15, 0, 100); this.audio.play('heal');
      } else if (action === 'clinic-full') {
        if (this.spendCredits(65)) { p.hp = p.maxHp; p.mp = p.maxMp; p.fatigue = clamp(p.fatigue - 40, 0, 100); this.audio.play('heal'); }
      } else if (action === 'clinic-morale') {
        if (this.spendCredits(40)) { p.morale = clamp(p.morale + 20, 0, 100); p.bond = clamp(p.bond + 5, 0, 100); this.audio.play('heal'); }
      } else if (action === 'arena-challenge') {
        const level = Math.max(3, Math.min(12, p.level + this.state.arenaWins));
        const enemy = this.makeEnemy({ id: `arena_${this.state.arenaWins}`, name: `Écho d’Arène ${this.state.arenaWins + 1}`, style: ['feral','scarab','wing','mystic'][this.state.arenaWins % 4], color: '#ffcf6e', level }, { boss: true, patrolId: null });
        enemy.arena = true; enemy.credits = 40 + level * 8; this.closeOverlays(); this.startBattle(enemy); return;
      } else if (action === 'arena-elite') {
        const enemy = this.makeEnemy({ id: 'arena_elite', name: 'COLOSSE CHITINEUX', style: 'titan', color: '#ffcf6e', level: Math.max(8, p.level + 1) }, { boss: true });
        enemy.arena = true; enemy.eliteReward = !this.state.arenaEliteRewardClaimed; this.closeOverlays(); this.startBattle(enemy); return;
      } else if (action.startsWith('train:')) {
        const stat = action.split(':')[1];
        const cost = 28 + this.state.trainingLevel * 4;
        if (p.fatigue >= 88) this.toast('Ton partenaire est trop fatigué.');
        else if (this.spendCredits(cost)) {
          p[stat] += 2; if (stat === 'guard') { p.maxHp += 5; p.hp += 5; } if (stat === 'spirit') { p.maxMp += 4; p.mp += 4; }
          p.fatigue = clamp(p.fatigue + 18, 0, 100); p.hunger = clamp(p.hunger + 8, 0, 100); p.discipline = clamp(p.discipline + 2, 0, 100); this.advanceTime(120); this.state.trainingLevel += 1; this.audio.play('skill'); this.checkEvolution();
        }
      } else if (action.startsWith('track:')) {
        const id = action.split(':')[1]; this.state.flags.trackedResident = id; this.toast(`${RESIDENTS[id].name} est maintenant suivi dans le HUD.`); this.closeOverlays(); return;
      } else if (action === 'care-bond') {
        if (this.spendCredits(45)) { p.bond = clamp(p.bond + 12, 0, 100); p.morale = clamp(p.morale + 8, 0, 100); p.fatigue = clamp(p.fatigue - 8, 0, 100); this.advanceTime(60); this.audio.play('heal'); }
      } else if (action === 'care-discipline') {
        if (this.spendCredits(45)) { p.discipline = clamp(p.discipline + 12, 0, 100); p.morale = clamp(p.morale + 4, 0, 100); this.advanceTime(60); this.audio.play('heal'); }
      } else if (action === 'care-balance') {
        if (this.consumeItem('incense', 1)) { p.hunger = clamp(p.hunger - 20, 0, 100); p.fatigue = clamp(p.fatigue - 20, 0, 100); p.bond = clamp(p.bond + 5, 0, 100); this.audio.play('heal'); }
      } else if (action.startsWith('buy:')) {
        const id = action.split(':')[1]; const item = ITEMS[id]; if (item && this.spendCredits(item.price)) { this.state.inventory[id] = (this.state.inventory[id] || 0) + 1; this.toast(`${item.name} acheté.`); }
      } else if (action === 'sell-spore') {
        if (this.consumeItem('spore', 1)) { this.state.credits += 12; this.toast('+12 crédits.'); }
      } else if (action === 'sell-scrap') {
        if (this.consumeItem('scrap', 1)) { this.state.credits += 16; this.toast('+16 crédits.'); }
      } else if (action === 'expedition-start') {
        if (this.spendCredits(35)) { this.state.expeditionActive = true; this.state.expeditionReadyAt = this.state.timeMinutes + 360; this.toast('Rook-Ø est parti pour six heures.'); }
      } else if (action === 'expedition-claim') {
        const credits = irand(80, 150); const spores = irand(1, 3); const scraps = irand(1, 3); this.state.credits += credits; this.state.inventory.spore += spores; this.state.inventory.scrap += scraps; if (chance(.28)) this.state.inventory.coreSeed += 1; this.state.expeditionActive = false; this.toast(`Convoi : +${credits} crédits, +${spores} spores, +${scraps} alliages.`); this.audio.play('victory');
      } else if (action === 'security-report') {
        this.showDialogue('KHEPRI-7', [this.canEnterVoid() ? 'Le dernier sceau est ouvert. La Porte violette est stable.' : `Le sceau exige encore ${Math.max(0, 100 - this.getCityScore())} points de cité et ${Math.max(0, 4 - this.getShardCount())} Éclat(s).`]); return;
      } else if (action === 'security-drill') {
        const enemy = this.makeEnemy({ id: 'security_drill', name: 'SENTINELLE DU BASTION', style: 'scarab', color: '#ffb75e', level: Math.max(8, p.level) }, { boss: true }); enemy.arena = true; enemy.credits += 80; this.closeOverlays(); this.startBattle(enemy); return;
      }
      this.updateHud();
      this.renderService();
      this.saveGame(false);
    }

    purchaseCoreSupply(id) {
      // Revalidate at transaction time: a stale/forged button never creates free
      // stock, negative credits, remote purchases or items outside this offer.
      if (!this.state || this.mode !== 'world' || this.state.map !== 'city' || this.serviceType !== 'core' || !CORE_SUPPLIES.includes(id)) return false;
      const item = ITEMS[id];
      const price = item.price;
      const credits = this.state.credits;
      const count = this.state.inventory[id] ?? 0;
      if (!Number.isSafeInteger(price) || price <= 0 || !Number.isFinite(credits) || credits < price || !Number.isSafeInteger(count) || count < 0 || count >= SAVE_VALUE_LIMITS.counter) {
        this.toast('Provision indisponible : vérifiez les crédits et la capacité de stockage.');
        return false;
      }
      this.state.credits = credits - price;
      this.state.inventory[id] = count + 1;
      this.toast(`${item.name} préparé pour l’expédition.`);
      return true;
    }

    spendCredits(amount) {
      if (this.state.credits < amount) { this.toast('Crédits insuffisants.'); return false; }
      this.state.credits -= amount; return true;
    }

    consumeItem(id, amount = 1) {
      if ((this.state.inventory[id] || 0) < amount) { this.toast(`${ITEMS[id]?.name || id} insuffisant.`); return false; }
      this.state.inventory[id] -= amount; return true;
    }

    showEvolutionAnalysis() {
      const p = this.state.partner;
      const decision = evaluateEvolution(p);
      const forecast = FORMS[decision.previewTargetFormId];
      if (!forecast) {
        this.showDialogue('MNÉMO-0', ['Forme finale atteinte. La prochaine transformation possible sera une renaissance volontaire.']);
        return;
      }
      const readiness = decision.eligible
        ? 'Les conditions de niveau sont réunies : la prochaine progression déclenchera cette évolution.'
        : `Niveau ${decision.requiredLevel} requis ; niveau actuel ${decision.level}.`;
      this.showDialogue('MNÉMO-0', [
        `${decision.pathName} : ${forecast.name} est la trajectoire dominante. Stabilité des soins ${Math.round(decision.care.stability)} %, lien ${Math.round(p.bond)}, discipline ${Math.round(p.discipline)}.`,
        `${readiness} Faim, fatigue, moral, erreurs de soin et équilibre des aptitudes peuvent encore modifier la trajectoire.`,
      ]);
    }

    confirmRebirth() {
      const accepted = window.confirm('La renaissance ramène le partenaire au niveau 1 et au stade I, tout en transmettant une partie de ses statistiques. La ville et les objets restent intacts. Continuer ?');
      if (!accepted) return;
      const p = this.state.partner;
      const starter = STARTERS.find((entry) => entry.id === p.starter) || STARTERS[0];
      const bonus = {
        power: Math.floor(Math.max(0, p.power - starter.stats.power) * .28),
        guard: Math.floor(Math.max(0, p.guard - starter.stats.guard) * .28),
        spirit: Math.floor(Math.max(0, p.spirit - starter.stats.spirit) * .28),
        speed: Math.floor(Math.max(0, p.speed - starter.stats.speed) * .28),
      };
      const previousName = p.name;
      const rebirths = p.rebirths + 1;
      const evolutions = [...p.evolutions];
      this.state.partner = makeDefaultState(starter).partner;
      Object.assign(this.state.partner, {
        name: previousName, rebirths, evolutions,
        power: starter.stats.power + bonus.power,
        guard: starter.stats.guard + bonus.guard,
        spirit: starter.stats.spirit + bonus.spirit,
        speed: starter.stats.speed + bonus.speed,
        bond: clamp(55 + rebirths * 4, 0, 90),
        discipline: 55,
      });
      this.state.partner.maxHp += bonus.guard * 3; this.state.partner.hp = this.state.partner.maxHp;
      this.state.partner.maxMp += bonus.spirit * 2; this.state.partner.mp = this.state.partner.maxMp;
      this.audio.play('evolution'); this.flash = 1;
      this.closeOverlays();
      this.showDialogue('LE CŒUR', [`${previousName} revient sous sa forme initiale, mais son nouveau corps porte la mémoire de ${rebirths} cycle(s).`, 'Les évolutions déjà découvertes restent inscrites dans les Archives.']);
      this.saveGame(false);
    }

    startBattle(enemy) {
      if (!this.state || this.mode === 'battle' || !enemy) return;
      if (!this.state.flags.combatTutorialSeen) {
        this.state.flags.combatTutorialSeen = true;
        this.showDialogue('PROTOCOLE DU LIEN', [
          'Un combat se gagne en donnant des ordres, pas en contrôlant directement votre partenaire. Attaquer, Technique, Défendre, Encourager et Soin ont chacun un rôle ; les touches 1 à 6 les sélectionnent aussi.',
          'La faim, la fatigue, le moral, la discipline et le lien influencent l’obéissance. Chaque échange remplit la Synchronisation : à 100 %, l’Unisson déclenche un pouvoir propre à la forme actuelle.',
          'Quitter un combat reprend au point enregistré avant l’affrontement, avec les PV, PE et objets d’entrée. Aucune récompense n’est accordée avant une victoire résolue.',
        ], () => {
          this.startBattle(enemy);
        });
        return;
      }
      if (!this.saveGame(false)) {
        this.toast('Enregistrement indisponible : combat possible, mais recharger perdra les progrès depuis la dernière sauvegarde. Exporte ta partie dès que possible.', 8000);
      }
      this.closeOverlays();
      DOM.prompt.classList.add('hidden');
      this.mode = 'battle';
      document.body.classList.add('in-battle');
      this.battle = {
        enemy: deepClone(enemy),
        phase: 'player',
        timer: 0,
        turn: 1,
        allyGuard: false,
        enemyGuard: false,
        focus: 0,
        sync: 0,
        allyLunge: 0,
        enemyLunge: 0,
        hitAlly: 0,
        hitEnemy: 0,
        skillBurst: 0,
        ended: false,
        result: null,
        log: `${enemy.name} bloque le passage.`,
      };
      this.gamepadCommandIndex = 0;
      DOM.battleUi.classList.remove('hidden');
      this.buildBattleCommands();
      this.updateBattleUi();
      this.fade = .45;
      this.fadeColor = enemy.color;
    }

    buildBattleCommands() {
      const form = FORMS[this.state.partner.formId];
      const profile = getTechniqueProfile(this.state.partner.formId);
      const effectLabels = {
        power: 'Puissance et rupture de garde.',
        guard: 'Défense offensive et protection.',
        spirit: 'Esprit, contrôle et récupération.',
        hybrid: 'Puissance et esprit en convergence.',
      };
      DOM.battleCommands.innerHTML = `
        <button data-command="attack"><strong>1 · ATTAQUER</strong><small>Ordre direct. Dégâts physiques.</small></button>
        <button data-command="skill"><strong>2 · ${profile.technique}</strong><small>${effectLabels[profile.scaling]} ${profile.cost} PE.</small></button>
        <button data-command="guard"><strong>3 · DÉFENDRE</strong><small>Réduit fortement la prochaine attaque.</small></button>
        <button data-command="encourage"><strong>4 · ENCOURAGER</strong><small>Renforce obéissance, moral et PE.</small></button>
        <button data-command="item"><strong>5 · SOIN RAPIDE</strong><small>Utilise automatiquement le meilleur objet.</small></button>
        <button data-command="sync"><strong>6 · UNISSON</strong><small>Effet propre à ${form?.name || 'la forme'} · disponible à 100 %.</small></button>
      `;
    }

    updateBattle(dt, gamepad) {
      if (!this.battle) return;
      const b = this.battle;
      b.allyLunge = Math.max(0, b.allyLunge - dt * 3.8);
      b.enemyLunge = Math.max(0, b.enemyLunge - dt * 3.8);
      b.hitAlly = Math.max(0, b.hitAlly - dt * 4.5);
      b.hitEnemy = Math.max(0, b.hitEnemy - dt * 4.5);
      b.skillBurst = Math.max(0, b.skillBurst - dt * 2.8);

      if (b.phase === 'player') {
        const keyCommands = [['1', 'attack'], ['2', 'skill'], ['3', 'guard'], ['4', 'encourage'], ['5', 'item'], ['6', 'sync']];
        for (const [key, command] of keyCommands) {
          if (this.input.consume(key)) {
            this.gamepadCommandIndex = keyCommands.findIndex((entry) => entry[1] === command);
            this.battleCommand(command);
            break;
          }
        }
        if (gamepad.navX || gamepad.navY) {
          const direction = gamepad.navX || gamepad.navY;
          this.gamepadCommandIndex = (this.gamepadCommandIndex + direction + keyCommands.length) % keyCommands.length;
          this.audio.play('ui');
          this.updateBattleUi();
        }
        if (gamepad.action) {
          const selected = keyCommands[this.gamepadCommandIndex]?.[1] || 'attack';
          this.battleCommand(selected);
        }
      } else if (b.timer > 0) {
        b.timer -= dt;
        if (b.timer <= 0) {
          if (b.phase === 'enemy-wait') this.enemyTurn();
          else if (b.phase === 'player-wait') {
            b.phase = 'player';
            b.turn += 1;
            this.setBattleLog('À toi de donner un ordre.');
          } else if (b.phase === 'resolve') {
            if (b.result === 'victory') this.resolveVictory();
            else this.resolveDefeat();
          }
        }
      }
      this.updateBattleUi();
    }

    gainBattleSync(amount) {
      if (!this.battle || this.battle.ended) return;
      const multiplier = (this.hasCityProject('resonator') ? 1.25 : 1) * getCycleScaling(this.state).syncGainMultiplier;
      this.battle.sync = clamp(this.battle.sync + amount * multiplier, 0, 100);
    }

    battleCommand(command) {
      const b = this.battle;
      if (!b || b.phase !== 'player' || b.ended) return;
      const p = this.state.partner;
      const form = FORMS[p.formId];
      const obedienceBase = .54 + p.discipline * .0026 + p.bond * .0018 + p.morale * .0008 + b.focus * .08 + this.getDifficulty().obedience;
      const obedience = clamp(obedienceBase - p.hunger * .0014 - p.fatigue * .0011, .34, .98);
      b.phase = 'acting';
      b.allyGuard = false;

      if (command === 'sync') {
        if (b.sync < 100) {
          this.setBattleLog(`Synchronisation insuffisante : ${Math.floor(b.sync)} / 100.`);
          b.phase = 'player';
          return;
        }
        const enemyWasGuarding = consumeGuard(b, 'enemyGuard');
        const strike = this.calculateDamage(p, b.enemy, 2.18 + (form?.stage || 1) * .2, true, enemyWasGuarding);
        const bondBonus = Math.round(p.bond * .28 + p.power * .42);
        const resolution = resolveUnison({
          formId: p.formId,
          actor: p,
          target: b.enemy,
          battle: b,
          damage: strike.amount + bondBonus,
        });
        b.allyLunge = 1; b.hitEnemy = 1; b.skillBurst = 1;
        this.flash = .8; this.shake = .8; this.audio.play('evolution');
        this.spawnParticles(480, 250, form?.color || '#8de7ff', 58, 210);
        this.setBattleLog(`${resolution.variant.name} : ${p.name} et son Gardien infligent ${resolution.damage} dégâts et réaccordent leur lien.`);
        if (this.handleEnemyDamageResult(resolution.damageResult)) return;
        this.afterPlayerAction();
        return;
      }

      if (command === 'encourage') {
        p.morale = clamp(p.morale + 8, 0, 100);
        p.bond = clamp(p.bond + .8, 0, 100);
        p.mp = clamp(p.mp + 7 + Math.floor(p.spirit * .08), 0, p.maxMp);
        b.focus = clamp(b.focus + 1, 0, 2);
        this.gainBattleSync(25);
        this.audio.play('heal');
        this.setBattleLog(`${p.name} comprend ton intention. Le prochain ordre sera plus fiable.`);
        this.afterPlayerAction();
        return;
      }

      if (command === 'item') {
        let used = false;
        if (p.hp < p.maxHp * .62 && (this.state.inventory.medgel || 0) > 0) used = this.useItem('medgel', true);
        else if (p.mp < p.maxMp * .42 && (this.state.inventory.ether || 0) > 0) used = this.useItem('ether', true);
        else if (p.fatigue > 72 && (this.state.inventory.stimulant || 0) > 0) used = this.useItem('stimulant', true);
        else if ((this.state.inventory.medgel || 0) > 0 && p.hp < p.maxHp) used = this.useItem('medgel', true);
        if (!used) {
          this.setBattleLog('Aucun objet utile n’est disponible.');
          b.phase = 'player';
          return;
        }
        this.gainBattleSync(6);
        this.setBattleLog('Le lien transmet le soin sans interrompre le combat.');
        this.afterPlayerAction();
        return;
      }

      const obeyed = chance(obedience + (command === 'guard' ? .08 : 0));
      if (!obeyed) {
        p.morale = clamp(p.morale - 3, 0, 100);
        p.discipline = clamp(p.discipline + .35, 0, 100);
        b.focus = 0;
        if (chance(.55)) {
          const enemyWasGuarding = consumeGuard(b, 'enemyGuard');
          const damage = this.calculateDamage(p, b.enemy, .72, false, enemyWasGuarding);
          const damageResult = resolveFinalBossDamage(b.enemy, damage.amount);
          b.allyLunge = 1; b.hitEnemy = 1; this.shake = .25; this.audio.play('hit');
          this.gainBattleSync(5);
          this.setBattleLog(`${p.name} ignore l’ordre mais improvise une attaque : ${damage.amount} dégâts.`);
          if (this.handleEnemyDamageResult(damageResult)) return;
        } else {
          this.setBattleLog(`${p.name} hésite et laisse passer son tour. Le lien manque de clarté.`);
        }
        this.afterPlayerAction();
        return;
      }

      p.discipline = clamp(p.discipline + .18, 0, 100);
      p.bond = clamp(p.bond + .12, 0, 100);
      b.focus = Math.max(0, b.focus - 1);
      let damageResult = null;
      if (command === 'attack') {
        const enemyWasGuarding = consumeGuard(b, 'enemyGuard');
        const damage = this.calculateDamage(p, b.enemy, 1.0, false, enemyWasGuarding);
        damageResult = resolveFinalBossDamage(b.enemy, damage.amount);
        b.allyLunge = 1; b.hitEnemy = 1; this.shake = damage.critical ? .5 : .25; this.audio.play('hit');
        this.spawnParticles(690, 245, form.color, damage.critical ? 24 : 12, 105);
        this.gainBattleSync(damage.critical ? 18 : 13);
        this.setBattleLog(`${p.name} frappe : ${damage.amount} dégâts${damage.critical ? ' — COUP CRITIQUE !' : ''}`);
      } else if (command === 'skill') {
        const profile = getTechniqueProfile(p.formId);
        const cost = profile.cost;
        if (p.mp < cost) {
          this.setBattleLog(`Il faut ${cost} PE pour utiliser ${profile.technique}.`);
          b.phase = 'player';
          return;
        }
        p.mp -= cost;
        const techniqueActor = profile.scaling === 'guard'
          ? { ...p, power: p.guard }
          : profile.scaling === 'hybrid'
            ? { ...p, spirit: (p.power + p.spirit) / 2 }
            : p;
        const spiritDamage = profile.scaling === 'spirit' || profile.scaling === 'hybrid';
        const enemyWasGuarding = consumeGuard(b, 'enemyGuard');
        const guardBroken = enemyWasGuarding && profile.effect.breaksEnemyGuard === true;
        const damage = this.calculateDamage(techniqueActor, b.enemy, profile.damageMultiplier, spiritDamage, enemyWasGuarding && !guardBroken, profile);
        const resolution = resolveTechnique({
          formId: p.formId,
          actor: p,
          target: b.enemy,
          battle: b,
          damage: damage.amount,
        });
        damageResult = resolution.damageResult;
        b.allyLunge = .65; b.hitEnemy = 1; b.skillBurst = 1; this.shake = .45; this.audio.play('skill');
        this.spawnParticles(685, 240, form.color, 30, 150);
        this.gainBattleSync(profile.syncGain + (damage.critical ? 5 : 0));
        const effectNotes = [];
        if (guardBroken) effectNotes.push('garde ennemie brisée');
        if (resolution.effect.hpRestored) effectNotes.push(`+${Math.round(resolution.effect.hpRestored)} PV`);
        if (resolution.effect.mpRestored) effectNotes.push(`+${Math.round(resolution.effect.mpRestored)} PE`);
        if (resolution.effect.enemyPowerReduced) effectNotes.push('puissance ennemie réduite');
        if (b.allyGuard) effectNotes.push('garde alliée');
        this.setBattleLog(`${profile.technique} inflige ${resolution.damage} dégâts${damage.critical ? ' critiques' : ''}${effectNotes.length ? ` · ${effectNotes.join(' · ')}` : ''}.`);
      } else if (command === 'guard') {
        b.allyGuard = true;
        p.mp = clamp(p.mp + 5, 0, p.maxMp);
        this.gainBattleSync(10);
        this.setBattleLog(`${p.name} se place entre toi et l’ennemi. Défense renforcée.`);
      }

      if (damageResult && this.handleEnemyDamageResult(damageResult)) return;
      this.afterPlayerAction();
    }

    handleEnemyDamageResult(result) {
      if (!result || !this.battle) return false;
      if (result.transitioned) {
        this.battle.skillBurst = 1;
        this.flash = .8;
        this.audio.play('evolution');
        this.setBattleLog('L’Architecte brise sa forme pâle : PHASE D’ANNULATION. Sa puissance augmente.');
        this.battle.phase = 'player-wait';
        this.battle.timer = 1.25;
        this.announce('Phase deux du boss final.');
        return true;
      }
      if (result.defeated) {
        this.finishBattle('victory');
        return true;
      }
      return false;
    }

    afterPlayerAction() {
      if (!this.battle || this.battle.ended) return;
      this.battle.phase = 'enemy-wait';
      this.battle.timer = .72;
    }

    enemyTurn() {
      const b = this.battle;
      if (!b || b.ended) return;
      const e = b.enemy;
      const p = this.state.partner;

      const pendingBossPhase = resolveFinalBossDamage(e, 0);
      if (pendingBossPhase.transitioned) {
        b.skillBurst = 1; this.flash = .8; this.audio.play('evolution');
        this.setBattleLog('L’Architecte brise sa forme pâle : PHASE D’ANNULATION. Sa puissance augmente.');
        b.phase = 'player-wait'; b.timer = 1.25; return;
      }

      if (e.hp < e.maxHp * .27 && chance(.22)) {
        b.enemyGuard = true;
        e.mp = clamp(e.mp + 6, 0, e.maxMp);
        this.setBattleLog(`${e.name} replie sa structure et se met en garde.`);
        b.phase = 'player-wait'; b.timer = .7; return;
      }

      const specialCost = 11;
      const useSpecial = e.mp >= specialCost && (b.turn % 3 === 0 || chance(e.boss ? .35 : .18));
      const allyWasGuarding = consumeGuard(b, 'allyGuard');
      let damage;
      if (useSpecial) {
        e.mp -= specialCost;
        damage = this.calculateDamage(e, p, e.final ? 1.7 : 1.35, true, allyWasGuarding);
        this.audio.play('skill'); b.skillBurst = 1;
        this.setBattleLog(`${e.name} libère une technique : ${damage.amount} dégâts.`);
      } else {
        damage = this.calculateDamage(e, p, 1.0, false, allyWasGuarding);
        this.audio.play('hit');
        this.setBattleLog(`${e.name} attaque : ${damage.amount} dégâts${damage.critical ? ' critiques' : ''}.`);
      }
      p.hp = clamp(p.hp - damage.amount, 0, p.maxHp);
      b.enemyLunge = 1; b.hitAlly = 1; this.shake = damage.critical ? .55 : .28;
      this.spawnParticles(270, 270, e.color, damage.critical ? 24 : 12, 105);
      this.gainBattleSync(damage.critical ? 14 : 9);

      if (e.style === 'fungus' && chance(.24)) {
        p.fatigue = clamp(p.fatigue + 5, 0, 100);
        this.setBattleLog(`${e.name} diffuse des spores : ${damage.amount} dégâts et +5 fatigue.`);
      }
      if (p.hp <= 0) { this.finishBattle('defeat'); return; }
      b.phase = 'player-wait';
      b.timer = .72;
    }

    calculateDamage(attacker, defender, multiplier = 1, spirit = false, guarded = false, technique = null) {
      const attackStat = spirit ? attacker.spirit : attacker.power;
      const guardPierce = clamp(Number(technique?.guardPierce) || 0, 0, 1);
      const defenseStat = (defender.guard || 0) * (1 - guardPierce);
      const speedDiff = (attacker.speed || 0) - (defender.speed || 0);
      const criticalBonus = clamp(Number(technique?.criticalBonus) || 0, 0, .27);
      const critical = chance(clamp(.06 + speedDiff * .006, .03, .27) + criticalBonus);
      let raw = attackStat * (spirit ? 1.65 : 1.45) * multiplier + (attacker.level || 1) * 2.7 - defenseStat * (spirit ? .42 : .58) + rand(-4, 6);
      if (critical) raw *= 1.5;
      if (guarded) raw *= .42;
      return { amount: Math.max(1, Math.round(raw)), critical };
    }

    setBattleLog(text) {
      if (!this.battle) return;
      this.battle.log = text;
      DOM.battleLog.textContent = text;
    }

    updateBattleUi() {
      if (!this.battle || !this.state) return;
      const b = this.battle;
      const p = this.state.partner;
      DOM.battleLog.textContent = b.log;
      DOM.battleAllyName.textContent = `${p.name} · NIV. ${p.level}`;
      DOM.battleAllyHp.style.width = pct(p.hp, p.maxHp);
      DOM.battleAllyStatus.textContent = b.allyGuard ? `EN GARDE · SYNCHRO ${Math.floor(b.sync)}%` : p.fatigue > 85 ? `ÉPUISÉ · SYNCHRO ${Math.floor(b.sync)}%` : `PE ${Math.ceil(p.mp)}/${p.maxMp} · SYNCHRO ${Math.floor(b.sync)}%`;
      DOM.battleEnemyName.textContent = `${b.enemy.name} · NIV. ${b.enemy.level}`;
      DOM.battleEnemyHp.style.width = pct(b.enemy.hp, b.enemy.maxHp);
      DOM.battleEnemyStatus.textContent = b.enemyGuard ? 'EN GARDE' : b.enemy.final && b.enemy.phaseTwo ? 'PHASE D’ANNULATION' : 'HOSTILE';
      DOM.battleCommands.querySelectorAll('button').forEach((button, index) => {
        const syncCommand = button.dataset.command === 'sync';
        const ready = syncCommand && b.sync >= 100;
        button.disabled = b.phase !== 'player' || b.ended || (syncCommand && !ready);
        button.classList.toggle('sync-ready', ready);
        button.classList.toggle('gamepad-selected', b.phase === 'player' && index === this.gamepadCommandIndex);
        button.setAttribute('aria-pressed', String(index === this.gamepadCommandIndex));
      });
    }

    finishBattle(result) {
      const b = this.battle;
      if (!b || b.ended) return;
      b.ended = true;
      b.result = result;
      b.phase = 'resolve';
      b.timer = result === 'victory' ? 1.0 : 1.25;
      if (result === 'victory') {
        this.audio.play('victory');
        this.setBattleLog(`${b.enemy.name} est vaincu.`);
      } else {
        this.audio.play('defeat');
        this.setBattleLog(`${this.state.partner.name} s’effondre. Le Cœur prépare un rappel d’urgence.`);
      }
    }

    resolveVictory() {
      const enemy = this.battle.enemy;
      const p = this.state.partner;
      DOM.battleUi.classList.add('hidden');
      this.mode = 'world';
      document.body.classList.remove('in-battle');
      this.battle = null;
      p.hp = Math.max(1, p.hp);
      p.morale = clamp(p.morale + (enemy.boss ? 7 : 3), 0, 100);
      p.bond = clamp(p.bond + (enemy.boss ? 2.4 : .7), 0, 100);
      const needPressure = getCycleScaling(this.state).needRateMultiplier;
      p.fatigue = clamp(p.fatigue + (enemy.boss ? 11 : 7) * needPressure, 0, 100);
      p.hunger = clamp(p.hunger + (enemy.boss ? 9 : 5) * needPressure, 0, 100);
      this.advanceTime(enemy.boss ? 45 : 25);
      const creditReward = Math.round(enemy.credits * (this.hasCityProject('beacon') ? 1.15 : 1));
      enemy.actualCredits = creditReward;
      this.state.credits += creditReward;
      this.state.wins[enemy.id] = (this.state.wins[enemy.id] || 0) + 1;
      const regionId = enemy.guardianRegion || this.getCurrentRegionId();
      if (Object.prototype.hasOwnProperty.call(this.state.regionWins, regionId)) {
        this.state.regionWins[regionId] = Number(this.state.regionWins[regionId] || 0) + 1;
      }
      if (enemy.guardianFlag) this.state.flags[enemy.guardianFlag] = true;
      if (enemy.patrolId) {
        if (!this.state.patrolVictories.includes(enemy.patrolId)) this.state.patrolVictories.push(enemy.patrolId);
        const respawnDelay = Math.round(260 * getCycleScaling(this.state).patrolRespawnMultiplier);
        this.state.worldDefeated[enemy.patrolId] = this.state.timeMinutes + respawnDelay;
      }
      if (enemy.loot) {
        const baseAmount = chance(.28) ? 2 : 1;
        const amount = Math.max(1, Math.round(baseAmount * getCycleScaling(this.state).materialMultiplier));
        this.state.inventory[enemy.loot] = (this.state.inventory[enemy.loot] || 0) + amount;
      }
      if (enemy.eliteReward && !this.state.arenaEliteRewardClaimed) {
        this.state.inventory.coreSeed += 1;
        this.state.arenaEliteRewardClaimed = true;
      }
      if (enemy.arena) this.state.arenaWins += 1;
      this.updateDailyContract(enemy);
      const progress = this.gainXp(enemy.xp);
      // Tous les effets de victoire précèdent la sauvegarde et les dialogues interruptibles.
      if (enemy.final) {
        this.state.finalBossDefeated = true;
        this.state.flags.endingSeen = false;
      }
      let presentRecruitment = null;
      if (enemy.recruitId && !this.state.recruited.includes(enemy.recruitId)) {
        for (const [itemId, amount] of Object.entries(enemy.recruitConsume || {})) {
          this.state.inventory[itemId] = Math.max(0, Number(this.state.inventory[itemId] || 0) - Number(amount || 0));
        }
        presentRecruitment = this.recruitResident(enemy.recruitId, { deferPresentation: true, deferSave: true });
      }
      this.checkAchievements();
      this.updateHud();
      this.saveGame(false);

      const afterProgress = () => {
        if (enemy.final) {
          this.showEnding();
        } else if (presentRecruitment) {
          presentRecruitment();
        } else if (enemy.guardianFlag) {
          const layout = WORLD_LAYOUTS[enemy.guardianRegion];
          this.showDialogue('SCEAU RÉGIONAL ROMPU', [
            `${enemy.name} reconnaît votre lien. La chambre de l’Éclat est désormais accessible.`,
            layout ? `Poursuivez jusqu’au dernier secteur de ${layout.name}. Le raccourci du sanctuaire peut aussi être ouvert pour les prochains voyages.` : 'La route mnésique est ouverte.',
          ]);
        } else {
          const lootText = enemy.loot ? ` · +${ITEMS[enemy.loot]?.name}` : '';
          this.toast(`Victoire · +${enemy.xp} XP · +${enemy.actualCredits || enemy.credits} crédits${lootText}`, 3200);
        }
      };

      if (progress.evolution) {
        const form = FORMS[progress.evolution];
        this.showDialogue('ÉVOLUTION DU LIEN', [
          `${p.name} dépasse les limites de son ancien corps. Les soins, les ordres et les combats vécus ensemble choisissent sa nouvelle forme.`,
          `${p.name} devient ${form.name}. Nouvelle technique : ${form.technique}.`,
        ], afterProgress);
      } else if (progress.levels.length) {
        this.showDialogue('PROGRESSION', [`${p.name} atteint le niveau ${p.level}. Ses statistiques et ses réserves augmentent.`], afterProgress);
      } else afterProgress();
    }

    resolveDefeat() {
      const enemy = this.battle.enemy;
      const arena = Boolean(enemy.arena);
      DOM.battleUi.classList.add('hidden');
      this.mode = 'world';
      document.body.classList.remove('in-battle');
      this.battle = null;
      const p = this.state.partner;
      const lost = arena ? 0 : Math.floor(this.state.credits * this.getDifficulty().defeatLoss);
      this.state.credits -= lost;
      p.hp = p.maxHp;
      p.mp = Math.round(p.maxMp * .6);
      p.fatigue = Math.max(42, p.fatigue - 20);
      p.hunger = Math.max(35, p.hunger);
      p.morale = clamp(p.morale - 8, 0, 100);
      p.bond = clamp(p.bond - 2, 0, 100);
      p.careMistakes += 1;
      this.advanceTime(240);
      this.changeMap('city', 480, 360);
      this.showDialogue('VESPERA — SIGNAL D’URGENCE', [
        `Le Cœur a rappelé votre lien avant sa rupture. ${lost ? `${lost} crédits ont été perdus pendant l’extraction.` : 'L’Arène a couvert le coût de l’extraction.'}`,
        'La défaite n’efface rien : entraîne ton partenaire, soigne ses besoins ou recrute de nouveaux services avant de repartir.',
      ]);
    }

    gainXp(amount) {
      const p = this.state.partner;
      const levels = [];
      p.xp += amount;
      while (p.xp >= this.xpToNext(p.level)) {
        p.xp -= this.xpToNext(p.level);
        p.level += 1;
        levels.push(p.level);
        const hpGain = 10 + Math.floor(p.guard * .18);
        const mpGain = 6 + Math.floor(p.spirit * .14);
        p.maxHp += hpGain; p.hp += hpGain;
        p.maxMp += mpGain; p.mp += mpGain;
        p.power += irand(1, 2); p.guard += irand(1, 2); p.spirit += irand(1, 2); p.speed += irand(1, 2);
        p.morale = clamp(p.morale + 4, 0, 100);
      }
      const evolution = this.checkEvolution(false);
      return { levels, evolution };
    }

    xpToNext(level) {
      return Math.round(58 + level * level * 24 + level * 18);
    }

    checkEvolution(showDialogue = true) {
      const p = this.state.partner;
      const decision = evaluateEvolution(p);
      const target = decision.targetFormId;
      if (!target) return null;
      this.applyEvolution(target);
      if (showDialogue) {
        const evolved = FORMS[target];
        this.showDialogue('ÉVOLUTION DU LIEN', [
          `${p.name} devient ${evolved.name} par la ${decision.pathName.toLowerCase()}.`,
          `Nouvelle technique : ${evolved.technique}. La stabilité des soins était de ${Math.round(decision.care.stability)} %.`,
        ]);
      }
      return target;
    }

    applyEvolution(target) {
      const p = this.state.partner;
      const form = FORMS[target];
      if (!form || p.formId === target) return;
      p.formId = target;
      if (!p.evolutions.includes(target)) p.evolutions.push(target);
      const stageBonus = form.stage === 2 ? 1 : 2;
      p.maxHp += 24 * stageBonus; p.hp = p.maxHp;
      p.maxMp += 16 * stageBonus; p.mp = p.maxMp;
      p.power += 4 * stageBonus; p.guard += 4 * stageBonus; p.spirit += 4 * stageBonus; p.speed += 3 * stageBonus;
      if (['ironhide', 'cathedral'].includes(target)) { p.guard += 5 * stageBonus; p.maxHp += 18 * stageBonus; }
      if (['veilwing', 'seraph'].includes(target)) { p.spirit += 5 * stageBonus; p.maxMp += 14 * stageBonus; }
      if (['riftclaw', 'dreadmaw'].includes(target)) { p.power += 5 * stageBonus; p.speed += 3 * stageBonus; }
      if (['nexusfox', 'sovereign'].includes(target)) { p.bond = clamp(p.bond + 5, 0, 100); p.power += 2 * stageBonus; p.spirit += 2 * stageBonus; p.speed += 2 * stageBonus; }
      this.audio.play('evolution'); this.flash = 1; this.spawnParticles(480, 270, form.color, 55, 180);
      this.updateHud();
      this.checkAchievements();
    }

    startFinalBattle() {
      if (!this.canEnterVoid() || this.state.finalBossDefeated) return;
      this.showDialogue('L’ARCHITECTE PÂLE', [
        'Tu as reconstruit une machine qui relie des mondes condamnés à se contaminer. Tu appelles cela une cité ; j’y vois une bouche.',
        'Douze voix peuvent habiter tes rues, mais une seule décision suffit à les transformer en armée. Prouve que ton lien ne repose pas sur la domination.',
        `${this.state.partner.name} ne regarde pas l’Architecte. Il te regarde, attendant un ordre qu’il choisira peut-être de comprendre.`,
      ], () => {
        const source = MAPS.void.boss;
        const enemy = this.makeEnemy(source, { boss: true, final: true, patrolId: null, level: Math.max(11, this.state.partner.level + 1) });
        const difficulty = this.getDifficulty();
        const cycle = getCycleScaling(this.state);
        enemy.maxHp = Math.round((420 + enemy.level * 25) * difficulty.enemyHp * cycle.enemyHpMultiplier); enemy.hp = enemy.maxHp;
        enemy.power = Math.round((28 + enemy.level * 3.1) * difficulty.enemyPower * cycle.enemyPowerMultiplier);
        enemy.guard = Math.round((23 + enemy.level * 2.45) * (1 + (difficulty.enemyHp - 1) * .45) * cycle.enemyGuardMultiplier);
        enemy.spirit = Math.round((31 + enemy.level * 3.25) * difficulty.enemyPower * cycle.enemySpiritMultiplier); enemy.speed = 23 + enemy.level + cycle.enemySpeedBonus;
        enemy.xp = Math.round(650 * difficulty.rewards * cycle.xpMultiplier); enemy.credits = Math.round(600 * difficulty.rewards * cycle.creditMultiplier);
        this.startBattle(enemy);
      });
    }

    render() {
      ctx.save();
      const motionScale = this.getAccessibilitySettings().reducedMotion ? 0 : 1;
      const shakeX = this.shake > 0 ? rand(-6, 6) * this.shake * motionScale : 0;
      const shakeY = this.shake > 0 ? rand(-4, 4) * this.shake * motionScale : 0;
      ctx.translate(shakeX, shakeY);

      if (this.state && (this.mode === 'world' || this.mode === 'battle' || this.mode === 'ending')) {
        if (this.mode === 'battle' && this.battle) this.renderBattle();
        else this.renderWorld();
      } else {
        this.renderTitleBackdrop();
      }
      this.renderParticles();
      ctx.restore();

      if (this.flash > 0) {
        ctx.fillStyle = `rgba(225,245,255,${this.flash * .55})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.fade > 0) {
        ctx.fillStyle = hexToRgba(this.fadeColor || '#050711', clamp(this.fade, 0, 1));
        ctx.fillRect(0, 0, W, H);
      }
    }

    renderTitleBackdrop() {
      const gradient = ctx.createRadialGradient(W * .5, H * .46, 10, W * .5, H * .46, 540);
      gradient.addColorStop(0, '#161a33');
      gradient.addColorStop(.45, '#090c1a');
      gradient.addColorStop(1, '#020309');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(141,231,255,.07)';
      ctx.lineWidth = 1;
      for (let r = 90; r < 460; r += 54) {
        ctx.beginPath(); ctx.ellipse(W / 2, H / 2, r * 1.45, r * .46, Math.sin(this.elapsed * .04) * .08, 0, TAU); ctx.stroke();
      }
      for (const particle of this.worldParticles) {
        const x = (particle.x + this.elapsed * 5 * particle.z) % W;
        const y = particle.y + Math.sin(this.elapsed * particle.z + particle.phase) * 12;
        ctx.fillStyle = `rgba(175,224,255,${.08 + particle.z * .12})`;
        ctx.fillRect(x, y, Math.max(1, particle.z * 2), Math.max(1, particle.z * 2));
      }
      drawMonster(ctx, W / 2, H / 2 + 18, 1.45, 'sovereign', '#8de7ff', 1, 3, this.elapsed, { mark: true });
    }

    renderWorld() {
      const map = MAPS[this.state.map] || MAPS.city;
      this.renderMapBackground(map);
      this.renderMapGeometry(map);

      const drawables = [];
      if (map.id === 'city') {
        drawables.push({ y: 20, draw: () => this.drawCityProjectEffects() });
        drawables.push({ y: 300, draw: () => this.drawCore() });
        for (const portal of this.getCityPortals()) drawables.push({ y: portal.y, draw: () => this.drawPortal(portal.x, portal.y, WORLD_LAYOUTS[portal.target]?.accent || MAPS[portal.target]?.accent || '#8de7ff', portal.unlocked, portal.target) });
        for (const residentId of this.state.recruited) {
          const resident = RESIDENTS[residentId];
          const building = resident && BUILDINGS[resident.building];
          if (!resident || !building) continue;
          drawables.push({ y: building.y + building.h, draw: () => this.drawBuilding(building, resident) });
          drawables.push({ y: building.y + building.h + 24, draw: () => drawMonster(ctx, building.x + building.w / 2, building.y + building.h + 23, .43, resident.style, resident.color, 1, 1, this.elapsed) });
        }
      } else {
        if (map.exit) this.drawExit(map.exit, map.accent);
        if (map.region && map.role === 'entry') this.drawExit({ x: 430, y: 503, w: 100, h: 30 }, map.accent);
        if (map.region) {
          const layout = getWorldLayout(map.region);
          const trackedTransitionId = this.getTrackedTransitionId(map.region, map.id);
          for (const transition of getSectorTransitions(map.region, map.id, this.state)) {
            const status = this.getTransitionStatus(transition, map.region);
            const connectionData = layout.connections.find(({ id }) => id === transition.connectionId);
            const activation = connectionData?.unlock?.activation;
            const canActivate = !transition.available && activation?.sectorId === map.id;
            this.drawTransition({
              ...transition,
              ...status,
              canActivate,
              tracked: transition.connectionId === trackedTransitionId,
              marker: canActivate ? activation : transition.from,
            }, map.accent);
          }
          for (const event of map.events || []) {
            if (!this.state.flags[event.onceFlag]) this.drawWorldEvent(event.trigger.x, event.trigger.y, map.accent);
          }
          for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
            const chronicleNode = getChronicleNode(chronicle, this.state);
            if (chronicleNode?.sectorId === map.id) this.drawChronicleNode(chronicleNode, map.accent);
          }
          if (map.sanctuary) this.drawSanctuary(map.sanctuary, map.accent);
          if (map.guardian && !this.state.flags[map.guardian.defeatFlag]) {
            drawables.push({
              y: map.guardian.y,
              draw: () => {
                drawMonster(ctx, map.guardian.x, map.guardian.y, .88, map.guardian.style, map.guardian.color, -1, 3, this.elapsed, { mark: true });
                this.drawEntityLabel(map.guardian.x, map.guardian.y - 68, map.guardian.name, 'GARDIEN DE L’ÉCLAT');
              },
            });
          }
        }
        const shardFlag = map.shard?.collectFlag || map.shard?.id;
        const shardReady = !map.shard?.requiresFlag || this.state.flags[map.shard.requiresFlag];
        if (map.shard && shardReady && !this.state.flags[shardFlag]) drawables.push({ y: map.shard.y, draw: () => this.drawShard(map.shard.x, map.shard.y, map.accent) });
        for (const resident of Object.values(RESIDENTS)) {
          if (resident.map !== map.id || this.state.recruited.includes(resident.id)) continue;
          drawables.push({
            y: resident.y,
            draw: () => {
              drawMonster(ctx, resident.x, resident.y, .66, resident.style, resident.color, Math.sin(this.elapsed + resident.x) > 0 ? 1 : -1, 2, this.elapsed, { mark: true });
              this.drawEntityLabel(resident.x, resident.y - 52, resident.name, resident.title);
              if (this.state.flags.trackedResident === resident.id) this.drawTrackedMarker(resident.x, resident.y - 78);
            },
          });
        }
        for (const patrol of map.patrols || []) {
          if (!this.isPatrolActive(patrol.id)) continue;
          const position = this.getPatrolPosition(patrol);
          drawables.push({ y: position.y, draw: () => drawMonster(ctx, position.x, position.y, .54, patrol.style, patrol.color, Math.cos(this.elapsed + position.y) > 0 ? 1 : -1, 1, this.elapsed) });
        }
        if (map.boss && !this.state.finalBossDefeated) {
          drawables.push({
            y: map.boss.y,
            draw: () => {
              drawMonster(ctx, map.boss.x, map.boss.y, .92, map.boss.style, map.boss.color, 1, 3, this.elapsed, { mark: true });
              this.drawEntityLabel(map.boss.x, map.boss.y - 72, map.boss.name, 'SOURCE DU GRAND SILENCE');
            },
          });
        }
      }

      const trailPoint = this.partnerTrail[Math.min(11, this.partnerTrail.length - 1)] || this.state.player;
      drawables.push({ y: trailPoint.y, draw: () => this.drawPartnerWorld(trailPoint.x, trailPoint.y) });
      drawables.push({ y: this.state.player.y, draw: () => this.drawPlayer(this.state.player.x, this.state.player.y) });
      drawables.sort((a, b) => a.y - b.y).forEach((entry) => entry.draw());

      this.renderAmbientParticles(map);
      this.renderDayNight(map);
      if (map.region) this.renderSectorProgress(map);
    }

    getBackgroundGradient(key) {
      if (!this.visualGradientCache) this.visualGradientCache = new Map();
      const cached = this.visualGradientCache.get(key);
      if (cached) return cached;

      let gradient;
      if (key === 'city') {
        gradient = ctx.createRadialGradient(480, 275, 40, 480, 275, 570);
        gradient.addColorStop(0, '#17243a'); gradient.addColorStop(.45, '#0c1222'); gradient.addColorStop(1, '#03050c');
      } else if (key === 'wastes') {
        gradient = ctx.createLinearGradient(0, 70, 0, H);
        gradient.addColorStop(0, '#241622'); gradient.addColorStop(.45, '#3b211d'); gradient.addColorStop(1, '#0b0b11');
      } else if (key === 'hive') {
        gradient = ctx.createRadialGradient(480, 250, 30, 480, 260, 570);
        gradient.addColorStop(0, '#24412d'); gradient.addColorStop(.45, '#13251e'); gradient.addColorStop(1, '#050b0a');
      } else if (key === 'fog') {
        gradient = ctx.createLinearGradient(0, 70, 0, H);
        gradient.addColorStop(0, '#242938'); gradient.addColorStop(.55, '#11151f'); gradient.addColorStop(1, '#05070b');
      } else if (key === 'fog-band') {
        gradient = ctx.createLinearGradient(0, 0, W, 0);
        gradient.addColorStop(0, 'rgba(210,220,240,0)'); gradient.addColorStop(.5, 'rgba(210,220,240,.035)'); gradient.addColorStop(1, 'rgba(210,220,240,0)');
      } else if (key === 'foundry') {
        gradient = ctx.createLinearGradient(0, 70, 0, H);
        gradient.addColorStop(0, '#282217'); gradient.addColorStop(.42, '#171411'); gradient.addColorStop(1, '#070708');
      } else {
        gradient = ctx.createRadialGradient(480, 240, 20, 480, 260, 620);
        gradient.addColorStop(0, '#271b49'); gradient.addColorStop(.43, '#0f0d24'); gradient.addColorStop(1, '#020309');
      }
      this.visualGradientCache.set(key, gradient);
      return gradient;
    }

    renderMapBackground(map) {
      if (map.theme === 'city') {
        const g = this.getBackgroundGradient('city');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(141,231,255,.055)'; ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 70); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 78; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        const rank = this.getCityRank().level;
        for (let i = 0; i < rank * 5; i += 1) {
          const angle = (i / (rank * 5)) * TAU + this.elapsed * .01;
          const radius = 110 + (i % 3) * 80;
          ctx.fillStyle = `rgba(141,231,255,${.035 + rank * .008})`;
          ctx.beginPath(); ctx.arc(480 + Math.cos(angle) * radius, 275 + Math.sin(angle) * radius * .62, 2 + (i % 3), 0, TAU); ctx.fill();
        }
      } else if (map.theme === 'wastes') {
        const g = this.getBackgroundGradient('wastes');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,145,92,.08)';
        for (let i = 0; i < 22; i += 1) {
          const x = seededNoise(i * 7 + 1) * W; const y = 125 + seededNoise(i * 11 + 2) * 380;
          ctx.beginPath(); ctx.ellipse(x, y, 80 + seededNoise(i + 4) * 150, 8 + seededNoise(i + 9) * 18, -.08, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,180,130,.12)';
        for (let i = 0; i < 9; i += 1) { const x = i * 120 - 40; ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + 80, H); ctx.stroke(); }
      } else if (map.theme === 'hive') {
        const g = this.getBackgroundGradient('hive');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(188,255,141,.09)';
        for (let y = 95; y < H; y += 56) {
          for (let x = 25 + ((Math.floor(y / 56) % 2) * 28); x < W; x += 56) {
            ctx.beginPath();
            for (let i = 0; i < 6; i += 1) { const a = i / 6 * TAU; const px = x + Math.cos(a) * 23; const py = y + Math.sin(a) * 23; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
            ctx.closePath(); ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(149,255,111,.045)';
        for (let i = 0; i < 18; i += 1) { const x = seededNoise(i + 44) * W; const y = 90 + seededNoise(i + 67) * 430; ctx.beginPath(); ctx.arc(x, y, 14 + seededNoise(i + 90) * 30, 0, TAU); ctx.fill(); }
      } else if (map.theme === 'fog') {
        const g = this.getBackgroundGradient('fog');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(216,226,255,.08)';
        for (let x = 55; x < W; x += 105) { ctx.beginPath(); ctx.moveTo(x, 75); ctx.lineTo(x, H); ctx.stroke(); ctx.beginPath(); ctx.arc(x, 128, 26, 0, TAU); ctx.stroke(); }
        const fog = this.getBackgroundGradient('fog-band');
        for (let i = 0; i < 15; i += 1) {
          const y = 110 + i * 28 + Math.sin(this.elapsed * .17 + i) * 12;
          ctx.fillStyle = fog; ctx.fillRect(0, y, W, 35);
        }
      } else if (map.theme === 'foundry') {
        const g = this.getBackgroundGradient('foundry');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,211,107,.08)';
        for (let x = 0; x < W; x += 64) { ctx.strokeRect(x, 75, 48, H - 75); }
        for (let y = 115; y < H; y += 68) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        ctx.shadowBlur = 12; ctx.shadowColor = '#ff8a4a'; ctx.strokeStyle = 'rgba(255,116,58,.24)'; ctx.lineWidth = 2;
        for (let i = 0; i < 5; i += 1) { const y = 145 + i * 82; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(220, y - 26, 680, y + 35, W, y - 10); ctx.stroke(); }
        ctx.shadowBlur = 0;
      } else {
        const g = this.getBackgroundGradient('void');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(179,148,255,.12)';
        for (let r = 80; r < 500; r += 52) { ctx.beginPath(); ctx.ellipse(480, 250, r * 1.28, r * .42, this.elapsed * .015, 0, TAU); ctx.stroke(); }
        for (const particle of this.worldParticles) { ctx.fillStyle = `rgba(210,195,255,${.08 + particle.z * .16})`; ctx.fillRect(particle.x, particle.y, particle.z * 2, particle.z * 2); }
      }
      this.drawSectorIdentity(map);
    }

    drawSectorIdentity(map) {
      const visual = getSectorVisualSignature(map.id, map.theme);
      const count = 4 + Math.round(visual.detail * 4);
      const phase = (visual.seed % 997) / 997 * TAU;
      const motif = visual.motif;
      ctx.save();
      ctx.strokeStyle = visual.accent;
      ctx.fillStyle = visual.accent;
      ctx.globalAlpha = visual.alpha;
      ctx.lineWidth = 1;

      if (motif === 'echo-grid' || motif === 'watch-grid') {
        const cellWidth = motif === 'watch-grid' ? 118 : 92;
        for (let index = 0; index < count; index += 1) {
          const x = 35 + ((visual.seed >>> (index % 20)) + index * 137) % 820;
          const y = 95 + index * (380 / Math.max(1, count - 1));
          ctx.strokeRect(x, y, cellWidth, 24 + (index % 3) * 8);
          ctx.beginPath(); ctx.moveTo(x + cellWidth / 2, y); ctx.lineTo(x + cellWidth / 2, y + 24 + (index % 3) * 8); ctx.stroke();
        }
      } else if (motif === 'signal-nodes' || motif === 'portal-scars' || motif === 'silent-rays') {
        const cx = motif === 'portal-scars' ? 480 : 480 + Math.cos(phase) * 90;
        const cy = motif === 'silent-rays' ? 245 : 285;
        for (let index = 0; index < count; index += 1) {
          const angle = phase + visual.angle + index * TAU / count;
          const inner = motif === 'portal-scars' ? 45 : 78;
          const outer = motif === 'silent-rays' ? 520 : 360;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner * .45);
          ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer * .45);
          ctx.stroke();
          if (motif === 'signal-nodes') {
            ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * 220, cy + Math.sin(angle) * 99, 3, 0, TAU); ctx.fill();
          }
        }
      } else if (motif === 'civic-orbits' || motif === 'dust-rings' || motif === 'distant-rings' || motif === 'void-orbits' || motif === 'broken-halo') {
        if (motif === 'broken-halo') ctx.setLineDash([12, 18]);
        const cx = 480 + Math.cos(phase) * (motif === 'dust-rings' ? 130 : 55);
        const cy = 280 + Math.sin(phase) * 32;
        for (let index = 0; index < count; index += 1) {
          const radius = 68 + index * 54;
          ctx.beginPath(); ctx.ellipse(cx, cy, radius * 1.5, radius * .42, visual.angle, 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (motif === 'wind-strata' || motif === 'soft-strata' || motif === 'furnace-flow') {
        for (let index = 0; index < count; index += 1) {
          const y = 105 + index * (405 / Math.max(1, count - 1));
          const bend = 24 + Math.sin(phase + index * 1.3) * (motif === 'furnace-flow' ? 38 : 20);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(260, y - bend, 675, y + bend, W, y - bend * .3);
          ctx.stroke();
        }
      } else if (motif === 'living-cells' || motif === 'spore-bloom') {
        for (let index = 0; index < count; index += 1) {
          const x = 90 + ((visual.seed >>> (index % 24)) + index * 151) % 780;
          const y = 110 + ((visual.seed >>> ((index + 9) % 24)) + index * 83) % 350;
          const radius = 16 + visual.detail * 13 + (index % 3) * 5;
          ctx.beginPath();
          if (motif === 'living-cells') ctx.ellipse(x, y, radius * 1.4, radius, phase + index, 0, TAU);
          else ctx.arc(x, y, radius, 0, TAU);
          ctx.stroke();
          if (motif === 'spore-bloom') {
            ctx.beginPath(); ctx.arc(x + radius * .7, y - radius * .45, 3 + (index % 3), 0, TAU); ctx.fill();
          }
        }
      } else if (motif === 'vein-canopy') {
        for (let index = 0; index < count; index += 1) {
          const x = (index + .5) * (W / count);
          const sway = Math.sin(phase + index * 1.7) * 46;
          ctx.beginPath();
          ctx.moveTo(x, H);
          ctx.bezierCurveTo(x - sway, 430, x + sway, 255, x + sway * .25, 78);
          ctx.stroke();
          ctx.beginPath(); ctx.ellipse(x + sway * .45, 255, 11 + visual.detail * 8, 4, phase + index, 0, TAU); ctx.stroke();
        }
      } else if (motif === 'procession-veil') {
        ctx.setLineDash([6, 13]);
        for (let index = 0; index < count; index += 1) {
          const x = (index + .5) * W / count;
          ctx.beginPath(); ctx.moveTo(x, 75); ctx.bezierCurveTo(x - 45, 210, x + 45, 380, x, H); ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (motif === 'memory-arches') {
        const cx = 480 + Math.cos(phase) * 100;
        for (let index = 0; index < count; index += 1) {
          const radius = 65 + index * 48;
          ctx.beginPath(); ctx.ellipse(cx, 315, radius * 1.35, radius * .6, visual.angle, Math.PI, TAU); ctx.stroke();
        }
      } else if (motif === 'mirror-haze') {
        for (let index = 0; index < count; index += 1) {
          const x = 80 + index * (800 / Math.max(1, count - 1));
          const y = 160 + Math.sin(phase + index) * 72;
          ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4 + visual.angle);
          ctx.strokeRect(-18 - index, -18 - index, 36 + index * 2, 36 + index * 2);
          ctx.restore();
        }
      } else if (motif === 'rail-circuit') {
        for (let index = 0; index < count; index += 1) {
          const y = 105 + index * (410 / Math.max(1, count - 1));
          const offset = 24 + ((visual.seed >>> (index % 24)) & 31);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(190 + offset, y);
          ctx.lineTo(235 + offset, y + Math.sin(phase + index) * 18);
          ctx.lineTo(W, y + Math.sin(phase + index * .7) * 8);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(235 + offset, y + Math.sin(phase + index) * 18, 2.5, 0, TAU);
          ctx.fill();
        }
      } else {
        for (let index = 0; index < count; index += 1) {
          const x = -80 + index * (W + 160) / Math.max(1, count - 1);
          const lean = 55 + Math.sin(phase + index) * 38;
          ctx.beginPath();
          ctx.moveTo(x, H); ctx.lineTo(x + lean, 78);
          ctx.lineTo(x + lean * .45 + 34, 335); ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    renderMapGeometry(map) {
      for (const obstacle of map.obstacles || []) this.drawObstacle(obstacle, map.theme, map.accent, map.id);
    }

    drawObstacle(rect, theme, accent, sectorId = theme) {
      ctx.save();
      if (theme === 'hive') {
        ctx.fillStyle = '#172d22'; ctx.strokeStyle = 'rgba(188,255,141,.22)';
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 22); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(188,255,141,.06)';
        for (let x = rect.x + 12; x < rect.x + rect.w; x += 24) { ctx.beginPath(); ctx.arc(x, rect.y + rect.h / 2 + Math.sin(x) * 7, 6, 0, TAU); ctx.fill(); }
      } else if (theme === 'fog') {
        ctx.fillStyle = '#171c27'; ctx.strokeStyle = 'rgba(216,226,255,.16)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = 'rgba(216,226,255,.05)'; ctx.fillRect(rect.x + 8, rect.y + 8, rect.w - 16, rect.h - 16);
      } else if (theme === 'foundry') {
        ctx.fillStyle = '#211d19'; ctx.strokeStyle = 'rgba(255,211,107,.21)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = '#ff9b53';
        for (let x = rect.x + 9; x < rect.x + rect.w; x += 25) { ctx.fillRect(x, rect.y + 8, 4, 4); }
      } else {
        ctx.fillStyle = theme === 'wastes' ? '#2b2528' : '#111827';
        ctx.strokeStyle = hexToRgba(accent, .2);
        ctx.beginPath(); ctx.moveTo(rect.x + 8, rect.y); ctx.lineTo(rect.x + rect.w, rect.y + 8); ctx.lineTo(rect.x + rect.w - 7, rect.y + rect.h); ctx.lineTo(rect.x, rect.y + rect.h - 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = hexToRgba(accent, .08); ctx.beginPath(); ctx.moveTo(rect.x + 12, rect.y + 10); ctx.lineTo(rect.x + rect.w - 18, rect.y + rect.h - 12); ctx.stroke();
      }
      const visual = getObstacleVisual(rect.kind, sectorId);
      const phase = (visual.seed % 997) / 997 * TAU;
      const spacing = Math.max(12, 26 - Math.round(visual.detail * 10));
      const motif = visual.motif;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.strokeStyle = visual.accent;
      ctx.fillStyle = visual.accent;
      ctx.globalAlpha = visual.alpha;
      ctx.lineWidth = 1;
      if (visual.family === 'mechanical') {
        if (/(cogs|rings)/.test(motif)) {
          const step = Math.max(8, spacing - 4);
          for (let radius = step; radius < Math.max(rect.w, rect.h) * .55; radius += step) {
            ctx.beginPath();
            ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, radius, Math.max(3, radius * .58), visual.angle, 0, TAU);
            ctx.stroke();
          }
        } else if (/(belt|flow|pipe|rail)/.test(motif)) {
          for (let y = rect.y + spacing / 2; y < rect.y + rect.h; y += spacing) {
            ctx.beginPath(); ctx.moveTo(rect.x, y);
            ctx.quadraticCurveTo(rect.x + rect.w / 2, y + Math.sin(phase + y) * 7, rect.x + rect.w, y);
            ctx.stroke();
          }
        } else if (/(lattice|bars|caged)/.test(motif)) {
          ctx.setLineDash([4, 4]);
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
          }
          for (let y = rect.y + spacing / 2; y < rect.y + rect.h; y += spacing) {
            ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
          }
          ctx.setLineDash([]);
        } else if (/(panels|cells)/.test(motif)) {
          for (let y = rect.y + 5; y < rect.y + rect.h - 4; y += spacing) {
            for (let x = rect.x + 5; x < rect.x + rect.w - 4; x += spacing) {
              ctx.strokeRect(x, y, Math.min(spacing - 5, rect.x + rect.w - x - 3), Math.min(spacing - 5, rect.y + rect.h - y - 3));
            }
          }
        } else {
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            ctx.beginPath(); ctx.moveTo(x, rect.y + 4); ctx.lineTo(x, rect.y + rect.h - 4); ctx.stroke();
            ctx.beginPath(); ctx.arc(x, rect.y + rect.h / 2, 2, 0, TAU); ctx.fill();
          }
        }
      } else if (visual.family === 'organic') {
        if (/(cells|lobes|clusters|rings)/.test(motif)) {
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            for (let y = rect.y + spacing / 2; y < rect.y + rect.h; y += spacing) {
              const radius = Math.max(3, spacing * (.2 + ((x + y + visual.seed) % 5) * .035));
              ctx.beginPath(); ctx.ellipse(x, y, radius * 1.35, radius, visual.angle, 0, TAU); ctx.stroke();
            }
          }
        } else if (/(veins|web|capillaries|filaments)/.test(motif)) {
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            ctx.beginPath(); ctx.moveTo(x, rect.y);
            ctx.bezierCurveTo(x - spacing, rect.y + rect.h * .35, x + spacing, rect.y + rect.h * .65, x + Math.sin(phase + x) * 5, rect.y + rect.h);
            ctx.stroke();
          }
        } else {
          for (let y = rect.y + spacing / 2; y < rect.y + rect.h; y += spacing) {
            ctx.beginPath();
            ctx.moveTo(rect.x, y);
            ctx.bezierCurveTo(rect.x + rect.w * .3, y - 9, rect.x + rect.w * .7, y + 9, rect.x + rect.w, y + Math.sin(phase + y) * 4);
            ctx.stroke();
          }
        }
      } else if (visual.family === 'ritual-fog') {
        if (motif === 'mirror-facets') {
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            ctx.save(); ctx.translate(x, rect.y + rect.h / 2); ctx.rotate(Math.PI / 4 + visual.angle);
            ctx.strokeRect(-spacing * .25, -spacing * .25, spacing * .5, spacing * .5); ctx.restore();
          }
        } else if (motif.includes('arches')) {
          const radiusStep = Math.max(9, spacing - 3);
          for (let radius = radiusStep; radius < Math.max(rect.w, rect.h); radius += radiusStep) {
            ctx.beginPath();
            ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h, radius, Math.max(4, radius * .55), visual.angle, Math.PI, TAU);
            ctx.stroke();
          }
        } else if (/(procession|funerary|veil)/.test(motif)) {
          ctx.setLineDash([3, 6]);
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x + Math.sin(phase + x) * 6, rect.y + rect.h); ctx.stroke();
          }
          ctx.setLineDash([]);
        } else if (/(glyphs|runes|sigil)/.test(motif)) {
          for (let x = rect.x + spacing / 2; x < rect.x + rect.w; x += spacing) {
            const y = rect.y + rect.h / 2 + Math.sin(phase + x) * Math.min(8, rect.h * .18);
            ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.closePath(); ctx.stroke();
          }
        } else {
          const radiusStep = Math.max(9, spacing - 3);
          for (let radius = radiusStep; radius < Math.max(rect.w, rect.h); radius += radiusStep) {
            ctx.beginPath();
            ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, radius, Math.max(4, radius * .45), visual.angle, 0, TAU);
            ctx.stroke();
          }
        }
      } else {
        if (/(rings|cracks)/.test(motif)) {
          const radiusStep = Math.max(9, spacing - 3);
          for (let radius = radiusStep; radius < Math.max(rect.w, rect.h) * .65; radius += radiusStep) {
            ctx.beginPath();
            ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, radius, Math.max(3, radius * .32), visual.angle, 0, TAU);
            ctx.stroke();
          }
        } else if (motif.includes('strata')) {
          for (let y = rect.y + spacing / 2; y < rect.y + rect.h; y += spacing) {
            ctx.beginPath(); ctx.moveTo(rect.x, y);
            ctx.quadraticCurveTo(rect.x + rect.w * .45, y - 8, rect.x + rect.w, y + 4); ctx.stroke();
          }
        } else if (/(fragments|shards|panels)/.test(motif)) {
          for (let offset = -rect.h; offset < rect.w; offset += spacing) {
            ctx.beginPath();
            ctx.moveTo(rect.x + offset, rect.y + rect.h);
            ctx.lineTo(rect.x + offset + rect.h * .55, rect.y);
            ctx.lineTo(rect.x + offset + rect.h * .8, rect.y + rect.h * .62);
            ctx.closePath(); ctx.stroke();
          }
        } else {
          for (let offset = -rect.h; offset < rect.w; offset += spacing) {
            ctx.beginPath();
            ctx.moveTo(rect.x + offset, rect.y + rect.h);
            ctx.lineTo(rect.x + offset + rect.h * .55, rect.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      ctx.restore();
    }

    drawCityProjectEffects() {
      if (!this.state?.cityProjects?.length) return;
      ctx.save();
      if (this.hasCityProject('sanctuary')) {
        const pulse = 1 + Math.sin(this.elapsed * 1.4) * .05;
        ctx.strokeStyle = 'rgba(139,240,178,.25)';
        ctx.fillStyle = 'rgba(139,240,178,.025)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(480, 278, 205 * pulse, 102 * pulse, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.setLineDash([7, 10]);
        ctx.beginPath(); ctx.ellipse(480, 278, 242 * pulse, 122 * pulse, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (this.hasCityProject('beacon')) {
        const nodes = [[245, 92], [715, 92], [875, 360], [85, 360], [480, 505]];
        ctx.strokeStyle = 'rgba(255,211,107,.14)'; ctx.lineWidth = 1;
        for (const [x, y] of nodes) {
          ctx.beginPath(); ctx.moveTo(480, 270); ctx.lineTo(x, y); ctx.stroke();
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 24);
          glow.addColorStop(0, 'rgba(255,244,190,.8)'); glow.addColorStop(.2, 'rgba(255,211,107,.35)'); glow.addColorStop(1, 'rgba(255,211,107,0)');
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffe7a0'; ctx.fillRect(x - 2, y - 10, 4, 20);
          ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.arc(x, y - 12, 3 + Math.sin(this.elapsed * 3 + x) * .6, 0, TAU); ctx.fill();
        }
      }
      if (this.hasCityProject('resonator')) {
        ctx.translate(480, 270);
        ctx.strokeStyle = 'rgba(179,148,255,.32)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i += 1) {
          ctx.save(); ctx.rotate(this.elapsed * (.16 + i * .05) * (i % 2 ? -1 : 1));
          ctx.setLineDash([9 + i * 2, 13]);
          ctx.beginPath(); ctx.ellipse(0, 0, 112 + i * 18, 56 + i * 9, i * .45, 0, TAU); ctx.stroke();
          ctx.restore();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    drawCore() {
      const score = this.getCityScore();
      const rank = this.getCityRank().level;
      const x = 480; const y = 270;
      drawShadow(ctx, x, y + 43, 64, 16, .42);
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = `rgba(141,231,255,${.25 + rank * .06})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3 + rank; i += 1) {
        ctx.save();
        ctx.rotate(this.elapsed * (.1 + i * .025) * (i % 2 ? 1 : -1));
        ctx.beginPath();
        const radius = 34 + i * 8;
        for (let j = 0; j < 6; j += 1) {
          const a = j / 6 * TAU;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius * .56;
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 42);
      g.addColorStop(0, '#efffff'); g.addColorStop(.18, '#8de7ff'); g.addColorStop(.6, 'rgba(91,174,214,.35)'); g.addColorStop(1, 'rgba(91,174,214,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a1020'; ctx.beginPath(); ctx.moveTo(-31, 30); ctx.lineTo(-18, -22); ctx.lineTo(0, -39); ctx.lineTo(18, -22); ctx.lineTo(31, 30); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8de7ff'; ctx.stroke();
      ctx.fillStyle = '#dffbff'; ctx.beginPath(); ctx.arc(0, -5, 7 + Math.sin(this.elapsed * 3) * 1.3, 0, TAU); ctx.fill();
      ctx.restore();
      this.drawEntityLabel(x, y - 78, 'CŒUR DE NOX ARCA', `ÉCHO ${score} · RANG ${rank}`);
    }

    drawBuilding(building, resident) {
      const { x, y, w, h, color } = building;
      drawShadow(ctx, x + w / 2, y + h + 8, w * .48, 10, .34);
      ctx.save();
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, hexToRgba(color, .25)); g.addColorStop(1, 'rgba(6,9,17,.96)');
      ctx.fillStyle = g; ctx.strokeStyle = hexToRgba(color, .52); ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.025)'; ctx.fillRect(x + 7, y + 8, w - 14, h - 17);
      ctx.strokeStyle = hexToRgba(color, .24);
      for (let line = x + 15; line < x + w; line += 20) { ctx.beginPath(); ctx.moveTo(line, y + 10); ctx.lineTo(line - 10, y + h - 10); ctx.stroke(); }
      ctx.fillStyle = color; ctx.font = '900 22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(building.icon, x + w / 2, y + h / 2 - 4);
      ctx.fillStyle = '#edf6ff'; ctx.font = '800 9px system-ui'; ctx.fillText(building.label, x + w / 2, y + h - 10);
      ctx.restore();
      const chronicle = getChronicleByService(resident.service);
      const completed = chronicle && getChronicleStatus(chronicle, this.state)?.status === 'complete';
      if (completed) {
        ctx.save();
        ctx.translate(x + w - 10, y + 10);
        ctx.fillStyle = color; ctx.strokeStyle = '#f4fbff'; ctx.lineWidth = 1.5; ctx.shadowBlur = 10; ctx.shadowColor = color;
        ctx.beginPath(); ctx.arc(0, 0, 8 + Math.sin(this.elapsed * 2) * .7, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#08101a'; ctx.font = '900 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('◇', 0, 0);
        ctx.restore();
      }
    }

    drawPortal(x, y, color, unlocked, target) {
      ctx.save();
      ctx.translate(x, y);
      drawShadow(ctx, 0, 20, 38, 9, .35);
      const alpha = unlocked ? 1 : .32;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = unlocked ? color : '#72798a';
      ctx.lineWidth = 4;
      ctx.shadowBlur = unlocked ? 18 : 0;
      ctx.shadowColor = color;
      ctx.beginPath(); ctx.ellipse(0, 0, 32, 43, 0, 0, TAU); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 33, 0, 0, TAU); ctx.stroke();
      if (unlocked) {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
        g.addColorStop(0, hexToRgba('#ffffff', .7)); g.addColorStop(.3, hexToRgba(color, .46)); g.addColorStop(1, hexToRgba(color, .02));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 23, 34, 0, 0, TAU); ctx.fill();
        for (let i = 0; i < 5; i += 1) {
          const a = this.elapsed * .8 + i * TAU / 5;
          ctx.fillStyle = '#edf6ff'; ctx.beginPath(); ctx.arc(Math.cos(a) * 27, Math.sin(a) * 37, 2.2, 0, TAU); ctx.fill();
        }
      } else {
        ctx.fillStyle = '#72798a'; ctx.font = '900 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('×', 0, 0);
      }
      ctx.shadowBlur = 0;
      ctx.restore();
      const name = { wastes: 'FRICHES', hive: 'BIO-RUCHE', fog: 'BRUME', foundry: 'FONDERIE', void: 'NÉANT' }[target] || target.toUpperCase();
      this.drawEntityLabel(x, y - 57, unlocked ? name : 'SCELLÉ', unlocked ? 'PORTE ACTIVE' : 'ÉCHO INSUFFISANT');
    }

    drawExit(exit, color) {
      ctx.save();
      const x = exit.x + exit.w / 2; const y = exit.y + exit.h / 2;
      ctx.fillStyle = 'rgba(4,7,12,.78)'; ctx.strokeStyle = hexToRgba(color, .45);
      roundRect(ctx, exit.x, exit.y, exit.w, exit.h, 8); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x + 15, y); ctx.moveTo(x + 7, y - 8); ctx.lineTo(x + 16, y); ctx.lineTo(x + 7, y + 8); ctx.stroke();
      ctx.restore();
    }

    drawTransition(transition, color) {
      const marker = transition.marker || transition.from;
      const available = Boolean(transition.available);
      const activeColor = transition.canActivate ? '#ffc975' : available ? color : '#6f788c';
      ctx.save();
      ctx.translate(marker.x, marker.y);
      ctx.strokeStyle = activeColor;
      ctx.fillStyle = hexToRgba(activeColor, available || transition.canActivate ? .14 : .045);
      ctx.lineWidth = transition.kind === 'shortcut' ? 3 : 2;
      ctx.shadowBlur = available || transition.canActivate ? 14 : 0;
      ctx.shadowColor = activeColor;
      ctx.beginPath();
      if (transition.kind === 'shortcut') {
        ctx.arc(0, 0, 21, 0, TAU);
      } else {
        ctx.rect(-26, -15, 52, 30);
      }
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.rotate(marker.facing === 'right' ? 0 : marker.facing === 'down' ? Math.PI / 2 : marker.facing === 'left' ? Math.PI : -Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-11, 0); ctx.lineTo(11, 0);
      ctx.moveTo(4, -7); ctx.lineTo(12, 0); ctx.lineTo(4, 7);
      ctx.stroke();
      ctx.restore();
      if (transition.tracked) this.drawTrackedMarker(marker.x, marker.y - 27);
    }

    drawWorldEvent(x, y, color) {
      const pulse = 1 + Math.sin(this.elapsed * 2.4) * .08;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = hexToRgba(color, .18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16; ctx.shadowColor = color;
      ctx.fillRect(-15 * pulse, -15 * pulse, 30 * pulse, 30 * pulse);
      ctx.strokeRect(-15 * pulse, -15 * pulse, 30 * pulse, 30 * pulse);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#f4fbff'; ctx.font = '900 17px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 0);
      ctx.restore();
    }

    drawChronicleNode(nodeData, color) {
      const pulse = 1 + Math.sin(this.elapsed * 3.1) * .07;
      ctx.save();
      ctx.translate(nodeData.x, nodeData.y);
      ctx.shadowBlur = 22;
      ctx.shadowColor = color;
      ctx.fillStyle = hexToRgba(color, .2);
      ctx.strokeStyle = '#f4fbff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let index = 0; index < 6; index += 1) {
        const angle = -Math.PI / 2 + index * TAU / 6;
        const radius = (index % 2 ? 19 : 23) * pulse;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f4fbff'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('◇', 0, 0);
      ctx.restore();
      this.drawEntityLabel(nodeData.x, nodeData.y - 43, 'TRACE MNÉSIQUE', nodeData.label.toUpperCase());
    }

    drawSanctuary(sanctuary, color) {
      const visit = Number(this.state.sectorVisits[this.state.map] || 0);
      const used = Number(this.state.sanctuaryVisits[sanctuary.id] || 0) === visit;
      ctx.save();
      ctx.translate(sanctuary.x, sanctuary.y);
      ctx.strokeStyle = used ? 'rgba(155,170,185,.3)' : hexToRgba(color, .75);
      ctx.fillStyle = used ? 'rgba(40,48,60,.16)' : hexToRgba(color, .08);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 35, 17, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, 21, 9, this.elapsed * .25, 0, TAU); ctx.stroke();
      if (!used) {
        const glow = ctx.createRadialGradient(0, -8, 1, 0, -8, 24);
        glow.addColorStop(0, 'rgba(255,255,255,.72)'); glow.addColorStop(.35, hexToRgba(color, .34)); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -8, 24, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    renderSectorProgress(map) {
      const progress = this.getRegionProgress(map.region);
      const layout = WORLD_LAYOUTS[map.region];
      if (!layout) return;
      const x = 24; const y = 91;
      ctx.save();
      ctx.fillStyle = 'rgba(5,8,16,.78)';
      ctx.strokeStyle = hexToRgba(map.accent, .28);
      roundRect(ctx, x, y, 190, 36, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b9c6d8'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(`EXPÉDITION · ${progress.discovered}/${progress.total} SECTEURS`, x + 10, y + 12);
      layout.mainPath.forEach((sectorId, index) => {
        const discovered = this.state.discoveredSectors.includes(sectorId);
        const current = sectorId === map.id;
        ctx.fillStyle = current ? '#ffffff' : discovered ? map.accent : '#3c4556';
        ctx.beginPath(); ctx.arc(x + 14 + index * 28, y + 25, current ? 4.5 : 3.2, 0, TAU); ctx.fill();
        if (index < layout.mainPath.length - 1) {
          ctx.strokeStyle = discovered ? hexToRgba(map.accent, .5) : 'rgba(90,100,118,.3)';
          ctx.beginPath(); ctx.moveTo(x + 19 + index * 28, y + 25); ctx.lineTo(x + 37 + index * 28, y + 25); ctx.stroke();
        }
      });
      ctx.fillStyle = progress.guardianDefeated ? '#8bf0b2' : '#ffc975';
      ctx.font = '800 7px system-ui';
      ctx.fillText(progress.shardCollected ? 'ÉCLAT ACQUIS' : progress.guardianDefeated ? 'CHAMBRE OUVERTE' : 'GARDIEN ACTIF', x + 150, y + 28);
      ctx.restore();
    }

    drawShard(x, y, color) {
      const bob = Math.sin(this.elapsed * 2.6) * 7;
      ctx.save(); ctx.translate(x, y + bob);
      ctx.shadowBlur = 28; ctx.shadowColor = color;
      ctx.fillStyle = '#eaffff'; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(14, -3); ctx.lineTo(6, 24); ctx.lineTo(-11, 15); ctx.lineTo(-15, -7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexToRgba(color, .55);
      for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.ellipse(0, 2, 22 + i * 8, 8 + i * 3, this.elapsed * .3 + i, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }

    drawPlayer(x, y) {
      const facing = this.state.player.facing;
      const side = facing === 'left' ? -1 : 1;
      const bob = Math.sin(this.elapsed * 7) * .9;
      drawShadow(ctx, x, y + 15, 14, 6, .35);
      ctx.save(); ctx.translate(x, y + bob);
      ctx.fillStyle = '#0a0d17'; ctx.strokeStyle = '#8de7ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, -16); ctx.lineTo(10, -16); ctx.lineTo(15, 15); ctx.lineTo(0, 22); ctx.lineTo(-15, 15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cbd7e8'; ctx.beginPath(); ctx.arc(0, -22, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#11182a'; ctx.beginPath(); ctx.arc(0, -24, 8, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = '#ff7fa8'; ctx.beginPath(); ctx.moveTo(side * 7, -1); ctx.lineTo(side * 18, 8); ctx.stroke();
      ctx.fillStyle = '#8de7ff'; ctx.fillRect(side * 5 - (side < 0 ? 4 : 0), -23, 4, 2);
      ctx.restore();
    }

    drawPartnerWorld(x, y) {
      const p = this.state.partner;
      const form = FORMS[p.formId] || FORMS.mote_feral;
      const stageScale = form.stage === 1 ? .44 : form.stage === 2 ? .53 : .62;
      const facing = this.state.player.facing === 'left' ? -1 : 1;
      drawShadow(ctx, x, y + 14, 22 + form.stage * 4, 7, .3);
      drawMonster(ctx, x, y, stageScale, form.style, form.color, facing, form.stage, this.elapsed, { mark: p.bond >= 85 });
    }

    drawEntityLabel(x, y, title, subtitle = '') {
      ctx.save();
      ctx.font = '800 9px system-ui';
      const width = Math.max(ctx.measureText(title).width + 18, subtitle ? ctx.measureText(subtitle).width + 18 : 0, 74);
      ctx.fillStyle = 'rgba(5,8,16,.83)'; ctx.strokeStyle = 'rgba(141,231,255,.17)';
      roundRect(ctx, x - width / 2, y - 11, width, subtitle ? 28 : 17, 4); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#edf6ff'; ctx.fillText(title, x, y - 8);
      if (subtitle) { ctx.font = '600 7px system-ui'; ctx.fillStyle = '#9aa9bc'; ctx.fillText(subtitle, x, y + 3); }
      ctx.restore();
    }

    drawTrackedMarker(x, y) {
      ctx.save(); ctx.translate(x, y + Math.sin(this.elapsed * 4) * 4);
      ctx.fillStyle = '#ffc975'; ctx.shadowBlur = 12; ctx.shadowColor = '#ffc975';
      ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(-7, -4); ctx.lineTo(7, -4); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
    }

    renderAmbientParticles(map) {
      const color = map.accent || '#8de7ff';
      ctx.save();
      for (const particle of this.worldParticles) {
        let x = (particle.x + this.elapsed * (map.theme === 'wastes' ? 22 : 5) * particle.z) % W;
        let y = particle.y + Math.sin(this.elapsed * particle.z + particle.phase) * (map.theme === 'fog' ? 22 : 8);
        if (map.theme === 'hive') y = (particle.y + this.elapsed * 8 * particle.z) % H;
        const alpha = map.theme === 'city' ? .08 : .12;
        ctx.fillStyle = hexToRgba(color, alpha + particle.z * .08);
        ctx.beginPath(); ctx.arc(x, y, Math.max(.7, particle.z * 1.6), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    renderDayNight(map) {
      if (map.theme === 'void') return;
      const time = formatTime(this.state.timeMinutes);
      let darkness = 0;
      if (time.hours >= 20) darkness = clamp((time.hours - 20) / 4, 0, 1) * .38;
      else if (time.hours < 7) darkness = clamp((7 - time.hours) / 7, 0, 1) * .4;
      if (map.theme === 'fog') darkness += .08;
      if (darkness <= 0) return;
      ctx.fillStyle = `rgba(3,6,18,${darkness})`; ctx.fillRect(0, 0, W, H);
      const x = this.state.player.x; const y = this.state.player.y;
      const light = ctx.createRadialGradient(x, y, 10, x, y, 145);
      light.addColorStop(0, 'rgba(155,225,255,.13)'); light.addColorStop(.6, 'rgba(155,225,255,.04)'); light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = light; ctx.fillRect(x - 150, y - 150, 300, 300); ctx.globalCompositeOperation = 'source-over';
    }

    renderBattle() {
      const map = MAPS[this.state.map] || MAPS.city;
      this.renderMapBackground(map);
      const b = this.battle;
      const p = this.state.partner;
      const form = FORMS[p.formId] || FORMS.mote_feral;
      const floor = ctx.createLinearGradient(0, 280, 0, H);
      floor.addColorStop(0, 'rgba(4,7,14,.08)'); floor.addColorStop(1, 'rgba(2,3,8,.86)');
      ctx.fillStyle = floor; ctx.fillRect(0, 260, W, H - 260);
      ctx.strokeStyle = hexToRgba(map.accent, .2); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(W / 2, 342, 390, 105, 0, 0, TAU); ctx.stroke();
      for (let i = 0; i < 5; i += 1) { ctx.beginPath(); ctx.ellipse(W / 2, 342, 110 + i * 64, 30 + i * 17, 0, 0, TAU); ctx.stroke(); }

      const allyX = 270 + Math.sin(Math.PI * b.allyLunge) * 95;
      const enemyX = 690 - Math.sin(Math.PI * b.enemyLunge) * 95;
      const allyY = 292 + (b.hitAlly > 0 ? rand(-4, 4) : 0);
      const enemyY = 270 + (b.hitEnemy > 0 ? rand(-4, 4) : 0);
      drawShadow(ctx, allyX, 342, 60, 15, .45);
      drawShadow(ctx, enemyX, 340, 68, 17, .45);
      if (b.allyGuard) this.drawShield(allyX, allyY, form.color, 64);
      if (b.enemyGuard) this.drawShield(enemyX, enemyY, b.enemy.color, 70);
      drawMonster(ctx, allyX, allyY, 1.55 + form.stage * .12, form.style, form.color, 1, form.stage, this.elapsed, { mark: p.bond >= 85 });
      drawMonster(ctx, enemyX, enemyY, b.enemy.final ? 2.05 : b.enemy.boss ? 1.8 : 1.55, b.enemy.style, b.enemy.color, -1, b.enemy.boss ? 3 : 2, this.elapsed, { mark: b.enemy.boss });

      if (b.skillBurst > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(480, 270, 0, 480, 270, 300 * b.skillBurst);
        g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(.22, hexToRgba(form.color, .32)); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (b.enemy.final && b.enemy.phaseTwo) {
        ctx.strokeStyle = 'rgba(228,232,255,.24)';
        for (let i = 0; i < 9; i += 1) { const a = this.elapsed * .5 + i * TAU / 9; ctx.beginPath(); ctx.moveTo(enemyX, enemyY); ctx.lineTo(enemyX + Math.cos(a) * 145, enemyY + Math.sin(a) * 145); ctx.stroke(); }
      }
    }

    drawShield(x, y, color, radius) {
      ctx.save(); ctx.strokeStyle = hexToRgba(color, .75); ctx.fillStyle = hexToRgba(color, .08); ctx.lineWidth = 3; ctx.shadowBlur = 18; ctx.shadowColor = color;
      ctx.beginPath(); ctx.ellipse(x, y, radius, radius * .72, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, radius - 8, (radius - 8) * .72, this.elapsed, 0, TAU); ctx.stroke(); ctx.restore();
    }

    renderParticles() {
      ctx.save();
      for (const particle of this.particles) {
        ctx.globalAlpha = particle.alpha;
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
      }
      ctx.restore();
    }

    showEnding() {
      if (!this.state) return;
      this.mode = 'ending';
      document.body.classList.remove('game-active', 'in-battle');
      DOM.battleUi.classList.add('hidden');
      DOM.menu.classList.add('hidden');
      DOM.service.classList.add('hidden');
      DOM.dialogue.classList.add('hidden');
      DOM.ending.classList.remove('hidden');
      DOM.hud.classList.add('hidden');
      const p = this.state.partner;
      const form = FORMS[p.formId];
      const allResidents = this.state.recruited.length === 12;
      const endingBase = allResidents
        ? `L’Architecte comprend enfin ce que ses calculs ignoraient : Nox Arca n’est pas une bouche, mais un foyer dont chaque habitant a choisi la porte. ${p.name}, devenu ${form.name}, pousse le Cœur à battre sans absorber les mondes qu’il relie. La cité est complète.`
        : `L’Architecte cède devant un lien qu’il ne peut réduire à un ordre. ${p.name}, sous la forme ${form.name}, rallume le Cœur. Nox Arca respire de nouveau ; les habitants encore absents pourront toujours être retrouvés après la fin.`;
      const completedChronicles = Object.values(REGIONAL_CHRONICLES)
        .filter((chronicle) => getChronicleStatus(chronicle, this.state)?.status === 'complete');
      const chronicleEpilogue = completedChronicles.length === CHRONICLE_IDS.length
        ? ' Les quatre chroniques de retour donnent à la cité plus qu’un avenir : les absents, les vivants et les protocoles libérés possèdent désormais une place choisie dans sa mémoire.'
        : completedChronicles.length
          ? ` ${completedChronicles.length} chronique(s) de retour témoignent déjà que reconstruire ne signifie pas effacer. Les autres mémoires pourront encore être suivies.`
          : ' Ses territoires conservent encore des mémoires auxquelles la cité devra choisir de répondre.';
      DOM.endingCopy.textContent = endingBase + chronicleEpilogue;
      DOM.endingStats.innerHTML = `
        <span>${this.state.recruited.length}/12 HABITANTS</span>
        <span>CITÉ ${this.getCityScore()}</span>
        <span>${completedChronicles.length}/${CHRONICLE_IDS.length} CHRONIQUES</span>
        <span>${this.getTotalWins()} VICTOIRES</span>
        <span>${p.evolutions.length} FORMES</span>
        <span>JOUR ${formatTime(this.state.timeMinutes).day}</span>
      `;
      this.audio.play('recruit');
    }

    applyCycleEchoes(choices = {}) {
      const inherited = new Set(Object.values(choices));
      const notes = [];
      const p = this.state.partner;
      if (inherited.has('restore_beacon')) { this.state.credits += 120; notes.push('la balise restaurée ramène 120 crédits'); }
      if (inherited.has('salvage_core')) { this.state.inventory.scrap += 4; notes.push('le noyau récupéré transmet 4 alliages'); }
      if (inherited.has('share_memory')) { p.bond = clamp(p.bond + 3, 0, 100); notes.push('la fleur partagée renforce le lien'); }
      if (inherited.has('prune_memory')) { this.state.inventory.spore += 3; notes.push('la taille mémorielle produit 3 spores'); }
      if (inherited.has('carry_name')) { p.bond = clamp(p.bond + 2, 0, 100); this.state.inventory.incense += 1; notes.push('le nom porté laisse un encens et du lien'); }
      if (inherited.has('release_name')) { p.fatigue = clamp(p.fatigue - 8, 0, 100); notes.push('le nom libéré allège la fatigue'); }
      if (inherited.has('finish_shift')) { p.discipline = clamp(p.discipline + 3, 0, 100); this.state.inventory.scrap += 3; notes.push('le quart honoré transmet discipline et alliages'); }
      if (inherited.has('forge_signature')) { p.discipline = clamp(p.discipline - 3, 0, 100); this.state.credits += 180; notes.push('la signature forgée ouvre 180 crédits mais trouble la discipline'); }
      return notes.length ? `Héritages actifs : ${notes.join(' ; ')}.` : 'Aucun choix d’expédition du cycle précédent n’a laissé d’héritage.';
    }

    beginNewCycle(lawId = null) {
      if (!this.state) return;
      if (!lawId) {
        this.mode = 'cycle-select';
        const laws = Object.values(CYCLE_LAWS);
        this.showDialogue('LE CŒUR — LOI DU PROCHAIN CYCLE', [
          'La cité demeure, mais les routes peuvent renaître sous une nouvelle loi. Chaque choix transforme la pression, les récompenses et les anomalies des quatre régions.',
          ...laws.map((law) => `${law.name} — ${law.description}`),
        ], null, {
          choicePrompt: 'Quelle loi doit gouverner le prochain cycle ?',
          choices: laws.map((law) => ({ id: law.id, label: law.name })),
          onChoice: (choice) => this.beginNewCycle(choice.id),
        });
        return;
      }
      const previousChoices = { ...this.state.expeditionChoices };
      const inheritedChoiceHistory = { ...this.state.cycleEchoes, ...previousChoices };
      const plan = createNextCyclePlan(this.state, lawId);
      const law = CYCLE_LAWS[lawId];
      this.state.flags.ngPlus = true;
      this.state.flags.endingSeen = true;
      this.state.flags.finalUnlocked = false;
      this.state.finalBossDefeated = false;
      this.state.cycleCount = plan.cycleCount;
      this.state.cycleModifier = plan.cycleModifier;
      this.state.cycleAnomalies = { ...plan.cycleAnomalies };
      this.state.cycleEchoes = inheritedChoiceHistory;
      this.state.newCycleBonus = plan.newCycleBonus;
      this.state.worldDefeated = {};
      this.state.regionWins = { wastes: 0, hive: 0, fog: 0, foundry: 0, void: 0 };
      this.state.discoveredSectors = ['city'];
      this.state.patrolVictories = [];
      this.state.sectorVisits = {};
      this.state.sanctuaryVisits = {};
      this.state.expeditionChoices = {};
      this.state.contract = null;
      this.state.arenaWins = 0;
      this.state.arenaEliteRewardClaimed = false;
      for (const regionId of REGION_IDS) {
        const layout = WORLD_LAYOUTS[regionId];
        this.state.flags[`shard_${regionId}`] = false;
        this.state.flags[`guardian_${regionId}_defeated`] = false;
        for (const connection of layout.connections) {
          if (connection.unlock?.activation?.flag) this.state.flags[connection.unlock.activation.flag] = false;
          if (connection.kind === 'shortcut' && connection.unlock?.flag) this.state.flags[connection.unlock.flag] = false;
        }
        for (const sector of layout.sectors) {
          for (const event of sector.events || []) this.state.flags[event.onceFlag] = false;
        }
      }
      this.state.unlockedMaps = this.state.unlockedMaps.filter((id) => id !== 'void');
      this.state.partner.bond = clamp(this.state.partner.bond + plan.bondBonus, 0, 100);
      this.state.partner.morale = 100;
      this.state.partner.hp = this.state.partner.maxHp;
      this.state.partner.mp = this.state.partner.maxMp;
      this.state.inventory.coreSeed += plan.coreSeedBonus;
      const inheritedSummary = this.applyCycleEchoes(previousChoices);
      DOM.ending.classList.add('hidden');
      DOM.hud.classList.remove('hidden');
      document.body.classList.add('game-active');
      document.body.classList.remove('in-battle');
      this.mode = 'world';
      this.changeMap('city', 480, 360);
      this.showDialogue('NOUVEAU CYCLE +', [
        `Cycle ${plan.cycleCount} — ${law.name}. ${law.description}`,
        `Les créatures gagnent jusqu’à ${plan.scaling.enemyLevelBonus} niveaux supplémentaires. Les sceaux 2/5, gardiens, Éclats, événements et raccourcis doivent être reconquis.`,
        `La cité, les recrues, les projets, les chroniques, les objets, le bestiaire et les évolutions restent acquis. Une Graine de Cœur rejoint l’inventaire. ${inheritedSummary}`,
      ]);
      this.saveGame(false);
    }
  }

  const game = new Game();
  window.__ECHObound = {
    version: VERSION,
    get game() { return game; },
    startBattle: (id = 'test') => {
      if (!game.state) return;
      game.startBattle(game.makeEnemy({ id, name: 'ÉCHO DE TEST', style: 'feral', color: '#ff7fa8', level: 2 }));
    },
    recruitAll: () => {
      if (!game.state) return;
      game.state.recruited = Object.keys(RESIDENTS);
      ['shard_wastes', 'shard_hive', 'shard_fog', 'shard_foundry'].forEach((id) => { game.state.flags[id] = true; });
      game.checkRegionUnlocks(); game.updateHud(); game.saveGame(false);
    },
    clearSave: () => gameStorage.removeItem(SAVE_KEY),
  };

})();
