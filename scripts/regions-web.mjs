import { MODULE_ID } from "./module.mjs";

/**
 * FVTT v13 Regions automation for several "zone" spells.
 *
 * Why Regions?
 * - Area placement is reliable (templates can be rotated/"ray" for cubes, etc.).
 * - We can consistently detect: initial-in-area, token entry, start/end of turn.
 *
 * Implemented rules (FR names, but EN supported too):
 * - Toile d’araignée / Web
 * - Graisse / Grease
 * - Enchevêtrement / Entangle
 * - Tentacules noirs d’Evard / Evard's Black Tentacles
 * - Voracité de Hadar / Hunger of Hadar
 */

const FLAG_SCOPE = MODULE_ID;
const LEGACY_SCOPE = "world";
// Historical key name kept for backward-compat with older hotfixes.
const FLAG_KEY = "epiWeb";

const INSIDE_CACHE = globalThis.__EPI_ZONE_INSIDE ?? (globalThis.__EPI_ZONE_INSIDE = new Set());
const TURN_CACHE = globalThis.__EPI_ZONE_TURN ?? (globalThis.__EPI_ZONE_TURN = new Set());
// Movement tracking (to support spells that trigger while moving *within* a region)
const MOVE_CACHE = globalThis.__EPI_ZONE_MOVE ?? (globalThis.__EPI_ZONE_MOVE = new Map());
const PREMOVE_CACHE = globalThis.__EPI_ZONE_PREMOVE ?? (globalThis.__EPI_ZONE_PREMOVE = new Map());
const LAST_POS_CACHE = globalThis.__EPI_ZONE_LASTPOS ?? (globalThis.__EPI_ZONE_LASTPOS = new Map());
const DEBUG = !!globalThis.__EPI_WEB_DEBUG; // keep existing debug flag name
function dbg(...args) { if (DEBUG) console.log(`[${MODULE_ID}]`, ...args); }

// ---------------------------------------------------------------------------
// Spike Growth: Region Execute Script behavior (counts damage per grid-square)
// ---------------------------------------------------------------------------
const SPIKE_GROWTH_SCRIPT_SOURCE = [
  "// Encounter+ Importer — Croissance d’épines (Spike Growth)",
  "// Subscribed events: tokenMoveIn + tokenMoveWithin",
  "if (!game.user?.isGM) return;",
  "const tokenDoc = event?.data?.token ?? event?.data?.tokenDoc ?? event?.data?.tokenDocument ?? null;",
  "if (!tokenDoc) return;",
  "const actor = tokenDoc.actor;",
  "if (!actor) return;",
  "const region = event?.region ?? event?.data?.region ?? null;",
  "if (!region) return;",
  "// Movement payload differs across builds/modules — try a few shapes.",
  "const mv = event?.data?.movement ?? event?.data ?? {};",
  "const origin = mv?.origin ?? mv?.from ?? mv?.start ?? mv?.passed?.origin ?? null;",
  "const destination = mv?.destination ?? mv?.to ?? mv?.end ?? mv?.passed?.destination ?? null;",
  "const rawWps = mv?.waypoints ?? mv?.passed?.waypoints ?? mv?.path ?? mv?.passed?.path ?? null;",
  "let pts = Array.isArray(rawWps) ? Array.from(rawWps) : [];",
  "if (pts.length < 2 && origin && destination) pts = [origin, destination];",
  "if (pts.length < 2) return;",
  "// Ensure origin/destination are included (some payloads omit origin, causing -1 case).",
  "const gs = Number(canvas?.grid?.size ?? 0) || 0;",
  "if (!gs) return;",
  "const near = (a,b) => {",
  "  if (!a || !b) return false;",
  "  const ax = Number(a.x ?? a?.x ?? 0) || 0; const ay = Number(a.y ?? a?.y ?? 0) || 0;",
  "  const bx = Number(b.x ?? b?.x ?? 0) || 0; const by = Number(b.y ?? b?.y ?? 0) || 0;",
  "  const tol = gs * 0.25;",
  "  return (Math.abs(ax - bx) <= tol) && (Math.abs(ay - by) <= tol);",
  "};",
  "if (origin && !near(pts[0], origin)) pts.unshift(origin);",
  "if (destination && !near(pts[pts.length-1], destination)) pts.push(destination);",
  "// Try to expand to complete path if Foundry provides it.",
  "try {",
  "  if (typeof tokenDoc.getCompleteMovementPath === 'function') {",
  "    const full = tokenDoc.getCompleteMovementPath(pts);",
  "    if (Array.isArray(full) && full.length >= 2) pts = full;",
  "  }",
  "} catch (e) {}",
  "// De-dupe: avoid double execution for the same movement (MoveIn + MoveWithin).",
  "const moveId = String(mv?.id ?? mv?._id ?? mv?.uuid ?? (origin ? (origin.x + ',' + origin.y) : '') + '>' + (destination ? (destination.x + ',' + destination.y) : '') );",
  "const dedupeKey = 'epiSpike:' + (region?.id ?? 'region') + ':' + moveId;",
  "try { const last = tokenDoc.getFlag('world', 'epiSpikeLast'); if (last === dedupeKey) return; await tokenDoc.setFlag('world', 'epiSpikeLast', dedupeKey); } catch (e) {}",
  "const elev = Number(origin?.elevation ?? tokenDoc.elevation ?? 0) || 0;",
  "const wPx = (Number(tokenDoc.width ?? 1) || 1) * gs;",
  "const hPx = (Number(tokenDoc.height ?? 1) || 1) * gs;",
  "// Convert a movement point into a top-left grid cell, tolerant to points being center or top-left.",
  "const toCell = (p) => {",
  "  const x = Number(p?.x ?? 0) || 0;",
  "  const y = Number(p?.y ?? 0) || 0;",
  "  const tl1 = { x, y }; // assume top-left",
  "  const tl2 = { x: x - (wPx / 2), y: y - (hPx / 2) }; // assume center",
  "  const err = (tl) => Math.abs((tl.x / gs) - Math.round(tl.x / gs)) + Math.abs((tl.y / gs) - Math.round(tl.y / gs));",
  "  const tl = (err(tl2) < err(tl1)) ? tl2 : tl1;",
  "  return { gx: Math.round(tl.x / gs), gy: Math.round(tl.y / gs) };",
  "};",
  "const insideCell = (gx, gy) => {",
  "  const cx = (gx * gs) + (wPx / 2);",
  "  const cy = (gy * gs) + (hPx / 2);",
  "  try { return !!region.testPoint({ x: cx, y: cy, elevation: elev }); } catch (e) { return false; }",
  "};",
  "// Count moved grid-cells inside region along the path (Bresenham over each segment).",
  "let stepsInside = 0;",
  "for (let i = 1; i < pts.length; i++) {",
  "  const A = toCell(pts[i-1]);",
  "  const B = toCell(pts[i]);",
  "  let x0 = A.gx, y0 = A.gy, x1 = B.gx, y1 = B.gy;",
  "  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);",
  "  let sx = (x0 < x1) ? 1 : -1;",
  "  let sy = (y0 < y1) ? 1 : -1;",
  "  let err = dx - dy;",
  "  while (!(x0 === x1 && y0 === y1)) {",
  "    const e2 = 2 * err;",
  "    if (e2 > -dy) { err -= dy; x0 += sx; }",
  "    if (e2 < dx) { err += dx; y0 += sy; }",
  "    if (insideCell(x0, y0)) stepsInside++;",
  "  }",
  "}",
  "if (stepsInside <= 0) return;",
  "const dice = stepsInside * 2;",
  "const roll = await (new Roll(String(dice) + 'd4')).evaluate();",
  "await roll.toMessage({ flavor: 'Croissance d\u2019\u00e9pines : ' + stepsInside + ' case(s) \u2192 ' + dice + 'd4 perforants' });",
  "try {",
  "  if (typeof actor.applyDamage === 'function') {",
  "    await actor.applyDamage(roll.total);",
  "  } else {",
  "    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;",
  "    await actor.update({ 'system.attributes.hp.value': Math.max(hp - (Number(roll.total ?? 0) || 0), 0) });",
  "  }",
  "} catch (e) {",
  "  const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;",
  "  await actor.update({ 'system.attributes.hp.value': Math.max(hp - (Number(roll.total ?? 0) || 0), 0) });",
  "}"
].join("\n");


const ITEM_IMG_CACHE = globalThis.__EPI_ITEM_IMG_CACHE ?? (globalThis.__EPI_ITEM_IMG_CACHE = new Map());

async function getItemImgByUuid(uuid) {
  try {
    const u = String(uuid ?? "");
    if (!u) return null;
    if (ITEM_IMG_CACHE.has(u)) return ITEM_IMG_CACHE.get(u) ?? null;
    const doc = await fromUuid(u).catch(() => null);
    const img = doc?.img ?? doc?.texture?.src ?? null;
    ITEM_IMG_CACHE.set(u, img);
    return img;
  } catch {
    return null;
  }
}

function getRegionItemUuid(regionDoc) {
  try { return getEpiData(regionDoc)?.itemUuid ?? null; } catch { return null; }
}

async function getRegionSpellIcon(regionDoc) {
  const u = getRegionItemUuid(regionDoc);
  return await getItemImgByUuid(u);
}

function isActiveGM() {
  try { return !!game.user?.isGM; } catch { return false; }
}

function getEpiData(doc) {
  return doc?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? doc?.flags?.[LEGACY_SCOPE]?.[FLAG_KEY] ?? null;
}

function insideKey(tokenDoc, regionId) {
  return `${tokenDoc?.uuid ?? "token"}|${regionId ?? "region"}`;
}

function getSpeaker(actor, tokenDoc) {
  try {
    return ChatMessage.getSpeaker({ actor, scene: canvas.scene, token: tokenDoc });
  } catch (e) {
    try { return ChatMessage.getSpeaker({ actor }); } catch { return {}; }
  }
}

function getRollTotal(result) {
  if (!result) return 0;
  if (Array.isArray(result)) return Number(result?.[0]?.total ?? 0) || 0;
  return Number(result?.total ?? 0) || 0;
}

async function rollSave(actor, tokenDoc, ability, dc, { advantage=false, disadvantage=false } = {}) {
  const speaker = getSpeaker(actor, tokenDoc);
  const cfg = { ability, target: dc };
  // dnd5e v5: to force advantage/disadvantage, pass roll configs with options.
  if (advantage || disadvantage) {
    cfg.rolls = [{ options: { advantage: !!advantage, disadvantage: !!disadvantage } }];
  }
  const res = await actor.rollSavingThrow(
    cfg,
    { configure: false },
    { data: { speaker } }
  );
  return getRollTotal(res);
}


async function rollAbilityCheck(actor, tokenDoc, ability) {
  const speaker = getSpeaker(actor, tokenDoc);
  const res = await actor.rollAbilityCheck(
    { ability },
    { configure: false },
    { data: { speaker } }
  );
  return getRollTotal(res);
}

function getAbilityMod(actor, ability) {
  try { return Number(actor?.system?.abilities?.[ability]?.mod ?? 0) || 0; } catch { return 0; }
}

function pickBestAbilityForCheck(actor, abilities=[]) {
  const list = Array.isArray(abilities) && abilities.length ? abilities : ["str"];
  let best = list[0];
  let bestMod = getAbilityMod(actor, best);
  for (const a of list.slice(1)) {
    const m = getAbilityMod(actor, a);
    if (m > bestMod) { best = a; bestMod = m; }
  }
  return best;
}

async function rollAbilityCheckBest(actor, tokenDoc, abilities) {
  const ab = pickBestAbilityForCheck(actor, abilities);
  return rollAbilityCheck(actor, tokenDoc, ab);
}

async function rollAbilityCheckBestWithAbility(actor, tokenDoc, abilities) {
  const ab = pickBestAbilityForCheck(actor, abilities);
  const total = await rollAbilityCheck(actor, tokenDoc, ab);
  return { ability: ab, total };
}


// ---------------------------------------------------------------------------
// Creature filters (immunities / traits)
// ---------------------------------------------------------------------------

function _traitList(val) {
  if (!val) return [];
  // dnd5e v5 often stores traits as Sets (or { value: Set }).
  if (val instanceof Set) return Array.from(val).map(v => String(v)).filter(Boolean);
  if (Array.isArray(val)) return val.map(v => String(v)).filter(Boolean);
  if (typeof val === "string") return [val];
  if (typeof val === "object") {
    const out = [];
    const vv = val.value;
    if (vv instanceof Set) out.push(...Array.from(vv).map(v => String(v)));
    else if (Array.isArray(vv)) out.push(...vv.map(v => String(v)));
    // Some builds may store values under `values`.
    const v2 = val.values;
    if (v2 instanceof Set) out.push(...Array.from(v2).map(v => String(v)));
    else if (Array.isArray(v2)) out.push(...v2.map(v => String(v)));
    if (typeof val.custom === "string" && val.custom.trim()) out.push(val.custom);
    return out.filter(Boolean);
  }
  return [];
}

function actorHasConditionImmunity(actor, conditionId) {
  try {
    const ci = actor?.system?.traits?.ci;
    const list = _traitList(ci).map(s => String(s).toLowerCase());
    return list.includes(String(conditionId).toLowerCase());
  } catch { return false; }
}

function actorHasDamageImmunity(actor, damageType) {
  try {
    const di = actor?.system?.traits?.di;
    const list = _traitList(di).map(s => String(s).toLowerCase());
    return list.includes(String(damageType).toLowerCase());
  } catch { return false; }
}

function actorIsImmuneToPoisonOrPoisoned(actor) {
  try {
    const ci = _traitList(actor?.system?.traits?.ci).map(s => String(s).toLowerCase());
    const di = _traitList(actor?.system?.traits?.di).map(s => String(s).toLowerCase());
    const ciHit = ci.includes("poisoned") || ci.some(s => s.includes("empoison"));
    const diHit = di.includes("poison") || di.some(s => s.includes("poison"));
    return ciHit || diHit;
  } catch {
    return actorHasConditionImmunity(actor, "poisoned") || actorHasDamageImmunity(actor, "poison");
  }
}

function actorTypeString(actor) {
  try {
    const t = actor?.system?.details?.type;
    const v = (typeof t === "string") ? t : (t?.value ?? "");
    const st = (t && typeof t === "object") ? (t?.subtype ?? t?.subType ?? "") : "";
    const subtype = Array.isArray(st) ? st.join(" ") : String(st ?? "");
    const c = (t && typeof t === "object") ? (t?.custom ?? "") : "";
    // Also include any localized/custom type strings which may contain "shapechanger".
    return `${v} ${subtype} ${c}`.trim().toLowerCase();
  } catch { return ""; }
}

function actorIsShapechanger(actor) {
  const s = actorTypeString(actor);
  return s.includes("shapechanger") || s.includes("métamorphe") || s.includes("metamorphe");
}

// ---------------------------------------------------------------------------
// Cast level (for upcasting scaling)
// ---------------------------------------------------------------------------

function getCastLevel(item, templateDoc) {
  const base = Number(item?.system?.level ?? 0) || 0;
  try {
    const d5e = templateDoc?.flags?.dnd5e ?? {};
    const cd = d5e?.castData ?? d5e?.cast ?? {};
    const lvl = Number(cd?.castLevel ?? cd?.spellLevel ?? cd?.level ?? d5e?.castLevel ?? d5e?.spellLevel ?? 0) || 0;
    return lvl || base || 0;
  } catch {
    return base || 0;
  }
}


async function rollDamageToChat({ actor, tokenDoc, formula, damageType, flavor }) {
  const speaker = getSpeaker(actor, tokenDoc);
  const roll = await (new Roll(formula)).evaluate();
  try {
    await roll.toMessage({
      speaker,
      flavor: flavor ?? `${damageType ?? ""}`
    });
  } catch (e) {
    // ignore chat failures
  }
  return roll;
}

async function applyDamage(actor, total, damageType) {
  if (!actor) return;
  const v = Number(total ?? 0) || 0;
  if (!v) return;
  // dnd5e v5: actor.applyDamage expects DamageDescription[]
  // Mark as magical damage so physical immunities/resistances with bypasses (e.g. lycanthropes) behave correctly.
  // dnd5e checks `properties` (Set) for physical damage bypasses like `mgc`.
  await actor.applyDamage([{ value: v, type: damageType, properties: new Set(["mgc"]) }]);
}

// ---------------------------------------------------------------------------
// Token footprint helpers (better boundary behavior than center-point only)
// ---------------------------------------------------------------------------

function tokenSamplePointsAt({ x, y, width, height }) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const wPx = (Number(width ?? 1) || 1) * gridSize;
  const hPx = (Number(height ?? 1) || 1) * gridSize;
  const _x = Number(x ?? 0) || 0;
  const _y = Number(y ?? 0) || 0;
  // inset corners a bit so we don't falsely trigger on touching edges only.
  const insetX = Math.max(1, wPx * 0.1);
  const insetY = Math.max(1, hPx * 0.1);
  const left = _x + insetX;
  const right = _x + wPx - insetX;
  const top = _y + insetY;
  const bottom = _y + hPx - insetY;
  const cx = _x + wPx / 2;
  const cy = _y + hPx / 2;
  return [
    { x: cx, y: cy },
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom }
  ];
}

// A looser sampler used for movement-triggered damage (e.g. Spike Growth).
// No inset + includes edge midpoints to avoid missing boundary-adjacent squares.
function tokenSamplePointsAtLoose({ x, y, width, height }) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const wPx = (Number(width ?? 1) || 1) * gridSize;
  const hPx = (Number(height ?? 1) || 1) * gridSize;
  const _x = Number(x ?? 0) || 0;
  const _y = Number(y ?? 0) || 0;

  // Include both edge and slightly-outside points so boundary-adjacent squares are counted.
  const eps = 1;
  const left = _x;
  const right = _x + wPx;
  const top = _y;
  const bottom = _y + hPx;

  const leftOut = left - eps;
  const rightOut = right + eps;
  const topOut = top - eps;
  const bottomOut = bottom + eps;

  const cx = _x + wPx / 2;
  const cy = _y + hPx / 2;

  return [
    { x: cx, y: cy },

    // corners (on-edge)
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },

    // mid-edges (on-edge)
    { x: cx, y: top },
    { x: cx, y: bottom },
    { x: left, y: cy },
    { x: right, y: cy },

    // corners (slightly outside)
    { x: leftOut, y: topOut },
    { x: rightOut, y: topOut },
    { x: leftOut, y: bottomOut },
    { x: rightOut, y: bottomOut },

    // mid-edges (slightly outside)
    { x: cx, y: topOut },
    { x: cx, y: bottomOut },
    { x: leftOut, y: cy },
    { x: rightOut, y: cy }
  ];
}

function tokenIntersectsRegionAtLoose(rect, regionDoc) {
  try {
    if (!rect || !regionDoc) return false;
    const pts = tokenSamplePointsAtLoose(rect);
    for (const p of pts) {
      if (isPointInsideRegion(p.x, p.y, regionDoc)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Spike Growth overlap helpers
// ---------------------------------------------------------------------------

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function _rectContainsPoint(rx0, ry0, rx1, ry1, x, y) {
  return x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
}

function _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  // Robust segment intersection with epsilon
  const eps = 1e-9;
  const orient = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const onSeg = (px, py, qx, qy, rx, ry) =>
    Math.min(px, qx) - eps <= rx && rx <= Math.max(px, qx) + eps &&
    Math.min(py, qy) - eps <= ry && ry <= Math.max(py, qy) + eps;

  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);

  if ((o1 > eps && o2 < -eps || o1 < -eps && o2 > eps) &&
      (o3 > eps && o4 < -eps || o3 < -eps && o4 > eps)) return true;

  if (Math.abs(o1) <= eps && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(o2) <= eps && onSeg(ax, ay, bx, by, dx, dy)) return true;
  if (Math.abs(o3) <= eps && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(o4) <= eps && onSeg(cx, cy, dx, dy, bx, by)) return true;

  return false;
}

function _polyIntersectsRect(pts, rx0, ry0, rx1, ry1) {
  try {
    if (!Array.isArray(pts) || pts.length < 6) return false;
    const rectPts = [
      [rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]
    ];

    // 1) Any rect corner inside polygon?
    for (const [x, y] of rectPts) {
      if (pointInPolygon(x, y, pts)) return true;
    }

    // 2) Any polygon vertex inside rect?
    for (let i = 0; i < pts.length; i += 2) {
      const x = Number(pts[i]) || 0;
      const y = Number(pts[i + 1]) || 0;
      if (_rectContainsPoint(rx0, ry0, rx1, ry1, x, y)) return true;
    }

    // 3) Any edge intersections?
    const rectEdges = [
      [rx0, ry0, rx1, ry0],
      [rx1, ry0, rx1, ry1],
      [rx1, ry1, rx0, ry1],
      [rx0, ry1, rx0, ry0]
    ];

    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      const ax = Number(pts[i]) || 0;
      const ay = Number(pts[i + 1]) || 0;
      const bx = Number(pts[j]) || 0;
      const by = Number(pts[j + 1]) || 0;
      for (const [cx, cy, dx, dy] of rectEdges) {
        if (_segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// D&D rule: a square counts if it is even partially covered.
// For circles we do a true circle-vs-rect overlap test which is far more
// reliable at the boundary than point sampling.
function tokenOverlapsRegionSpike(rect, regionDoc) {
  try {
    if (!rect || !regionDoc) return false;
    const shapes = Array.isArray(regionDoc?.shapes) ? regionDoc.shapes : (regionDoc?.shapes ? Array.from(regionDoc.shapes) : []);
    if (!shapes?.length) return false;
    const rx0 = Number(rect.x ?? 0) || 0;
    const ry0 = Number(rect.y ?? 0) || 0;
    const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
    const wPx = (Number(rect.width ?? 1) || 1) * gridSize;
    const hPx = (Number(rect.height ?? 1) || 1) * gridSize;
    const rx1 = rx0 + wPx;
    const ry1 = ry0 + hPx;

    for (const s0 of shapes) {
      const s = (s0 && typeof s0.toObject === "function") ? s0.toObject() : s0;
      const type = String(s?.type ?? s0?.type ?? "").toLowerCase();
      if (type === "circle") {
        const cx = Number(s?.x ?? s0?.x ?? 0) || 0;
        const cy = Number(s?.y ?? s0?.y ?? 0) || 0;
        const r = Number(s?.radius ?? s0?.radius ?? 0) || 0;
        if (!r) continue;
        const nx = _clamp(cx, rx0, rx1);
        const ny = _clamp(cy, ry0, ry1);
        const dx = cx - nx;
        const dy = cy - ny;
        if ((dx * dx + dy * dy) <= (r * r)) return true;
        continue;
      }

      if (type === "polygon") {
        const pts = Array.isArray(s?.points) ? s.points : (Array.isArray(s0?.points) ? s0.points : []);
        if (_polyIntersectsRect(pts, rx0, ry0, rx1, ry1)) return true;
        continue;
      }

      // Fallback for other shapes (sampling)
      if (tokenIntersectsRegionAtLoose(rect, regionDoc)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function tokenRectAtCenter(center, tokenDoc) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const wPx = (Number(tokenDoc?.width ?? 1) || 1) * gridSize;
  const hPx = (Number(tokenDoc?.height ?? 1) || 1) * gridSize;
  const cx = Number(center?.x ?? 0) || 0;
  const cy = Number(center?.y ?? 0) || 0;
  return {
    x: cx - (wPx / 2),
    y: cy - (hPx / 2),
    width: Number(tokenDoc?.width ?? 1) || 1,
    height: Number(tokenDoc?.height ?? 1) || 1
  };
}

function computeSpikeSteps(moveInfo, tokenDoc, regionDoc) {
  try {
    if (!moveInfo || !tokenDoc || !regionDoc) return 0;

    const scene = tokenDoc?.parent ?? canvas?.scene;
    const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
    const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
    if (!gridSize || !gridDist) return 0;

    const from = moveInfo.from;
    const to = moveInfo.to;
    if (!from || !to) return 0;

    // Total movement measured in grid-spaces (robust for keyboard + mouse drag).
    let spaces = Number(moveInfo.movedSpaces ?? 0) || 0;
    if (!spaces) {
      const movedUnits = Number(moveInfo.movedUnits ?? 0) || 0;
      if (movedUnits && gridDist) spaces = movedUnits / gridDist;
    }
    if (!spaces) {
      const movedPx = Number(moveInfo.movedPx ?? 0) || 0;
      if (movedPx && gridSize) spaces = movedPx / gridSize;
    }

    // Number of 1-square "ticks" of movement.
    // Use rounding to avoid the classic 1-square -> 0 due to floating point.
    const n = Math.max(1, Math.round(spaces));

    const dx = (Number(to.x ?? 0) || 0) - (Number(from.x ?? 0) || 0);
    const dy = (Number(to.y ?? 0) || 0) - (Number(from.y ?? 0) || 0);

    let steps = 0;
    for (let i = 1; i <= n; i++) {
      const t0 = (i - 1) / n;
      const t1 = i / n;
      const tm = (t0 + t1) / 2;

      const c0 = { x: from.x + dx * t0, y: from.y + dy * t0 };
      const c1 = { x: from.x + dx * t1, y: from.y + dy * t1 };
      const cm = { x: from.x + dx * tm, y: from.y + dy * tm };

      const r0 = tokenRectAtCenter(c0, tokenDoc);
      const r1 = tokenRectAtCenter(c1, tokenDoc);
      const rm = tokenRectAtCenter(cm, tokenDoc);

      if (tokenOverlapsRegionSpike(r0, regionDoc) || tokenOverlapsRegionSpike(r1, regionDoc) || tokenOverlapsRegionSpike(rm, regionDoc)) {
        steps += 1;
      }
    }

    return steps;
  } catch {
    return 0;
  }
}


// ---------------------------------------------------------------------------
// V13 movement hooks helpers (fix mouse-drag waypoints + 1-square rounding)
// ---------------------------------------------------------------------------

function _pickMovementWaypoints(movement, tokenDoc) {
  try {
    const passed = movement?.passed?.waypoints;
    const pending = movement?.pending?.waypoints;
    const hist = movement?.history?.waypoints;
    const wps = (Array.isArray(passed) && passed.length) ? passed
      : (Array.isArray(pending) && pending.length) ? pending
      : (Array.isArray(hist) && hist.length) ? hist
      : null;
    if (wps && wps.length >= 2) return wps;

    const o = movement?.origin ?? {
      x: Number(tokenDoc?._source?.x ?? tokenDoc?.x ?? 0) || 0,
      y: Number(tokenDoc?._source?.y ?? tokenDoc?.y ?? 0) || 0,
      elevation: Number(tokenDoc?._source?.elevation ?? tokenDoc?.elevation ?? 0) || 0,
      width: Number(tokenDoc?._source?.width ?? tokenDoc?.width ?? 1) || 1,
      height: Number(tokenDoc?._source?.height ?? tokenDoc?.height ?? 1) || 1,
      shape: tokenDoc?._source?.shape ?? tokenDoc?.shape
    };
    const d = movement?.destination ?? {
      x: Number(tokenDoc?.x ?? 0) || 0,
      y: Number(tokenDoc?.y ?? 0) || 0,
      elevation: Number(tokenDoc?.elevation ?? 0) || 0,
      width: Number(tokenDoc?._source?.width ?? tokenDoc?.width ?? 1) || 1,
      height: Number(tokenDoc?._source?.height ?? tokenDoc?.height ?? 1) || 1,
      shape: tokenDoc?._source?.shape ?? tokenDoc?.shape
    };
    return [o, d];
  } catch {
    return [];
  }
}

function _getCompleteMovementPath(tokenDoc, waypoints) {
  try {
    if (typeof tokenDoc?.getCompleteMovementPath === 'function') {
      const out = tokenDoc.getCompleteMovementPath(waypoints);
      if (Array.isArray(out) && out.length >= 2) return out;
    }
  } catch {
    // ignore
  }
  return Array.isArray(waypoints) ? waypoints : [];
}

function _waypointToCenter(tokenDoc, wp) {
  try {
    const w = Number(wp?.width ?? tokenDoc?._source?.width ?? tokenDoc?.width ?? 1) || 1;
    const h = Number(wp?.height ?? tokenDoc?._source?.height ?? tokenDoc?.height ?? 1) || 1;
    const sh = wp?.shape ?? tokenDoc?._source?.shape ?? tokenDoc?.shape;
    const elev = Number(wp?.elevation ?? tokenDoc?._source?.elevation ?? tokenDoc?.elevation ?? 0) || 0;
    return tokenDoc.getCenterPoint({
      x: Number(wp?.x ?? 0) || 0,
      y: Number(wp?.y ?? 0) || 0,
      elevation: elev,
      width: w,
      height: h,
      shape: sh
    });
  } catch {
    // Fallback: approximate center using grid size
    const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
    const wPx = (Number(tokenDoc?.width ?? 1) || 1) * gridSize;
    const hPx = (Number(tokenDoc?.height ?? 1) || 1) * gridSize;
    const x = Number(wp?.x ?? 0) || 0;
    const y = Number(wp?.y ?? 0) || 0;
    return { x: x + wPx / 2, y: y + hPx / 2 };
  }
}

function _measureWaypointSegmentUnits(tokenDoc, a, b) {
  try {
    const scene = canvas?.scene;
    const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
    const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
    const A = _waypointToCenter(tokenDoc, a);
    const B = _waypointToCenter(tokenDoc, b);

    // Preferred: v13 grid measurement (respects diagonal rules)
    if (canvas?.grid?.measurePath) {
      const res = canvas.grid.measurePath([A, B], { gridSpaces: false });
      let d = Number(res?.distance ?? 0) || 0;
      // Some grids return spaces even with gridSpaces=false.
      if (gridDist && d && d < (gridDist * 0.75)) d = d * gridDist;
      if (d) return d;
    }

    // Fallback: pixel distance -> scene units
    const dx = (Number(B?.x ?? 0) || 0) - (Number(A?.x ?? 0) || 0);
    const dy = (Number(B?.y ?? 0) || 0) - (Number(A?.y ?? 0) || 0);
    const movedPx = (dx*dx + dy*dy) ** 0.5;
    if (gridSize && gridDist) return (movedPx / gridSize) * gridDist;
    return movedPx;
  } catch {
    return 0;
  }
}

function _tokenInsideRegionAtWaypoint(tokenDoc, regionDoc, wp) {
  try {
    if (!tokenDoc?.testInsideRegion || !regionDoc) return false;
    const w = Number(wp?.width ?? tokenDoc?._source?.width ?? tokenDoc?.width ?? 1) || 1;
    const h = Number(wp?.height ?? tokenDoc?._source?.height ?? tokenDoc?.height ?? 1) || 1;
    const sh = wp?.shape ?? tokenDoc?._source?.shape ?? tokenDoc?.shape;
    const elev = Number(wp?.elevation ?? tokenDoc?._source?.elevation ?? tokenDoc?.elevation ?? 0) || 0;
    return !!tokenDoc.testInsideRegion(regionDoc, {
      x: Number(wp?.x ?? 0) || 0,
      y: Number(wp?.y ?? 0) || 0,
      elevation: elev,
      width: w,
      height: h,
      shape: sh
    });
  } catch {
    return false;
  }
}

async function _applySpikeGrowthDamageFromMovement(tokenDoc, actor, regionDoc, movement) {
  try {
    if (!isActiveGM() || !tokenDoc || !actor || !regionDoc || !movement) return;

    // Optional: ignore if elevated above ground
    const elev = Number(tokenDoc?._source?.elevation ?? tokenDoc?.elevation ?? 0) || 0;
    if (elev > 0) return;

    // Ignore undo/paste/config moves (avoid "rewind" damage)
    const method = String(movement?.method ?? '').toLowerCase();
    if (['undo', 'paste', 'config'].includes(method)) return;

    const scene = canvas?.scene;
    const gridStep = Number(scene?.grid?.distance ?? 0) || 5;
    const eps = Math.max(1e-6, gridStep * 0.001);

    const waypoints = _pickMovementWaypoints(movement, tokenDoc);
    if (!Array.isArray(waypoints) || waypoints.length < 2) return;

    const path = _getCompleteMovementPath(tokenDoc, waypoints);
    if (!Array.isArray(path) || path.length < 2) return;

    let insideUnits = 0;

    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];

      let inside = _tokenInsideRegionAtWaypoint(tokenDoc, regionDoc, a) || _tokenInsideRegionAtWaypoint(tokenDoc, regionDoc, b);
      if (!inside) {
        // Midpoint check for boundary edge-cases
        const mid = {
          x: ((Number(a?.x ?? 0) || 0) + (Number(b?.x ?? 0) || 0)) / 2,
          y: ((Number(a?.y ?? 0) || 0) + (Number(b?.y ?? 0) || 0)) / 2,
          elevation: Number(a?.elevation ?? b?.elevation ?? tokenDoc?._source?.elevation ?? tokenDoc?.elevation ?? 0) || 0,
          width: a?.width ?? b?.width,
          height: a?.height ?? b?.height,
          shape: a?.shape ?? b?.shape
        };
        inside = _tokenInsideRegionAtWaypoint(tokenDoc, regionDoc, mid);
      }

      if (!inside) continue;
      insideUnits += _measureWaypointSegmentUnits(tokenDoc, a, b);
    }

    const ticks = Math.floor((insideUnits + eps) / gridStep);
    if (ticks <= 0) return;

    const dice = ticks * 2;
    const roll = await rollDamageToChat({
      actor,
      tokenDoc,
      formula: `${dice}d4`,
      damageType: 'piercing',
      flavor: `Croissance d’épines — ${tokenDoc.name} traverse les épines (${ticks}×${gridStep}${String(scene?.grid?.units ?? '')})`
    });

    await applyDamage(actor, Number(roll?.total ?? 0) || 0, 'piercing');
  } catch (e) {
    console.warn(`[${MODULE_ID}] Spike Growth moveToken handler failed`, e);
  }
}

function tokenIntersectsRegionAt(rect, regionDoc) {
  try {
    if (!rect || !regionDoc) return false;
    const pts = tokenSamplePointsAt(rect);
    for (const p of pts) {
      if (isPointInsideRegion(p.x, p.y, regionDoc)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getSpellDC(actor, item) {
  let dc = Number(actor?.system?.attributes?.spell?.dc ?? 0) || 0;
  if (dc) return dc;
  dc = Number(actor?.system?.attributes?.spelldc ?? actor?.system?.attributes?.spellDc ?? 0) || 0;
  if (dc) return dc;
  dc = Number(item?.system?.save?.dc ?? item?.system?.save?.value ?? 0) || 0;
  if (dc) return dc;
  const acts = item?.system?.activities;
  const arr = Array.isArray(acts) ? acts : (acts && typeof acts === "object" ? Object.values(acts) : []);
  for (const a of arr) {
    const d = Number(a?.save?.dc?.value ?? a?.save?.dc ?? a?.save?.value ?? 0) || 0;
    if (d) return d;
  }
  return 0;
}

function getTemplateItemUuid(doc) {
  const d5e = doc?.flags?.dnd5e ?? {};
  const mq = doc?.flags?.["midi-qol"] ?? {};
  const candidates = [];
  const it = d5e?.item;
  if (typeof it === "string") candidates.push(it);
  else if (it && typeof it === "object") {
    if (typeof it.uuid === "string") candidates.push(it.uuid);
    if (typeof it.itemUuid === "string") candidates.push(it.itemUuid);
  }
  if (typeof d5e?.itemUuid === "string") candidates.push(d5e.itemUuid);
  if (typeof d5e?.origin === "string") candidates.push(d5e.origin);
  if (typeof mq?.itemUuid === "string") candidates.push(mq.itemUuid);
  if (typeof mq?.ItemUuid === "string") candidates.push(mq.ItemUuid);
  const strings = candidates.filter(u => typeof u === "string" && u.length);
  const preferred = strings.find(u => u.includes(".Item."));
  return preferred ?? strings[0] ?? null;
}

function getTemplateObject(tplDoc) {
  try { return canvas?.templates?.get?.(tplDoc?.id) ?? tplDoc?.object ?? null; } catch { return null; }
}

function toScenePoint(displayObject, x, y) {
  try {
    if (!displayObject?.toGlobal || !globalThis.PIXI) return null;
    const g = displayObject.toGlobal(new PIXI.Point(x, y));
    const stage = globalThis.canvas?.stage ?? null;
    if (stage?.toLocal) {
      const w = stage.toLocal(g);
      return { x: w.x, y: w.y };
    }
    return { x: g.x, y: g.y };
  } catch {
    return null;
  }
}

function templateObjectShapeToWorldShapes(tplDoc) {
  const obj = getTemplateObject(tplDoc);
  const shape = obj?.shape ?? null;
  if (!obj || !shape || !globalThis.PIXI) return null;

  try {
    if (shape instanceof PIXI.Circle) {
      const c = toScenePoint(obj, shape.x, shape.y);
      if (!c) return null;
      // Regions in FVTT v13 may serialize circles as ellipses. To keep inside-testing reliable,
      // we store circles as polygons (approximated) instead of relying on a "circle"/"ellipse" shape type.
      const r = Number(shape.radius ?? 0) || 0;
      const segments = 32;
      const ptsWorld = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * (Math.PI * 2);
        ptsWorld.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      }
      return [{ type: "polygon", points: ptsWorld, hole: false }];
    }

    if (shape instanceof PIXI.Rectangle) {
      const ptsLocal = [
        [shape.x, shape.y],
        [shape.x + shape.width, shape.y],
        [shape.x + shape.width, shape.y + shape.height],
        [shape.x, shape.y + shape.height]
      ];
      const ptsWorld = [];
      for (const [lx, ly] of ptsLocal) {
        const w = toScenePoint(obj, lx, ly);
        if (!w) return null;
        ptsWorld.push(w.x, w.y);
      }
      return [{ type: "polygon", points: ptsWorld, hole: false }];
    }

    if (shape instanceof PIXI.Polygon) {
      const pts = Array.from(shape.points ?? []);
      if (!pts.length) return null;
      const out = [];
      for (let i = 0; i < pts.length; i += 2) {
        const w = toScenePoint(obj, Number(pts[i]) || 0, Number(pts[i + 1]) || 0);
        if (!w) return null;
        out.push(w.x, w.y);
      }
      return [{ type: "polygon", points: out, hole: false }];
    }
  } catch {
    return null;
  }
  return null;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = (pts.length / 2) - 1; i < (pts.length / 2); j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1];
    const xj = pts[j * 2], yj = pts[j * 2 + 1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInsideRegion(x, y, regionDoc) {
  try {
    if (!regionDoc) return false;
    const shapes = Array.isArray(regionDoc?.shapes) ? regionDoc.shapes : (regionDoc?.shapes ? Array.from(regionDoc.shapes) : []);
    if (!shapes?.length) return false;
    for (const s0 of shapes) {
      const s = (s0 && typeof s0.toObject === "function") ? s0.toObject() : s0;
      const type = String(s?.type ?? s0?.type ?? "").toLowerCase();
      let hit = false;
      if (type === "circle") {
        const cx = Number(s?.x ?? s0?.x ?? 0) || 0;
        const cy = Number(s?.y ?? s0?.y ?? 0) || 0;
        const r = Number(s?.radius ?? s0?.radius ?? 0) || 0;
        const dx = x - cx;
        const dy = y - cy;
        hit = (dx * dx + dy * dy) <= (r * r);
      } else if (type === "ellipse") {
        // Region ellipses use x,y,width,height,rotation (similar to drawings). Accept radiusX/Y or center form too.
        const rot = Number(s?.rotation ?? s0?.rotation ?? 0) || 0;
        // Prefer explicit radii if present
        let rx = Number(s?.radiusX ?? s0?.radiusX ?? 0) || 0;
        let ry = Number(s?.radiusY ?? s0?.radiusY ?? 0) || 0;

        // Center-based forms
        let cx = Number(s?.cx ?? s0?.cx ?? s?.x ?? s0?.x ?? 0) || 0;
        let cy = Number(s?.cy ?? s0?.cy ?? s?.y ?? s0?.y ?? 0) || 0;

        const w = Number(s?.width ?? s0?.width ?? 0) || 0;
        const h = Number(s?.height ?? s0?.height ?? 0) || 0;

        // If width/height provided, treat x/y as top-left, derive center and radii
        if (w && h) {
          cx = (Number(s?.x ?? s0?.x ?? 0) || 0) + (w / 2);
          cy = (Number(s?.y ?? s0?.y ?? 0) || 0) + (h / 2);
          rx = w / 2;
          ry = h / 2;
        } else if (!rx || !ry) {
          // Fallback: if only a 'radius' exists, treat as circle
          const r = Number(s?.radius ?? s0?.radius ?? 0) || 0;
          rx = rx || r;
          ry = ry || r;
        }

        if (rx > 0 && ry > 0) {
          // rotate point into ellipse local space
          const sin = Math.sin(-rot);
          const cos = Math.cos(-rot);
          const dx = x - cx;
          const dy = y - cy;
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
          hit = ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry)) <= 1;
        } else {
          hit = false;
        }
      } else if (type === "polygon") {
        const pts = s?.points ?? s0?.points ?? [];
        hit = pointInPolygon(x, y, Array.from(pts));
      } else if (type === "rectangle") {
        const rx = Number(s?.x ?? s0?.x ?? 0) || 0;
        const ry = Number(s?.y ?? s0?.y ?? 0) || 0;
        const w = Number(s?.width ?? s0?.width ?? 0) || 0;
        const h = Number(s?.height ?? s0?.height ?? 0) || 0;
        const rot = Number(s?.rotation ?? s0?.rotation ?? 0) || 0;
        if (!rot) hit = x >= rx && x <= (rx + w) && y >= ry && y <= (ry + h);
        else {
          const cx = rx + w / 2;
          const cy = ry + h / 2;
          const sin = Math.sin(-rot);
          const cos = Math.cos(-rot);
          const dx = x - cx;
          const dy = y - cy;
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
          hit = lx >= -w/2 && lx <= w/2 && ly >= -h/2 && ly <= h/2;
        }
      }
      if (hit) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function distanceUnitsStep() {
  try {
    const d = Number(canvas?.scene?.grid?.distance ?? 0) || 0;
    return d || 5;
  } catch {
    return 5;
  }
}

function computeInsideMovedUnits(moveInfo, regionDoc) {
  try {
    if (!moveInfo || !regionDoc) return 0;
    const movedPx = Number(moveInfo.movedPx ?? 0) || 0;
    const movedUnits = Number(moveInfo.movedUnits ?? 0) || 0;
    if (!movedPx || !movedUnits) return 0;
    const from = moveInfo.from;
    const to = moveInfo.to;
    if (!from || !to) return 0;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const gridSize = Number(canvas?.grid?.size ?? 0) || 100;
    const stepPx = Math.max(10, gridSize / 2);
    const n = Math.max(1, Math.ceil(movedPx / stepPx));
    const segPx = movedPx / n;
    let insidePx = 0;
    for (let i = 0; i < n; i++) {
      const tMid = (i + 0.5) / n;
      const mx = from.x + dx * tMid;
      const my = from.y + dy * tMid;
      if (isPointInsideRegion(mx, my, regionDoc)) insidePx += segPx;
    }
    if (!insidePx) return 0;
    const frac = insidePx / movedPx;
    return movedUnits * frac;
  } catch {
    return 0;
  }
}


function tokenCenterPx(tokenDoc) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const wPx = (Number(tokenDoc?.width ?? 1) || 1) * gridSize;
  const hPx = (Number(tokenDoc?.height ?? 1) || 1) * gridSize;
  const x = Number(tokenDoc?.x ?? 0) || 0;
  const y = Number(tokenDoc?.y ?? 0) || 0;
  return { x: x + (wPx / 2), y: y + (hPx / 2) };
}

function tokenCenterPxAt({ x, y, width, height }) {
  const gridSize = Number(canvas?.grid?.size ?? 0) || 0;
  const wPx = (Number(width ?? 1) || 1) * gridSize;
  const hPx = (Number(height ?? 1) || 1) * gridSize;
  const _x = Number(x ?? 0) || 0;
  const _y = Number(y ?? 0) || 0;
  return { x: _x + (wPx / 2), y: _y + (hPx / 2) };
}

function computeMovementInfo(prev, tokenDoc) {
  try {
    if (!prev || !tokenDoc) return null;
    const from = tokenCenterPxAt(prev);
    const to = tokenCenterPx(tokenDoc);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const movedPx = Math.hypot(dx, dy);
    if (!movedPx) return { movedPx: 0, movedUnits: 0, from, to };

    // Use Foundry grid measurement when available (respects diagonal rules).
    let movedUnits = 0;
    let movedSpaces = 0;
    try {
      const RayCls = foundry?.canvas?.geometry?.Ray ?? globalThis.Ray;
      const ray = RayCls ? new RayCls(from, to) : { A: from, B: to };
      const scene = tokenDoc?.parent ?? canvas?.scene;
      const gridDist = Number(scene?.grid?.distance ?? 0) || 0;

      if (canvas?.grid?.measurePath) {
        // Foundry v13+: preferred API.
        let path = canvas.grid.measurePath([from, to], { gridSpaces: false });
        let val = Number(path?.distance ?? 0) || 0;

        // Some grids return grid-spaces; convert when the value is implausibly small.
        if (gridDist && val && val < (gridDist * 0.75)) val = val * gridDist;

        // Fallback: explicit grid-spaces conversion.
        if (gridDist && (!val || !Number.isFinite(val))) {
          path = canvas.grid.measurePath([from, to], { gridSpaces: true });
          const spaces = Number(path?.distance ?? 0) || 0;
          val = spaces * gridDist;
        }

        movedUnits = val || 0;

        // Also compute moved grid-spaces (robust fallback for "1 square" edge cases)
        try {
          let pathS = canvas.grid.measurePath([from, to], { gridSpaces: true });
          let sVal = Number(pathS?.distance ?? 0) || 0;
          // Some grids still return units even with gridSpaces=true; normalize to spaces.
          if (gridDist && sVal && sVal > (gridDist * 0.75)) sVal = sVal / gridDist;
          movedSpaces = sVal || 0;
        } catch { /* ignore */ }
      } else if (canvas?.grid?.measureDistances) {
        // Foundry v12 fallback (deprecated in v13)
        let res = canvas.grid.measureDistances([{ ray }], { gridSpaces: false });
        let val = Array.isArray(res) ? (Number(res[0] ?? 0) || 0) : (Number(res ?? 0) || 0);

        if (gridDist && val && val < (gridDist * 0.75)) val = val * gridDist;

        if (gridDist && (!val || !Number.isFinite(val))) {
          res = canvas.grid.measureDistances([{ ray }], { gridSpaces: true });
          const spaces = Array.isArray(res) ? (Number(res[0] ?? 0) || 0) : (Number(res ?? 0) || 0);
          val = spaces * gridDist;
        }

        movedUnits = val || 0;

        try {
          let resS = canvas.grid.measureDistances([{ ray }], { gridSpaces: true });
          let sVal = Array.isArray(resS) ? (Number(resS[0] ?? 0) || 0) : (Number(resS ?? 0) || 0);
          if (gridDist && sVal && sVal > (gridDist * 0.75)) sVal = sVal / gridDist;
          movedSpaces = sVal || 0;
        } catch { /* ignore */ }
      } else if (canvas?.grid?.measureDistance) {
        let val = Number(canvas.grid.measureDistance(from, to, { gridSpaces: false }) ?? 0) || 0;
        if (gridDist && val && val < (gridDist * 0.75)) val = val * gridDist;
        movedUnits = val;
      }
    } catch {
      movedUnits = 0;
    }

    // Fallback: derive units from pixel distance and grid configuration.
    if (!movedUnits) {
      const scene = tokenDoc?.parent ?? canvas?.scene;
      const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
      const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
      movedUnits = (gridSize && gridDist) ? (movedPx / gridSize) * gridDist : 0;
    }

    // Ensure we always have grid-space distance (used as a robust fallback for per-square triggers).
    if (!movedSpaces) {
      const scene = tokenDoc?.parent ?? canvas?.scene;
      const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
      const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
      if (gridDist && movedUnits) movedSpaces = movedUnits / gridDist;
      else if (gridSize) movedSpaces = movedPx / gridSize;
      else movedSpaces = 0;
    }

    const fromRect = { x: prev.x, y: prev.y, width: prev.width, height: prev.height };
    const toRect = { x: tokenDoc.x, y: tokenDoc.y, width: tokenDoc.width, height: tokenDoc.height };
    return { movedPx, movedUnits, movedSpaces, from, to, fromRect, toRect };
  } catch {
    return null;
  }
}


function isTokenInsideRegion(tokenDoc, regionDoc) {
  try {
    if (!tokenDoc || !regionDoc) return false;
    return tokenIntersectsRegionAt({ x: tokenDoc.x, y: tokenDoc.y, width: tokenDoc.width, height: tokenDoc.height }, regionDoc);
  } catch { return false; }
}

function isTokenInsideRegionForRule(tokenDoc, regionDoc, rule) {
  try {
    if (rule && typeof rule.isInside === "function") return !!rule.isInside(tokenDoc, regionDoc);
  } catch {
    // ignore
  }
  return isTokenInsideRegion(tokenDoc, regionDoc);
}

function _shapeToRegionDocLike(shapes = []) {
  return { shapes };
}

function _wallOfFireLineCoreShapes(tplDoc, { practicalWallPx = 0 } = {}) {
  const scene = tplDoc?.parent ?? canvas?.scene;
  const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
  const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
  const toPx = (distUnits) => {
    const d = Number(distUnits ?? 0) || 0;
    if (!d || !gridSize || !gridDist) return 0;
    return (d / gridDist) * gridSize;
  };
  const len = toPx(tplDoc?.distance ?? 0);
  let w = toPx(tplDoc?.width ?? tplDoc?.distance ?? 0);
  if (!len) return [];
  const ox = Number(tplDoc?.x ?? 0) || 0;
  const oy = Number(tplDoc?.y ?? 0) || 0;
  const dir = Number(tplDoc?.direction ?? 0) || 0;
  const ang = (dir * Math.PI) / 180;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const px = -dy;
  const py = dx;
  const widthPx = Math.max(Number(practicalWallPx ?? 0) || 0, Number(w ?? 0) || 0, Number(gridSize ?? 0) || 0);
  const half = widthPx / 2;
  const ax = ox + px * half;
  const ay = oy + py * half;
  const bx = ox - px * half;
  const by = oy - py * half;
  const cx = bx + dx * len;
  const cy = by + dy * len;
  const dx2 = ax + dx * len;
  const dy2 = ay + dy * len;
  return [{ type: "polygon", points: [ax, ay, bx, by, cx, cy, dx2, dy2], hole: false }];
}

function _annulusPolygonShapes(cx, cy, outerRadius, innerRadius, { segments = 48 } = {}) {
  const outer = Number(outerRadius ?? 0) || 0;
  const inner = Math.max(0, Number(innerRadius ?? 0) || 0);
  if (!(outer > 0) || !(outer > inner)) return [];
  const count = Math.max(12, Number(segments ?? 48) || 48);
  const shapes = [];
  for (let i = 0; i < count; i += 1) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 1) / count) * Math.PI * 2;
    const ox0 = cx + Math.cos(a0) * outer;
    const oy0 = cy + Math.sin(a0) * outer;
    const ox1 = cx + Math.cos(a1) * outer;
    const oy1 = cy + Math.sin(a1) * outer;
    const ix1 = cx + Math.cos(a1) * inner;
    const iy1 = cy + Math.sin(a1) * inner;
    const ix0 = cx + Math.cos(a0) * inner;
    const iy0 = cy + Math.sin(a0) * inner;
    shapes.push({ type: "polygon", points: [ox0, oy0, ox1, oy1, ix1, iy1, ix0, iy0], hole: false });
  }
  return shapes;
}

function _wallOfFireCoreShapesFromTemplate(tplDoc, opts = {}) {
  const t = String(tplDoc?.t ?? "").toLowerCase();
  const scene = tplDoc?.parent ?? canvas?.scene;
  const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
  const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
  const toPx = (distUnits) => {
    const d = Number(distUnits ?? 0) || 0;
    if (!d || !gridSize || !gridDist) return 0;
    return (d / gridDist) * gridSize;
  };
  const oneCellPx = gridSize || toPx(gridDist) || 0;
  const practicalWallPx = Number(opts?.practicalWallPx ?? 0) || oneCellPx || 0;

  if (t === "ray") return _wallOfFireLineCoreShapes(tplDoc, { practicalWallPx });
  if (t === "circle") {
    const cx = Number(tplDoc?.x ?? 0) || 0;
    const cy = Number(tplDoc?.y ?? 0) || 0;
    const radiusPx = toPx(tplDoc?.distance ?? tplDoc?.radius ?? 0);
    if (!radiusPx) return [];
    // For ring walls, treat the measured template radius as the OUTER radius.
    // Using polygon slices instead of a circle+hole keeps the region visually annular
    // even on renderers/modules that ignore hole semantics for textured regions.
    const outer = radiusPx;
    const inner = Math.max(0, outer - practicalWallPx);
    return _annulusPolygonShapes(cx, cy, outer, inner, { segments: 48 });
  }
  return [];
}

function isTokenInsideWallOfFireCore(tokenDoc, regionDoc) {
  try {
    if (!tokenDoc || !regionDoc) return false;
    const epi = getEpiData(regionDoc) ?? {};
    const scene = regionDoc?.parent ?? canvas?.scene;
    const tplId = epi?.templateId ?? null;
    const templateDoc = tplId ? (scene?.templates?.get?.(tplId) ?? null) : null;
    if (!templateDoc) return false;
    const coreShapes = _wallOfFireCoreShapesFromTemplate(templateDoc);
    if (!coreShapes?.length) return false;
    return tokenIntersectsRegionAt({ x: tokenDoc.x, y: tokenDoc.y, width: tokenDoc.width, height: tokenDoc.height }, _shapeToRegionDocLike(coreShapes));
  } catch {
    return false;
  }
}

function templateToRegionShapes(tplDoc, ruleKey = null, opts = {}) {
  // Fallback based on document data (covers ray/circle/rect)
  const t = String(tplDoc?.t ?? "").toLowerCase();
  const ruleKeyLc = String(ruleKey ?? "").toLowerCase();
  const wallVariant = String(opts?.wallOfFireVariant ?? "").toLowerCase();
  const wantsAnnulus = (t === "circle") && (ruleKeyLc === "blade-barrier" || ruleKeyLc === "wall-of-thorns" || ruleKeyLc === "wall-of-fire" || ruleKeyLc === "wall-of-fire-wall" || ruleKeyLc === "wall-of-ice");
  const wantsPracticalWallRay = (ruleKeyLc === "wall-of-fire") && (t === "ray");

  const wantsCustomCircle = (ruleKeyLc === "flaming-sphere");
  const world = templateObjectShapeToWorldShapes(tplDoc);
  if (world?.length && !wantsAnnulus && !wantsPracticalWallRay && !wantsCustomCircle) return world;
  const scene = tplDoc?.parent ?? canvas?.scene;
  const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
  const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
  const toPx = (distUnits) => {
    const d = Number(distUnits ?? 0) || 0;
    if (!d || !gridSize || !gridDist) return 0;
    return (d / gridDist) * gridSize;
  };
  const oneCellPx = gridSize || toPx(gridDist) || 0;
  const hotDepthPx = toPx(gridDist ? (gridDist * 2) : 0) || (oneCellPx ? oneCellPx * 2 : 0); // 10 ft / 3 m = ~2 grid cells on standard grids

  if (t === "circle") {
    const radiusPx = toPx(tplDoc?.distance ?? tplDoc?.radius ?? 0);
    if (!radiusPx) return [];

    // Special-case: ring walls (Blade Barrier / Wall of Fire).
    if (ruleKeyLc === "wall-of-fire" || ruleKeyLc === "wall-of-fire-wall") {
      const cx = Number(tplDoc?.x ?? 0) || 0;
      const cy = Number(tplDoc?.y ?? 0) || 0;
      const practicalWallPx = oneCellPx || radiusPx * 0.1;
      const wallOuter = radiusPx;
      const wallInner = Math.max(0, wallOuter - practicalWallPx);
      const hotOuter = wallOuter + (hotDepthPx || 0);
      const hotInner = Math.max(0, wallInner - (hotDepthPx || 0));
      if (ruleKeyLc === "wall-of-fire-wall") {
        return _wallOfFireCoreShapesFromTemplate(tplDoc, { practicalWallPx });
      }
      if (wallVariant === "ring-inner") {
        const innerOuter = wallInner;
        let innerInner = Math.max(0, wallInner - (hotDepthPx || 0));
        // Keep the inner hot-side region visually annular whenever there is enough room on the grid.
        // Foundry renders this much more clearly than a full disk for Wall of Fire ring variants.
        if (!(innerOuter > innerInner + 1)) {
          const minHole = Math.max(1, Math.min(innerOuter - 1, oneCellPx || 0));
          if (innerOuter > minHole + 1) innerInner = minHole;
        }
        if (innerOuter > innerInner + 1) {
          return _annulusPolygonShapes(cx, cy, innerOuter, innerInner, { segments: 48 });
        }
        return [{ type: "circle", x: cx, y: cy, radius: innerOuter, hole: false }];
      }
      if (wallVariant === "ring-outer") {
        const outerHot = hotOuter || wallOuter;
        if (outerHot > wallOuter + 1) {
          return _annulusPolygonShapes(cx, cy, outerHot, wallOuter, { segments: 48 });
        }
        return _annulusPolygonShapes(cx, cy, wallOuter, wallInner, { segments: 48 });
      }
      const outerHot = hotOuter || wallOuter;
      if (outerHot > wallInner + 1) {
        return _annulusPolygonShapes(cx, cy, outerHot, wallInner, { segments: 48 });
      }
      return _annulusPolygonShapes(cx, cy, wallOuter, wallInner, { segments: 48 });
    }

    if (ruleKeyLc === "blade-barrier" || ruleKeyLc === "wall-of-thorns" || ruleKeyLc === "wall-of-ice") {
      const outer = radiusPx;
      const thicknessPx = oneCellPx || toPx(gridDist) || 0; // practical 1-square ring
      const inner = Math.max(0, outer - (thicknessPx || 0));
      if (inner > 1) {
        return _annulusPolygonShapes(Number(tplDoc?.x ?? 0) || 0, Number(tplDoc?.y ?? 0) || 0, outer, inner, { segments: 48 });
      }
    }

    if (ruleKeyLc === "flaming-sphere") {
      const cx = Number(tplDoc?.x ?? 0) || 0;
      const cy = Number(tplDoc?.y ?? 0) || 0;
      // RAW: creatures ending their turn within 5 ft / 1.5 m of the sphere take damage,
      // so the damaging Region must be a bit larger than the visible sphere template.
      const auraDepth = oneCellPx || radiusPx;
      return [{ type: "circle", x: cx, y: cy, radius: radiusPx + auraDepth, hole: false }];
    }

    if (ruleKeyLc === "prismatic-wall-aura") {
      const cx = Number(tplDoc?.x ?? 0) || 0;
      const cy = Number(tplDoc?.y ?? 0) || 0;
      const auraDepth = toPx(gridDist ? (gridDist * 4) : 0) || ((oneCellPx || 0) * 4);
      const outer = radiusPx + auraDepth;
      const inner = Math.max(0, radiusPx - auraDepth);
      if (outer > inner + 1) return _annulusPolygonShapes(cx, cy, outer, inner, { segments: 48 });
      return [{ type: "circle", x: cx, y: cy, radius: outer, hole: false }];
    }

    return [{ type: "circle", x: Number(tplDoc?.x ?? 0) || 0, y: Number(tplDoc?.y ?? 0) || 0, radius: radiusPx, hole: false }];
  }

  if (t === "rect") {
    const sidePx = toPx(tplDoc?.width ?? tplDoc?.distance ?? 0);
    if (!sidePx) return [];
    return [{ type: "rectangle", x: Number(tplDoc?.x ?? 0) || 0, y: Number(tplDoc?.y ?? 0) || 0, width: sidePx, height: sidePx, rotation: 0, hole: false }];
  }

  // dnd5e often uses "ray" for cubes to allow rotation.
  if (t === "ray") {
    const len = toPx(tplDoc?.distance ?? 0);
    let w = toPx(tplDoc?.width ?? tplDoc?.distance ?? 0);
    if (!len) return [];
    const ox = Number(tplDoc?.x ?? 0) || 0;
    const oy = Number(tplDoc?.y ?? 0) || 0;
    const dir = Number(tplDoc?.direction ?? 0) || 0;
    const ang = (dir * Math.PI) / 180;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const px = -dy;
    const py = dx;

    if (ruleKeyLc === "wall-of-fire" || ruleKeyLc === "wall-of-fire-wall") {
      const practicalWallPx = Math.max(w || 0, oneCellPx || 0);
      if (ruleKeyLc === "wall-of-fire-wall") {
        return _wallOfFireCoreShapesFromTemplate(tplDoc, { practicalWallPx });
      }
      const wantLeft = wallVariant === "line-left";
      // Screen-space / template direction makes the practical "left" side
      // the negative perpendicular, and "right" the positive one.
      const side = wantLeft ? -1 : 1;
      const inner = side * (practicalWallPx / 2);
      const outer = inner + (side * (hotDepthPx || 0));
      const ax = ox + px * inner;
      const ay = oy + py * inner;
      const bx = ox + px * outer;
      const by = oy + py * outer;
      const cx = bx + dx * len;
      const cy = by + dy * len;
      const dx2 = ax + dx * len;
      const dy2 = ay + dy * len;
      return [{ type: "polygon", points: [ax, ay, bx, by, cx, cy, dx2, dy2], hole: false }];
    }
    if (ruleKeyLc === "prismatic-wall-aura") {
      const baseW = Math.max(w || 0, oneCellPx || 0);
      const auraDepth = toPx(gridDist ? (gridDist * 4) : 0) || ((oneCellPx || 0) * 4);
      const totalW = baseW + (auraDepth * 2);
      const half = totalW / 2;
      const ax = ox + px * half;
      const ay = oy + py * half;
      const bx = ox - px * half;
      const by = oy - py * half;
      const cx = bx + dx * len;
      const cy = by + dy * len;
      const dx2 = ax + dx * len;
      const dy2 = ay + dy * len;
      return [{ type: "polygon", points: [ax, ay, bx, by, cx, cy, dx2, dy2], hole: false }];
    }

    if (!w) return [];
    const half = w / 2;
    const ax = ox + px * half;
    const ay = oy + py * half;
    const bx = ox - px * half;
    const by = oy - py * half;
    const cx = bx + dx * len;
    const cy = by + dy * len;
    const dx2 = ax + dx * len;
    const dy2 = ay + dy * len;
    return [{ type: "polygon", points: [ax, ay, bx, by, cx, cy, dx2, dy2], hole: false }];
  }

  return [];
}

function actorHasEffect(actor, kind, regionId) {
  return !!actor?.effects?.some(e => {
    const f = getEpiData(e) ?? {};
    return f.kind === kind && (!regionId || f.regionId === regionId);
  });
}

function getEffect(actor, kind, regionId) {
  return actor?.effects?.find(e => {
    const f = getEpiData(e) ?? {};
    return f.kind === kind && (!regionId || f.regionId === regionId);
  }) ?? null;
}

async function applyRestrained(actor, regionDoc, { label, escapeDC, kind, icon } ) {
  if (!actor || !regionDoc || !isActiveGM()) return;
  const regionId = regionDoc.id;
  if (actorHasEffect(actor, kind, regionId)) return;

  const _icon = icon || (await getRegionSpellIcon(regionDoc)) || "systems/dnd5e/icons/svg/statuses/restrained.svg";

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label,
    icon: _icon,
    origin: regionDoc.uuid,
    duration: {
      rounds: 600,
      startRound: game.combat?.round ?? 0,
      startTime: game.time.worldTime
    },
    statuses: ["restrained"],
    changes: [
      { key: "system.attributes.movement.walk", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" },
      { key: "system.attributes.movement.fly", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" },
      { key: "system.attributes.movement.swim", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" },
      { key: "system.attributes.movement.climb", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" },
      { key: "system.attributes.movement.burrow", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" }
    ],
    flags: {
      [FLAG_SCOPE]: { [FLAG_KEY]: { kind, regionId, escapeDC } }
    }
  }]);
}

async function removeEffectKind(actor, kind, regionId) {
  if (!actor) return;
  const eff = getEffect(actor, kind, regionId);
  if (eff) await eff.delete();
}

async function applyBlinded(actor, regionDoc, { label, kind, icon } ) {
  if (!actor || !regionDoc || !isActiveGM()) return;
  const regionId = regionDoc.id;
  if (actorHasEffect(actor, kind, regionId)) return;
  const _icon = icon || (await getRegionSpellIcon(regionDoc)) || "systems/dnd5e/icons/svg/statuses/blinded.svg";
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label,
    icon: _icon,
    origin: regionDoc.uuid,
    duration: {
      rounds: 600,
      startRound: game.combat?.round ?? 0,
      startTime: game.time.worldTime
    },
    statuses: ["blinded"],
    changes: [],
    flags: {
      [FLAG_SCOPE]: { [FLAG_KEY]: { kind, regionId } }
    }
  }]);
}

async function applyProne(actor, regionDoc, { label, kind, icon } ) {
  if (!actor || !regionDoc || !isActiveGM()) return;
  const regionId = regionDoc.id;
  if (actorHasEffect(actor, kind, regionId)) return;
  const _icon = icon || (await getRegionSpellIcon(regionDoc)) || "systems/dnd5e/icons/svg/statuses/prone.svg";
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label,
    icon: _icon,
    origin: regionDoc.uuid,
    duration: {
      rounds: 600,
      startRound: game.combat?.round ?? 0,
      startTime: game.time.worldTime
    },
    statuses: ["prone"],
    changes: [],
    flags: {
      [FLAG_SCOPE]: { [FLAG_KEY]: { kind, regionId } }
    }
  }]);
}

// ---------------------------------------------------------------------------
// Concentration helpers
// ---------------------------------------------------------------------------

function _effectHasStatus(effect, statusId) {
  try {
    const sid = String(statusId ?? "");
    if (!sid) return false;
    const s1 = effect?.statuses;
    if (s1?.has?.(sid)) return true;
    if (Array.isArray(s1) && s1.includes(sid)) return true;
    const s2 = effect?.system?.statuses;
    if (s2?.has?.(sid)) return true;
    if (Array.isArray(s2) && s2.includes(sid)) return true;
    return false;
  } catch {
    return false;
  }
}

function actorIsConcentrating(actor) {
  try {
    const statusId = CONFIG?.specialStatusEffects?.CONCENTRATING ?? "concentrating";
    return !!actor?.effects?.some(e => _effectHasStatus(e, statusId));
  } catch {
    return false;
  }
}

async function endActorConcentration(actor, tokenDoc, { reason = "" } = {}) {
  try {
    if (!isActiveGM() || !actor) return;
    const statusId = CONFIG?.specialStatusEffects?.CONCENTRATING ?? "concentrating";

    // Prefer system helper if present.
    if (typeof actor.endConcentration === "function") {
      try {
        await actor.endConcentration();
      } catch {
        // fall back below
      }
    }

    // Fallback: delete concentrating effects.
    const concEffects = (actor.effects ?? []).filter(e => _effectHasStatus(e, statusId));
    for (const e of concEffects) {
      try { await e.delete(); } catch { /* ignore */ }
    }

    // Informative chat message
    try {
      const speaker = getSpeaker(actor, tokenDoc);
      const msg = reason ? `${actor.name} perd sa concentration — ${reason}` : `${actor.name} perd sa concentration`;
      await ChatMessage.create({ speaker, content: msg });
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] endActorConcentration failed`, e);
  }
}

// ---------------------------------------------------------------------------
// Rules registry
// ---------------------------------------------------------------------------

function normalizeName(s) {
  return String(s ?? "").toLowerCase();
}

function getRuleFromItem(item) {
  const rule = item?.flags?.["encounterplus-importer"]?.regionRule
    ?? (item?.flags?.["encounterplus-importer"]?.useWebRegions ? "web" : null);
  const slugRuleMap = {
    "toile-d-araignee": "web",
    "graisse": "grease",
    "enchevetrement": "entangle",
    "tentacules-noirs-d-evard": "black-tentacles",
    "voracite-de-hadar": "hunger-of-hadar",
    "nuee-de-dagues": "cloud-of-daggers",
    "rayon-de-lune": "moonbeam",
    "sphere-de-feu": "flaming-sphere",
    "sphere-aqueuse": "aqueous-sphere",
    "esprits-gardiens": "spirit-guardians",
    "nuage-incendiaire": "incendiary-cloud",
    "nuage-nauseabond": "stinking-cloud",
    "croissance-d-epines": "spike-growth",
    "fleau-d-insectes": "insect-plague",
    "barriere-de-lames": "blade-barrier",
    "mur-d-epines": "wall-of-thorns",
    "mur-de-feu": "wall-of-fire",
    "mur-de-lumiere": "wall-of-light",
    "mur-de-force": "wall-of-force",
    "mur-de-glace": "wall-of-ice",
    "mur-de-pierre": "wall-of-stone",
    "mur-de-sable": "wall-of-sand",
    "mur-de-vent": "wall-of-wind",
    "mur-d-eau": "wall-of-water",
    "mur-prismatique": "prismatic-wall",
    "sphere-de-tempete": "storm-sphere",
    "tempete-de-neige": "sleet-storm"
  };
  const slug = String(item?.flags?.["encounterplus-importer"]?.slug ?? "").toLowerCase();
  if (slugRuleMap[slug]) return slugRuleMap[slug];

  if (rule) return rule;

  // Fallback (safe): match only a few exact/very specific names to avoid affecting unrelated items.
  const n = normalizeName(item?.name);
  if (n.includes("toile d") || n === "web") return "web";
  if (n === "graisse" || n === "grease") return "grease";
  if (n === "enchevêtrement" || n === "enchevetrement" || n === "entangle") return "entangle";
  if (n.includes("tentacules noirs") || n.includes("black tentacles")) return "black-tentacles";
  if (n.includes("voracité de hadar") || n.includes("hunger of hadar")) return "hunger-of-hadar";
  if (n.includes("nuée de dagues") || n.includes("cloud of daggers")) return "cloud-of-daggers";
  if (n.includes("rayon de lune") || n.includes("moonbeam")) return "moonbeam";
  if (n.includes("sphère de feu") || n.includes("sphere de feu") || n.includes("flaming sphere")) return "flaming-sphere";
  if (n.includes("sphère aqueuse") || n.includes("sphere aqueuse") || n.includes("aqueous sphere")) return "aqueous-sphere";
  if (n.includes("esprits gardiens") || n.includes("spirit guardians")) return "spirit-guardians";
  if (n.includes("nuage incendiaire") || n.includes("incendiary cloud")) return "incendiary-cloud";
  if (n.includes("nuage nauséabond") || n.includes("stinking cloud")) return "stinking-cloud";
  if (n.includes("croissance") && n.includes("épines")) return "spike-growth";
  if (n.includes("spike growth")) return "spike-growth";
  if (n.includes("barrière de lames") || n.includes("barriere de lames") || n.includes("blade barrier")) return "blade-barrier";
  if (n.includes("mur d’épines") || n.includes("mur d'epines") || n.includes("mur d’epines") || n.includes("wall of thorns")) return "wall-of-thorns";
  if (n.includes("mur de lumière") || n.includes("mur de lumiere") || n.includes("wall of light")) return "wall-of-light";
  if (n.includes("mur de force") || n.includes("wall of force")) return "wall-of-force";
  if (n.includes("mur de glace") || n.includes("wall of ice")) return "wall-of-ice";
  if (n.includes("mur de pierre") || n.includes("wall of stone")) return "wall-of-stone";
  if (n.includes("mur de sable") || n.includes("wall of sand")) return "wall-of-sand";
  if (n.includes("mur de vent") || n.includes("wall of wind")) return "wall-of-wind";
  if (n.includes("mur d’eau") || n.includes("mur d'eau") || n.includes("wall of water")) return "wall-of-water";
  if (n.includes("mur prismatique") || n.includes("prismatic wall")) return "prismatic-wall";
  if (n.includes("sphère de tempête") || n.includes("sphere de tempete") || n.includes("storm sphere")) return "storm-sphere";
  if (n.includes("tempête de neige") || n.includes("tempete de neige") || n.includes("sleet storm")) return "sleet-storm";
  if (n.includes("fléau") && n.includes("insect")) return "insect-plague";
  if (n.includes("insect plague")) return "insect-plague";
  return null;
}

const RULES = {

  "generic-hazard": {
    label: "Zone dangereuse",
    allowMissingDC: true,
    // Optional: difficult terrain can be set via behaviors on the region or via spell itself.
    onCast: async ({ actor, tokenDoc, regionDoc }) => {
      // No default action on cast; behavior is driven by triggers.
    },
    _shouldTriggerEnterOnce: ({ tokenDoc, regionDoc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      if (!hz?.triggers?.enterOncePerTurn) return false;
      const key = `${tokenDoc?.uuid ?? "token"}|${regionDoc?.id ?? "region"}|enterOnce|${game.combat?.round ?? 0}|${game.combat?.turn ?? 0}`;
      if (TURN_CACHE.has(key)) return false;
      TURN_CACHE.add(key);
      return true;
    },
    _applyDamage: async ({ actor, tokenDoc, regionDoc, dc, damage }) => {
      const parts = Array.isArray(damage) ? damage : (damage ? [damage] : []);
      if (!parts.length) return;
      const speaker = getSpeaker(actor, tokenDoc);

      const rolledParts = [];
      for (const part of parts) {
        if (!part?.formula || !part?.type) continue;
        const roll = await (new Roll(part.formula)).evaluate({ async: true });
        rolledParts.push({ type: part.type, roll });
        await roll.toMessage({
          speaker,
          flavor: `${regionDoc.name} — Dégâts ${part.type}`
        });
      }

      // Best-effort application via MidiQOL: apply all parts with their types.
      try {
        if (globalThis.MidiQOL?.applyTokenDamage && rolledParts.length) {
          const dmgArr = rolledParts.map(p => ({ damage: p.roll.total, type: p.type }));
          const total = dmgArr.reduce((a, b) => a + (Number(b.damage) || 0), 0);
          await globalThis.MidiQOL.applyTokenDamage(dmgArr, total, new Set([tokenDoc.object]), null, null);
        }
      } catch (e) { /* ignore */ }
    },
    _checkConcentration: async ({ actor, tokenDoc, regionDoc, dc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      if (!hz?.concentrationCheck) return;
      // If the actor is concentrating, ask for a CON save vs spell DC (best-effort).
      const isConc = actor?.effects?.some(e => e?.statuses?.has?.("concentrating") || /concentration/i.test(e?.name ?? ""));
      if (!isConc) return;
      const _dc = dc ?? getSpellDC(actor, null) ?? null;
      if (!_dc) return;
      const total = await rollSave(actor, tokenDoc, "con", _dc);
      if (total < _dc) {
        // Remove concentration effect best-effort.
        try {
          const eff = actor.effects?.find(e => e?.statuses?.has?.("concentrating") || /concentration/i.test(e?.name ?? ""));
          if (eff) await eff.delete();
        } catch (e) {}
        await ChatMessage.create({ speaker: getSpeaker(actor, tokenDoc), content: `<p><b>Concentration rompue</b> (DD ${_dc})</p>` });
      }
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      if (hz?.triggers?.enterOncePerTurn && !RULES["generic-hazard"]._shouldTriggerEnterOnce({ tokenDoc, regionDoc })) return;
      if (hz?.damage) await RULES["generic-hazard"]._applyDamage({ actor, tokenDoc, regionDoc, dc, damage: hz.damage });
    },
    onStartTurn: async ({ actor, tokenDoc, regionDoc, dc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      if (hz?.triggers?.startTurnInside && hz?.damage) {
        await RULES["generic-hazard"]._applyDamage({ actor, tokenDoc, regionDoc, dc, damage: hz.damage });
      }
      await RULES["generic-hazard"]._checkConcentration({ actor, tokenDoc, regionDoc, dc });
    },
    onEndTurn: async ({ actor, tokenDoc, regionDoc, dc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      if (hz?.triggers?.endTurnInside && hz?.damage) {
        await RULES["generic-hazard"]._applyDamage({ actor, tokenDoc, regionDoc, dc, damage: hz.damage });
      }
    },
    onMoveWithin: async ({ actor, tokenDoc, regionDoc, dc, movedUnits }) => {
      const f = getEpiData(regionDoc) ?? {};
      const hz = f.hazard ?? {};
      const mv = hz?.move;
      if (!mv?.formula || !mv?.perMeters) return;
      const dist = Number(movedUnits ?? 0) || 0;
      if (dist <= 0) return;
      const chunks = Math.floor(dist / (Number(mv.perMeters) || 1.5));
      if (chunks <= 0) return;
      const formula = `${chunks}*(${mv.formula})`;
      await RULES["generic-hazard"]._applyDamage({ actor, tokenDoc, regionDoc, dc, damage: { formula, type: mv.type || hz?.damage?.type || "untyped" } });
    }
  },

  "web": {
    label: "Toile d’araignée",
    behaviorLabel: "Terrain difficile — Toile d’araignée",
    onCast: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorHasConditionImmunity(actor, "restrained")) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyRestrained(actor, regionDoc, {
          label: `Toile d’araignée — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "web-restrained"
        });
      }
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorHasConditionImmunity(actor, "restrained")) return;
      if (actorHasEffect(actor, "web-restrained", regionDoc.id)) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyRestrained(actor, regionDoc, {
          label: `Toile d’araignée — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "web-restrained"
        });
      }
    },
    onStartTurn: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      const eff = getEffect(actor, "web-restrained", regionDoc.id);
      if (eff) {
        // If restrained: STR check to escape (user preference)
        const escapeDC = Number(getEpiData(eff)?.escapeDC ?? dc ?? 0) || dc;
        const total = await rollAbilityCheck(actor, tokenDoc, "str");
        if (total >= escapeDC) {
          await eff.delete();
          ui.notifications.info(`✅ ${actor.name} se libère de la toile (FOR ${total} vs DD ${escapeDC}).`);
        }
        return;
      }

      if (actorHasConditionImmunity(actor, "restrained")) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyRestrained(actor, regionDoc, {
          label: `Toile d’araignée — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "web-restrained"
        });
      }
    },
    onExit: async ({ actor, regionDoc }) => {
      await removeEffectKind(actor, "web-restrained", regionDoc.id);
    },
    cleanupEffects: ["web-restrained"]
  },

  "grease": {
    label: "Graisse",
    behaviorLabel: "Terrain difficile — Graisse",
    onCast: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorHasConditionImmunity(actor, "prone")) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyProne(actor, regionDoc, { label: `Graisse — À terre (DD ${dc})`, kind: "grease-prone" });
      }
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorHasConditionImmunity(actor, "prone")) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyProne(actor, regionDoc, { label: `Graisse — À terre (DD ${dc})`, kind: "grease-prone" });
      }
    },
    // User preference: saving throw is required when entering the area, AND when moving within it.
    onMoveWithin: async ({ actor, tokenDoc, regionDoc, dc }) => {
      if (actorHasConditionImmunity(actor, "prone")) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyProne(actor, regionDoc, { label: `Graisse — À terre (DD ${dc})`, kind: "grease-prone" });
      }
    },
    onExit: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      // House rule: leaving the grease ends the slip effect.
      await removeEffectKind(actor, "grease-prone", regionDoc.id);
    },
    cleanupEffects: ["grease-prone"]
  },

  "entangle": {
    label: "Enchevêtrement",
    behaviorLabel: "Terrain difficile — Enchevêtrement",
    // RAW: the restraint check happens when the spell is cast (creatures already in the area).
    // Entering later is difficult terrain, but does not auto-restrain (user request).
    onCast: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorHasConditionImmunity(actor, "restrained")) return;
      const total = await rollSave(actor, tokenDoc, "str", dc);
      if (total < dc) {
        await applyRestrained(actor, regionDoc, {
          label: `Enchevêtrement — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "entangle-restrained"
        });
      }
    },
    onStartTurn: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      const eff = getEffect(actor, "entangle-restrained", regionDoc.id);
      if (!eff) return;
      const escapeDC = Number(getEpiData(eff)?.escapeDC ?? dc ?? 0) || dc;
      const { ability, total } = await rollAbilityCheckBestWithAbility(actor, tokenDoc, ["str", "dex"]);
      if (total >= escapeDC) {
        await eff.delete();
        ui.notifications.info(`✅ ${actor.name} se libère des plantes (${ability.toUpperCase()} ${total} vs DD ${escapeDC}).`);
      }
    },
    cleanupEffects: ["entangle-restrained"]
  },

  "black-tentacles": {
    label: "Tentacules noirs d’Evard",
    behaviorLabel: "Terrain difficile — Tentacules",
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      // Dex save, 3d6 bludgeoning (half on success). Fail => restrained.
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: "3d6",
        damageType: "bludgeoning",
        flavor: `Tentacules noirs — dégâts contondants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "bludgeoning");

      if (total < dc && !actorHasConditionImmunity(actor, "restrained")) {
        await applyRestrained(actor, regionDoc, {
          label: `Tentacules noirs — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "tentacles-restrained"
        });
      }
    },
    onCast: async (ctx) => { await RULES["black-tentacles"]._affect(ctx); },
    onEnter: async (ctx) => { await RULES["black-tentacles"]._affect(ctx); },
    onStartTurn: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      await RULES["black-tentacles"]._affect({ actor, tokenDoc, regionDoc, dc, castLevel });

      // User preference: resolve the escape action at the beginning of the turn.
      const eff = getEffect(actor, "tentacles-restrained", regionDoc.id);
      if (!eff) return;
      const escapeDC = Number(getEpiData(eff)?.escapeDC ?? dc ?? 0) || dc;
      const r = await rollAbilityCheckBestWithAbility(actor, tokenDoc, ["str", "dex"]);
      if (r.total >= escapeDC) {
        await eff.delete();
        ui.notifications.info(`✅ ${actor.name} se libère des tentacules (${r.ability.toUpperCase()} ${r.total} vs DD ${escapeDC}).`);
      }
    },
    cleanupEffects: ["tentacles-restrained"]
  },

  "hunger-of-hadar": {
    label: "Voracité de Hadar",
    behaviorLabel: "Terrain difficile — Voracité de Hadar",
    allowMissingDC: true,
    onCast: async ({ actor, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Voracité de Hadar — Aveuglé", kind: "hadar-blinded" });
    },
    onEnter: async ({ actor, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Voracité de Hadar — Aveuglé", kind: "hadar-blinded" });
    },
    onExit: async ({ actor, regionDoc }) => {
      await removeEffectKind(actor, "hadar-blinded", regionDoc.id);
    },
    onStartTurn: async ({ actor, tokenDoc }) => {
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: "2d6",
        damageType: "cold",
        flavor: `Voracité de Hadar — dégâts de froid (${actor.name})`
      });
      await applyDamage(actor, Number(roll.total ?? 0) || 0, "cold");
    },
    onEndTurn: async ({ actor, tokenDoc }) => {
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: "2d6",
        damageType: "acid",
        flavor: `Voracité de Hadar — dégâts d’acide (${actor.name})`
      });
      await applyDamage(actor, Number(roll.total ?? 0) || 0, "acid");
    },
    cleanupEffects: ["hadar-blinded"]
  },

  "cloud-of-daggers": {
    label: "Nuée de dagues",
    allowMissingDC: true,
    _formula: ({ castLevel }) => {
      const L = Math.max(2, Number(castLevel ?? 2) || 2);
      const dice = 4 + Math.max(0, L - 2) * 2;
      return `${dice}d4`;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, castLevel, combat }) => {
      // Apply at most once per combat turn (covers both "enter" and "start of turn").
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat)) return;
      }
      const formula = RULES["cloud-of-daggers"]._formula({ castLevel });
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "slashing",
        flavor: `Nuée de dagues — dégâts tranchants (${actor.name})`
      });
      await applyDamage(actor, Number(roll.total ?? 0) || 0, "slashing");
    },
    onEnter: async (ctx) => { await RULES["cloud-of-daggers"]._affect(ctx); },
    onStartTurn: async (ctx) => { await RULES["cloud-of-daggers"]._affect(ctx); }
  },

  "moonbeam": {
    label: "Rayon de lune",
    _formula: ({ castLevel }) => {
      const L = Math.max(2, Number(castLevel ?? 2) || 2);
      const dice = 2 + Math.max(0, L - 2);
      return `${dice}d10`;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      const isSC = actorIsShapechanger(actor);
      const total = await rollSave(actor, tokenDoc, "con", dc, isSC ? { disadvantage: true } : {});
      const formula = RULES["moonbeam"]._formula({ castLevel });
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "radiant",
        flavor: `Rayon de lune — dégâts radiants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "radiant");

      if (total < dc && isSC) {
        ui.notifications.info(`🌙 ${actor.name} est un métamorphe : sur échec, il revient à sa forme d’origine (Rayon de lune).`);
      }
    },
    // Many tables apply the effect immediately when you place the beam on creatures.
    onCast: async (ctx) => { await RULES["moonbeam"]._affect(ctx); },
    onEnter: async (ctx) => { await RULES["moonbeam"]._affect(ctx); },
    onStartTurn: async (ctx) => { await RULES["moonbeam"]._affect(ctx); }
  },

  "flaming-sphere": {
    label: "Sphère de feu",
    allowMissingDC: false,
    _formula: ({ castLevel }) => {
      const L = Math.max(2, Number(castLevel ?? 2) || 2);
      const dice = 2 + Math.max(0, L - 2);
      return `${dice}d6`;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (!actor || !tokenDoc || !dc) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const formula = RULES["flaming-sphere"]._formula({ castLevel });
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "fire",
        flavor: `Sphère de feu — dégâts de feu (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "fire");
    },
    onCast: async () => {
      // RAW: creating the sphere does not inherently deal damage.
      // Damage happens when a creature ends its turn near it, or when the sphere is moved into it later.
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc, castLevel, combat }) => {
      if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "flaming-sphere")) return;
      await RULES["flaming-sphere"]._affect({ actor, tokenDoc, regionDoc, dc, castLevel });
    },
    onEndTurn: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      await RULES["flaming-sphere"]._affect({ actor, tokenDoc, regionDoc, dc, castLevel });
    }
  },

  "aqueous-sphere": {
    label: "Sphère aqueuse",
    allowMissingDC: false,
    onCast: async ({ actor, tokenDoc, regionDoc, dc }) => {
      if (!actor || !tokenDoc || !dc) return;
      if (actorHasConditionImmunity(actor, "restrained")) return;
      const total = await rollSave(actor, tokenDoc, "str", dc);
      if (total < dc) {
        await applyRestrained(actor, regionDoc, {
          label: `Sphère aqueuse — Entravé (DD ${dc})`,
          escapeDC: dc,
          kind: "aqueous-sphere-restrained",
          saveAbility: "str"
        });
      }
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc, combat }) => {
      if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "aqueous-sphere")) return;
      await RULES["aqueous-sphere"].onCast({ actor, tokenDoc, regionDoc, dc });
    },
    cleanupEffects: ["aqueous-sphere-restrained"]
  },

  "spirit-guardians": {
    label: "Esprits gardiens",
    buildBehaviors: ({ casterDisposition }) => [{
      name: "Ralentissement — Esprits gardiens",
      type: "dnd5e.difficultTerrain",
      system: { magical: true, types: [], ignoredDispositions: [casterDisposition] },
      flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "spirit-guardians-difficult-terrain" } } }
    }],
    _formula: ({ castLevel }) => {
      const L = Math.max(3, Number(castLevel ?? 3) || 3);
      const dice = 3 + Math.max(0, L - 3);
      return `${dice}d8`;
    },
    _shouldAffect: ({ tokenDoc, regionDoc }) => {
      const f = getEpiData(regionDoc) ?? {};
      const casterDisp = Number(f.casterDisposition ?? 0) || 0;
      const td = Number(tokenDoc?.disposition ?? 0) || 0;
      // Approximation: ignore same disposition as caster (treat as "designated unaffected").
      return td !== casterDisp;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (!RULES["spirit-guardians"]._shouldAffect({ tokenDoc, regionDoc })) return;
      const total = await rollSave(actor, tokenDoc, "wis", dc);
      const formula = RULES["spirit-guardians"]._formula({ castLevel });
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "radiant",
        flavor: `Esprits gardiens — dégâts radiants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "radiant");
    },
    onEnter: async (ctx) => { await RULES["spirit-guardians"]._affect(ctx); },
    onStartTurn: async (ctx) => { await RULES["spirit-guardians"]._affect(ctx); }
  },

  "incendiary-cloud": {
    label: "Nuage incendiaire",
    allowMissingDC: false,
    _formula: () => "10d8",
    _affect: async ({ actor, tokenDoc, regionDoc, dc }) => {
      if (!actor || !tokenDoc || !dc) return;
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const formula = RULES["incendiary-cloud"]._formula();
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "fire",
        flavor: `Nuage incendiaire — dégâts de feu (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "fire");
    },
    onEnter: async ({ actor, tokenDoc, regionDoc, dc, combat }) => {
      if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "incendiary-cloud-enter")) return;
      await RULES["incendiary-cloud"]._affect({ actor, tokenDoc, regionDoc, dc });
    },
    onEndTurn: async ({ actor, tokenDoc, regionDoc, dc }) => {
      await RULES["incendiary-cloud"]._affect({ actor, tokenDoc, regionDoc, dc });
    }
  },


  "stinking-cloud": {
    label: "Nuage nauséabond",
    _applyNauseated: async ({ actor, tokenDoc, regionDoc }) => {
      if (!actor || !regionDoc || !isActiveGM()) return;
      const regionId = regionDoc.id;
      const kind = "stinking-nauseated";
      if (actorHasEffect(actor, kind, regionId)) return;
      const icon = (await getRegionSpellIcon(regionDoc)) || "systems/dnd5e/icons/svg/statuses/poisoned.svg";
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Nuage nauséabond — Haut-le-cœur",
        icon,
        origin: regionDoc.uuid,
        duration: { rounds: 1, startRound: game.combat?.round ?? 0, startTime: game.time.worldTime },
        statuses: ["poisoned"],
        changes: [],
        flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind, regionId } } }
      }]);
    },
    onStartTurn: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
      if (actorIsImmuneToPoisonOrPoisoned(actor)) return;
      const total = await rollSave(actor, tokenDoc, "con", dc);
      if (total < dc) {
        await RULES["stinking-cloud"]._applyNauseated({ actor, tokenDoc, regionDoc });
        ui.notifications.info(`🤢 ${actor.name} est pris de haut-le-cœur : il perd son action ce tour (Nuage nauséabond).`);
      } else {
        // On success, ensure we clear any lingering effect from previous rounds
        await removeEffectKind(actor, "stinking-nauseated", regionDoc.id);
      }
    },
    onExit: async ({ actor, regionDoc }) => {
      await removeEffectKind(actor, "stinking-nauseated", regionDoc.id);
    },
    cleanupEffects: ["stinking-nauseated"]
  }
,

"spike-growth": {
  label: "Croissance d’épines",
  allowMissingDC: true,

  // Spike Growth: we rely on a core Region Behavior ("Execute Script") for movement damage.
  // This is much more reliable for drag movement in FVTT v13 because the Region event payload
  // contains the full movement waypoints.
  buildBehaviors: () => ([
    {
      name: "Terrain difficile — Croissance d’épines",
      type: "dnd5e.difficultTerrain",
      system: { magical: true, types: [], ignoredDispositions: [] },
      flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "spike-growth-difficult-terrain" } } }
    },
    {
      name: "Dégâts — Croissance d’épines",
      type: "executeScript",
      system: {
        events: [CONST.REGION_EVENTS.TOKEN_MOVE_IN, CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN],
        source: SPIKE_GROWTH_SCRIPT_SOURCE
      },
      flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "spike-growth-script" } } }
    }
  ])
},

"insect-plague": {
  label: "Fléau d’insectes",
  behaviorLabel: "Terrain difficile — Fléau d’insectes",
  allowMissingDC: false,
  moveThrottle: "default",
  _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel }) => {
    if (!actor || !regionDoc || !isActiveGM()) return;
    const total = await rollSave(actor, tokenDoc, "con", dc);
    const dice = Math.max(4, 4 + Math.max(0, (Number(castLevel ?? 0) || 0) - 5)); // +1d10 per slot above 5th
    const roll = await rollDamageToChat({
      actor,
      tokenDoc,
      formula: `${dice}d10`,
      damageType: "piercing",
      flavor: `Fléau d’insectes (DD ${dc})`
    });
    const dmg = (total < dc) ? roll.total : Math.floor(roll.total / 2);
    await applyDamage(actor, dmg, "piercing");
  },
  onCast: async (ctx) => { await RULES["insect-plague"]._affect(ctx); },
  onEnter: async (ctx) => { await RULES["insect-plague"]._affect(ctx); },
  onEndTurn: async (ctx) => { await RULES["insect-plague"]._affect(ctx); }
}
,
  
  "wall-of-fire": {
    label: "Mur de feu",
    _formula: ({ castLevel }) => {
      const L = Math.max(4, Number(castLevel ?? 4) || 4);
      const dice = 5 + Math.max(0, L - 4);
      return `${dice}d8`;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel, combat, _tag = "wall-of-fire" }) => {
      if (!actor || !regionDoc || !isActiveGM()) return;
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, _tag)) return;
      }
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const formula = RULES["wall-of-fire"]._formula({ castLevel });
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula,
        damageType: "fire",
        flavor: `Mur de feu — dégâts de feu (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "fire");
    },
    // Hot side only: no damage simply for entering the 3 m heated side.
    onEndTurn: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      await RULES["wall-of-fire"]._affect({ ...ctx, combat, _tag: "wall-of-fire-hot-end" });
    }
  },

  "wall-of-fire-wall": {
    label: "Mur de feu",
    _affect: async (ctx) => {
      await RULES["wall-of-fire"]._affect({ ...ctx, _tag: ctx?._tag ?? "wall-of-fire-wall" });
    },
    isInside: (tokenDoc, regionDoc) => isTokenInsideWallOfFireCore(tokenDoc, regionDoc),
    onEnter: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      if (combat?.started) {
        const curTokenId = combat?.combatant?.tokenId ?? combat?.combatant?.token?.id ?? combat?.combatant?.token?.document?.id ?? null;
        if (curTokenId && ctx?.tokenDoc?.id && curTokenId !== ctx.tokenDoc.id) return;
      }
      if (!isTokenInsideWallOfFireCore(ctx?.tokenDoc, ctx?.regionDoc)) return;
      await RULES["wall-of-fire-wall"]._affect({ ...ctx, combat, _tag: "wall-of-fire-wall-enter" });
    },
    onEndTurn: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      if (!isTokenInsideWallOfFireCore(ctx?.tokenDoc, ctx?.regionDoc)) return;
      await RULES["wall-of-fire-wall"]._affect({ ...ctx, combat, _tag: "wall-of-fire-wall-end" });
    }
  },

  "blade-barrier": {
    label: "Barrière de lames",
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel, combat, _tag = "blade-barrier" }) => {
      // Dégâts quand la créature commence son tour dans la zone,
      // et la première fois qu’elle y entre pendant SON tour.
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, _tag)) return;
      }
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: "6d10",
        damageType: "slashing",
        flavor: `Barrière de lames — dégâts tranchants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "slashing");
    },
    onEnter: async (ctx) => {
      // En combat : seulement si le token entre pendant SON tour.
      const combat = ctx?.combat ?? game?.combat ?? null;
      if (combat?.started) {
        const curTokenId = combat?.combatant?.tokenId ?? combat?.combatant?.token?.id ?? combat?.combatant?.token?.document?.id ?? null;
        if (curTokenId && ctx?.tokenDoc?.id && curTokenId !== ctx.tokenDoc.id) return;
      }
      await RULES["blade-barrier"]._affect({ ...ctx, combat, _tag: "blade-barrier-enter" });
    },
    onStartTurn: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      await RULES["blade-barrier"]._affect({ ...ctx, combat, _tag: "blade-barrier-start" });
    }
  },

  "wall-of-thorns": {
    label: "Mur d’épines",
    buildBehaviors: () => {
      // RAW the wall costs 4 feet of movement for every 1 foot traveled through it.
      // Stacking two difficult-terrain behaviors is the closest reliable core implementation
      // we can do with Regions without taking control of token movement itself.
      return [
        {
          name: "Terrain difficile — Mur d’épines (1/2)",
          type: "dnd5e.difficultTerrain",
          system: { magical: true, types: [], ignoredDispositions: [] },
          flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "wall-of-thorns-difficult-terrain-a" } } }
        },
        {
          name: "Terrain difficile — Mur d’épines (2/2)",
          type: "dnd5e.difficultTerrain",
          system: { magical: true, types: [], ignoredDispositions: [] },
          flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "wall-of-thorns-difficult-terrain-b" } } }
        }
      ];
    },
    _formula: ({ castLevel }) => {
      const L = Math.max(6, Number(castLevel ?? 6) || 6);
      const dice = 7 + Math.max(0, L - 6);
      return `${dice}d8`;
    },
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel, combat, _tag = "wall-of-thorns" }) => {
      if (!actor || !regionDoc || !isActiveGM()) return;
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, _tag)) return;
      }
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: RULES["wall-of-thorns"]._formula({ castLevel }),
        damageType: "piercing",
        flavor: `Mur d’épines — dégâts perforants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "piercing");
    },
    onEnter: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      if (combat?.started) {
        const curTokenId = combat?.combatant?.tokenId ?? combat?.combatant?.token?.id ?? combat?.combatant?.token?.document?.id ?? null;
        if (curTokenId && ctx?.tokenDoc?.id && curTokenId !== ctx.tokenDoc.id) return;
      }
      await RULES["wall-of-thorns"]._affect({ ...ctx, combat, _tag: "wall-of-thorns-enter" });
    },
    onEndTurn: async (ctx) => {
      const combat = ctx?.combat ?? game?.combat ?? null;
      await RULES["wall-of-thorns"]._affect({ ...ctx, combat, _tag: "wall-of-thorns-end" });
    }
  },

  "wall-of-light": {
    label: "Mur de lumière",
    allowMissingDC: true,
    _formula: ({ castLevel }) => {
      const L = Math.max(5, Number(castLevel ?? 5) || 5);
      const dice = 4 + Math.max(0, L - 5);
      return `${dice}d8`;
    },
    onEndTurn: async ({ actor, tokenDoc, regionDoc, castLevel, combat }) => {
      if (!actor || !regionDoc || !isActiveGM()) return;
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "wall-of-light-end")) return;
      }
      const roll = await rollDamageToChat({
        actor, tokenDoc,
        formula: RULES["wall-of-light"]._formula({ castLevel }),
        damageType: "radiant",
        flavor: `Mur de lumière — dégâts radiants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      await applyDamage(actor, raw, "radiant");
    }
  },

  "wall-of-force": {
    label: "Mur de force",
    allowMissingDC: true
  },

  "wall-of-ice": {
    label: "Mur de glace",
    allowMissingDC: true
  },

  "wall-of-stone": {
    label: "Mur de pierre",
    allowMissingDC: true
  },

  "wall-of-sand": {
    label: "Mur de sable",
    behaviorLabel: "Terrain difficile — Mur de sable",
    allowMissingDC: true,
    onCast: async ({ actor, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Mur de sable — Aveuglé", kind: "wall-of-sand-blinded" });
    },
    onEnter: async ({ actor, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Mur de sable — Aveuglé", kind: "wall-of-sand-blinded" });
    },
    onStartTurn: async ({ actor, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Mur de sable — Aveuglé", kind: "wall-of-sand-blinded" });
    },
    onExit: async ({ actor, regionDoc }) => {
      await removeEffectKind(actor, "wall-of-sand-blinded", regionDoc.id);
    },
    cleanupEffects: ["wall-of-sand-blinded"]
  },

  "wall-of-wind": {
    label: "Mur de vent",
    allowMissingDC: true
  },

  "wall-of-water": {
    label: "Mur d’eau",
    behaviorLabel: "Terrain difficile — Mur d’eau",
    allowMissingDC: true
  },

  "prismatic-wall": {
    label: "Mur prismatique",
    allowMissingDC: true
  },

  "prismatic-wall-aura": {
    label: "Mur prismatique",
    allowMissingDC: true,
    _tryBlind: async ({ actor, tokenDoc, regionDoc, dc, combat, _tag = "prismatic-wall-blind" }) => {
      if (!actor || !regionDoc || actorHasConditionImmunity(actor, "blinded")) return;
      if (actorHasEffect(actor, "prismatic-wall-blinded", regionDoc.id)) return;
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, _tag)) return;
      }
      if (!dc) return;
      const total = await rollSave(actor, tokenDoc, "con", dc);
      if (total < dc) {
        await applyBlinded(actor, regionDoc, { label: `Mur prismatique — Aveuglé (DD ${dc})`, kind: "prismatic-wall-blinded" });
      }
    },
    onCast: async (ctx) => { await RULES["prismatic-wall-aura"]._tryBlind({ ...ctx, _tag: "prismatic-wall-cast" }); },
    onEnter: async (ctx) => { await RULES["prismatic-wall-aura"]._tryBlind({ ...ctx, _tag: "prismatic-wall-enter" }); },
    onStartTurn: async (ctx) => { await RULES["prismatic-wall-aura"]._tryBlind({ ...ctx, _tag: "prismatic-wall-start" }); }
  },

  "storm-sphere": {
    label: "Sphère de tempête",
    behaviorLabel: "Terrain difficile — Sphère de tempête",
    _affect: async ({ actor, tokenDoc, regionDoc, dc, castLevel, combat }) => {
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "storm-sphere")) return;
      }
      const total = await rollSave(actor, tokenDoc, "str", dc);
      const roll = await rollDamageToChat({
        actor,
        tokenDoc,
        formula: "2d6",
        damageType: "bludgeoning",
        flavor: `Sphère de tempête — dégâts contondants (${actor.name})`
      });
      const raw = Number(roll.total ?? 0) || 0;
      const dmg = (total < dc) ? raw : Math.floor(raw / 2);
      await applyDamage(actor, dmg, "bludgeoning");
    },
    onCast: async (ctx) => { await RULES["storm-sphere"]._affect(ctx); },
    onEndTurn: async (ctx) => { await RULES["storm-sphere"]._affect(ctx); }
  },

  "sleet-storm": {
    label: "Tempête de neige",
    behaviorLabel: "Terrain difficile — Tempête de neige",
    _applyObscured: async ({ actor, tokenDoc, regionDoc }) => {
      if (actorHasConditionImmunity(actor, "blinded")) return;
      await applyBlinded(actor, regionDoc, { label: "Tempête de neige — Aveuglé (obscurité totale)", kind: "sleet-blinded" });
    },
    _tryTrip: async ({ actor, tokenDoc, regionDoc, dc, combat }) => {
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "sleet-storm-trip")) return;
      }
      const total = await rollSave(actor, tokenDoc, "dex", dc);
      if (total < dc) {
        await applyProne(actor, regionDoc, { label: `Tempête de neige — À terre (DD ${dc})`, kind: "sleet-prone" });
      }
    },
    _tryConcentration: async ({ actor, tokenDoc, regionDoc, dc, combat }) => {
      // RAW: If a creature is concentrating in the storm, it must make a CON save against your spell DC at the start of its turn.
      // On a failed save, it loses concentration.
      if (!actorIsConcentrating(actor)) return;
      if (combat?.started && tokenDoc?.id && regionDoc?.id) {
        if (!touchTurnCache(regionDoc.id, tokenDoc.id, combat, "sleet-storm-conc")) return;
      }
      const total = await rollSave(actor, tokenDoc, "con", dc);
      if (total < dc) {
        await endActorConcentration(actor, tokenDoc, { reason: `Tempête de neige (DD ${dc})` });
      }
    },
    onCast: async (ctx) => { await RULES["sleet-storm"]._applyObscured(ctx); },
    onEnter: async (ctx) => {
      await RULES["sleet-storm"]._applyObscured(ctx);
      await RULES["sleet-storm"]._tryTrip(ctx);
    },
    onStartTurn: async (ctx) => {
      await RULES["sleet-storm"]._tryTrip(ctx);
      await RULES["sleet-storm"]._tryConcentration(ctx);
    },
    onExit: async ({ actor, regionDoc }) => {
      await removeEffectKind(actor, "sleet-blinded", regionDoc.id);
    },
    cleanupEffects: ["sleet-blinded"]
  }


};

// ---------------------------------------------------------------------------
// Region creation / cleanup
// ---------------------------------------------------------------------------

function iterEpiRegions(scene) {
  const regs = scene?.regions;
  if (!regs) return [];
  return Array.from(regs).filter(r => {
    const f = getEpiData(r) ?? {};
    return !!RULES[f.kind];
  });
}

async function createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey, shapesOverride = null } = {}) {
  const scene = templateDoc?.parent;
  if (!scene || !isActiveGM()) return null;

  const rule = RULES[ruleKey];
  if (!rule) return null;

  const dc = getSpellDC(caster, item);
  if (!dc && !rule.allowMissingDC) {
    console.warn(`[${MODULE_ID}] Region: missing spell DC`, { ruleKey, caster: caster?.name, item: item?.name });
    return null;
  }

  const wallOfFireVariant = (item?.flags?.[MODULE_ID]?.wallOfFireVariant ?? item?.flags?.["encounterplus-importer"]?.wallOfFireVariant ?? null);
  const shapes = Array.isArray(shapesOverride) && shapesOverride.length ? shapesOverride : templateToRegionShapes(templateDoc, ruleKey, { wallOfFireVariant });
  if (!shapes.length) {
    console.warn(`[${MODULE_ID}] Region: template->shapes conversion returned empty`, { templateId: templateDoc?.id, t: templateDoc?.t, ruleKey });
    return null;
  }

  const castLevel = getCastLevel(item, templateDoc);
  const casterTokenDoc = (canvas?.tokens?.placeables ?? []).find(t => t?.document?.actor?.uuid === caster?.uuid)?.document ?? null;
  const casterDisposition = Number(casterTokenDoc?.disposition ?? 0) || 0;

  const flags = {
    [FLAG_SCOPE]: {
      [FLAG_KEY]: {
        kind: ruleKey,
        templateId: templateDoc.id,
        templateUuid: templateDoc.uuid,
        itemUuid: item?.uuid ?? getTemplateItemUuid(templateDoc) ?? null,
        casterUuid: caster?.uuid ?? null,
        casterDisposition,
        dc: dc || null,
        castLevel: castLevel || null,
        hazard: (item?.flags?.[MODULE_ID]?.regionMeta?.hazard ?? null),
        wallOfFireVariant: (item?.flags?.[MODULE_ID]?.wallOfFireVariant ?? item?.flags?.["encounterplus-importer"]?.wallOfFireVariant ?? null)
      }
    }
  };

  const name = `${rule.label} (${caster?.name ?? ""})`.trim();

  let behaviors = [];
  if (typeof rule.buildBehaviors === "function") {
    behaviors = rule.buildBehaviors({ caster, item, templateDoc, casterDisposition }) ?? [];
  } else if (rule.behaviorLabel) {
    behaviors = [{
      name: rule.behaviorLabel,
      type: "dnd5e.difficultTerrain",
      system: { magical: true, types: [], ignoredDispositions: rule.ignoredDispositions ?? [] },
      flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: `${ruleKey}-difficult-terrain` } } }
    }];
  }

  const created = await scene.createEmbeddedDocuments("Region", [{
    name,
    shapes,
    behaviors,
    flags
  }]);

  const region = Array.isArray(created) ? created[0] : null;
  if (!region) return null;

  try {
    const combat = game?.combat ?? null;
    for (const tok of canvas?.tokens?.placeables ?? []) {
      const td = tok?.document;
      const a = td?.actor;
      if (!td || !a) continue;
      if (!isTokenInsideRegionForRule(td, region, rule)) continue;
      INSIDE_CACHE.add(insideKey(td, region.id));
      if (rule.onCast) await rule.onCast({ actor: a, tokenDoc: td, regionDoc: region, dc, castLevel, combat });
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Region initial-in-area application failed`, e);
  }

  return region;
}

async function createRegionFromTemplate(templateDoc, { caster, item, ruleKey } = {}) {
  if (ruleKey === "wall-of-fire") {
    const hot = await createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey: "wall-of-fire" });
    const wall = await createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey: "wall-of-fire-wall" });
    return hot ?? wall ?? null;
  }
  if (ruleKey === "prismatic-wall") {
    const wall = await createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey: "prismatic-wall" });
    const aura = await createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey: "prismatic-wall-aura" });
    return wall ?? aura ?? null;
  }
  return createSingleRegionFromTemplate(templateDoc, { caster, item, ruleKey });
}



async function cleanupEffectsForRegion(regionDoc) {
  try {
    if (!isActiveGM() || !regionDoc) return;
    const kind = getEpiData(regionDoc)?.kind ?? null;
    const toRemove = RULES[kind]?.cleanupEffects ?? [];
    if (!toRemove.length) return;
    for (const tok of canvas?.tokens?.placeables ?? []) {
      const actor = tok?.document?.actor;
      if (!actor) continue;
      for (const effKind of toRemove) {
        await removeEffectKind(actor, effKind, regionDoc.id);
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Region effect cleanup failed`, e);
  }
}

function _getLinkedWallData(doc) {
  const f = doc?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? doc?.flags?.[LEGACY_SCOPE]?.[FLAG_KEY] ?? null;
  return f?.linkedWalls ?? [];
}

function _getLinkedLightData(doc) {
  const f = doc?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? doc?.flags?.[LEGACY_SCOPE]?.[FLAG_KEY] ?? null;
  return f?.linkedLights ?? [];
}

async function cleanupLinkedLightsBySelectors({ scene = null, templateId = null, templateUuid = null, itemUuid = null, linkedRule = null } = {}) {
  try {
    if (!isActiveGM()) return;
    scene = scene ?? canvas?.scene ?? null;
    if (!scene) return;
    const wantTemplateId = templateId == null ? null : String(templateId);
    const wantTemplateUuid = templateUuid == null ? null : String(templateUuid);
    const wantItemUuid = itemUuid == null ? null : String(itemUuid);
    const wantRule = linkedRule == null ? null : String(linkedRule).toLowerCase();
    const toDelete = Array.from(scene.lights ?? []).filter(l => {
      const f = l?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? l?.flags?.[LEGACY_SCOPE]?.[FLAG_KEY] ?? null;
      if (!f || String(f.kind ?? '') !== 'linked-template-light') return false;
      if (wantRule && String(f.linkedRule ?? '').toLowerCase() !== wantRule) return false;
      if (wantTemplateId && String(f.templateId ?? '') === wantTemplateId) return true;
      if (wantTemplateUuid && String(f.templateUuid ?? '') === wantTemplateUuid) return true;
      if (wantItemUuid && String(f.itemUuid ?? '') === wantItemUuid) return true;
      return false;
    }).map(l => String(l?.id ?? '')).filter(Boolean);
    if (toDelete.length) await scene.deleteEmbeddedDocuments('AmbientLight', toDelete).catch(() => {});
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked light selector cleanup failed`, e);
  }
}

function _buildLinkedTemplateLights(templateDoc, ruleKey = null) {
  try {
    const rk = String(ruleKey ?? '').toLowerCase();
    if (!["wall-of-light", "flaming-sphere", "moonbeam"].includes(rk)) return [];
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene) return [];
    const unitsPerGrid = Number(scene?.grid?.distance ?? 5) || 5;
    const pxPerGrid = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 100) || 100;
    const toPx = (distUnits) => ((Number(distUnits ?? 0) || 0) / unitsPerGrid) * pxPerGrid;
    const t = String(templateDoc?.t ?? '').toLowerCase();
    let x = Number(templateDoc?.x ?? 0) || 0;
    let y = Number(templateDoc?.y ?? 0) || 0;
    if (t === 'ray') {
      const len = toPx(templateDoc?.distance ?? 0);
      const dir = (Number(templateDoc?.direction ?? 0) || 0) * Math.PI / 180;
      x = x + Math.cos(dir) * (len / 2);
      y = y + Math.sin(dir) * (len / 2);
    }
    let bright = unitsPerGrid === 1.5 ? 18 : 60;
    let dim = unitsPerGrid === 1.5 ? 36 : 120;
    let color = '#fff4b0';
    let alpha = 0.15;
    let luminosity = 0.5;
    if (rk === 'flaming-sphere') {
      bright = unitsPerGrid === 1.5 ? 6 : 20;
      dim = unitsPerGrid === 1.5 ? 12 : 40;
      color = '#ffb347';
      alpha = 0.2;
      luminosity = 0.4;
    } else if (rk === 'moonbeam') {
      bright = unitsPerGrid === 1.5 ? 3 : 10;
      dim = unitsPerGrid === 1.5 ? 6 : 20;
      color = '#cfe8ff';
      alpha = 0.12;
      luminosity = 0.35;
    }
    return [{
      x, y,
      rotation: 0,
      walls: false,
      vision: false,
      hidden: false,
      config: {
        alpha,
        angle: 360,
        bright,
        dim,
        coloration: 1,
        luminosity,
        attenuation: 0.5,
        saturation: 0,
        contrast: 0,
        shadows: 0,
        color,
        darkness: { min: 0, max: 1 },
        animation: { type: null, speed: 1, intensity: 1 }
      },
      flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: 'linked-template-light' } } }
    }];
  } catch (_e) {}
  return [];
}

async function syncLinkedLightsForTemplate(templateDoc, item = null, ruleKey = null) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene) return;
    const rk = String((ruleKey ?? (item ? getRuleFromItem(item) : '')) ?? '').toLowerCase();
    const linked = _getLinkedLightData(templateDoc).map(w => String(w?.id ?? w)).filter(Boolean);
    if (linked.length) {
      const existingIds = linked.filter(id => scene.lights?.get?.(id));
      if (existingIds.length) await scene.deleteEmbeddedDocuments('AmbientLight', existingIds).catch(() => {});
    }
    await cleanupLinkedLightsBySelectors({
      scene,
      templateId: templateDoc?.id ?? null,
      templateUuid: templateDoc?.uuid ?? null,
      linkedRule: rk || null
    });
    const lightData = _buildLinkedTemplateLights(templateDoc, rk);
    if (!lightData.length) {
      if (linked.length) await templateDoc.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.linkedLights`]: [] }).catch(() => {});
      return;
    }
    const itemUuid = item?.uuid ?? getTemplateItemUuid(templateDoc) ?? null;
    for (const l of lightData) {
      l.flags[FLAG_SCOPE][FLAG_KEY].templateId = templateDoc.id;
      l.flags[FLAG_SCOPE][FLAG_KEY].templateUuid = templateDoc.uuid;
      l.flags[FLAG_SCOPE][FLAG_KEY].itemUuid = itemUuid;
      l.flags[FLAG_SCOPE][FLAG_KEY].linkedRule = rk;
    }
    const created = await scene.createEmbeddedDocuments('AmbientLight', lightData);
    const ids = (Array.isArray(created) ? created : []).map(l => ({ id: String(l?.id ?? '') })).filter(l => l.id);
    await templateDoc.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.linkedLights`]: ids }).catch(() => {});
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked light sync failed`, e);
  }
}

async function cleanupLinkedLightsForTemplate(templateDoc) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene) return;
    const linked = _getLinkedLightData(templateDoc).map(w => String(w?.id ?? w)).filter(Boolean);
    const directDelete = linked.length ? linked.filter(id => scene.lights?.get?.(id)) : [];
    if (directDelete.length) await scene.deleteEmbeddedDocuments('AmbientLight', directDelete).catch(() => {});
    await cleanupLinkedLightsBySelectors({
      scene,
      templateId: templateDoc?.id ?? null,
      templateUuid: templateDoc?.uuid ?? null,
      itemUuid: getTemplateItemUuid(templateDoc) ?? null,
      linkedRule: null
    });
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked light cleanup failed`, e);
  }
}

function _makeLinkedWallData(c, mode = "sight") {
  const m = String(mode ?? "sight").toLowerCase();
  const isSight = m === "sight" || m === "sight-move" || m === "move-sight" || m === "both";
  const isMove = m === "move" || m === "sight-move" || m === "move-sight" || m === "both";
  return {
    c,
    move: isMove ? 20 : 0,
    sight: isSight ? 20 : 0,
    light: isSight ? 20 : 0,
    sound: 0,
    door: 0,
    ds: 0,
    flags: { [FLAG_SCOPE]: { [FLAG_KEY]: { kind: "linked-template-wall", wallMode: m } } }
  };
}

function _buildLinkedTemplateWalls(templateDoc, mode = "sight") {
  try {
    const t = String(templateDoc?.t ?? "").toLowerCase();
    const scene = templateDoc?.parent ?? canvas?.scene;
    const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 0) || 0;
    const gridDist = Number(scene?.grid?.distance ?? 0) || 0;
    const toPx = (distUnits) => {
      const d = Number(distUnits ?? 0) || 0;
      if (!d || !gridSize || !gridDist) return 0;
      return (d / gridDist) * gridSize;
    };
    if (t === "ray") {
      const len = toPx(templateDoc?.distance ?? 0);
      if (!len) return [];
      const ox = Number(templateDoc?.x ?? 0) || 0;
      const oy = Number(templateDoc?.y ?? 0) || 0;
      const dir = Number(templateDoc?.direction ?? 0) || 0;
      const ang = (dir * Math.PI) / 180;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const ex = ox + dx * len;
      const ey = oy + dy * len;
      return [_makeLinkedWallData([ox, oy, ex, ey], mode)];
    }
    if (t === "circle") {
      const cx = Number(templateDoc?.x ?? 0) || 0;
      const cy = Number(templateDoc?.y ?? 0) || 0;
      const radiusPx = toPx(templateDoc?.distance ?? templateDoc?.radius ?? 0);
      if (!radiusPx) return [];
      const oneCellPx = gridSize || toPx(gridDist) || 0;
      const wallThicknessPx = oneCellPx || Math.max(8, radiusPx * 0.15);
      const centerRadius = Math.max(4, radiusPx - (wallThicknessPx / 2));
      const count = 32;
      const walls = [];
      for (let i = 0; i < count; i += 1) {
        const a0 = (i / count) * Math.PI * 2;
        const a1 = ((i + 1) / count) * Math.PI * 2;
        walls.push(_makeLinkedWallData([
          cx + Math.cos(a0) * centerRadius,
          cy + Math.sin(a0) * centerRadius,
          cx + Math.cos(a1) * centerRadius,
          cy + Math.sin(a1) * centerRadius
        ], mode));
      }
      return walls;
    }
  } catch {}
  return [];
}

async function syncLinkedWallsForTemplate(templateDoc, item = null, ruleKey = null) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene) return;
    const rk = String((ruleKey ?? (item ? getRuleFromItem(item) : "")) ?? "").toLowerCase();
    const linked = _getLinkedWallData(templateDoc).map(w => String(w?.id ?? w)).filter(Boolean);
    if (linked.length) {
      const existingIds = linked.filter(id => scene.walls?.get?.(id));
      if (existingIds.length) await scene.deleteEmbeddedDocuments("Wall", existingIds).catch(() => {});
    }
    const linkedModes = {
      "wall-of-thorns": "sight",
      "wall-of-light": "sight",
      "wall-of-force": "move",
      "wall-of-ice": "both",
      "wall-of-stone": "both",
      "wall-of-sand": "sight",
      "prismatic-wall": "both"
    };
    const wallMode = linkedModes[rk] ?? null;
    if (!wallMode) {
      if (linked.length) {
        await templateDoc.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.linkedWalls`]: [] }).catch(() => {});
      }
      return;
    }
    const wallData = _buildLinkedTemplateWalls(templateDoc, wallMode);
    if (!wallData.length) {
      await templateDoc.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.linkedWalls`]: [] }).catch(() => {});
      return;
    }
    const itemUuid = item?.uuid ?? getTemplateItemUuid(templateDoc) ?? null;
    for (const w of wallData) {
      w.flags[FLAG_SCOPE][FLAG_KEY].templateId = templateDoc.id;
      w.flags[FLAG_SCOPE][FLAG_KEY].templateUuid = templateDoc.uuid;
      w.flags[FLAG_SCOPE][FLAG_KEY].itemUuid = itemUuid;
      w.flags[FLAG_SCOPE][FLAG_KEY].linkedRule = rk;
    }
    const created = await scene.createEmbeddedDocuments("Wall", wallData);
    const ids = (Array.isArray(created) ? created : []).map(w => ({ id: String(w?.id ?? "") })).filter(w => w.id);
    await templateDoc.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.linkedWalls`]: ids }).catch(() => {});
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked wall sync failed`, e);
  }
}

async function cleanupLinkedWallsBySelectors({ scene = null, templateId = null, templateUuid = null, itemUuid = null, linkedRule = null } = {}) {
  try {
    if (!isActiveGM()) return;
    scene = scene ?? canvas?.scene ?? null;
    if (!scene) return;
    const wantTemplateId = String(templateId ?? "");
    const wantTemplateUuid = String(templateUuid ?? "");
    const wantItemUuid = String(itemUuid ?? "");
    const wantRule = String(linkedRule ?? "").toLowerCase();
    const toDelete = Array.from(scene.walls ?? []).filter(w => {
      const f = w?.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? w?.flags?.[LEGACY_SCOPE]?.[FLAG_KEY] ?? null;
      if (!f) return false;
      if (!["linked-sight-wall", "linked-template-wall"].includes(String(f.kind ?? ""))) return false;
      if (wantRule && String(f.linkedRule ?? "").toLowerCase() !== wantRule) return false;
      if (wantTemplateId && String(f.templateId ?? "") === wantTemplateId) return true;
      if (wantTemplateUuid && String(f.templateUuid ?? "") === wantTemplateUuid) return true;
      if (wantItemUuid && String(f.itemUuid ?? "") === wantItemUuid) return true;
      return false;
    }).map(w => String(w?.id ?? "")).filter(Boolean);
    if (toDelete.length) await scene.deleteEmbeddedDocuments("Wall", toDelete).catch(() => {});
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked wall selector cleanup failed`, e);
  }
}

async function cleanupLinkedWallsForTemplate(templateDoc) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene) return;
    const linked = _getLinkedWallData(templateDoc).map(w => String(w?.id ?? w)).filter(Boolean);
    const directDelete = linked.length
      ? linked.filter(id => scene.walls?.get?.(id))
      : [];
    if (directDelete.length) await scene.deleteEmbeddedDocuments("Wall", directDelete).catch(() => {});

    await cleanupLinkedWallsBySelectors({
      scene,
      templateId: templateDoc?.id ?? null,
      templateUuid: templateDoc?.uuid ?? null,
      itemUuid: getTemplateItemUuid(templateDoc) ?? null,
      linkedRule: null
    });
  } catch (e) {
    console.warn(`[${MODULE_ID}] Linked wall cleanup failed`, e);
  }
}

async function cleanupRegionsForTemplate(templateDoc) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent;
    if (!scene) return;
    await cleanupLinkedWallsForTemplate(templateDoc);
    await cleanupLinkedLightsForTemplate(templateDoc);

    const regions = iterEpiRegions(scene).filter(r => (getEpiData(r)?.templateId === templateDoc.id));
    if (!regions.length) return;
// Remove linked effects for these regions.
for (const r of regions) {
  await cleanupEffectsForRegion(r);
}

await scene.deleteEmbeddedDocuments("Region", regions.map(r => r.id));
    for (const r of regions) {
      for (const key of Array.from(INSIDE_CACHE)) {
        if (String(key).endsWith(`|${r.id}`)) INSIDE_CACHE.delete(key);
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Region cleanup failed`, e);
  }
}

function _effectLooksConcentration(effect) {
  try {
    const statusId = CONFIG?.specialStatusEffects?.CONCENTRATING ?? "concentrating";
    const statuses = effect?.statuses;
    if ((statuses?.has?.(statusId)) || (Array.isArray(statuses) && statuses.includes(statusId))) return true;
    const nm = String(effect?.name ?? effect?.label ?? "").toLowerCase();
    if (/concentration|concentrat|concentration/i.test(nm)) return true;
  } catch {}
  return false;
}

async function cleanupRegionsOnConcentrationEnd(effect) {
  try {
    if (!isActiveGM()) return;
    if (!_effectLooksConcentration(effect)) return;

    const itemUuid = effect?.origin ?? effect?.flags?.dnd5e?.concentration?.itemUuid ?? null;
    const actor = effect?.parent ?? null;
    const scene = canvas?.scene ?? null;
    if (!scene) return;

    const regions = iterEpiRegions(scene).filter(r => {
      const f = getEpiData(r) ?? {};
      const itemMatch = itemUuid ? (f?.itemUuid === itemUuid) : !!f?.casterUuid;
      const casterMatch = (!f?.casterUuid || (actor?.uuid && f.casterUuid === actor.uuid));
      return itemMatch && casterMatch;
    });

    // Always attempt linked wall/light cleanup, even if the region/template is already gone.
    await cleanupLinkedWallsBySelectors({ scene, itemUuid, linkedRule: null });
    await cleanupLinkedLightsBySelectors({ scene, itemUuid, linkedRule: null });

    if (!regions.length) return;
    // Remove effects for these regions.
    for (const r of regions) {
      await cleanupEffectsForRegion(r);
    }

    // Delete template (if still present) then delete regions.
    for (const r of regions) {
      const tplId = getEpiData(r)?.templateId ?? null;
      const tpl = tplId ? (scene.templates?.get?.(tplId) ?? null) : null;
      if (tpl) {
        await cleanupLinkedWallsForTemplate(tpl);
        await tpl.delete();
      } else {
        await cleanupLinkedWallsBySelectors({
          scene,
          templateId: tplId ?? null,
          itemUuid: getEpiData(r)?.itemUuid ?? itemUuid ?? null,
          linkedRule: null
        });
      }
    }
    await scene.deleteEmbeddedDocuments("Region", regions.map(r => r.id));
  } catch (e) {
    console.warn(`[${MODULE_ID}] Region concentration cleanup failed`, e);
  }
}


const TPL_REFRESH_THROTTLE = globalThis.__EPI_TPL_REFRESH_THROTTLE ?? (globalThis.__EPI_TPL_REFRESH_THROTTLE = new Map());
function _throttleTemplateRefresh(templateId, ms = 150) {
  try {
    const id = String(templateId ?? "");
    if (!id) return false;
    const now = Date.now();
    const last = Number(TPL_REFRESH_THROTTLE.get(id) ?? 0) || 0;
    if (now - last < ms) return false;
    TPL_REFRESH_THROTTLE.set(id, now);
    return true;
  } catch {
    return true;
  }
}


function _getWallOfFireVariantForTemplateItem(item) {
  try {
    return String(item?.flags?.[MODULE_ID]?.wallOfFireVariant ?? item?.flags?.["encounterplus-importer"]?.wallOfFireVariant ?? "").toLowerCase();
  } catch {
    return "";
  }
}

async function hideWallOfFireRingTemplate(templateDoc, item = null, ruleKey = null) {
  try {
    const rk = String(ruleKey ?? getRuleFromItem(item) ?? "").toLowerCase();
    if (rk !== "wall-of-fire") return;
    const wallVariant = _getWallOfFireVariantForTemplateItem(item);
    if (!wallVariant.startsWith("ring-")) return;

    // Persist the hidden state on the document.
    if (!templateDoc.hidden) {
      await templateDoc.update({ hidden: true });
    }

    // Also force-hide the rendered object; on some scenes the measured template
    // disk can remain visible until the canvas redraw catches up.
    const obj = templateDoc.object ?? canvas?.templates?.get?.(templateDoc.id) ?? null;
    if (obj) {
      try { obj.visible = false; } catch {}
      try { obj.renderable = false; } catch {}
      try { obj.alpha = 0; } catch {}
      try { obj.refresh?.(); } catch {}
      try { obj.renderFlags?.set?.({ refresh: true }); } catch {}
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Wall of Fire template hide failed`, e);
  }
}

async function updateRegionsForTemplate(templateDoc, changed, { force = false } = {}) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent;
    if (!scene) return;

    const keys = ["x","y","t","distance","width","direction","angle","fillColor","borderColor"];
    if (!force && !keys.some(k => (changed && Object.prototype.hasOwnProperty.call(changed, k)))) return;

    const regions = iterEpiRegions(scene).filter(r => (getEpiData(r)?.templateId === templateDoc.id));
    if (!regions.length) return;

    for (const region of regions) {
      const updated = scene.regions?.get?.(region.id) ?? region;
      const f = getEpiData(updated) ?? {};
      const ruleKey = f.kind;
      const rule = RULES[ruleKey];
      if (!rule) continue;

      const newShapes = templateToRegionShapes(templateDoc, ruleKey, { wallOfFireVariant: f.wallOfFireVariant ?? null });
      if (!newShapes.length) continue;

      await region.update({ shapes: newShapes });
      const regionAfter = scene.regions?.get?.(region.id) ?? region;
      const dc = Number(f.dc ?? 0) || 0;
      const castLevel = Number(f.castLevel ?? 0) || 0;

      // Recompute enter/exit due to template movement
      for (const tok of canvas?.tokens?.placeables ?? []) {
        const td = tok?.document;
        const actor = td?.actor;
        if (!td || !actor) continue;
        const key = insideKey(td, regionAfter.id);
        const inside = isTokenInsideRegionForRule(td, regionAfter, rule);
        const wasInside = INSIDE_CACHE.has(key);

        if (inside) {
          INSIDE_CACHE.add(key);
          if (!wasInside && rule.onEnter && ruleKey !== "spike-growth") await rule.onEnter({ actor, tokenDoc: td, regionDoc: regionAfter, dc, castLevel });
        } else {
          INSIDE_CACHE.delete(key);
          if (wasInside && rule.onExit) await rule.onExit({ actor, tokenDoc: td, regionDoc: regionAfter, dc, castLevel });
        }
      }
    }

    try {
      const itemUuid = getTemplateItemUuid(templateDoc);
      const item = itemUuid ? await fromUuid(itemUuid).catch(() => null) : null;
      const itemRule = item ? getRuleFromItem(item) : null;
      await syncLinkedWallsForTemplate(templateDoc, item, itemRule);
      await syncLinkedLightsForTemplate(templateDoc, item, itemRule);
      await hideWallOfFireRingTemplate(templateDoc, item, itemRule);
    } catch (e) {
      console.warn(`[${MODULE_ID}] Wall/template linked refresh failed`, e);
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Template->Region update failed`, e);
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

async function maybeCreateRegionForTemplate(templateDoc) {
  try {
    if (!isActiveGM()) return;
    const scene = templateDoc?.parent;
    if (!scene) return;

    const itemUuid = getTemplateItemUuid(templateDoc);
    if (!itemUuid) return;

    const item = await fromUuid(itemUuid).catch(() => null);
    if (!item || item.type !== "spell") return;

    const ruleKey = getRuleFromItem(item);
    if (!ruleKey || !RULES[ruleKey]) return;

    const caster = item.actor ?? null;
    if (!caster) return;

    const existing = iterEpiRegions(scene).filter(r => getEpiData(r)?.templateId === templateDoc.id);
    if (ruleKey === "wall-of-fire") {
      const hasHot = existing.some(r => getEpiData(r)?.kind === "wall-of-fire");
      const hasWall = existing.some(r => getEpiData(r)?.kind === "wall-of-fire-wall");
      if (hasHot && hasWall) return;
      if (existing.length) await scene.deleteEmbeddedDocuments("Region", existing.map(r => r.id));
    } else if (existing.length) {
      return;
    }

    await createRegionFromTemplate(templateDoc, { caster, item, ruleKey });
    await syncLinkedWallsForTemplate(templateDoc, item, ruleKey);
    await syncLinkedLightsForTemplate(templateDoc, item, ruleKey);

    // Wall of Fire ring variants: hide the stock filled-circle measured template after
    // Regions are created so the user only sees the annular wall + hot-side regions.
    await hideWallOfFireRingTemplate(templateDoc, item, ruleKey);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Region creation failed`, e);
  }
}

function touchTurnCache(regionId, tokenId, combat, tag="") {
  const cid = combat?.id ?? "combat";
  const r = Number(combat?.round ?? 0) || 0;
  const t = Number(combat?.turn ?? 0) || 0;
  const key = `${cid}|${r}|${t}|${regionId}|${tokenId}|${tag}`;
  if (TURN_CACHE.has(key)) return false;
  TURN_CACHE.add(key);
  // prevent unbounded growth
  if (TURN_CACHE.size > 5000) {
    for (const k of Array.from(TURN_CACHE).slice(0, 2500)) TURN_CACHE.delete(k);
  }
  return true;
}

function touchMoveCache(regionId, tokenId, combat) {
  // Combat: one trigger per (current) combat turn
  if (combat?.started) {
    const cid = combat?.id ?? "combat";
    const r = Number(combat?.round ?? 0) || 0;
    const t = Number(combat?.turn ?? 0) || 0;
    const key = `${cid}|${r}|${t}|${regionId}|${tokenId}|move`;
    if (MOVE_CACHE.has(key)) return false;
    MOVE_CACHE.set(key, Date.now());
  } else {
    // No combat: throttle per token+region to avoid spam while dragging.
    const key = `${regionId}|${tokenId}`;
    const now = Date.now();
    const last = Number(MOVE_CACHE.get(key) ?? 0) || 0;
    if (now - last < 1500) return false;
    MOVE_CACHE.set(key, now);
  }
  // prevent unbounded growth
  if (MOVE_CACHE.size > 8000) {
    const keys = Array.from(MOVE_CACHE.keys());
    for (const k of keys.slice(0, 4000)) MOVE_CACHE.delete(k);
  }
  return true;
}

let _lastCombatTurn = null;

async function maybeRefineRingWallInitialTargets(templateDoc) {
  try {
    const scene = templateDoc?.parent ?? canvas?.scene ?? null;
    if (!scene || !canvas?.tokens) return;

    const itemUuid = getTemplateItemUuid(templateDoc);
    if (!itemUuid) return;
    const item = await fromUuid(itemUuid).catch(() => null);
    if (!item || item.type !== "spell") return;

    const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
    const name = String(item?.name ?? "").toLowerCase();
    const regionRule = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
    const isWallOfFire = regionRule === "wall-of-fire" || slug === "wall-of-fire" || /mur\s+de\s+feu|wall\s+of\s+fire/i.test(name);
    const isWallOfThorns = regionRule === "wall-of-thorns" || slug === "wall-of-thorns" || /mur\s+d[’']?epines|mur\s+d[’']?épines|wall\s+of\s+thorns/i.test(name);
    const isWallOfIce = regionRule === "wall-of-ice" || slug === "wall-of-ice" || /mur\s+de\s+glace|wall\s+of\s+ice/i.test(name);
    if (!isWallOfFire && !isWallOfThorns && !isWallOfIce) return;

    const isCircle = String(templateDoc?.t ?? "").toLowerCase() === "circle";
    if (!isCircle) return;

    let shapes = [];
    if (isWallOfFire) {
      const variant = String(item?.flags?.[MODULE_ID]?.wallOfFireVariant ?? item?.flags?.["encounterplus-importer"]?.wallOfFireVariant ?? "").toLowerCase();
      if (!variant.startsWith("ring-")) return;
      shapes = templateToRegionShapes(templateDoc, "wall-of-fire-wall", { wallOfFireVariant: variant });
    } else if (isWallOfThorns) {
      shapes = templateToRegionShapes(templateDoc, "wall-of-thorns");
    } else if (isWallOfIce) {
      const form = String(item?.flags?.[MODULE_ID]?.wallOfIceForm ?? item?.flags?.["encounterplus-importer"]?.wallOfIceForm ?? "").toLowerCase();
      if (form !== "sphere") return;
      shapes = templateToRegionShapes(templateDoc, "wall-of-ice");
    }
    if (!Array.isArray(shapes) || !shapes.length) return;
    const regionLike = _shapeToRegionDocLike(shapes);

    const validIds = (canvas?.tokens?.placeables ?? [])
      .filter(t => t?.actor && tokenIntersectsRegionAt({
        x: Number(t?.document?.x ?? 0) || 0,
        y: Number(t?.document?.y ?? 0) || 0,
        width: Number(t?.document?.width ?? 1) || 1,
        height: Number(t?.document?.height ?? 1) || 1
      }, regionLike))
      .map(t => String(t?.id ?? t?.document?.id ?? ""))
      .filter(Boolean);

    const applyTargets = async () => {
      try { game.user?.updateTokenTargets?.(validIds); } catch {}
      try {
        for (const tok of (canvas?.tokens?.placeables ?? [])) {
          const tid = String(tok?.id ?? tok?.document?.id ?? "");
          if (!tid) continue;
          const shouldTarget = validIds.includes(tid);
          try { await tok.setTarget(shouldTarget, { user: game.user, releaseOthers: false, groupSelection: true }); } catch {}
        }
      } catch {}
    };

    await applyTargets();
    setTimeout(() => { applyTargets().catch?.(() => {}); }, 0);
    setTimeout(() => { applyTargets().catch?.(() => {}); }, 35);
    setTimeout(() => { applyTargets().catch?.(() => {}); }, 120);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Ring wall initial target refine failed`, e);
  }
}

export function initWebRegions() {
  Hooks.on("createMeasuredTemplate", async (doc) => {
    try { await maybeRefineRingWallInitialTargets(doc); } catch {}
    await maybeCreateRegionForTemplate(doc);
    // Post-create sync: some placement workflows update template coordinates after creation.
    try {
      await updateRegionsForTemplate(doc, { _postCreate: true }, { force: true });
      setTimeout(() => { updateRegionsForTemplate(doc, { _postCreate: true }, { force: true }).catch(() => {}); }, 50);
      setTimeout(() => { updateRegionsForTemplate(doc, { _postCreate: true }, { force: true }).catch(() => {}); }, 250);
    } catch {
      // ignore
    }
  });

  Hooks.on("updateMeasuredTemplate", async (doc, changed) => {
    await updateRegionsForTemplate(doc, changed);
  });

  // Some template moves (dragging / certain system workflows) may not reliably emit update data
  // at the expected time. As a safety net, refresh events keep Regions in sync.
  Hooks.on("refreshMeasuredTemplate", async (obj) => {
    try {
      if (!isActiveGM()) return;
      const doc = obj?.document ?? obj;
      const id = doc?.id ?? obj?.id;
      if (!id) return;
      if (!_throttleTemplateRefresh(id)) return;
      await updateRegionsForTemplate(doc, { _refresh: true }, { force: true });
    } catch (e) {
      console.warn(`[${MODULE_ID}] refreshMeasuredTemplate handler failed`, e);
    }
  });

  Hooks.on("deleteMeasuredTemplate", async (doc) => {
    await cleanupRegionsForTemplate(doc);
  });

  Hooks.on("deleteRegion", async (regionDoc) => {
    try {
      if (!isActiveGM()) return;
      const kind = getEpiData(regionDoc)?.kind ?? null;
      if (!kind || !RULES[kind]) return;
      await cleanupEffectsForRegion(regionDoc);
      // purge inside cache entries for this region
      for (const key of Array.from(INSIDE_CACHE)) {
        if (String(key).endsWith(`|${regionDoc.id}`)) INSIDE_CACHE.delete(key);
      }
    } catch (e) {
      console.warn(`[${MODULE_ID}] Region delete handler failed`, e);
    }
  });

  Hooks.on("deleteActiveEffect", async (effect) => {
    await cleanupRegionsOnConcentrationEnd(effect);
  });

  Hooks.on("updateActiveEffect", async (effect, changed) => {
    try {
      const disabledNow = changed && Object.prototype.hasOwnProperty.call(changed, "disabled") && !!changed.disabled;
      const statusesChanged = !!(changed && Object.prototype.hasOwnProperty.call(changed, "statuses"));
      if (!disabledNow && !statusesChanged) return;
      await cleanupRegionsOnConcentrationEnd(effect);
    } catch (e) {
      console.warn(`[${MODULE_ID}] ActiveEffect update cleanup failed`, e);
    }
  });

  Hooks.on("canvasReady", () => {
    try {
      if (!isActiveGM()) return;
      const scene = canvas?.scene;
      if (!scene) return;
      for (const tok of scene.tokens ?? []) {
        const td = tok;
        if (!td?.uuid) continue;
        LAST_POS_CACHE.set(td.uuid, {
          x: Number(td.x ?? 0) || 0,
          y: Number(td.y ?? 0) || 0,
          width: Number(td.width ?? 1) || 1,
          height: Number(td.height ?? 1) || 1,
          t: Date.now()
        });
      }
    } catch (e) {
      console.warn(`[${MODULE_ID}] canvasReady seed failed`, e);
    }
  });

  // Capture previous token position so we can detect movement *within* regions.
  Hooks.on("preUpdateToken", (tokenDoc, changed) => {
    try {
      if (!isActiveGM()) return;
      if (!tokenDoc?.parent || tokenDoc.parent !== canvas?.scene) return;
      if (!("x" in changed) && !("y" in changed) && !("width" in changed) && !("height" in changed)) return;
      PREMOVE_CACHE.set(tokenDoc.uuid, {
        x: Number(tokenDoc.x ?? 0) || 0,
        y: Number(tokenDoc.y ?? 0) || 0,
        width: Number(tokenDoc.width ?? 1) || 1,
        height: Number(tokenDoc.height ?? 1) || 1,
        t: Date.now()
      });
    } catch {
      // ignore
    }
  });

  Hooks.on("updateToken", async (tokenDoc, changed) => {
    try {
      if (!isActiveGM()) return;
      if (!tokenDoc?.parent || tokenDoc.parent !== canvas?.scene) return;
      if (!("x" in changed) && !("y" in changed) && !("width" in changed) && !("height" in changed)) return;

      const prev = PREMOVE_CACHE.get(tokenDoc.uuid) ?? LAST_POS_CACHE.get(tokenDoc.uuid) ?? null;
      PREMOVE_CACHE.delete(tokenDoc.uuid);
      const moveInfo = computeMovementInfo(prev, tokenDoc);
      const movedPx = Number(moveInfo?.movedPx ?? 0) || 0;
      const movedUnits = Number(moveInfo?.movedUnits ?? 0) || 0;

      const actor = tokenDoc.actor;
      if (!actor) return;
      const scene = tokenDoc.parent;

      for (const region of iterEpiRegions(scene)) {
        const f = getEpiData(region) ?? {};
        const ruleKey = f.kind;
        const rule = RULES[ruleKey];
        if (!rule) continue;

        const dc = Number(f.dc ?? 0) || 0;
        const castLevel = Number(f.castLevel ?? 0) || 0;
        const key = insideKey(tokenDoc, region.id);
        const inside = isTokenInsideRegionForRule(tokenDoc, region, rule);
        const wasInside = INSIDE_CACHE.has(key);

        // Spike Growth is handled by a core Region Behavior ("Execute Script") attached to that Region.
        // We only keep the inside cache updated here for consistency.
        if (ruleKey === "spike-growth") {
          if (inside) INSIDE_CACHE.add(key);
          else INSIDE_CACHE.delete(key);
          continue;
        }


        if (inside) {
          INSIDE_CACHE.add(key);
          if (!wasInside && rule.onEnter) {
            dbg("Zone enter", { ruleKey, token: tokenDoc?.name, regionId: region.id });
            await rule.onEnter({ actor, tokenDoc, regionDoc: region, dc, castLevel, combat: game.combat, movedPx, movedUnits, moveInfo });
          }
          // Some spells trigger while moving within the region (not just crossing the boundary).
          if (wasInside && movedPx > 0.5 && rule.onMoveWithin) {
            let allow = true;
            // Some spells (e.g. Spike Growth) must trigger on every move segment in combat.
            if (rule.moveThrottle === "noneInCombat" && game.combat?.started) {
              allow = true;
            } else if (rule.moveThrottle === "none") {
              allow = true;
            } else {
              allow = touchMoveCache(region.id, tokenDoc.id, game.combat);
            }
            if (allow) {
              dbg("Zone moveWithin", { ruleKey, token: tokenDoc?.name, regionId: region.id, movedUnits });
              await rule.onMoveWithin({ actor, tokenDoc, regionDoc: region, dc, castLevel, combat: game.combat, movedPx, movedUnits, moveInfo });
            }
          }
        } else {
          INSIDE_CACHE.delete(key);
          if (wasInside && rule.onExit) {
            dbg("Zone exit", { ruleKey, token: tokenDoc?.name, regionId: region.id });
            await rule.onExit({ actor, tokenDoc, regionDoc: region, dc, castLevel, combat: game.combat });
          }
        }
      }

      // Update last-known token position for movement fallback (handles moves initiated by other users).
      try {
        LAST_POS_CACHE.set(tokenDoc.uuid, {
          x: Number(tokenDoc.x ?? 0) || 0,
          y: Number(tokenDoc.y ?? 0) || 0,
          width: Number(tokenDoc.width ?? 1) || 1,
          height: Number(tokenDoc.height ?? 1) || 1,
          t: Date.now()
        });
      } catch { /* ignore */ }
    } catch (e) {
      console.warn(`[${MODULE_ID}] Zone token-move handler failed`, e);
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    try {
      if (!isActiveGM()) return;
      if (!combat?.started) return;
      if (!("turn" in changed) && !("round" in changed)) return;
      const scene = canvas?.scene;
      if (!scene) return;

      // Determine previous combatant (end-of-turn) from our last cached state.
      let prevTokenDoc = null;
      if (_lastCombatTurn?.combatId === combat.id) {
        const prevTokenId = _lastCombatTurn?.tokenId ?? null;
        if (prevTokenId) prevTokenDoc = scene.tokens?.get?.(prevTokenId) ?? null;
      }

      // Determine current combatant (start-of-turn)
      const combatant = combat.combatant
        ?? (Array.isArray(combat.turns) ? (combat.turns[Number(combat.turn) ?? 0] ?? null) : null);
      const tokenId = combatant?.tokenId ?? combatant?.token?.id ?? null;
      const tokenDoc = combatant?.token ?? (tokenId ? scene.tokens?.get?.(tokenId) : null) ?? null;

      // End-of-turn handlers for previous token
      if (prevTokenDoc?.actor) {
        const prevActor = prevTokenDoc.actor;
        for (const region of iterEpiRegions(scene)) {
          const f = getEpiData(region) ?? {};
          const ruleKey = f.kind;
          const rule = RULES[ruleKey];
          if (!rule?.onEndTurn) continue;

          const dc = Number(f.dc ?? 0) || 0;
          const castLevel = Number(f.castLevel ?? 0) || 0;
          if (!isTokenInsideRegionForRule(prevTokenDoc, region, rule)) continue;
          // per-turn de-dupe per region
          if (!touchTurnCache(region.id, prevTokenDoc.id, combat)) continue;
          await rule.onEndTurn({ actor: prevActor, tokenDoc: prevTokenDoc, regionDoc: region, dc, castLevel, combat });
        }
      }

      // Start-of-turn handlers for current token
      if (tokenDoc?.actor) {
        const actor = tokenDoc.actor;
        for (const region of iterEpiRegions(scene)) {
          const f = getEpiData(region) ?? {};
          const ruleKey = f.kind;
          const rule = RULES[ruleKey];
          if (!rule?.onStartTurn) continue;

          const dc = Number(f.dc ?? 0) || 0;
          const castLevel = Number(f.castLevel ?? 0) || 0;
          if (!isTokenInsideRegionForRule(tokenDoc, region, rule)) continue;

          // keep inside cache in sync
          INSIDE_CACHE.add(insideKey(tokenDoc, region.id));

          await rule.onStartTurn({ actor, tokenDoc, regionDoc: region, dc, castLevel, combat });
        }
      }

      _lastCombatTurn = { combatId: combat.id, tokenId: tokenDoc?.id ?? tokenId ?? null };
    } catch (e) {
      console.warn(`[${MODULE_ID}] Zone combat handler failed`, e);
    }
  });

  // -----------------------------------------------------------------------
  // Storm Sphere (Sphère de tempête): advantage on the bolt attack if the
  // target is inside the sphere.
  //
  // We implement this at the Midi-QOL hook level so it works regardless of
  // who is GM, and so it stays in sync with the Region geometry.
  // -----------------------------------------------------------------------
  try {
    if (!globalThis.__EPI_STORM_SPHERE_BOLT_ADV_HOOK) {
      globalThis.__EPI_STORM_SPHERE_BOLT_ADV_HOOK = true;
      Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
        try {
          const item = workflow?.item;
          const actor = workflow?.actor;
          const scene = canvas?.scene;
          if (!item || !actor || !scene) return;

          const ruleKey = item?.flags?.["encounterplus-importer"]?.regionRule
            ?? item?.flags?.[MODULE_ID]?.regionRule
            ?? null;
          if (String(ruleKey ?? "") !== "storm-sphere") return;

          // Only apply to the BONUS ACTION bolt activity.
          const act = workflow?.activity
            ?? (workflow?.activityId ? (item?.system?.activities?.[workflow.activityId] ?? null) : null)
            ?? null;
          const actName = String(act?.name ?? "").toLowerCase();
          const actIsBonus = String(act?.activation?.type ?? "").toLowerCase() === "bonus";
          const actLooksLikeBolt = actIsBonus || actName.includes("éclair") || actName.includes("eclair") || actName.includes("lightning");
          if (!actLooksLikeBolt) return;

          const targetTok = workflow?.targets?.first?.()
            ?? (Array.isArray(workflow?.targets) ? workflow.targets[0] : null)
            ?? (workflow?.targets ? Array.from(workflow.targets)[0] : null)
            ?? null;
          const targetDoc = targetTok?.document ?? targetTok;
          if (!targetDoc) return;

          // Find the active Storm Sphere region created by THIS item and THIS caster.
          const regions = iterEpiRegions(scene).filter(r => {
            const f = getEpiData(r) ?? {};
            return f.kind === "storm-sphere" && f.itemUuid === item.uuid && f.casterUuid === actor.uuid;
          });
          if (!regions.length) return;

          const region = regions[0];
          const inside = isTokenInsideRegionForRule(targetDoc, region, RULES["storm-sphere"]);
          if (!inside) return;

          // Grant advantage (do not forcibly clear disadvantage to respect other effects).
          workflow.advantage = true;
        } catch (e) {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }

  // Guard: Storm Sphere bolt should only be usable while the spell is active (i.e. the Region exists).
  try {
    if (!globalThis.__EPI_STORM_SPHERE_BOLT_GUARD_HOOK) {
      globalThis.__EPI_STORM_SPHERE_BOLT_GUARD_HOOK = true;
      Hooks.on("midi-qol.preItemRoll", async (workflow) => {
        try {
          const item = workflow?.item;
          const actor = workflow?.actor;
          const scene = canvas?.scene;
          if (!item || !actor || !scene) return;

          const ruleKey = item?.flags?.["encounterplus-importer"]?.regionRule
            ?? item?.flags?.[MODULE_ID]?.regionRule
            ?? null;
          if (String(ruleKey ?? "") !== "storm-sphere") return;

          const act = workflow?.activity
            ?? (workflow?.activityId ? (item?.system?.activities?.[workflow.activityId] ?? null) : null)
            ?? null;
          const actName = String(act?.name ?? "").toLowerCase();
          const actIsBonus = String(act?.activation?.type ?? "").toLowerCase() === "bonus";
          const actLooksLikeBolt = actIsBonus || actName.includes("éclair") || actName.includes("eclair") || actName.includes("lightning");
          if (!actLooksLikeBolt) return;

          const regions = iterEpiRegions(scene).filter(r => {
            const f = getEpiData(r) ?? {};
            return f.kind === "storm-sphere" && f.itemUuid === item.uuid && f.casterUuid === actor.uuid;
          });

          if (regions.length) return;

          ui.notifications?.warn?.("Sphère de tempête : lance d’abord le sort (concentration) avant d’utiliser l’action bonus Éclair.");
          return false;
        } catch {
          return;
        }
      });
    }
  } catch {
    // ignore
  }
}
