import assert from "node:assert/strict";
import { createGameHarness } from "./game-harness.mjs";
import { getTechniqueProfile } from "../../src/combat-rules.js";
import {
  WORLD_LAYOUTS,
  getSectorTransitions,
} from "../../src/world-layouts.js";
function interact(h, predicate) {
  const e = h.game.getInteractables().find(predicate);
  assert.ok(e, "missing interaction " + h.game.state.map);
  h.game.nearestInteractable = e;
  h.game.handleAction();
  h.finishDialogues();
}
function path(h, to) {
  const g = h.game,
    region = g.getCurrentRegionId(),
    q = [[g.state.map]],
    seen = new Set([g.state.map]);
  while (q.length) {
    const p = q.shift(),
      id = p.at(-1);
    if (id === to) return p.slice(1);
    for (const t of getSectorTransitions(region, id, g.state)) {
      if (
        !g.getTransitionStatus(t, region).available ||
        seen.has(t.to.sectorId)
      )
        continue;
      seen.add(t.to.sectorId);
      q.push([...p, t.to.sectorId]);
    }
  }
  throw Error("no route " + g.state.map + " -> " + to);
}
function navigate(h, to) {
  for (const id of path(h, to))
    interact(
      h,
      (e) => e.type === "transition" && e.unlocked && e.data.to.sectorId === id,
    );
}
function home(h) {
  const g = h.game;
  if (g.state.map === "city") return;
  navigate(h, WORLD_LAYOUTS[g.getCurrentRegionId()].entrySectorId);
  interact(h, (e) => e.type === "exit");
}
function goto(h, region, sector) {
  if (h.game.state.map === "city")
    interact(h, (e) => e.id === "portal_" + region);
  navigate(h, sector);
}
function prep(h, { gels = 4 } = {}) {
  const g = h.game;
  home(h);
  if (
    g.state.recruited.includes("brakk") &&
    g.state.forgeLevel < 3 &&
    g.state.inventory.scrap >= 1 &&
    g.state.credits >= 250 + g.state.forgeLevel * 35
  ) {
    interact(h, (e) => e.type === "building" && e.id === "brakk");
    h.service(
      g.state.partner.starter === "feral" ? "forge-power" : "forge-guard",
    );
    g.closeOverlays();
  }
  if (
    g.state.recruited.includes("bellgrave") &&
    g.state.trainingLevel < 6 &&
    g.state.partner.fatigue < 80 &&
    g.state.credits >= 200
  ) {
    interact(h, (e) => e.type === "building" && e.id === "bellgrave");
    h.service(
      "train:" +
        (g.state.partner.starter === "feral"
          ? "power"
          : g.state.partner.starter === "veil"
            ? "spirit"
            : "guard"),
    );
    g.closeOverlays();
  }
  if (
    g.state.recruited.includes("vespera") &&
    (g.state.partner.fatigue > 55 ||
      g.state.partner.hp < g.state.partner.maxHp * 0.9 ||
      g.state.partner.mp < g.state.partner.maxMp * 0.7) &&
    g.state.credits >= 65
  ) {
    interact(h, (e) => e.type === "building" && e.id === "vespera");
    h.service("clinic-full");
    g.closeOverlays();
  }
  interact(h, (e) => e.type === "core");
  h.service("sleep");
  for (
    let i = 0;
    i < 5 &&
    (g.state.partner.hp < g.state.partner.maxHp * 0.9 ||
      g.state.partner.mp < g.state.partner.maxMp * 0.7) &&
    g.state.credits >= 25;
    i++
  )
    h.service("core-heal");
  for (let i = 0; i < 3 && g.state.partner.hunger > 35; i++) {
    if (!g.state.inventory.ration) h.service("core-supply:ration");
    if (!g.state.inventory.ration) break;
    h.service("feed");
  }
  while (g.state.inventory.medgel < gels && g.state.credits >= 45)
    h.service("core-supply:medgel");
  g.closeOverlays();
}
function fight(h) {
  const g = h.game;
  let result = null,
    ticks = 0,
    commands = [],
    phaseTwoSeen = false;
  while (g.battle && ticks++ < 500) {
    if (g.battle.phase === "player") {
      const p = g.state.partner,
        b = g.battle;
      const cmd =
        b.sync >= 100
          ? "sync"
          : p.hp < p.maxHp * 0.55 && g.state.inventory.medgel > 0
            ? "item"
            : p.mp >= getTechniqueProfile(p.formId).cost
              ? "skill"
              : "encourage";
      commands.push(cmd);
      g.battleCommand(cmd);
    }
    if (g.battle?.enemy.phaseTwo) phaseTwoSeen = true;
    if (g.battle?.ended) result = g.battle.result;
    g.updateBattle(2, {});
    h.finishDialogues();
  }
  return {
    result,
    phaseTwoSeen,
    commands: commands.length,
    hp: Math.round(g.state.partner.hp),
    level: g.state.partner.level,
    gels: g.state.inventory.medgel,
    credits: g.state.credits,
    fatigue: Math.round(g.state.partner.fatigue),
  };
}
/** Command-level campaign QA: uses real gates, purchases, care, forge, training and combat.
 * Navigation selects existing interactables; collision/render/input are covered separately.
 * NOCTE and VESPER train to their first evolution on naturally respawned patrols.
 * No state flags, money, XP, stats or item rewards are injected.
 */
export async function runCampaignScenario({
  starter = "aegis",
  seed = 7,
  finish = false,
} = {}) {
  const h = await createGameHarness({ starter, seed }),
    g = h.game;
  g.startNewGame(starter);
  h.finishDialogues();
  const rows = [];
  let failed = false;
  // Follow the learned first-resident objective before exploring further patrols.
  interact(h, (e) => e.type === "core");
  h.service("core-supply:medgel");
  g.closeOverlays();
  interact(h, (e) => e.id === "portal_wastes");
  for (const patrol of WORLD_LAYOUTS.wastes.sectors[0].patrols) {
    interact(h, (e) => e.type === "enemy" && e.id === patrol.id);
    const r = fight(h);
    rows.push({ id: patrol.id, ...r });
    assert.equal(r.result, "victory");
  }
  home(h);
  interact(h, (e) => e.type === "core");
  h.service("sleep");
  while (g.state.partner.hunger > 35 && g.state.inventory.ration > 0)
    h.service("feed");
  while (g.state.inventory.medgel < 3 && g.state.credits >= 45)
    h.service("core-supply:medgel");
  g.closeOverlays();
  goto(h, "wastes", "wastes_caravan_scars");
  interact(h, (e) => e.type === "resident" && e.id === "brakk");
  const opening = fight(h);
  rows.push({ id: "brakk", ...opening });
  assert.equal(opening.result, "victory");
  outer: for (const region of ["wastes", "hive", "fog", "foundry"]) {
    const layout = WORLD_LAYOUTS[region];
    if (!g.getCityPortals().find((e) => e.target === region)?.unlocked) {
      rows.push({ blockedRegion: region, score: g.getCityScore() });
      break;
    }
    for (const sector of layout.sectors) {
      for (const patrol of sector.patrols) {
        if (g.state.patrolVictories.includes(patrol.id)) continue;
        prep(h);
        goto(h, region, sector.id);
        interact(h, (e) => e.type === "enemy" && e.id === patrol.id);
        const r = fight(h);
        rows.push({ id: patrol.id, ...r });
        if (r.result !== "victory") {
          failed = true;
          break outer;
        }
      }

      if (
        region === "wastes" &&
        sector.guardian &&
        starter !== "aegis" &&
        g.state.partner.level < 5
      ) {
        for (let round = 0; round < 16 && g.state.partner.level < 5; round++) {
          prep(h, { gels: 3 });
          const candidates = layout.sectors
            .slice(0, 3)
            .flatMap((sec) => sec.patrols.map((p) => ({ sec, p })))
            .filter(({ p }) => g.isPatrolActive(p.id));
          assert.ok(
            candidates.length,
            "No naturally respawned patrol for training",
          );
          const { sec, p } = candidates[round % candidates.length];
          goto(h, region, sec.id);
          interact(h, (e) => e.type === "enemy" && e.id === p.id);
          const result = fight(h);
          rows.push({ trainingPatrol: p.id, ...result });
          if (result.result !== "victory") {
            failed = true;
            break outer;
          }
        }
      }
      for (const spawn of sector.residentSpawns) {
        const r = h.RESIDENTS[spawn.residentId];
        if (g.state.recruited.includes(r.id) || (r.requires && !r.requires(g)))
          continue;
        prep(h);
        goto(h, region, sector.id);
        interact(h, (e) => e.type === "resident" && e.id === r.id);
        const result = fight(h);
        rows.push({ id: r.id, ...result });
        if (result.result !== "victory") {
          failed = true;
          break outer;
        }
      }
      if (sector.guardian) {
        prep(h);
        goto(h, region, sector.id);
        interact(h, (e) => e.type === "sanctuary");
        interact(h, (e) => e.type === "guardian");
        const r = fight(h);
        rows.push({ id: sector.guardian.id, ...r });
        if (r.result !== "victory") {
          failed = true;
          break outer;
        }
        const shortcut = g
          .getInteractables()
          .find((e) => e.type === "shortcut-activation");
        if (shortcut) interact(h, (e) => e.type === "shortcut-activation");
      }
      if (sector.shard) {
        goto(h, region, sector.id);
        interact(h, (e) => e.type === "shard");
      }
    }
    for (const sector of layout.sectors)
      for (const spawn of sector.residentSpawns) {
        const r = h.RESIDENTS[spawn.residentId];
        if (g.state.recruited.includes(r.id) || (r.requires && !r.requires(g)))
          continue;
        prep(h);
        goto(h, region, sector.id);
        interact(h, (e) => e.type === "resident" && e.id === r.id);
        const result = fight(h);
        rows.push({ id: r.id, ...result });
        if (result.result !== "victory") {
          failed = true;
          break outer;
        }
      }
    home(h);
  }

  const summary = {
    starter,
    seed,
    failed,
    shards: g.getShardCount(),
    score: g.getCityScore(),
    level: g.state.partner.level,
    recruits: g.state.recruited.length,
    patrols: g.state.patrolVictories.length,
    forge: g.state.forgeLevel,
    training: g.state.trainingLevel,
    extraTrainingBattles: rows.filter((row) => row.trainingPatrol).length,
  };
  let ending = null;
  if (finish && !failed) {
    prep(h, { gels: 8 });
    interact(h, (e) => e.id === "portal_void");
    interact(h, (e) => e.type === "boss");
    ending = fight(h);
  }
  return { h, summary, rows, ending };
}
