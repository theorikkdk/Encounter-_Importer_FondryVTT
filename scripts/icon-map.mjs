import { MODULE_ID } from "./module.mjs";
const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;


/**
 * Hotfix4 icon picker:
 * - Builds an index of Foundry core icons under /icons/* using FP.browse (recursive).
 * - Picks a "best" icon based on name/description keywords and a prefered root order.
 * - Always falls back to stable icons/svg/* if indexing is unavailable or no good match is found.
 */

const FALLBACK = {
  generic: "icons/svg/book.svg",
  melee: "icons/svg/sword.svg",
  ranged: "icons/svg/bow.svg",
  magic: "icons/svg/daze.svg",
  breath: "icons/svg/dragon.svg",
  multi: "icons/svg/target.svg",
  fire: "icons/svg/fire.svg",
  cold: "icons/svg/snowflake.svg",
  poison: "icons/svg/poison.svg",
  lightning: "icons/svg/lightning.svg",
  necrotic: "icons/svg/skull.svg",
  radiant: "icons/svg/sun.svg",
  psychic: "icons/svg/brain.svg",
  force: "icons/svg/explosion.svg",
  thunder: "icons/svg/sound.svg",
  healing: "icons/svg/regen.svg",
  charm: "icons/svg/heart.svg",
  fear: "icons/svg/terror.svg",
  grapple: "icons/svg/net.svg",
  legendary: "icons/svg/crown.svg",
  summon: "icons/svg/wing.svg",
  teleport: "icons/svg/door-exit.svg"
};

const ROOTS_ALL = [
  "icons/creatures",
  "icons/weapons",
  "icons/magic",
  "icons/skills",
  "icons/equipment",
  "icons/consumables",
  "icons/containers",
  "icons/tools",
  "icons/commodities",
  "icons/sundries",
  "icons/environment",
  "icons/dice"
];

const STOP = new Set([
  "icons","icon","image","img","webp","png","jpg","jpeg","svg",
  "creatures","weapons","magic","skills","equipment","consumables","containers","tools","commodities","sundries","environment","dice","pings",
  "simple","basic","war","battle","double","single","blank","outline","flat"
]);

function foldKey(s) {
  const str = String(s ?? "");
  try {
    return str.normalize("NFKD").replace(/[\p{M}]/gu, "").toLowerCase();
  } catch {
    return str.toLowerCase();
  }
}

function tokensOf(s) {
  const f = foldKey(s);
  return f
    .split(/[^\p{L}\p{N}]+/gu)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !STOP.has(w));
}

function uniq(arr) {
  return [...new Set(arr)];
}

const SYN = {
  bite: ["mouth","teeth","fang","morsure","crocs"],
  claw: ["claw","talon","griffe","griffes"],
  tail: ["tail","queue","swipe"],
  tentacle: ["tentacle","tentacule"],
  poison: ["poison","venom","toxin","toxique","empoison"],
  fire: ["fire","flame","feu","brul","brule","burn"],
  cold: ["cold","ice","froid","glace","gel"],
  lightning: ["lightning","bolt","foudre","electr","eclair"],
  necrotic: ["necrotic","necrot","death","mort","skull"],
  radiant: ["radiant","holy","divin","sun","soleil"],
  psychic: ["psychic","mind","mental","brain","psychique"],
  thunder: ["thunder","sound","tonnerre","son","boom"],
  heal: ["heal","healing","soin","regen","regeneration","life","vie"],
  fear: ["fear","fright","terror","effroi","terreur","apeur"],
  charm: ["charm","charmed","heart","amour","ensorcel"],
  grapple: ["grapple","net","bind","chain","entrav","agripp","saisie"],
  breath: ["breath","souffle","cone","spray","dragon","mouth"],
  teleport: ["teleport","portal","door","téléport","porte","dimension","misty","blink"],
  summon: ["summon","conjure","invoke","invoc","conjur","appel"],
  spell: ["spell","spellcasting","magic","magique","arcane","sort","rune"]
};

// Classification rules (order matters)
const RULES = [
  { key: "legendary", re: /legendary|légendaire/i, fallback: FALLBACK.legendary, prefer: ["icons/creatures","icons/magic","icons/skills"] , tags: ["crown","legendary","royal"] },
  { key: "multi", re: /multiattack|attaque(s)? multiples?/i, fallback: FALLBACK.multi, prefer: ["icons/creatures","icons/skills","icons/weapons"], tags: ["multi","strike","target","barrage"] },
  { key: "breath", re: /breath|souffle/i, fallback: FALLBACK.breath, prefer: ["icons/creatures","icons/magic"], tags: SYN.breath },

  { key: "teleport", re: /teleport|téléport|dimension door|porte dimension|misty step|pas brumeux|blink/i, fallback: FALLBACK.teleport, prefer: ["icons/magic","icons/environment"], tags: SYN.teleport },
  { key: "summon", re: /summon|invoc|conjur|appel/i, fallback: FALLBACK.summon, prefer: ["icons/magic","icons/creatures"], tags: SYN.summon },
  { key: "healing", re: /heal|healing|soin|regagne des points de vie|récupère des points de vie|regeneration|régénération/i, fallback: FALLBACK.healing, prefer: ["icons/magic","icons/creatures"], tags: SYN.heal },

  { key: "charm", re: /charm|charmé|ensorcel|séduc/i, fallback: FALLBACK.charm, prefer: ["icons/magic","icons/skills","icons/creatures"], tags: SYN.charm },
  { key: "fear", re: /fear|frighten|apeur|effroi|terreur/i, fallback: FALLBACK.fear, prefer: ["icons/magic","icons/creatures"], tags: SYN.fear },
  { key: "grapple", re: /grapple|agripp|saisie|entrav/i, fallback: FALLBACK.grapple, prefer: ["icons/creatures","icons/tools","icons/weapons"], tags: SYN.grapple },

  { key: "fire", re: /fire|feu|brûl|brul|flame/i, fallback: FALLBACK.fire, prefer: ["icons/magic","icons/creatures","icons/weapons"], tags: SYN.fire },
  { key: "cold", re: /cold|froid|glace|ice/i, fallback: FALLBACK.cold, prefer: ["icons/magic","icons/creatures"], tags: SYN.cold },
  { key: "poison", re: /poison|poisonn|venom|toxin|toxique/i, fallback: FALLBACK.poison, prefer: ["icons/creatures","icons/magic"], tags: SYN.poison },
  { key: "lightning", re: /lightning|foudre|électr|eclair/i, fallback: FALLBACK.lightning, prefer: ["icons/magic","icons/creatures"], tags: SYN.lightning },
  { key: "necrotic", re: /necrotic|nécrot|undeath|mort-vivant/i, fallback: FALLBACK.necrotic, prefer: ["icons/magic","icons/creatures"], tags: SYN.necrotic },
  { key: "radiant", re: /radiant|radieux|divin|holy/i, fallback: FALLBACK.radiant, prefer: ["icons/magic","icons/skills"], tags: SYN.radiant },
  { key: "psychic", re: /psychic|psychique|mental|mind/i, fallback: FALLBACK.psychic, prefer: ["icons/magic","icons/skills"], tags: SYN.psychic },
  { key: "force", re: /force( damage)?|dégâts de force/i, fallback: FALLBACK.force, prefer: ["icons/magic","icons/weapons"], tags: ["force","blast","explosion","impact"] },
  { key: "thunder", re: /thunder|tonnerre|sonique/i, fallback: FALLBACK.thunder, prefer: ["icons/magic","icons/environment"], tags: SYN.thunder },

  { key: "magic", re: /spell|sort|magique|magic|incant|arcane|rituel/i, fallback: FALLBACK.magic, prefer: ["icons/magic","icons/skills"], tags: SYN.spell },

  // Ranged / Melee heuristics last
  { key: "ranged", re: /ranged|distance|bow|arc|arrow|flèche|bolt|ray|projectile/i, fallback: FALLBACK.ranged, prefer: ["icons/weapons","icons/skills","icons/creatures"], tags: ["bow","arrow","crossbow","bolt","ray","shot","tir","flèche"] },
  { key: "melee", re: /bite|morsure|claw|griffe|slam|coup|tail|queue|tentacle|tentacule|pincers|pince|sword|axe|hammer|mace|spear|lance/i, fallback: FALLBACK.melee, prefer: ["icons/weapons","icons/creatures"], tags: ["sword","axe","hammer","mace","spear","lance","strike"].concat(SYN.bite, SYN.claw, SYN.tail, SYN.tentacle) }
];

function classify(name = "", description = "", kind = "ability") {
  const text = `${name}\n${description}`;
  for (const r of RULES) if (r.re.test(text)) return r;
  // Kind-specific fallback preference
  const prefer = (kind === "weapon")
    ? ["icons/weapons","icons/creatures","icons/equipment","icons/magic"]
    : ["icons/creatures","icons/magic","icons/skills","icons/environment","icons/sundries","icons/tools"];
  return { key: "generic", fallback: FALLBACK.generic, prefer, tags: tokensOf(text) };
}

/** Icon index (built lazily) */
let _index = null;           // Array<{path, root, tokens:Set<string>}>
let _inverted = null;        // Map<string, Set<number>>
let _buildPromise = null;
const _decisionCache = new Map(); // key -> iconPath

function isImageFile(p) {
  return /\.(webp|png|jpg|jpeg|svg)$/i.test(String(p ?? ""));
}

function rootOfPath(p) {
  for (const r of ROOTS_ALL) if (p.startsWith(r + "/") || p === r) return r;
  // fallback: first two segments
  const seg = String(p ?? "").split("/").slice(0, 2).join("/");
  return seg || "icons";
}

function entryTokens(path) {
  const f = foldKey(path);
  const segs = f.replace(/^icons\//, "").split("/");
  const file = segs[segs.length - 1] ?? "";
  const noExt = file.replace(/\.(webp|png|jpg|jpeg|svg)$/i, "");
  const parts = [];
  parts.push(...segs.slice(0, -1)); // dirs
  parts.push(noExt);
  return uniq(parts.flatMap(tokensOf));
}

async function browseRecursive(source, dir, depth = 0, maxDepth = 6, outFiles = []) {
  if (depth > maxDepth) return outFiles;
  let res;
  try {
    res = await FP.browse(source, dir);
  } catch (e) {
    // Some hosting configs may block browsing "public".
    return outFiles;
  }

  for (const f of (res.files ?? [])) {
    if (isImageFile(f)) outFiles.push(f);
  }

  for (const d of (res.dirs ?? [])) {
    // Avoid crazy recursion in case of weird loops
    if (typeof d === "string" && d.startsWith(dir)) await browseRecursive(source, d, depth + 1, maxDepth, outFiles);
  }

  return outFiles;
}

async function buildIndex() {
  if (_index) return _index;
  if (_buildPromise) return _buildPromise;

  _buildPromise = (async () => {
    const entries = [];
    const inverted = new Map();

    // Prefer "public" source for core icons, but fall back to "core" on v13 setups where "public" isn't browsable.
    const sourcesToTry = ["public", "core"];
    let source = "public";

    // Probe quickly: if we can't browse anything under the first root, try the next source.
    for (const s of sourcesToTry) {
      try {
        const probe = await browseRecursive(s, ROOTS_ALL[0], 0, 1, []);
        if (probe?.length) { source = s; break; }
      } catch (e) { /* try next */ }
    }

    for (const root of ROOTS_ALL) {
      const files = await browseRecursive(source, root, 0, 6, []);
      for (const p of files) {
        const toks = new Set(entryTokens(p));
        // Keep entries with at least 2 tokens
        if (toks.size < 2) continue;
        const entry = { path: p, root: rootOfPath(p), tokens: toks };
        const idx = entries.push(entry) - 1;

        for (const tk of toks) {
          if (!inverted.has(tk)) inverted.set(tk, new Set());
          inverted.get(tk).add(idx);
        }
      }
    }

    _index = entries;
    _inverted = inverted;
    return _index;
  })();

  return _buildPromise;
}

function expandTags(tags) {
  const out = [];
  for (const t of (tags ?? [])) {
    out.push(t);
    if (SYN[t]) out.push(...SYN[t]);
  }
  return uniq(out.flatMap(tokensOf));
}

function matchCount(entry, tags) {
  let c = 0;
  for (const t of (tags ?? [])) if (entry.tokens.has(t)) c++;
  return c;
}

function scoreEntry(entry, tags, preferRoots) {
  let score = 0;

  // Prefer roots in order
  const pr = preferRoots ?? [];
  const pos = pr.findIndex(r => entry.path.startsWith(r + "/") || entry.root === r);
  if (pos >= 0) score += (pr.length - pos) * 12;

  for (const t of tags) {
    if (entry.tokens.has(t)) score += 6;
    // small bonus when the raw path contains the string
    if (foldKey(entry.path).includes(t)) score += 1;
  }

  // Prefer webp slightly
  if (entry.path.toLowerCase().endsWith(".webp")) score += 2;
  if (entry.path.toLowerCase().includes("blank")) score -= 3;

  return score;
}

async function pickFromIndex(tags, preferRoots, fallback) {
  await buildIndex().catch(() => null);
  if (!_index || !_index.length || !_inverted) return fallback;

  const expanded = expandTags(tags);
  const cand = new Set();

  for (const t of expanded) {
    const hit = _inverted.get(t);
    if (!hit) continue;
    for (const idx of hit) cand.add(idx);
    // soft cap: avoid exploding
    if (cand.size > 2000) break;
  }

  // If no candidates found, do a small scan in preferred roots (top N)
  const candidates = (cand.size ? [...cand] : _index.map((_, i) => i));

  let best = null;
  let bestScore = -Infinity;
  let bestMatches = 0;

  // Hard cap for performance
  const limit = Math.min(candidates.length, 2500);
  for (let i = 0; i < limit; i++) {
    const e = _index[candidates[i]];
    // If we didn't filter by tags, quickly skip icons outside preferred roots
    if (!cand.size && preferRoots?.length) {
      const ok = preferRoots.some(r => e.path.startsWith(r + "/") || e.root === r);
      if (!ok) continue;
    }
    const mc = matchCount(e, expanded);
    const s = scoreEntry(e, expanded, preferRoots);
    if (s > bestScore) {
      bestScore = s;
      best = e;
      bestMatches = mc;
    }
  }

  // Threshold: avoid random picks when there is no real keyword overlap.
  if (!best || bestMatches < 1 || bestScore < 35) return fallback;
  return best.path;
}

/**
 * Picks an icon for an "ability-like" thing (traits/actions/reactions/legendary)
 * or for a weapon (kind:"weapon").
 *
 * @param {string} name
 * @param {string} description
 * @param {{kind?: "ability"|"weapon"}} opts
 */
export async function pickAbilityIcon(name = "", description = "", opts = {}) {
  const kind = opts.kind ?? "ability";
  const c = classify(name, description, kind);

  const cacheKey = `${kind}::${foldKey(c.key)}::${foldKey(name)}`;
  if (_decisionCache.has(cacheKey)) return _decisionCache.get(cacheKey);

  const tags = uniq([c.key, ...tokensOf(name), ...tokensOf(description), ...(c.tags ?? [])]);
  const icon = await pickFromIndex(tags, c.prefer, c.fallback);

  _decisionCache.set(cacheKey, icon);
  return icon;
}

/**
 * Sync fallback (used if needed). This never scans folders.
 */
export function pickAbilityIconSync(name = "", description = "") {
  const c = classify(name, description, "ability");
  return c.fallback ?? FALLBACK.generic;
}
