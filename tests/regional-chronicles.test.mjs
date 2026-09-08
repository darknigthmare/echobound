import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHRONICLE_CHOICE_IDS,
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
} from '../src/regional-chronicles.js';
import { WORLD_LAYOUTS } from '../src/world-layouts.js';

const EXPECTED = Object.freeze({
  convoy_names: Object.freeze({
    region: 'wastes',
    event: 'wastes_caravan_blackbox',
    giver: 'brakk',
    service: 'forge',
  }),
  remembering_seed: Object.freeze({
    region: 'hive',
    event: 'hive_canopy_memory_bloom',
    giver: 'mycella',
    service: 'greenhouse',
  }),
  three_bells: Object.freeze({
    region: 'fog',
    event: 'fog_mirror_lost_name',
    giver: 'bellgrave',
    service: 'training',
  }),
  last_watch: Object.freeze({
    region: 'foundry',
    event: 'foundry_mills_worker_protocol',
    giver: 'coiljack',
    service: 'shop',
  }),
});

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function findSector(regionId, sectorId) {
  return WORLD_LAYOUTS[regionId]?.sectors.find(({ id }) => id === sectorId) || null;
}

function findEvent(regionId, eventId) {
  for (const sector of WORLD_LAYOUTS[regionId]?.sectors || []) {
    const event = (sector.events || []).find(({ id }) => id === eventId);
    if (event) return { event, sector };
  }
  return null;
}

function circleTouchesRect(point, rect) {
  const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(point.y, rect.y + rect.h));
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2 <= point.radius ** 2;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, 'Chaque donnée narrative exposée doit être gelée.');
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function stateFor(chronicle, progress, { source = 'expeditionChoices', conclusion = null } = {}) {
  const sourceEvent = findEvent(chronicle.region, chronicle.sourceEventId)?.event;
  const state = {
    recruited: [chronicle.giverId],
    expeditionChoices: {},
    cycleEchoes: {},
    chronicleProgress: { [chronicle.id]: progress },
    chronicleChoices: {},
  };
  state[source][chronicle.sourceEventId] = sourceEvent.choices[0].id;
  if (conclusion) state.chronicleChoices[chronicle.id] = conclusion;
  return state;
}

test('les quatre chroniques correspondent exactement aux régions, événements et services existants', () => {
  assert.equal(MAX_CHRONICLE_PROGRESS, 4);
  assert.deepEqual(CHRONICLE_IDS, Object.keys(EXPECTED));
  assert.deepEqual(Object.keys(REGIONAL_CHRONICLES), Object.keys(EXPECTED));
  assert.equal(new Set(CHRONICLE_IDS).size, 4);

  for (const [id, expected] of Object.entries(EXPECTED)) {
    const chronicle = REGIONAL_CHRONICLES[id];
    assert.equal(chronicle.id, id);
    assert.equal(chronicle.region, expected.region);
    assert.equal(chronicle.sourceEventId, expected.event);
    assert.equal(chronicle.giverId, expected.giver);
    assert.equal(chronicle.service, expected.service);
    assert.equal(getChronicleByService(expected.service), chronicle);
    assert.ok(findEvent(expected.region, expected.event), `${expected.event} doit exister dans ${expected.region}.`);
    assert.ok(chronicle.title.length > 5);
    assert.ok(chronicle.intro.length >= 2);
    const eventChoiceIds = findEvent(expected.region, expected.event).event.choices.map(({ id: choiceId }) => choiceId).sort();
    assert.deepEqual(Object.keys(chronicle.sourceBranches).sort(), eventChoiceIds);
    assert.equal(new Set(Object.values(chronicle.sourceBranches).map(({ intro }) => intro.join('|'))).size, eventChoiceIds.length);
    for (const branch of Object.values(chronicle.sourceBranches)) assert.ok(branch.intro.length >= 2);
  }
  assert.equal(getChronicleByService('service_inconnu'), null);
});

test('les nœuds sont uniques, placés dans les secteurs d’entrée et d’Éclat et hors obstacles', () => {
  const nodeIds = new Set();
  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    const layout = WORLD_LAYOUTS[chronicle.region];
    assert.equal(chronicle.nodes.length, 2);
    assert.equal(chronicle.nodes[0].sectorId, layout.entrySectorId);
    assert.equal(chronicle.nodes[1].sectorId, layout.shardSectorId);

    for (const currentNode of chronicle.nodes) {
      assert.equal(nodeIds.has(currentNode.id), false, `Nœud dupliqué : ${currentNode.id}`);
      nodeIds.add(currentNode.id);
      const sector = findSector(chronicle.region, currentNode.sectorId);
      assert.ok(sector, `Secteur absent : ${currentNode.sectorId}`);
      assert.equal(Number.isFinite(currentNode.x), true);
      assert.equal(Number.isFinite(currentNode.y), true);
      assert.ok(currentNode.radius >= 36 && currentNode.radius <= 64);
      assert.ok(currentNode.x >= currentNode.radius && currentNode.x <= sector.bounds.width - currentNode.radius);
      assert.ok(currentNode.y >= currentNode.radius && currentNode.y <= sector.bounds.height - currentNode.radius);
      for (const obstacle of sector.obstacles) {
        assert.equal(circleTouchesRect(currentNode, obstacle), false, `${currentNode.id} touche ${obstacle.id}.`);
      }
      assert.ok(currentNode.label.length > 5);
      assert.ok(currentNode.lines.length >= 2);
    }
  }
  assert.equal(nodeIds.size, 8);
});

test('chaque conclusion a un identifiant globalement unique et une récompense bornée', () => {
  const globalChoiceIds = new Set();
  assert.equal(isRecord(CHRONICLE_CHOICE_IDS), true);
  assert.equal(Object.keys(CHRONICLE_CHOICE_IDS).length, 4);

  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    assert.equal(chronicle.choices.length, 2);
    const allowed = CHRONICLE_CHOICE_IDS[chronicle.id];
    assert.equal(Array.isArray(allowed), true);
    assert.equal(allowed.length, 2);
    for (const choice of chronicle.choices) {
      assert.equal(globalChoiceIds.has(choice.id), false, `Conclusion dupliquée : ${choice.id}`);
      globalChoiceIds.add(choice.id);
      assert.equal(isChronicleChoiceId(chronicle.id, choice.id), true);
      assert.ok(choice.label.length > 5);
      assert.ok(choice.outcome.length > 10);
      assert.ok(choice.lines.length >= 2);
      assert.ok(Number.isInteger(choice.reward.credits));
      assert.ok(choice.reward.credits >= 60 && choice.reward.credits <= 250);
      assert.equal(isRecord(choice.reward.inventory), true);
      assert.ok(Object.keys(choice.reward.inventory).length >= 1);
      for (const amount of Object.values(choice.reward.inventory)) {
        assert.ok(Number.isInteger(amount) && amount >= 1 && amount <= 4);
      }
      const relationshipKeys = ['bond', 'discipline', 'morale', 'fatigue'];
      assert.ok(relationshipKeys.some((key) => Number.isFinite(choice.reward[key])));
      for (const key of relationshipKeys) {
        if (choice.reward[key] === undefined) continue;
        assert.ok(choice.reward[key] >= -20 && choice.reward[key] <= 10, `${choice.id}.${key} est hors équilibre.`);
      }
    }
  }
  assert.equal(globalChoiceIds.size, 8);
  assert.equal(isChronicleChoiceId('convoy_names', 'choix_inconnu'), false);
  assert.equal(isChronicleChoiceId('__proto__', 'memorial_steel'), false);
});

test('chaque choix source sélectionne une narration distincte et immuable', () => {
  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    const intros = [];
    for (const sourceChoiceId of Object.keys(chronicle.sourceBranches)) {
      const state = stateFor(chronicle, 0);
      state.expeditionChoices[chronicle.sourceEventId] = sourceChoiceId;
      assert.equal(getChronicleSourceChoice(chronicle, state), sourceChoiceId);
      const intro = getChronicleIntro(chronicle, state);
      assert.equal(intro, chronicle.sourceBranches[sourceChoiceId].intro);
      assert.equal(Object.isFrozen(intro), true);
      intros.push(intro.join('|'));
    }
    assert.equal(new Set(intros).size, Object.keys(chronicle.sourceBranches).length);
  }
  assert.equal(getChronicleSourceChoice(null, {}), null);
  assert.deepEqual(getChronicleIntro(null, {}), []);
  assert.equal(Object.isFrozen(getChronicleIntro(null, {})), true);
});

test('le statut pur couvre découverte, donneur absent, disponibilité et progression persistante', () => {
  for (const chronicle of Object.values(REGIONAL_CHRONICLES)) {
    const unknown = getChronicleStatus(chronicle, {});
    assert.equal(unknown.status, 'undiscovered');
    assert.equal(unknown.progress, 0);
    assert.equal(getChronicleNode(chronicle, {}), null);

    const missingGiver = stateFor(chronicle, 0);
    missingGiver.recruited = [];
    assert.equal(getChronicleStatus(chronicle, missingGiver).status, 'giver-missing');

    for (const source of ['expeditionChoices', 'cycleEchoes']) {
      const available = getChronicleStatus(chronicle, stateFor(chronicle, 0, { source }));
      assert.equal(available.status, 'available');
      assert.equal(available.progress, 0);
      assert.equal(available.giverRecruited, true);
      assert.ok(available.sourceChoice);
      assert.match(getChronicleObjective(chronicle, stateFor(chronicle, 0, { source })), new RegExp(chronicle.giverName));
    }

    for (const progress of [1, 2]) {
      const state = stateFor(chronicle, progress);
      const status = getChronicleStatus(chronicle, state);
      const currentNode = getChronicleNode(chronicle, state);
      assert.equal(status.status, 'active');
      assert.equal(status.progress, progress);
      assert.equal(currentNode, chronicle.nodes[progress - 1]);
      assert.match(getChronicleObjective(chronicle, state), new RegExp(currentNode.sectorName));
    }

    const forgedWithoutSource = { chronicleProgress: { [chronicle.id]: 2 } };
    assert.equal(getChronicleStatus(chronicle, forgedWithoutSource).status, 'undiscovered');
    assert.equal(getChronicleStatus(chronicle, forgedWithoutSource).progress, 0);
    assert.equal(getChronicleNode(chronicle, forgedWithoutSource), null);

    const readyState = stateFor(chronicle, 3);
    assert.equal(getChronicleStatus(chronicle, readyState).status, 'ready');
    assert.equal(getChronicleNode(chronicle, readyState), null);
    assert.match(getChronicleObjective(chronicle, readyState), new RegExp(chronicle.giverName));

    const conclusion = chronicle.choices[1];
    const completeState = stateFor(chronicle, 4, { conclusion: conclusion.id });
    const complete = getChronicleStatus(chronicle, completeState);
    assert.equal(complete.status, 'complete');
    assert.equal(complete.progress, 4);
    assert.equal(complete.conclusion, conclusion);
    assert.match(getChronicleObjective(chronicle, completeState), new RegExp(conclusion.outcome));
  }
});

test('les sélecteurs refusent les progressions et conclusions invalides sans modifier l’état', () => {
  const chronicle = REGIONAL_CHRONICLES.convoy_names;
  for (const progress of [-1, 1.5, MAX_CHRONICLE_PROGRESS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = stateFor(chronicle, progress);
    const before = structuredClone(state);
    assert.equal(getChronicleStatus(chronicle, state).progress, 0);
    assert.deepEqual(state, before);
  }

  const forged = stateFor(chronicle, 4, { conclusion: 'conclusion_inconnue' });
  const before = structuredClone(forged);
  const status = getChronicleStatus(chronicle, forged);
  assert.notEqual(status.status, 'complete');
  assert.equal(status.conclusion, null);
  assert.equal(getChronicleNode(chronicle, forged), null);
  assert.deepEqual(forged, before);

  assert.equal(getChronicleStatus(null, forged), null);
  assert.equal(getChronicleNode(null, forged), null);
  assert.equal(getChronicleObjective(null, forged), '');
});

test('les chroniques et les résultats des sélecteurs sont profondément immuables', () => {
  assertDeepFrozen(REGIONAL_CHRONICLES);
  assertDeepFrozen(CHRONICLE_CHOICE_IDS);
  assert.equal(Object.isFrozen(CHRONICLE_IDS), true);
  const chronicle = REGIONAL_CHRONICLES.convoy_names;
  assert.throws(() => { chronicle.title = 'ALTÉRÉ'; }, TypeError);
  assert.throws(() => chronicle.nodes.push({}), TypeError);
  assert.throws(() => chronicle.choices[0].lines.push('ALTÉRÉ'), TypeError);
  assert.throws(() => CHRONICLE_CHOICE_IDS.convoy_names.push('ALTÉRÉ'), TypeError);

  const status = getChronicleStatus(chronicle, stateFor(chronicle, 0));
  assert.equal(Object.isFrozen(status), true);
  assert.throws(() => { status.progress = 4; }, TypeError);
});
