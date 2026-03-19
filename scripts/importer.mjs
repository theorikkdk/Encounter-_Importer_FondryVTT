import { MODULE_ID, SETTINGS, log, notify } from "./module.mjs";

const USE_WEB_REGIONS = true;
import { scanEncounterPath } from "./diagnose.mjs";
import { pickAbilityIcon } from "./icon-map.mjs";


let _magicSpellIconIndex = null;
async function buildMagicSpellIconIndex() {
  if (_magicSpellIconIndex) return _magicSpellIconIndex;
  const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const out = [];
  async function walk(source, target, depth = 0, maxDepth = 6) {
    if (depth > maxDepth) return;
    try {
      // NOTE: On some Foundry builds, passing "extensions" can cause browse() to return empty.
      // We therefore browse without filters and filter ourselves.
      const res = await FP.browse(source, target);
      if (Array.isArray(res?.files)) {
        for (const f of res.files) {
          const s = String(f ?? "");
          if (/\.(webp|png|jpe?g|svg)$/i.test(s)) out.push(s);
        }
      }
      if (Array.isArray(res?.dirs)) {
        for (const d of res.dirs) await walk(source, d, depth + 1, maxDepth);
      }
    } catch (e) {
      // ignore
    }
  }
  // Core icons usually live in "public"
  await walk("public", "icons/magic", 0, 7);
  // Build a small index by top-level folder under icons/magic
  const byFolder = new Map();
  for (const f of out) {
    const m = String(f).match(/icons\/magic\/([^\/]+)\//i);
    const folder = (m?.[1] ?? "").toLowerCase();
    if (!folder) continue;
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(f);
  }
  _magicSpellIconIndex = { all: out, byFolder };
  return _magicSpellIconIndex;
}

async function pickSpellIcon(spellName, school, description = "") {
  const s = String(school ?? "").toLowerCase();
  const schoolFull = ({abj:"abjuration",con:"conjuration",div:"divination",enc:"enchantment",evo:"evocation",ill:"illusion",nec:"necromancy",trs:"transmutation"})[s] ?? s;
  const name = String(spellName ?? "").toLowerCase();
  const hay = `${spellName ?? ""}\n${description ?? ""}`;

  // 1) Try Foundry core icons/magic (public/icons/magic/*)
  const idx = await buildMagicSpellIconIndex();
  const byFolder = idx?.byFolder;
  const all = idx?.all;

  function hashString(str) {
    // small deterministic hash
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  function pickFromFolder(folder) {
    const key = String(folder ?? "").toLowerCase();
    const arr = byFolder?.get(key);
    if (!arr?.length) return null;
    const i = hashString(`${key}|${name}`) % arr.length;
    return arr[i];
  }

  if (all?.length) {
    // Prefer element/keyword mapping first (best visuals)
    const folderByKeyword = [
      ["fire", /(\bfeu\b|incend|flamme|brasier|boule de feu|mur de feu|feu\s+ardent)/i],
      ["lightning", /(\bfoudre\b|éclair|électr|tonnerre|choc|appel de la foudre)/i],
      ["water", /(\beau\b|glace|givre|froid|neige|tempête de grêle)/i],
      ["acid", /(\bacide\b|corros|vitriol)/i],
      ["sonic", /(\btonnerre\b|sonique|vibration|hurlement)/i],
      ["death", /(nécro|mort|cadavr|squelette|zombi|animation des morts)/i],
      ["unholy", /(démon|infernal|diable|maudit|profan)/i],
      ["holy", /(sacré|divin|ange|radiant|lumière\b|aura sacrée|sanctu)/i],
      ["life", /(soin|guér|régén|restauration|reviv)/i],
      ["nature", /(nature|plante|épine|racine|animal|insecte|bête|druide)/i],
      ["movement", /(pas\s+brumeux|téléport|clignot|porte\b|déplacement|vol\b|hâte|ralent)/i],
      ["time", /(temps\b|prémonit|arrêt du temps|augure)/i],
      ["control", /(contrôle|charme|domination|suggestion|hypnose|immobil|entrave)/i],
      ["defensive", /(protection|bouclier|antidétection|barrière|armure\b|sanctuaire|résist)/i],
      ["perception", /(clairvoy|détection|vision|voir\b|invisibil|divination|augure)/i],
      ["symbols", /(illusion|image\b|mirage|symbole|runique|glyph)/i],
      ["earth", /(terre\b|pierre|roc\b|métal|fange|sable)/i],
      ["air", /(air\b|vent|bourrasque|tempête\b)/i],
      ["light", /(lumière\b|rayon|soleil|éclat)/i],
    ];

    for (const [folder, rx] of folderByKeyword) {
      if (rx.test(hay)) {
        const pick = pickFromFolder(folder);
        if (pick) return pick;
      }
    }

    // School fallback -> folder
    const folderBySchool = {
      abj: "defensive",
      nec: "death",
      div: "perception",
      enc: "control",
      ill: "symbols",
      evo: "fire",
      con: "nature",
      trs: "movement",
    };
    const schoolFolder = folderBySchool[s] ?? null;
    if (schoolFolder) {
      const pick = pickFromFolder(schoolFolder);
      if (pick) return pick;
    }

    // Last resort: pick any magic icon deterministically
    const i = hashString(`all|${name}`) % all.length;
    return all[i];
  }

  // 2) Fallback: use stable core svg icons per school.
  // (Avoid relying on dnd5e system icon paths which can change between versions.)
  const svg = {
    abj: "icons/svg/shield.svg",
    con: "icons/svg/wing.svg",
    div: "icons/svg/eye.svg",
    enc: "icons/svg/heart.svg",
    evo: "icons/svg/explosion.svg",
    ill: "icons/svg/mystery-man.svg",
    nec: "icons/svg/skull.svg",
    trs: "icons/svg/gear.svg",
  };
  return svg[s] ?? "icons/svg/book.svg";
}

// --- Unicode/diacritics tolerant matching (helps for "Trilène", "Mirna", etc.)

function sanitizePath(p) {
  if (!p) return p;
  let s = String(p).replaceAll("\\", "/");
  try { if (/%[0-9A-Fa-f]{2}/.test(s)) s = decodeURIComponent(s); } catch (e) {}
  s = s.replace(/\/+$/, "");
  return s;
}

function foldKey(s) {
  const str = String(s ?? "");
  try {
    return str
      .normalize("NFKD")
      .replace(/[\p{M}]/gu, "")
      .toLowerCase();
  } catch (e) {
    // Fallback if Unicode property escapes aren't supported.
    return str.toLowerCase();
  }
}

function normalizeAuraNameKey(s) {
  return foldKey(String(s ?? ""))
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AURA_SPELL_KEYS = new Set([
  "passage-sans-trace",
  "aura-de-vie",
  "aura-de-purete",
  "aura-du-croise",
  "cercle-de-pouvoir",
  "aura-sacree",
  "esprits-gardiens",
  "linceul-spirituel",
  "aura-de-vitalite",
  "coquille-antivie",
  "champ-antimagie",
  "sacre-de-la-glace"
]);

const AURA_SPELL_NAME_ALIASES = {
  // FR
  "passage sans trace": "passage-sans-trace",
  "aura de vie": "aura-de-vie",
  "aura de purete": "aura-de-purete",
  "aura du croise": "aura-du-croise",
  "cercle de pouvoir": "cercle-de-pouvoir",
  "aura sacree": "aura-sacree",
  // EN
  "pass without trace": "passage-sans-trace",
  "aura of life": "aura-de-vie",
  "aura of purity": "aura-de-purete",
  "purity of aura": "aura-de-purete",
  "crusader s mantle": "aura-du-croise",
  "crusaders mantle": "aura-du-croise",
  "circle of power": "cercle-de-pouvoir",
  "holy aura": "aura-sacree",
  // Additional phases
  "esprits gardiens": "esprits-gardiens",
  "spirit guardians": "esprits-gardiens",
  "linceul spirituel": "linceul-spirituel",
  "spirit shroud": "linceul-spirituel",
  "aura de vitalite": "aura-de-vitalite",
  "aura of vitality": "aura-de-vitalite",
  "coquille antivie": "coquille-antivie",
  "antilife shell": "coquille-antivie",
  "champ antimagie": "champ-antimagie",
  "antimagic field": "champ-antimagie",
  "sacre de la glace": "sacre-de-la-glace",
  "armor of agathys": "sacre-de-la-glace"
};

function resolvePhase1AuraKey(spellSlug, spellName) {
  const slug = String(spellSlug ?? "").toLowerCase().trim();
  if (AURA_SPELL_KEYS.has(slug)) return { key: slug, via: "slug" };
  const nk = normalizeAuraNameKey(spellName ?? "");
  const byName = AURA_SPELL_NAME_ALIASES[nk] ?? null;
  if (byName) return { key: byName, via: "name" };
  return { key: null, via: "none" };
}

// --- Folder helpers (Foundry Items subfolders)
async function ensureChildFolder(name, type, parentId) {
  // Reuse existing folder if present
  const existing = game.folders?.find(f => f.type === type && f.name === name && (f.folder?.id ?? f.folder) === parentId);
  if (existing) return existing;
  return await Folder.create({ name, type, folder: parentId, sorting: "a" });
}

function isMagicishItem(data) {
  const rarity = String(data?.system?.rarity ?? "").toLowerCase();
  const att = data?.system?.attunement;
  const name = String(data?.name ?? "").toLowerCase();
  const hasPlus = /\+\s*[123]\b/.test(name);
  if (att && att !== 0 && att !== "0") return true;
  if (rarity && !["", "common", "none"].includes(rarity)) return true;
  if (hasPlus) return true;
  // common magic buckets
  const t = String(data?.system?.type?.value ?? "").toLowerCase();
  if (["wand", "staff", "rod", "ring", "wondrous", "scroll"].includes(t)) return true;
  return false;
}

function classifyItemFolder(data) {
  // Returns a category key
  const itemType = String(data?.type ?? "");
  const sys = data?.system ?? {};
  const name = String(data?.name ?? "");
  const lower = name.toLowerCase();

  // Ammunition (heuristics)
  const isAmmo = (sys?.type?.value && String(sys.type.value).toLowerCase() === "ammo")
    || /munition|munitions|fl[eè]che|carreau|balle|projectile|bolts?\b|arrows?\b/i.test(lower);

  if (itemType === "weapon") return "WEAPONS";
  if (itemType === "consumable") return "CONSUMABLES";
  if (itemType === "tool") return "TOOLS";
  if (isAmmo) return "AMMUNITION";

  if (itemType === "equipment") {
    const armorType = String(sys?.armor?.type ?? "").toLowerCase();
    if (armorType === "shield" || /bouclier/i.test(name)) return "SHIELDS";
    if (armorType) return "ARMOR";
    // Some equipment are clearly magic
    if (isMagicishItem(data)) return "MAGIC";
    return "EQUIPMENT";
  }

  if (itemType === "loot") return "TREASURE";
  if (isMagicishItem(data)) return "MAGIC";
  return "EQUIPMENT";
}

async function ensureItemSubfolders(rootFolderId) {
  const type = "Item";
  const folders = {
    WEAPONS: await ensureChildFolder("Armes", type, rootFolderId),
    ARMOR: await ensureChildFolder("Armures", type, rootFolderId),
    SHIELDS: await ensureChildFolder("Boucliers", type, rootFolderId),
    CONSUMABLES: await ensureChildFolder("Consommables", type, rootFolderId),
    MAGIC: await ensureChildFolder("Objets magiques", type, rootFolderId),
    TOOLS: await ensureChildFolder("Outils", type, rootFolderId),
    AMMUNITION: await ensureChildFolder("Ammunition", type, rootFolderId),
    EQUIPMENT: await ensureChildFolder("Équipement", type, rootFolderId),
    TREASURE: await ensureChildFolder("Trésors / Divers", type, rootFolderId),
  };
  return folders;
}



function safeInt(v, fallback = 0) {
  const n = parseInt(String(v ?? "").match(/-?\d+/)?.[0] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
function safeFloat(v, fallback = 0) {
  const n = parseFloat(String(v ?? "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(n) ? n : fallback;
}

// Convert a user-data relative path (e.g. encounter-source/foo/bar.webp)
// to a URL which respects Foundry's routing (reverse proxies, route prefix, etc.).
function toFilesUrl(dataPath) {
  // Convert a user-data relative path (e.g. encounter-source/foo/bar.webp)
  // into a browser-loadable URL under Foundry's /files route, while respecting
  // any route prefix / reverse proxy.
  if (!dataPath) return null;
  const raw0 = String(dataPath).replace(/\\/g, "/").trim();
  if (!raw0) return null;
  if (/^(data:|https?:)/i.test(raw0)) return raw0;

  // IMPORTANT: getRoute("/files") returns a route-aware absolute path (e.g. "/files" or "/game/files").
  // Using getRoute("files") can yield a relative path ("files") in some installs, causing 404s.
  let filesRoot = foundry.utils.getRoute("/files");
  if (filesRoot && !String(filesRoot).startsWith("/")) filesRoot = "/" + String(filesRoot);

  let p = raw0;
  // Accept common variants like "files/data/..." or "/files/data/...".
  if (p.startsWith("files/")) p = "/" + p;
  if (p.startsWith("/files/")) {
    // Strip the "/files" prefix and rebuild using the route-aware filesRoot.
    const rest = p.replace(/^\/files/, "");
    return `${filesRoot}${rest}`;
  }

  // Strip leading slash and an optional "data/" prefix
  p = p.replace(/^\/+/, "");
  if (p.startsWith("data/")) p = p.slice("data/".length);

  // Static package paths
  const top = (p.split("/")[0] ?? "").toLowerCase();
  if (["modules", "systems", "worlds", "icons"].includes(top)) return foundry.utils.getRoute(`/${p}`);

  // /files/data/<encoded path>
  const enc = p.split("/").map(encodeURIComponent).join("/");
  return `${filesRoot}/data/${enc}`;
}

function hasValidMediaExtension(path) {
  if (!path) return false;
  const s = String(path).split("?")[0].split("#")[0];
  return /\.(webp|png|jpe?g|gif|bmp|mp4|webm)$/i.test(s);
}

function hasValidImageExtension(path) {
  if (!path) return false;
  const s = String(path).split("?")[0].split("#")[0];
  return /\.(webp|png|jpe?g|gif|bmp|svg)$/i.test(s);
}

// Convert a plain user-data path ("encounter-source/.../file.webp") into a
// browser-loadable URL using Foundry's /files routing, without hardcoding host.
function toPublicUrlIfDataPath(p) {
  if (!p) return p;
  const s = String(p).trim();
  if (!s) return s;
  // Keep core/system/module assets as-is.
  if (/^(icons|systems|modules)\//i.test(s)) return s;
  if (/^(data:|https?:)/i.test(s)) return s;
  // Already a /files URL (ensure leading slash so the browser doesn't treat it as relative)
  if (s.startsWith("/files/")) return s;
  if (s.startsWith("files/")) return "/" + s;
  // Convert plain data path
  const dataPath = normalizeDataPath(s);
  return dataPath ? (toFilesUrl(dataPath) ?? s) : s;
}


function normalizeDataPath(s) {
  if (!s) return null;
  const str = String(s);
  // Handle "files/data/..." without leading slash
  if (str.startsWith("files/data/")) return decodeURIComponent(str.slice("files/data/".length));
  // If we already have a plain data path like "encounter-source/.../file.png", keep it.
  if (!str.startsWith("http") && !str.startsWith("/files/")) return str.replace(/\\/g, "/").replace(/^\//, "");
  // Convert /files/data/<path> to <path>
  try {
    const u = new URL(str, window.location.origin);
    const p = u.pathname;
    const idx = p.indexOf("/files/data/");
    if (idx >= 0) return decodeURIComponent(p.slice(idx + "/files/data/".length));
    return decodeURIComponent(p.replace(/^\//, ""));
  } catch (e) {
    const idx = str.indexOf("/files/data/");
    if (idx >= 0) return str.slice(idx + "/files/data/".length);
    return str.replace(/^\//, "");
  }
}

async function buildFileIndex(basePath, { depth = 3, maxFiles = 25000 } = {}) {
  const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? FilePicker;
  // Map: keyLower -> [{ path }]
  // Keys include both full basename ("foo.webp") and stem ("foo") so we can resolve
  // Encounter+ references that omit the file extension.
  const index = new Map();
  const queue = [{ path: basePath, d: 0 }];
  let count = 0;

  while (queue.length) {
    const cur = queue.shift();
    let res;
    try {
      res = await FP.browse("data", cur.path);
    } catch (e) {
      log("Index browse failed", cur.path, e);
      continue;
    }

    for (const f of (res.files ?? [])) {
      const dataPath = normalizeDataPath(f);
      if (!dataPath) continue;
      const base = dataPath.split("/").pop() ?? "";
      const key = base.toLowerCase();
      const fkey = foldKey(base);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ path: dataPath });
      if (fkey && fkey !== key) {
        if (!index.has(fkey)) index.set(fkey, []);
        index.get(fkey).push({ path: dataPath });
      }

      // Also store the stem (basename without extension) as a key.
      const stem = base.replace(/\.[a-z0-9]{2,5}$/i, "");
      if (stem && stem !== base) {
        const sKey = stem.toLowerCase();
        const fsKey = foldKey(stem);
        if (!index.has(sKey)) index.set(sKey, []);
        index.get(sKey).push({ path: dataPath });
        if (fsKey && fsKey !== sKey) {
          if (!index.has(fsKey)) index.set(fsKey, []);
          index.get(fsKey).push({ path: dataPath });
        }
      }
      count++;
      if (count >= maxFiles) break;
    }
    if (count >= maxFiles) break;

    if (cur.d < depth) {
      for (const d of (res.dirs ?? [])) queue.push({ path: normalizeDataPath(d) ?? d, d: cur.d + 1 });
    }
  }
  return index;
}

function bestCandidate(cands, kind = "") {
  if (!cands?.length) return null;
  // Prefer deterministic + relevant folders.
  const prefer = (p) => {
    const s = p.toLowerCase();
    let score = 0;
    if (kind.startsWith("monster")) {
      if (s.includes("/monsters/")) score += 40;
      if (s.includes("/resources/monsters/")) score += 20;
    }
    if (kind.startsWith("item")) {
      if (s.includes("/items/")) score += 40;
      if (s.includes("/resources/items/")) score += 20;
    }
    if (kind.startsWith("map")) {
      if (s.includes("/maps/")) score += 20;
      // Root-level images are common for maps in exports
      if (s.split("/").length <= 3) score += 15;
    }
    // Prefer shorter paths (usually the canonical one)
    score += Math.max(0, 30 - s.length / 5);
    return score;
  };
  return [...cands].sort((a, b) => prefer(b.path) - prefer(a.path))[0].path;
}


async function ensureExtension(dataPath, fileIndex) {
  const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? FilePicker;
  if (!dataPath) return null;
  const p = String(dataPath).replace(/\\/g, "/").replace(/^\//, "");
  const leaf = p.split("/").pop() ?? p;
  if (/\.[a-z0-9]{2,5}$/i.test(leaf)) return p; // has extension
  // Fetch bytes and infer extension from the file signature.
  const url = toFilesUrl(p);
  if (!url) return p;
  let buf;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return p;
    buf = await resp.arrayBuffer();
  } catch (e) {
    return p;
  }
  const bytes = new Uint8Array(buf.slice(0, 16));
  const isPng = bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isJpg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isGif = bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  const isWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const ext = isPng ? "png" : isWebp ? "webp" : isJpg ? "jpg" : isGif ? "gif" : "png";
  const mime = isPng ? "image/png" : isWebp ? "image/webp" : isJpg ? "image/jpeg" : isGif ? "image/gif" : "application/octet-stream";

  const dir = p.split("/").slice(0, -1).join("/");
  const newName = `${leaf}.${ext}`;
  const newPath = (dir ? `${dir}/${newName}` : newName).replace(/\/+/g, "/");

  // Upload only if missing. If upload fails, just return original path.
  try {
    const file = new File([buf], newName, { type: mime });
    await FP.upload("data", dir || "", file, { overwrite: false });
  } catch (e) {
    // If it already exists or cannot upload, we still try to use the newPath.
  }

  // Update index so future lookups find it.
  if (fileIndex && fileIndex instanceof Map) {
    const key = newName.toLowerCase();
    if (!fileIndex.has(key)) fileIndex.set(key, []);
    fileIndex.get(key).push({ path: newPath });
    const stemKey = leaf.toLowerCase();
    if (!fileIndex.has(stemKey)) fileIndex.set(stemKey, []);
    fileIndex.get(stemKey).push({ path: newPath });
  }
  return newPath;
}

function resolveAssetPath(basePath, fileIndex, name, { kind = "generic", allowNoExtension = false } = {}) {
  if (!name) return null;
  const raw0 = String(name).trim();
  if (!raw0) return null;
  const raw = raw0.replace(/\\/g, "/").replace(/^\//, "");
  if (/^(data:|https?:)/i.test(raw)) return raw;
  if (raw.startsWith("/files/")) return normalizeDataPath(raw);

  // If the reference is already a normal Foundry-static path, keep it.
  const top = (raw.split("/")[0] ?? "").toLowerCase();
  if (["modules", "systems", "worlds", "icons"].includes(top)) return raw;

  const segs = raw.split("/");
  const leaf = segs[segs.length - 1] ?? raw;
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(leaf);

  // If the reference already looks like a data-path rooted under the export folder, keep it.
  const bp = basePath.replace(/^\//, "").replace(/\/+$/, "");
  if (hasExt && (raw.startsWith(bp + "/") || raw.startsWith("encounter-source/"))) return raw;

  // 1) If raw includes a folder and already has an extension, treat it as relative to the export root.
  if (raw.includes("/") && hasExt) {
    return `${basePath.replace(/^\//, "")}/${raw}`.replace(/\/+/g, "/");
  }

  // 2) Try exact match (basename or stem) via the prebuilt index.
  const key = leaf.toLowerCase();
  const fkey = foldKey(leaf);
  const cands = fileIndex?.get(key) ?? (fkey ? fileIndex?.get(fkey) : null);
  if (cands?.length) {
    // If the original ref had a folder, prefer candidates within that folder.
    const folderHint = raw.includes("/") ? segs.slice(0, -1).join("/").toLowerCase() : "";
    if (folderHint) {
      const filtered = cands.filter(c => (c.path ?? "").toLowerCase().includes(`/${folderHint}/`));
      if (filtered.length) return bestCandidate(filtered, kind);
    }
    return bestCandidate(cands, kind);
  }

  // 2b) If the reference has an extension but we didn't find it (common: Encounter+ says .jpg but file is .webp),
  // try resolving by stem and by common extensions.
  if (hasExt) {
    const stem = leaf.replace(/\.[a-z0-9]{2,5}$/i, "");
    const stemKey = stem ? stem.toLowerCase() : "";
    const stemFold = stem ? foldKey(stem) : "";
    const stemCands = stem ? (fileIndex?.get(stemKey) ?? (stemFold ? fileIndex?.get(stemFold) : null)) : null;
    if (stemCands?.length) return bestCandidate(stemCands, kind);
    const exts = ["webp", "png", "jpg", "jpeg", "gif", "mp4", "webm"];
    for (const ext of exts) {
      const k = `${stem}.${ext}`.toLowerCase();
      const c = fileIndex?.get(k) ?? fileIndex?.get(foldKey(k));
      if (c?.length) return bestCandidate(c, kind);
    }
  }

  // 3) If missing extension, try common ones.
  if (!hasExt) {
    const exts = ["webp", "png", "jpg", "jpeg", "gif", "mp4", "webm"];
    for (const ext of exts) {
      const k = `${leaf}.${ext}`.toLowerCase();
      const c = fileIndex?.get(k) ?? fileIndex?.get(foldKey(k));
      if (c?.length) return bestCandidate(c, kind);
    }
    if (!allowNoExtension) return null;
  }

  // 4) Conservative fallback guesses (folder heuristics).
  const k = String(kind).toLowerCase();
  const bp2 = String(basePath).replace(/^\//, "").replace(/\/+$/, "");
  const guesses = [];
    const push = (p) => guesses.push(String(p).replace(/\/+/g, "/"));

  // When Encounter+ stores only a filename, it is usually located in a subfolder (monsters/, items/, Images/, ...).
  if (k.includes("monster")) {
    push(`${bp2}/monsters/${leaf}`);
    push(`${bp2}/resources/monsters/${leaf}`);
    push(`${bp2}/${leaf}`);
  } else if (k.includes("item")) {
    push(`${bp2}/items/${leaf}`);
    push(`${bp2}/resources/items/${leaf}`);
    push(`${bp2}/${leaf}`);
  } else if (k.includes("page") || k.includes("journal")) {
    if (raw.includes("/")) push(`${bp2}/${raw}`);
    push(`${bp2}/Images/${raw}`);
    push(`${bp2}/Images/${leaf}`);
    push(`${bp2}/${leaf}`);
  } else if (k.includes("map")) {
    if (raw.includes("/")) push(`${bp2}/${raw}`);
    push(`${bp2}/${leaf}`);
    push(`${bp2}/maps/${leaf}`);
    push(`${bp2}/Images/${leaf}`);
  } else {
    if (raw.includes("/")) push(`${bp2}/${raw}`);
    push(`${bp2}/${leaf}`);
    push(`${bp2}/Images/${leaf}`);
    push(`${bp2}/maps/${leaf}`);
    push(`${bp2}/monsters/${leaf}`);
    push(`${bp2}/items/${leaf}`);
  }

  return guesses[0] ?? `${bp2}/${leaf}`;
}


function resolveImg(raw, basePath, fileIndex) {
  // Compatibility helper used by item import
  if (!raw) return null;
  try {
    return resolveAssetPath(basePath, fileIndex, raw, { kind: "item-img", allowNoExtension: true });
  } catch (e) {
    return null;
  }
}


function rewriteHtml(content, basePath, fileIndex) {
  if (!content) return "";
  let html = String(content);

  // Images: <img src="...">, <source srcset="...">, and common inline CSS url(...)
  const rewriteOne = (src) => {
    if (!src) return src;
    const s = String(src).trim();
    if (!s) return s;
    if (/^(data:|https?:)/i.test(s)) return s;

    // If the content already contains a /files/data/... URL (or a plain data path),
    // still attempt to resolve it through the file index by basename. This fixes cases
    // where the path is correct syntactically but points to a non-existing file (case,
    // Unicode normalization, nested extraction folder, etc.).
    const existingDataPath = normalizeDataPath(s);
    const baseName = (existingDataPath ?? s).split("/").pop() ?? "";
    const key = baseName.toLowerCase();
    const fKey = foldKey(baseName);
    const candidates = fileIndex.get(key) ?? fileIndex.get(fKey) ?? null;
    if (candidates?.length) {
      const pick = bestCandidate(candidates.map(c => c.path), "page");
      if (pick) return pick;
    }

    // Otherwise resolve relative Encounter+ paths.
    const fixed = resolveAssetPath(basePath, fileIndex, s, { kind: "page-image", allowNoExtension: true });
    return fixed ? fixed : s;
  };

  html = html.replace(/(<img[^>]+\bsrc=["'])([^"']+)(["'])/gi, (m, p1, src, p3) => `${p1}${rewriteOne(src)}${p3}`);
  html = html.replace(/(<source[^>]+\bsrcset=["'])([^"']+)(["'])/gi, (m, p1, src, p3) => `${p1}${rewriteOne(src)}${p3}`);
  // Markdown-style images that sometimes appear in content
  html = html.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (m, src) => {
    const cleaned = src.replace(/^\s+|\s+$/g, "").replace(/^"|"$/g, "");
    return `![](${rewriteOne(cleaned)})`;
  });
  // Inline CSS: style="background-image:url(...)" etc.
  html = html.replace(/url\(([^)]+)\)/gi, (m, inner) => {
    const cleaned = inner.trim().replace(/^['"]|['"]$/g, "");
    return `url('${rewriteOne(cleaned)}')`;
  });

  // Basic link rewrite: keep for later UUID rewrite, but make sure href isn't relative-broken
  html = html.replace(/href=["']([^"']+)["']/gi, (m, href) => {
    if (href.startsWith("#")) return m;
    // Encounter+ sometimes uses plain slugs: "partie1#section"
    return `href="${href}"`;
  });

  return html;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse error for ${url}: ${e.message}`);
  }
}

async function ensureFolder(type, name) {
  const existing = game.folders?.find(f => f.type === type && f.name === name && !f.folder);
  if (existing) return existing;
  return Folder.create({ name, type });
}

async function buildFeat(name, text) {
  return {
    name,
    type: "feat",
    img: await pickAbilityIcon(name, text, { kind: "ability" }),
    system: {
      description: { value: text ?? "" }
    },
    flags: { [MODULE_ID]: { kind: "ability" } }
  };
}

function roundTo5(n) {
  return Math.round(n / 5) * 5;
}

function feetToMeters(ft) {
  // D&D convention used in official translations: 5 ft = 1.5 m
  const v = (Number(ft) || 0) * 0.3;
  return Math.round(v * 10) / 10;
}

function milesToKm(mi) {
  const v = (Number(mi) || 0) * 1.5;
  return Math.round(v * 10) / 10;
}

function kmToMiles(km) {
  return (Number(km) || 0) / 1.5;
}

// --- Generic spell mechanic inference (language-agnostic best-effort) ---
function inferRegionRuleFromDesc(descText, descHtml = "") {
  const text = String(descText ?? "").toLowerCase();
  const html = String(descHtml ?? "").toLowerCase();

  // Utility: extract damage parts (supports multiple) while avoiding follow-up bonus action sections.
  const splitBonusRe = /(en\s+action\s+bonus|action\s+bonus|as\s+a\s+bonus\s+action|bonus\s+action)/i;
  const mainText = String(descText ?? "").split(splitBonusRe)[0];

  const KNOWN_TYPES_FR = [
    "acide","froid","feu","force","foudre","nécrotique","necrotique","psychique","radiant","tonnerre",
    "contendant","perforant","tranchant","poison"
  ];
  const KNOWN_TYPES_EN = [
    "acid","cold","fire","force","lightning","necrotic","psychic","radiant","thunder",
    "bludgeoning","piercing","slashing","poison"
  ];
  const cleanType = (t) => String(t || "").trim().toLowerCase()
    .replace(/^d['’]|^de\s+|^du\s+|^des\s+/,"")
    .replace(/\s+/g," ");

  const extractDamages = (txt) => {
    const out = [];
    const src = String(txt ?? "");
    // French: "2d6 dégâts perforants" / "2d4 dégâts d'acide"
    const reFR = /(\d+d\d+)\s*(?:points\s+de\s+)?d[ée]g[âa]ts?\s+(?:de\s+|d['’]|du\s+|des\s+)?([a-zéèêàîïôûùç\- ]+)/ig;
    for (const m of src.matchAll(reFR)) {
      const typeRaw = cleanType(m[2]).split(/[,\.;\n]/)[0].trim();
      if (KNOWN_TYPES_FR.includes(typeRaw)) out.push({ formula: m[1], type: typeRaw });
    }
    // English: "2d6 piercing damage"
    const reEN = /(\d+d\d+)\s+([a-z]+)\s+damage/ig;
    for (const m of src.matchAll(reEN)) {
      const typeRaw = cleanType(m[2]).split(/[,\.;\n]/)[0].trim();
      if (KNOWN_TYPES_EN.includes(typeRaw)) out.push({ formula: m[1], type: typeRaw });
    }
    // De-dup in order
    const seen = new Set();
    return out.filter(d => {
      const k = `${d.formula}|${d.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const dmgParts = extractDamages(mainText);
  let dmg = dmgParts.length ? dmgParts : null;

  // Movement damage pattern: "par tranche de 1,50 mètre parcouru" OR "for every 5 feet"
  const moveReFR = /(\d+d\d+)\s*d[ée]g[âa]ts?\s+[a-zéèêàîïôûùç\- ]+\s+par\s+tranche\s+de\s+([0-9]+(?:[.,][0-9]+)?)\s*m[èe]tre/i;
  const mm = (String(descText ?? "")).match(moveReFR);
  let move = null;
  if (mm) {
    const per = parseFloat(String(mm[2]).replace(",", ".")) || 1.5;
    move = { formula: mm[1], perMeters: per };
    // try to capture damage type near the formula
    const around = String(descText ?? "").slice(Math.max(0, mm.index - 60), mm.index + 120);
    const dm2 = around.match(/(\d+d\d+)[^.\n]*d[ée]g[âa]ts?\s+([a-zéèêàîïôûùç\- ]+)/i);
    if (dm2) move.type = dm2[2].trim().split(/[,\.;]/)[0].trim();
  }

  const triggers = {
    enterOncePerTurn: /premi[èe]re\s+fois.*(p[ée]n[èe]tre|entre).*tour|first\s+time.*enter.*turn/i.test(text),
    startTurnInside: /commence\s+son\s+tour|starts?\s+its?\s+turn/i.test(text),
    endTurnInside: /termine\s+son\s+tour|ends?\s+its?\s+turn/i.test(text),
    moveWithin: /s['’]y\s+d[ée]place|moves?\s+within|tranche\s+de\s+1[,\.]50\s*m[èe]tre\s+parcouru|per\s+5\s*feet\s+traveled/i.test(text)
  };

  const hasZoneWording = triggers.enterOncePerTurn || triggers.startTurnInside || triggers.endTurnInside || triggers.moveWithin
    || /dans\s+la\s+zone|within\s+the\s+area|dans\s+le\s+gabarit|in\s+the\s+area/i.test(text);

  const wantsConcentrationCheck =
    /en\s+concentration|maintient\s+la\s+concentration|jet\s+de\s+concentration|concentration\s+check/i.test(text);

  // If it looks like an area hazard, use generic-hazard
  if (hasZoneWording && (dmg || move || wantsConcentrationCheck)) {
    const hazard = {
      triggers,
      damage: Array.isArray(dmg) ? dmg : (dmg ? [dmg] : null),
      move: move ? { formula: move.formula, type: move.type || (Array.isArray(dmg) ? dmg[0]?.type : dmg?.type) || null, perMeters: move.perMeters } : null,
      concentrationCheck: wantsConcentrationCheck
    };
    return { ruleKey: "generic-hazard", meta: { hazard } };
  }

  return { ruleKey: null, meta: null };
}

function metersToFeet(m) {
  return roundTo5(m * 3.28084);
}

function crToNumber(crRaw) {
  const s = String(crRaw ?? "0").trim();
  if (!s) return 0;
  if (s.includes("/")) {
    const [a, b] = s.split("/").map(n => parseFloat(n));
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function pbFromCr(crNum) {
  if (crNum >= 29) return 9;
  if (crNum >= 25) return 8;
  if (crNum >= 21) return 7;
  if (crNum >= 17) return 6;
  if (crNum >= 13) return 5;
  if (crNum >= 9) return 4;
  if (crNum >= 5) return 3;
  return 2;
}


// --- Weapon/action parsing + compendium templates (dnd5e v5.2+, Foundry v13)

const _weaponTemplateCache = new Map();

/** Guess a dnd5e baseItem from a FR/EN weapon name (best-effort). */
function guessBaseItemFromName(name = "") {
  const n = foldKey(name);
  // FR → baseItem (EN identifiers used by dnd5e)
  const rules = [
    [/ep(e|é)e\s*longue|longsword/, "longsword"],
    [/ep(e|é)e\s*courte|shortsword/, "shortsword"],
    [/dague|dagger/, "dagger"],
    [/rapiere|rapier/, "rapier"],
    [/cimeterre|scimitar/, "scimitar"],
    [/hachette|handaxe/, "handaxe"],
    [/hache\s*de\s*combat|battleaxe/, "battleaxe"],
    [/hache\s*(a|à)\s*deux\s*mains|greataxe/, "greataxe"],
    [/marteau\s*de\s*guerre|warhammer/, "warhammer"],
    [/marteau\s*leger|light\s*hammer/, "lighthammer"],
    [/masse\s*d'armes|morningstar/, "morningstar"],
    [/masse|mace/, "mace"],
    [/gourdin|club/, "club"],
    [/baton|quarterstaff|staff/, "quarterstaff"],
    [/javelot|javelin/, "javelin"],
    [/lance\b|lance\b/, "lance"],
    [/pique|pike/, "pike"],
    [/hallebarde|halberd/, "halberd"],
    [/glaive\b|glaive\b/, "glaive"],
    [/arc\s*long|longbow/, "longbow"],
    [/arc\s*court|shortbow/, "shortbow"],
    [/arbalete\s*legere|light\s*crossbow|crossbow,\s*light/, "lightcrossbow"],
    [/arbalete\s*lourde|heavy\s*crossbow|crossbow,\s*heavy/, "heavycrossbow"],
    [/fronde|sling/, "sling"],
    [/dard|dart/, "dart"]
  ];
  for (const [re, base] of rules) if (re.test(n)) return base;
  return null;
}

const DAMAGE_TYPE_ALIASES = [
  [/perforant|piercing/i, "piercing"],
  [/tranchant|slashing/i, "slashing"],
  [/contondant|bludgeoning/i, "bludgeoning"],
  [/acide|acid/i, "acid"],
  [/feu|fire/i, "fire"],
  [/froid|cold/i, "cold"],
  [/foudre|lightning/i, "lightning"],
  [/tonnerre|thunder/i, "thunder"],
  [/poison|poison/i, "poison"],
  [/n(e|é)crotique|necrotic/i, "necrotic"],
  [/radieux|radiant/i, "radiant"],
  [/psychique|psychic/i, "psychic"],
  [/force\b|force damage/i, "force"]
];

function guessDamageType(text = "") {
  for (const [re, t] of DAMAGE_TYPE_ALIASES) if (re.test(text)) return t;
  return null;
}

function parseDiceExpression(expr = "") {
  const m = String(expr).trim().match(/(\d+)\s*d\s*(\d+)\s*([+\-]\s*\d+)?/i);
  if (!m) return null;
  const number = safeInt(m[1], 0);
  const denomination = safeInt(m[2], 0);
  const bonus = (m[3] ?? "").replace(/\s+/g, "");
  return { number, denomination, bonus: bonus.startsWith("+") || bonus.startsWith("-") ? bonus.slice(1) : bonus, bonusRaw: bonus };
}

function parseReachOrRange(text = "", measurement = "") {
  const t = String(text);
  const isMetric = String(measurement).toLowerCase() === "metric";

  // Reach / allonge
  let reachFt = null;
  let m = t.match(/(?:allonge|reach)\s*([0-9]+(?:[.,][0-9]+)?)\s*(m|ft|pieds|pi)?/i);
  if (m) {
    let v = safeFloat(m[1], 0);
    const unit = (m[2] ?? "").toLowerCase();
    if (unit.startsWith("m") || (isMetric && !unit)) v = metersToFeet(v);
    reachFt = roundTo5(v);
  }

  // Range / portée: can be "portée 6/18 m" or "range 20/60 ft"
  let range = null;
  m = t.match(/(?:port[eé]e|range)\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*\/\s*([0-9]+(?:[.,][0-9]+)?))?\s*(m|ft|pieds|pi)?/i);
  if (m) {
    let v = safeFloat(m[1], 0);
    let l = m[2] ? safeFloat(m[2], 0) : null;
    const unit = (m[3] ?? "").toLowerCase();
    if (unit.startsWith("m") || (isMetric && !unit)) {
      v = metersToFeet(v);
      if (l != null) l = metersToFeet(l);
    }
    range = { value: roundTo5(v), long: l != null ? roundTo5(l) : null };
  }

  return { reachFt, range };
}

function parseAttackText(text = "", measurement = "") {
  const t = String(text);
  const isWeapon = /attaque d['’]?arme|weapon attack/i.test(t);
  const isSpell = /attaque de sort|spell attack/i.test(t);
  if (!isWeapon && !isSpell) return null;

  const { reachFt, range } = parseReachOrRange(t, measurement);

  const toHit = (() => {
    const m = t.match(/\+(\d+)\s*(?:pour toucher|to hit)/i);
    return m ? safeInt(m[1], 0) : null;
  })();

  // Identify melee/ranged/both
  const mode = (() => {
    const low = foldKey(t);
    const melee = /corps a corps|melee/.test(low);
    const ranged = /a distance|ranged/.test(low);
    if (melee && ranged) return "both";
    if (ranged) return "ranged";
    return "melee";
  })();

  // Parse damage after "Touché:" or "Hit:"
  const hitIdx = (() => {
    const m = t.match(/(?:touch[eé]\s*:|hit:)/i);
    return m ? m.index : -1;
  })();
  const tail = hitIdx >= 0 ? t.slice(hitIdx) : t;

  // Collect dice expressions + nearby type
  const diceRe = /(\d+\s*d\s*\d+\s*(?:[+\-]\s*\d+)?)/ig;
  const parts = [];
  let dm;
  while ((dm = diceRe.exec(tail))) {
    const expr = dm[1];
    const dice = parseDiceExpression(expr);
    if (!dice) continue;
    const after = tail.slice(dm.index + dm[0].length, dm.index + dm[0].length + 80);
    const dtype = guessDamageType(after) ?? guessDamageType(tail.slice(Math.max(0, dm.index - 30), dm.index + 80)) ?? null;
    parts.push({ dice, dtype, context: after });
  }
  if (!parts.length) return { classification: isSpell ? "spell" : "weapon", mode, toHit, reachFt, range, base: null, versatile: null, extras: [] };

  // Heuristic: first dice is base; others are either versatile alternative or extra damage
  const base = parts[0];
  let versatile = null;
  const extras = [];

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const ctx = foldKey(p.context);
    const isTwoHand = /deux\s*mains|two\s*hands|two-handed|a\s*deux\s*mains/.test(ctx);
    if (!versatile && isTwoHand) {
      versatile = p;
    } else {
      // treat as extra damage (poison, fire, etc.)
      extras.push(p);
    }
  }

  return {
    classification: isSpell ? "spell" : "weapon",
    mode,
    toHit,
    reachFt,
    range,
    base,
    versatile,
    extras
  };
}

function makeDamagePart({ number, denomination, bonus, types = [] }) {
  return {
    number: number ?? null,
    denomination: denomination ?? null,
    bonus: bonus ?? "",
    types,
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: null, formula: "" }
  };
}

function ensureWeaponDamageStruct() {
  return {
    versatile: makeDamagePart({ number: null, denomination: null, bonus: "", types: [] }),
    base: makeDamagePart({ number: 1, denomination: 4, bonus: "", types: [] })
  };
}

async function getWeaponTemplateByBaseItem(baseItem) {
  if (!baseItem) return null;
  if (_weaponTemplateCache.has(baseItem)) return _weaponTemplateCache.get(baseItem);

  const packs = (game.packs ?? []).filter(p => p.documentName === "Item");
  const prioritized = packs.sort((a, b) => {
    const ap = a.metadata?.package === "dnd5e" ? 0 : 1;
    const bp = b.metadata?.package === "dnd5e" ? 0 : 1;
    return ap - bp;
  });

  let found = null;
  for (const pack of prioritized) {
    try {
      const idx = await pack.getIndex({ fields: ["type", "name", "system.identifier", "system.type.baseItem"] });
      const entry = idx.find(e =>
        e.type === "weapon" &&
        ((e.system?.type?.baseItem === baseItem) || (e.system?.identifier === baseItem) || (foldKey(e.name) === baseItem))
      );
      if (!entry) continue;
      const doc = await pack.getDocument(entry._id);
      if (!doc) continue;
      found = doc.toObject();
      break;
    } catch (e) {
      // ignore packs which don't expose these fields
      continue;
    }
  }

  _weaponTemplateCache.set(baseItem, found);
  return found;
}


// --- Spell compendium lookup (hotfix5)
const _spellIndexCache = { built: false, deepBuilt: false, map: new Map(), packsToScan: [], stats: {} }; // normalizedName -> { packId, docId, name }

function isSpellDocument(doc) {
  if (!doc) return false;
  const t = String(doc.type ?? "").toLowerCase();
  if (t === "spell") return true;

  const st = doc.system?.type;
  if (typeof st === "string" && String(st).toLowerCase() === "spell") return true;
  const stv = doc.system?.type?.value;
  if (typeof stv === "string" && String(stv).toLowerCase() === "spell") return true;

  // Heuristics for dnd5e spell data shapes (varies by version/modules)
  const lvl = doc.system?.level;
  const school = doc.system?.school;
  if (lvl !== undefined && lvl !== null && school !== undefined) return true;

  // Some packs might store a "spell" identifier in system
  const ident = doc.system?.identifier;
  if (ident && /spell/i.test(String(ident))) return true;

  return false;
}



function parseChargeRecoveryV2(rawText) {
  const raw = String(rawText ?? "");
  const norm = raw
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip accents

  // FR/EN
  const rx = /(regagne|recupere|recuperer|regains?)\s+[^.\n]{0,160}?(\d+d\d+(?:\s*\+\s*\d+)?)\s+charges?[^.\n]{0,160}?\b(a l'?aube|aube|dawn|au crepuscule|crepuscule|dusk)\b/;
  const m = norm.match(rx);
  if (!m) return null;
  const formula = String(m[2]).replace(/\s+/g, "");
  const when = m[3] ?? "dawn";
  const timing = /dusk|crepuscule/.test(when) ? "dusk" : "dawn";
  return { formula, timing };
}

function newActivityId(){
  const chars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s="";
  for(let i=0;i<16;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function ensureAttackActivity(data){
  data.system = data.system ?? {};
  data.system.activities = data.system.activities ?? {};
  for (const [id, act] of Object.entries(data.system.activities)) {
    if (act?.type === "attack") return id;
  }
  const id = "dnd5eactivity000";
  data.system.activities[id] = data.system.activities[id] ?? {
    _id: id,
    type: "attack",
    activation: { type: "action", value: 1, condition: "", override: false },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { concentration: false, value: "", units: "inst", special: "", override: false },
    effects: [],
    range: { value: "5", units: "ft", special: "", override: false },
    target: { template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
      affects: { count:"", type:"", choice:false, special:"" }, prompt:true, override:false },
    attack: { ability: "str", bonus: "", critical: { threshold: null }, flat: false, type: { value: "melee", classification: "weapon" } },
    damage: { critical: { bonus: "" }, includeBase: true, parts: [] },
    uses: { spent: 0, recovery: [] },
    sort: 0,
    flags: {},
    visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
    useConditionText: "", useConditionReason: "", effectConditionText: "",
    macroData: { name: "", command: "" },
    ignoreTraits: { idi:false, idr:false, idv:false, ida:false, idm:false },
    midiProperties: { ignoreTraits: [], triggeredActivityId: "none", triggeredActivityConditionText: "",
      triggeredActivityTargets: "targets", triggeredActivityRollAs: "self", autoConsume: false,
      forceConsumeDialog: "default", forceRollDialog: "default", forceDamageDialog: "default",
      confirmTargets: "default", autoTargetType: "any", autoTargetAction: "default",
      automationOnly:false, otherActivityCompatible:true, otherActivityAsParentType:true, identifier:"",
      displayActivityName:false, rollMode:"default", chooseEffects:false, toggleEffect:false,
      ignoreFullCover:false, removeChatButtons:"default", magicEffect:false, magicDamage:false,
      noConcentrationCheck:false, skipConcentrationCheck:false, autoCEEffects:"default" },
    isOverTimeFlag:false,
    overTimeProperties:{ saveRemoves:true, preRemoveConditionText:"", postRemoveConditionText:"" },
    otherActivityId:"", otherActivityAsParentType:true, attackMode:"oneHanded", ammunition:"",
    otherActivityUuid:"", attackRollPerTarget:"default", fumbleThreshold:1
  };
  return id;
}

function mapDamageTypeFrToEn(t){
  const k = String(t ?? "").toLowerCase();
  const m = { poison:"poison", feu:"fire", froid:"cold", electrique:"lightning", foudre:"lightning",
    tonnerre:"thunder", acide:"acid", necrotique:"necrotic", radiant:"radiant", psychique:"psychic", force:"force" };
  return m[k] ?? k;
}

function addExtraDamageFromText(data, rawText){
  if (data?.type !== "weapon") return;
  const plain = stripHtmlToText(rawText ?? "");
  const norm = plain.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  // Match both "dégâts de poison supplémentaires" and "dégâts radiants supplémentaires"\n  const rx = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+degats?\s+(?:de\s+)?([a-z\-]+)\s+supplementaires?(?:\s+aux\s+([^\.]+))?/g;
  let m;
  const attackId = ensureAttackActivity(data);
  const act = data.system.activities[attackId];
  act.damage = act.damage ?? { critical:{bonus:""}, includeBase:true, parts:[] };
  while ((m = rx.exec(norm)) !== null) {
    const formula = String(m[1]).replace(/\s+/g,"");
    const dtype = (guessDamageType(m[2]) ?? mapDamageTypeFrToEn(String(m[2]).replace(/s$/,"")));
    const exists = (act.damage.parts ?? []).some(p => (p?.custom?.formula===formula && (p?.types||[]).includes(dtype)));
    if (exists) continue;
    const cond = m[3] ? String(m[3]).trim() : "";
    act.damage.parts.push({
      number: 1,
      denomination: 0,
      bonus: "",
      types: [dtype],
      custom: { enabled: true, formula },
      scaling: { mode:"", number:null, formula:"" }
    });
    if (cond) {
      act.description = act.description ?? { chatFlavor: "" };
      const tag = `Dégâts supplémentaires : ${formula} ${dtype}` + (cond ? ` (contre ${cond})` : "");
      const cur = act.description.chatFlavor ?? "";
      if (!cur.includes(tag)) act.description.chatFlavor = (cur ? (cur + " | ") : "") + tag;
    }
  }
}

function extractSpellMentionsWithCosts(raw){
  const out = [];
  const re = /\[([^\]]+?)\]\(spell\)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const nm = String(m[1]).trim();
    const tail = raw.slice(m.index, m.index+140);
    const mm = tail.normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/(\d+)\s+charges?/i);
    const cost = mm ? Number(mm[1]) : 1;
    out.push({ name:nm, cost });
  }
  return out;
}

function ensureCastActivity(data, spellUuid, spellName, cost){
  data.system = data.system ?? {};
  data.system.activities = data.system.activities ?? {};
  for (const act of Object.values(data.system.activities)) {
    if (act?.type==="cast" && act?.spell?.uuid===spellUuid) return;
  }
  const id = newActivityId();
  data.system.activities[id] = {
    type: "cast",
    name: spellName,
    spell: { uuid: spellUuid, challenge: { override: false }, properties: [], spellbook: true, ability: "", level: null },
    _id: id,
    sort: 0,
    activation: { type: "action", value: 1, condition:"", override:false },
    consumption: { scaling: { allowed:false }, spellSlot: true, targets: [ { type:"itemUses", value: String(cost ?? 1), target:"", scaling:{} } ] },
    description: { chatFlavor:"" },
    duration: { concentration:false, value:"", units:"inst", special:"", override:false },
    flags: {},
    range: { value:"", units:"ft", special:"", override:false },
    target: { template: {count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft"},
      affects:{count:"", type:"", choice:false, special:""}, prompt:true, override:false },
    uses: { spent:0, recovery:[] },
    visibility: { level:{}, requireAttunement:false, requireIdentification:false, requireMagic:false },
    useConditionText:"", useConditionReason:"", effectConditionText:"",
    macroData:{ name:"", command:"" },
    ignoreTraits:{ idi:false, idr:false, idv:false, ida:false, idm:false },
    midiProperties:{ ignoreTraits:[], triggeredActivityId:"none", triggeredActivityConditionText:"",
      triggeredActivityTargets:"targets", triggeredActivityRollAs:"self", autoConsume:false,
      forceConsumeDialog:"default", forceRollDialog:"default", forceDamageDialog:"default",
      confirmTargets:"default", autoTargetType:"any", autoTargetAction:"default",
      automationOnly:false, otherActivityCompatible:true, otherActivityAsParentType:true, identifier:"",
      displayActivityName:false, rollMode:"default", chooseEffects:false, toggleEffect:false,
      ignoreFullCover:false, removeChatButtons:"default", magicEffect:false, magicDamage:false,
      noConcentrationCheck:false, skipConcentrationCheck:false, autoCEEffects:"default" },
    isOverTimeFlag:false,
    overTimeProperties:{ saveRemoves:true, preRemoveConditionText:"", postRemoveConditionText:"" }
  };
}


function parseSpellSaveFR(text) {
  const t = String(text ?? "");
  const map = [
    ["force", "str"],
    ["dextérité", "dex"],
    ["dexterite", "dex"],
    ["constitution", "con"],
    ["intelligence", "int"],
    ["sagesse", "wis"],
    ["charisme", "cha"],
  ];
  const m = t.match(/jet de sauvegarde de\s+([a-zA-ZéèêàùîïôçÉÈÊÀÙÎÏÔÇ]+)/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  for (const [fr, ab] of map) {
    if (w.startsWith(fr)) return ab;
  }
  return null;
}

function parseSpellAttackFR(text) {
  const t = String(text ?? "").toLowerCase();

  // Variantes communes FR (officielles + homebrew)
  // - "attaque(s) de sort", "jet d'attaque de sort"
  // - "attaque de contact à distance / au corps à corps"
  // - formulations sans "de sort" mais avec "si le sort touche"
  const hasSpellAttack =
    /attaques?\s+de\s+sort/.test(t) ||
    /jet\s+d['’]attaque\s+de\s+sort/.test(t) ||
    /attaque\s+de\s+contact/.test(t);

  const hasHitCue = /si\s+le\s+sort\s+touche|si\s+vous\s+touchez|sur\s+une\s+r[ée]ussite|en\s+cas\s+de\s+r[ée]ussite/.test(t);
  const genericAttack = /faites?\s+une\s+attaque|effectuez?\s+une\s+attaque|faites?\s+un\s+jet\s+d['’]attaque|effectuez?\s+un\s+jet\s+d['’]attaque/.test(t);

  if (!(hasSpellAttack || (genericAttack && hasHitCue))) return null;

  const melee = /corps\s*[àa]\s*corps/.test(t);
  const ranged = /[àa]\s+distance/.test(t);

  if (melee && !ranged) return { mode: "melee", actionType: "msak" };
  if (ranged && !melee) return { mode: "ranged", actionType: "rsak" };

  return { mode: "ranged", actionType: "rsak" };
}

function parseDamageDiceFR(text) {
  const tRaw = String(text ?? "");
  const t = tRaw.toLowerCase();

  const typeMap = [
    ["acide", "acid"],
    ["acides", "acid"],
    ["froid", "cold"],
    ["feu", "fire"],
    ["foudre", "lightning"],
    ["tonnerre", "thunder"],
    ["poison", "poison"],
    ["psychique", "psychic"],
    ["psychiques", "psychic"],
    ["nécrotique", "necrotic"],
    ["nécrotiques", "necrotic"],
    ["necrotique", "necrotic"],
    ["necrotiques", "necrotic"],
    ["radiant", "radiant"],
    ["radiants", "radiant"],
    ["radieux", "radiant"],
    ["force", "force"],
    ["perforant", "piercing"],
    ["perforants", "piercing"],
    ["tranchant", "slashing"],
    ["tranchants", "slashing"],
    ["contondant", "bludgeoning"],
    ["contondants", "bludgeoning"],
  ];

  const halfOnSave = (() => {
    if (!/moiti[ée]/i.test(t)) return false;
    if (/(r[ée]ussit|r[ée]ussite|succ[èe]s)/i.test(t) && /moiti[ée]/i.test(t)) return true;
    if (/les autres.*moiti[ée]/i.test(t) && /(échou|rate)/i.test(t)) return true;
    if (/moiti[ée].*seulement/i.test(t) && /(échou|rate)/i.test(t)) return true;
    return false;
  })();

  // Typed: "... dégâts de feu" / "... dégâts d'acide"
  const rxTyped = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s*(?:(?:de|d['’])\s*)?(acide|acides|froid|feu|foudre|tonnerre|poison|psychique|psychiques|n[ée]crotique|n[ée]crotiques|necrotique|necrotiques|radiant|radiants|radieux|force|perforant|perforants|tranchant|tranchants|contondant|contondants)/i;
  const m = t.match(rxTyped);
  if (m) {
    const number = Number(m[1]);
    const denom = Number(m[2]);
    const frType = String(m[4] ?? "").toLowerCase();
    let dtype = "";
    for (const [fr, en] of typeMap) {
      if (frType.startsWith(fr.replace("é","e"))) { dtype = en; break; }
    }
    return { number, denom, dtype, halfOnSave };
  }

  // Variable type: "... dégâts du type ..."
  const mVar = t.match(/(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s+du\s+type/i);
  if (mVar) {
    const number = Number(mVar[1]);
    const denom = Number(mVar[2]);
    return { number, denom, dtype: "", halfOnSave };
  }

  // Type omitted: "... 2d6 dégâts."
  const mNoType = t.match(/(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\b/i);
  if (mNoType) {
    const number = Number(mNoType[1]);
    const denom = Number(mNoType[2]);

    // Heuristic: infer from nearby elemental keywords (helps for "Rayon ardent" => fire)
    const idx = t.indexOf(mNoType[0]);
    const win = t.slice(Math.max(0, idx - 200), Math.min(t.length, idx + 80));
    let dtype = "";
    const infer = [
      ["fire", /(rayons?\s+de\s+feu|\bfeu\b|flamme|incend)/i],
      ["cold", /(\bfroid\b|glace|givre|neige)/i],
      ["acid", /(\bacide\b|caustique|corros)/i],
      ["lightning", /(\bfoudre\b|éclair|electr)/i],
      ["thunder", /(\btonnerre\b|sonique|onde\s+de\s+choc)/i],
      ["radiant", /(\bradiant\b|\bradieux\b|lumi[èe]re\b|soleil)/i],
      ["necrotic", /(n[ée]cro|mort|t[ée]n[èe]bres)/i],
      ["psychic", /(psychique|mental)/i],
      ["force", /(\bforce\b|énergie\s+pure)/i],
    ];
    for (const [en, rx] of infer) {
      if (rx.test(win)) { dtype = en; break; }
    }

    return { number, denom, dtype, halfOnSave };
  }

  return null;
}

function wantsMidiName() {
  try {
    return !!game.modules?.get?.("midi-qol")?.active;
  } catch (e) { return false; }
}

function localizeMidi(labelEn, labelFr) {
  const lang = (game.i18n?.lang ?? "en").toLowerCase();
  const fr = lang.startsWith("fr");
  return fr ? labelFr : labelEn;
}

function parseAllDamageDiceFR(text) {
  const tRaw = String(text ?? "");
  const t = tRaw.toLowerCase();

  const typeMap = [
    ["acide", "acid"],
    ["acides", "acid"],
    ["froid", "cold"],
    ["feu", "fire"],
    ["foudre", "lightning"],
    ["tonnerre", "thunder"],
    ["poison", "poison"],
    ["psychique", "psychic"],
    ["psychiques", "psychic"],
    ["nécrotique", "necrotic"],
    ["nécrotiques", "necrotic"],
    ["necrotique", "necrotic"],
    ["necrotiques", "necrotic"],
    ["radiant", "radiant"],
    ["radiants", "radiant"],
    ["radieux", "radiant"],
    ["force", "force"],
    ["perforant", "piercing"],
    ["perforants", "piercing"],
    ["tranchant", "slashing"],
    ["tranchants", "slashing"],
    ["contondant", "bludgeoning"],
    ["contondants", "bludgeoning"],
  ];

  const out = [];
  const spans = [];

  // 1) Typed damage: "... dégâts de feu" or "... dégâts d'acide"
  const rxTyped = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s*(?:(?:de|d['’])\s*)?(acide|acides|froid|feu|foudre|tonnerre|poison|psychique|psychiques|n[ée]crotique|n[ée]crotiques|necrotique|necrotiques|radiant|radiants|radieux|force|perforant|perforants|tranchant|tranchants|contondant|contondants)/gi;

  let m;
  while ((m = rxTyped.exec(t)) !== null) {
    const number = Number(m[1]);
    const denom = Number(m[2]);
    const bonusRaw = (m[3] ?? "").trim();
    const frType = String(m[4] ?? "").toLowerCase();

    let bonus = "";
    if (bonusRaw) {
      if (/^\d+$/.test(bonusRaw)) bonus = String(Number(bonusRaw));
      else bonus = "@mod";
    }

    let dtype = "";
    for (const [fr, en] of typeMap) {
      if (frType.startsWith(fr.replace("é","e"))) { dtype = en; break; }
    }

    out.push({ number, denom, dtype, bonus, index: m.index });
    spans.push([m.index, m.index + m[0].length]);
  }

  // 2) Variable type: "... dégâts du type ..." => keep dtype empty
  const rxVar = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s+du\s+type/gi;
  while ((m = rxVar.exec(t)) !== null) {
    const overlap = spans.some(([a,b]) => m.index >= a && m.index < b);
    if (overlap) continue;

    const number = Number(m[1]);
    const denom = Number(m[2]);
    const bonusRaw = (m[3] ?? "").trim();

    let bonus = "";
    if (bonusRaw) {
      if (/^\d+$/.test(bonusRaw)) bonus = String(Number(bonusRaw));
      else bonus = "@mod";
    }

    out.push({ number, denom, dtype: "", bonus, index: m.index });
    spans.push([m.index, m.index + m[0].length]);
  }

  // 3) Type omitted: "... 2d6 dégâts." => keep dtype empty (or infer from context)
  const rxNoType = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\b(?!\s*(?:(?:de|d['’])\s*)?(acide|acides|froid|feu|foudre|tonnerre|poison|psychique|psychiques|n[ée]crotique|n[ée]crotiques|necrotique|necrotiques|radiant|radiants|radieux|force|perforant|perforants|tranchant|tranchants|contondant|contondants))/gi;

  const inferFromWindow = (idx) => {
    const win = t.slice(Math.max(0, idx - 220), Math.min(t.length, idx + 80));
    const infer = [
      ["fire", /(rayons?\s+de\s+feu|\bfeu\b|flamme|incend|brasier)/i],
      ["cold", /(\bfroid\b|glace|givre|neige)/i],
      ["acid", /(\bacide\b|caustique|corros)/i],
      ["lightning", /(\bfoudre\b|éclair|electr)/i],
      ["thunder", /(\btonnerre\b|sonique|onde\s+de\s+choc)/i],
      ["radiant", /(\bradiant\b|\bradieux\b|lumi[èe]re\b|soleil)/i],
      ["necrotic", /(n[ée]cro|mort|t[ée]n[èe]bres)/i],
      ["psychic", /(psychique|mental)/i],
      ["force", /(\bforce\b|énergie\s+pure)/i],
    ];
    for (const [en, rx] of infer) if (rx.test(win)) return en;
    return "";
  };

  while ((m = rxNoType.exec(t)) !== null) {
    const overlap = spans.some(([a,b]) => m.index >= a && m.index < b);
    if (overlap) continue;

    const number = Number(m[1]);
    const denom = Number(m[2]);
    const bonusRaw = (m[3] ?? "").trim();

    let bonus = "";
    if (bonusRaw) {
      if (/^\d+$/.test(bonusRaw)) bonus = String(Number(bonusRaw));
      else bonus = "@mod";
    }

    const dtype = inferFromWindow(m.index);
    out.push({ number, denom, dtype, bonus, index: m.index });
    spans.push([m.index, m.index + m[0].length]);
  }

  const halfOnSave = (() => {
    if (!/moiti[ée]/i.test(t)) return false;
    if (/(r[ée]ussit|r[ée]ussite|succ[èe]s)/i.test(t) && /moiti[ée]/i.test(t)) return true;
    if (/les autres.*moiti[ée]/i.test(t) && /(échou|rate)/i.test(t)) return true;
    if (/moiti[ée].*seulement/i.test(t) && /(échou|rate)/i.test(t)) return true;
    return false;
  })();

  out.sort((a,b) => (a.index ?? 0) - (b.index ?? 0));

  return { hits: out, halfOnSave };
}


function parseDelayedDamageNextTurnFR(text) {
  const raw = String(text ?? "");
  const t = raw.toLowerCase();

  // Identify a secondary damage that happens on the target's next turn.
  // We first locate the "next turn" timing clause, then search backwards for the closest dice+damage phrase.
  // This avoids issues with accented characters and prevents accidentally capturing the initial damage dice.
  const whenRx = /(?:à|a|au)\s+la\s+(fin|debut|début)\s+de\s+son\s+prochain\s+tour/gi;

  const diceRx = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s*(?:(?:de|d['’])\s*)?(acide|acides|froid|feu|foudre|tonnerre|poison|psychique|psychiques|n[ée]crotique|n[ée]crotiques|necrotique|necrotiques|radiant|radiants|radieux|force|perforant|perforants|tranchant|tranchants|contondant|contondants)?/gi;

  const parseBonus = (b) => {
    const bonusRaw = String(b ?? "").trim();
    if (!bonusRaw) return "";
    if (/^\d+$/.test(bonusRaw)) return String(Number(bonusRaw));
    return "@mod";
  };

  const scales = /(d[ée]g[âa]ts?\s+initiaux?\s+et\s+secondaires?\s+augment|d[ée]g[âa]ts?\s+secondaires?\s+augment)/i.test(t);

  let m;
  while ((m = whenRx.exec(t)) !== null) {
    const whenWord = String(m[1] ?? "").toLowerCase();
    const when = /debut|début/.test(whenWord) ? "start" : "end";

    const idx = m.index ?? 0;
    const winStart = Math.max(0, idx - 280);
    const win = t.slice(winStart, idx);

    // Find the last dice+damage phrase before the timing clause.
    let last = null;
    diceRx.lastIndex = 0;
    let dm;
    while ((dm = diceRx.exec(win)) !== null) last = dm;
    if (!last) continue;

    const number = Number(last[1]);
    const denom = Number(last[2]);
    const bonus = parseBonus(last[3]);
    const frType = String(last[4] ?? "").trim();

    if (!Number.isFinite(number) || !Number.isFinite(denom)) continue;

    // Determine condition context (hit vs failed save), if any.
    const before = t.slice(Math.max(0, winStart - 280), Math.min(t.length, idx + 40));
    let condition = "";
    if (/sur\s+un\s+[ée]chec/.test(before) || /en\s+cas\s+d['’][ée]chec/.test(before)) condition = "fail";
    else if (/si\s+vous\s+touchez/.test(before) || /si\s+vous\s+le\s+touchez/.test(before) || /si\s+vous\s+la\s+touchez/.test(before)) condition = "hit";
    else if (/si\s+la\s+cible\s+[ée]choue/.test(before) || /si\s+la\s+cr[ée]ature\s+[ée]choue/.test(before)) condition = "fail";

    const dtype = frType ? (mapDamageTypeFRToEN(frType) ?? "") : "";

    return { number, denom, bonus, dtype, when, condition, scales };
  }

  return null;
}



function parseRecurringDamageEachTurnFR(text) {
  const raw = String(text ?? "");
  const t = raw.toLowerCase();

  // Match: "Au début de chacun de ses tours" or "À la fin de chacun de ses tours"
  const whenRx = /(?:au|a|à)\s+(?:la\s+)?(fin|debut|début)\s+de\s+chacun\s+de\s+ses\s+tours?/gi;

  // Reuse a robust dice+damage matcher (similar to delayed-next-turn).
  const diceRx = /(\d+)\s*d\s*(\d+)(?:\s*\+\s*(\d+|(?:votre|ton|ta|son|sa)\s+modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?|modificateur(?:\s+de\s+caract[ée]ristique(?:\s+d['’]incantation)?)?))?\s*(?:points?\s+de\s+)?d[ée]g[âa]ts?\s*(?:(?:de|d['’])\s*)?(acide|acides|froid|feu|foudre|tonnerre|poison|psychique|psychiques|n[ée]crotique|n[ée]crotiques|necrotique|necrotiques|radiant|radiants|radieux|force|perforant|perforants|tranchant|tranchants|contondant|contondants)?/gi;

  const parseBonus = (b) => {
    const bonusRaw = String(b ?? "").trim();
    if (!bonusRaw) return "";
    if (/^\d+$/.test(bonusRaw)) return String(Number(bonusRaw));
    return "@mod";
  };

  // Save-ends clue: "jet de sauvegarde de X ... mettant fin à l'effet"
  const saveEndsRx = /jet\s+de\s+sauvegarde\s+de\s+(force|dexterit[eé]|constitution|intelligence|sagesse|charisme)[^\.]{0,180}?(?:mettant|met)\s+fin/i;
  const mapAbility = (fr) => {
    const w = String(fr ?? "").toLowerCase();
    if (w.startsWith("for")) return "str";
    if (w.startsWith("dex")) return "dex";
    if (w.startsWith("con")) return "con";
    if (w.startsWith("int")) return "int";
    if (w.startsWith("sag")) return "wis";
    if (w.startsWith("cha")) return "cha";
    return "";
  };

  let m;
  while ((m = whenRx.exec(t)) !== null) {
    const whenWord = String(m[1] ?? "").toLowerCase();
    const when = /debut|début/.test(whenWord) ? "start" : "end";

    const idx = m.index ?? 0;
    const winStart = Math.max(0, idx - 320);
    const win = t.slice(winStart, idx);

    // Find the last dice+damage phrase before the timing clause.
    let last = null;
    diceRx.lastIndex = 0;
    let dm;
    while ((dm = diceRx.exec(win)) !== null) last = dm;
    if (!last) continue;

    const number = Number(last[1]);
    const denom = Number(last[2]);
    const bonus = parseBonus(last[3]);
    const frType = String(last[4] ?? "").trim();

    if (!Number.isFinite(number) || !Number.isFinite(denom)) continue;

    // Determine condition context (hit vs failed save), if any.
    const before = t.slice(Math.max(0, winStart - 360), Math.min(t.length, idx + 220));
    let condition = "";
    if (/sur\s+un\s+[ée]chec/.test(before) || /en\s+cas\s+d['’][ée]chec/.test(before) || /si\s+la\s+cible\s+[ée]choue/.test(before)) condition = "fail";
    else if (/si\s+vous\s+touchez/.test(before) || /si\s+vous\s+le\s+touchez/.test(before) || /si\s+vous\s+la\s+touchez/.test(before)) condition = "hit";

    const dtype = frType ? (mapDamageTypeFRToEN(frType) ?? "") : "";

    // Try to detect save-ends in the vicinity.
    const after = t.slice(idx, Math.min(t.length, idx + 260));
    const sm = after.match(saveEndsRx) || before.match(saveEndsRx);
    const saveEnds = sm ? mapAbility(sm[1]) : "";

    return { number, denom, bonus, dtype, when, condition, saveEnds };
  }

  return null;
}



function parseRecurringSaveEachTurnFR(text) {
  const raw = String(text ?? "");
  const t = raw.toLowerCase();

  // Timing clause variants seen in FR statblocks:
  // - "À la fin de chacun de ses tours"
  // - "À la fin de chacun de vos tours"
  // - "À la fin de chaque tour"
  // - "Au début de chacun de ses tours", etc.
  // We keep this intentionally permissive and then confirm with save/ending clues.
  const whenRx = /(?:au|a|à)\s+(?:la\s+)?(fin|debut|début)\s+de\s+(?:chacun|chaque)\s+(?:de\s+)?(?:ses|leurs|vos|son|sa)?\s*tours?/gi;

  const mapAbility = (fr) => {
    const w = String(fr ?? "").toLowerCase();
    if (w.startsWith("for")) return "str";
    if (w.startsWith("dex")) return "dex";
    if (w.startsWith("con")) return "con";
    if (w.startsWith("int")) return "int";
    if (w.startsWith("sag")) return "wis";
    if (w.startsWith("cha")) return "cha";
    return "";
  };

  // Accept: "jet de sauvegarde de Sagesse", "JS de Sagesse", "nouveau jet de sauvegarde d’Intelligence", etc.
  // Also accept "saving throw" snippets in EN descriptions.
  const saveRx = /(?:(?:jet\s+de\s+sauvegarde|jds|js)\s*(?:d[\'’]|\s+de\s+)?(force|dexterit[eé]|constitution|intelligence|sagesse|charisme))|(?:saving\s+throw\s*(?:of)?\s*(strength|dexterity|constitution|intelligence|wisdom|charisma))/i;

  // Some texts omit "sauvegarde" in FR statblocks; tolerate "jet de Dextérité" only if we are in a "repeat each turn" context.
  const looseSaveRx = /jet\s+de\s+(force|dexterit[eé]|constitution|intelligence|sagesse|charisme)/i;

  const mapAbilityEN = (en) => {
    const w = String(en ?? "").toLowerCase();
    if (w.startsWith("str")) return "str";
    if (w.startsWith("dex")) return "dex";
    if (w.startsWith("con")) return "con";
    if (w.startsWith("int")) return "int";
    if (w.startsWith("wis")) return "wis";
    if (w.startsWith("cha")) return "cha";
    return "";
  };

  let m;
  while ((m = whenRx.exec(t)) !== null) {
    const whenWord = String(m[1] ?? "").toLowerCase();
    const when = /debut|début/.test(whenWord) ? "start" : "end";
    const idx = m.index ?? 0;

    // Look around the timing clause for the save ability.
    const win = t.slice(Math.max(0, idx - 320), Math.min(t.length, idx + 520));

    let ab = "";
    let sm = win.match(saveRx);
    if (sm) {
      // sm[1] is FR ability, sm[2] is EN ability
      ab = sm[1] ? mapAbility(sm[1]) : mapAbilityEN(sm[2]);
    } else {
      sm = win.match(looseSaveRx);
      if (sm) ab = mapAbility(sm[1]);
    }

    if (!ab) continue;

    // Only keep if it actually suggests a repeated attempt / end condition
    // e.g. "peut refaire", "doit refaire", "nouveau jet", "met fin", "se termine", etc.
    const endClue = /(mettant|met)\s+fin|se\s+termine|prend\s+fin|mettre\s+fin|nouveau\s+jet|refaire|r[eé]p[eè]te|r[eé]p[eè]ter|retenter|peut\s+effectuer|doit\s+effectuer|doit\s+r[eé]ussir|peut\s+faire|doit\s+faire|repeat\s+the\s+saving\s+throw|make\s+another\s+saving\s+throw|on\s+a\s+success|ends?\s+early|ends?\s+the\s+spell/i;
    if (!endClue.test(win)) continue;

    return { when, saveAbility: ab };
  }

  return null;
}



function parseAoeRadiusFR(text) {
  const t = String(text ?? "").toLowerCase();

  const num = (s) => Number(String(s ?? "").replace(",", "."));
  const unit = (u) => {
    const w = String(u ?? "").toLowerCase();
    if (/m|m[ée]tre|mètre|metre/.test(w)) return "m";
    return "ft";
  };

  // --- SPHÈRE / RAYON ---
  let m = t.match(/sph[eè]re\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)\s+de\s+rayon/);
  if (m) return { type: "sphere", value: num(m[1]), units: unit(m[2]) };

  m = t.match(/dans\s+un\s+rayon\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)/);
  if (m) return { type: "sphere", value: num(m[1]), units: unit(m[2]) };

  m = t.match(/rayon\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)/);
  if (m) return { type: "sphere", value: num(m[1]), units: unit(m[2]) };

  // --- CÔNE ---
  m = t.match(/c[oô]ne\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)/);
  if (m) return { type: "cone", value: num(m[1]), units: unit(m[2]) };

  // --- CUBE / CARRÉ ---
  m = t.match(/cube\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)(?:\s*(?:d['’]ar[eê]te|de\s+c[oô]t[eé]|de\s+cot[eé]))?/);
  if (m) return { type: "cube", value: num(m[1]), units: unit(m[2]) };

  m = t.match(/carr[eé]\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)(?:\s*(?:de\s+c[oô]t[eé]|de\s+cot[eé]))?/);
  if (m) return { type: "cube", value: num(m[1]), units: unit(m[2]) };

  // --- LIGNE ---
  // "ligne de 30 mètres de long et 1,5 mètre de large"
  m = t.match(/ligne\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)(?:\s*(?:de\s+long|de\s+longueur|de\s+longue|de\s+longueur|de\s+longueur))?(?:[^\.\n]{0,80}?(?:\bet\b|sur)\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)\s*(?:de\s+large|de\s+largeur))?/);
  if (m) {
    const len = num(m[1]); const u1 = unit(m[2]);
    const w = m[3] ? num(m[3]) : null;
    const uW = m[4] ? unit(m[4]) : u1;
    return { type: "line", value: len, units: u1, width: (w != null ? w : null), widthUnits: uW };
  }

  // Alternate wording: "une ligne longue de 30 m" + "large de 1,5 m"
  m = t.match(/ligne[^\.\n]{0,80}?long(?:ue|ueur)?\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)[^\.\n]{0,80}?large(?:ur)?\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)/);
  if (m) {
    const len = num(m[1]); const u1 = unit(m[2]);
    const w = num(m[3]); const uW = unit(m[4]);
    return { type: "line", value: len, units: u1, width: (w != null ? w : null), widthUnits: uW };
  }

  // --- CYLINDRE ---
  m = t.match(/cylindre\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)\s+de\s+rayon(?:[^\.\n]{0,80}?\bet\b\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)\s+de\s+haut(?:eur)?)?/);
  if (m) {
    const r = num(m[1]); const u1 = unit(m[2]);
    const h = m[3] ? num(m[3]) : null;
    const uH = m[4] ? unit(m[4]) : u1;
    return { type: "cylinder", value: r, units: u1, height: (h != null ? h : null), heightUnits: uH };
  }

  return null;
}

// Secondary AoE centered on the HIT TARGET (e.g. Ice Knife explosion "dans un rayon de 1,5 m de la cible").
// Returns { value, units } or null.
function parseAoeAroundTargetFR(text) {
  const t = String(text ?? "").toLowerCase();
  const num = (s) => Number(String(s ?? "").replace(",", "."));
  const unit = (u) => {
    const w = String(u ?? "").toLowerCase();
    if (/m|m[ée]tre|mètre|metre/.test(w)) return "m";
    return "ft";
  };

  // FR: "dans un rayon de 1,5 m de la cible" / "autour de la cible"
  let m = t.match(/dans\s+un\s+rayon\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|ft|feet|pieds?)\s+(?:autour\s+de|de)\s+la\s+cible/);
  if (m) return { value: num(m[1]), units: unit(m[2]) };


  // FR variants: "dans un rayon de X mètre de celle-ci" / "autour de celle-ci" / "autour d'elle"
  m = t.match(/dans\s+un\s+rayon\s+de\s+(\d+(?:[.,]\d+)?)\s*(m|m[ée]tres?|m[ée]tre|metres?|meters?|ft|feet|pieds?)\s+(?:autour\s+de|de)\s+(?:celle-?ci|elle|lui|le\s+cible|la\s+cible|la\s+creature\s+cible|la\s+cr[eé]ature\s+cible)/);
  if (m) return { value: num(m[1]), units: unit(m[2]) };
  // EN: "within 5 feet of the target" / "within 5 feet of it"
  m = t.match(/within\s+(\d+(?:[.,]\d+)?)\s*(feet|foot|ft|meters|metres|m)\s+of\s+(?:the\s+target|it)/);
  if (m) return { value: num(m[1]), units: unit(m[2]) };

  return null;
}


// Detect "buff that triggers an AoE SAVE on the NEXT ranged weapon hit" spells (Hail of Thorns / Lightning Arrow style).
// FR examples: "La prochaine fois que vous touchez ... avec une attaque d'arme à distance"
// EN examples: "The next time you hit ... with a ranged weapon attack"
function isWeaponTriggeredAoeBuff(text) {
  const t = foldKey(String(text ?? ""));
  const frNext = /la\s+prochaine\s+fois\s+que\s+vous\s+touchez|la\s+prochaine\s+attaque/.test(t);
  // Encounter+ exports sometimes say "attaque armée à distance" instead of "attaque d'arme à distance"
  const frRangedWeapon = /attaque\s+(?:d['’]arme|arme[eé]e?|arm[eé]e?)\s+a\s+distance/.test(t);
  const enNext = /the\s+next\s+time\s+you\s+hit|next\s+time\s+you\s+hit/.test(t);
  const enRangedWeapon = /ranged\s+weapon\s+attack/.test(t);
  return (frNext && frRangedWeapon) || (enNext && enRangedWeapon);
}




function mapDamageTypeFRToEN(fr) {
  const w = String(fr ?? "").toLowerCase().replace("é","e");
  const pairs = [
    ["acide", "acid"],
    ["froid", "cold"],
    ["feu", "fire"],
    ["foudre", "lightning"],
    ["tonnerre", "thunder"],
    ["poison", "poison"],
    ["psychique", "psychic"],
    ["necrotique", "necrotic"],
    ["nécrotique", "necrotic"],
    ["radieux", "radiant"],
    ["radiant", "radiant"],
    ["force", "force"],
    ["perforant", "piercing"],
    ["tranchant", "slashing"],
    ["contondant", "bludgeoning"]
  ];
  for (const [k,v] of pairs) if (w.startsWith(k.replace("é","e"))) return v;
  return null;
}

function parseScalingFR(text, spellLevel) {
  const t = String(text ?? "");
  const lower = t.toLowerCase();

  // Cantrip scaling phrases
  const cantripCue = /(quand vous atteignez le niveau 5|niveau 5\s*\(2d|niveau 11\s*\(3d|niveau 17\s*\(4d)/i.test(t);
  if ((spellLevel === 0 || spellLevel === "0" || spellLevel == null) && cantripCue) {
    return { kind: "cantrip" };
  }

  // Upcast scaling (FR):
  // - "les dégâts augmentent de 2d4 par emplacement de sort au-delà du 2ème"
  // - "augmente de 1d6 pour chaque niveau d'emplacement de sort au-delà du 3e"
  // - sometimes the base is omitted (assume the spell's base level)
  const upcastRx = /augment(?:e|ent)\s+de\s+(\d+)\s*d\s*(\d+)\s+(?:par|pour\s+chaque)\s+(?:niveau(?:\s+d['’]emplacement(?:\s+de\s+sort)?)?|niveau\s+de\s+sort|emplacement(?:\s+de\s+sort)?)\s*(?:(?:au[- ]del[aà]\s+du|au-delà\s+du|sup[eé]rieur\s+[àa])\s+(\d+)(?:er|e|ème|eme)?)?/i;

  const m = t.match(upcastRx);
  if (m) {
    const n = Number(m[1]);
    const d = Number(m[2]);
    const base = Number(m[3] ?? spellLevel ?? 0);

    // Try to infer which damage type scales, e.g. "les dégâts de froid augmentent..."
    let typeHint = null;
    const typeMatch = t.match(/d[ée]g[âa]ts?\s+de\s+([a-zA-ZéèêàùîïôçÉÈÊÀÙÎÏÔÇ]+)\s+augment/i);
    if (typeMatch) typeHint = mapDamageTypeFRToEN(typeMatch[1]);

    if (!Number.isNaN(n) && !Number.isNaN(d) && !Number.isNaN(base)) {
      return { kind: "upcast", per: { n, d }, base, typeHint };
    }
  }

  return null;
}

function parseMultiShotCountScaling(text, spellLevel, opts = {}) {
  const t = String(text ?? "");
  const baseSpellLevel = Number(spellLevel ?? 0) || 0;
  const slug = String(opts?.slug ?? "").toLowerCase();
  const name = String(opts?.name ?? "").toLowerCase();

  const words = new Map([
    ["un", 1], ["une", 1], ["one", 1], ["deux", 2], ["two", 2], ["trois", 3], ["three", 3],
    ["quatre", 4], ["four", 4], ["cinq", 5], ["five", 5], ["six", 6],
    ["sept", 7], ["seven", 7], ["huit", 8], ["eight", 8], ["neuf", 9], ["nine", 9], ["dix", 10], ["ten", 10],
    ["onze", 11], ["douze", 12]
  ]);
  const toQty = (raw) => {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v) return 0;
    if (/^\d+$/.test(v)) return Number(v) || 0;
    return Number(words.get(v) ?? 0) || 0;
  };

  const fr = t.match(/(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|\d+)\s+(?:rayon|faisceau|projectile|dard|trait|fl[ée]chette|carreau)\s+de\s+plus\s+par\s+niveau\s+(?:d['’]emplacement\s+de\s+sort\s+)?(?:au[- ]del[aà]\s+du|au-delà\s+du|sup[eé]rieur\s+[àa])\s+(\d+)(?:er|e|ème|eme)?/i);
  if (fr) return { perLevel: toQty(fr[1]), baseLevel: Number(fr[2] ?? baseSpellLevel) || baseSpellLevel, countOnly: true };

  const en = t.match(/(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:additional\s+)?(?:ray|rays|beam|beams|projectile|projectiles|dart|darts|bolt|bolts|missile|missiles)\s+for\s+each\s+slot\s+level\s+above\s+(\d+)(?:st|nd|rd|th)?/i);
  if (en) return { perLevel: toQty(en[1]), baseLevel: Number(en[2] ?? baseSpellLevel) || baseSpellLevel, countOnly: true };

  if (/rayon-ardent|scorching-ray|projectile-magique|magic-missile/.test(slug) || /rayon\s+ardent|scorching\s+ray|projectile\s+magique|magic\s+missile/.test(name)) {
    return { perLevel: 1, baseLevel: baseSpellLevel, countOnly: true };
  }
  return null;
}

function disableActivityDamageScaling(activity) {
  try {
    const parts = Array.isArray(activity?.damage?.parts) ? activity.damage.parts : [];
    for (const part of parts) {
      part.scaling = { mode: "", number: 0, formula: "" };
    }
  } catch (e) {
    log("disableActivityDamageScaling failed", e);
  }
}

function ensureActivitySlotLevelChoice(activity) {
  try {
    activity.consumption = activity.consumption ?? { targets: [], scaling: { allowed: true, max: "" }, spellSlot: true };
    activity.consumption.spellSlot = true;
    activity.consumption.scaling = activity.consumption.scaling ?? { allowed: true, max: "" };
    activity.consumption.scaling.allowed = true;
    if (activity.consumption.scaling.max == null) activity.consumption.scaling.max = "";
  } catch (e) {
    log("ensureActivitySlotLevelChoice failed", e);
  }
}

function applyScalingToActivityDamage(activity, scaling, opts = {}) {
  try {
    if (!activity?.damage?.parts?.length) return;
    if (!scaling) return;

    // For upcast scaling to actually apply when casting at a higher slot,
    // the activity must allow slot scaling.
    if (scaling.kind === "upcast") {
      activity.consumption = activity.consumption ?? { targets: [], scaling: { allowed: true, max: "" }, spellSlot: true };
      activity.consumption.spellSlot = true;
      activity.consumption.scaling = activity.consumption.scaling ?? { allowed: true, max: "" };
      activity.consumption.scaling.allowed = true;
      if (activity.consumption.scaling.max == null) activity.consumption.scaling.max = "";
    }

    for (const part of activity.damage.parts) {
      part.scaling = part.scaling ?? { mode: "whole", number: 1, formula: "" };

      // In the dnd5e system, damage part scaling uses CONFIG.DND5E.damageScalingModes (whole/half).
      // The *source* of scaling (spell slot vs cantrip tiers) is handled elsewhere; here we only
      // describe how much damage changes per scaling step.
      if (scaling.kind === "cantrip") {
        part.scaling.mode = "whole";
        part.scaling.number = 1;
        part.scaling.formula = "";
      } else if (scaling.kind === "upcast") {
        // Apply only to matching damage type when possible
        if (scaling.typeHint && Array.isArray(part.types) && !part.types.includes(scaling.typeHint)) continue;

        const perN = Number(scaling.per?.n ?? 1) || 1;
        const perD = String(scaling.per?.d ?? "").trim();

        part.scaling.mode = "whole";
        part.scaling.number = perN;

        // IMPORTANT (dnd5e v4+): scaling.formula must hold the die portion (e.g. "d8") or the system UI/rolls may treat
        // scaling.number as a flat integer increment. Using "dX" keeps both UI and roll correct.
        {
        const baseDenom = Number(part.denomination ?? part.denom ?? 0) || null;
        const perDNum = Number(perD);
        // If the scaling die matches the base die (e.g. Fireball 8d6 -> +1d6/slot),
        // leave scaling.formula empty so the UI doesn't show a redundant formula.
        // When the scaling die differs from the base die, we must keep it explicit (e.g. +1d8).
        if (baseDenom && perDNum && baseDenom === perDNum) part.scaling.formula = "";
        else part.scaling.formula = perD ? `d${perD}` : "";
      }
      }
    }
  } catch (e) {
    log("applyScalingToActivityDamage failed", e);
  }
}



function parseHealingOrTempFR(text) {
  const raw = String(text ?? "");
  const t = raw.toLowerCase();

  const parseBonus = (tail) => {
    const bNum = tail.match(/\+\s*(\d+)\b/);
    if (bNum) return String(Number(bNum[1]));
    if (/\+\s*(?:votre|ton|ta|son|sa)\s+modificateur|\+\s*modificateur/.test(tail)) return "@mod";
    return "";
  };

  // TEMP HP - dice BEFORE or AFTER "points de vie temporaires"
  // ex: "gagne 1d4 + 4 points de vie temporaires"
  let m = t.match(/(\d+)\s*d\s*(\d+)[^\n\.]{0,120}points?\s+de\s+vie\s+temporaires/);
  if (m) {
    const number = Number(m[1]); const denom = Number(m[2]);
    const tail = t.slice(m.index, m.index + 220);
    const bonus = parseBonus(tail);
    return { kind: "temp", number, denom, bonus };
  }
  // ex: "gagne des points de vie temporaires égaux à 1d4 + 4"
  m = t.match(/points?\s+de\s+vie\s+temporaires[^\n\.]{0,120}(?:[ée]gaux?\s*[àa]|[ée]gal\s*[àa]|=)\s*(\d+)\s*d\s*(\d+)/);
  if (m) {
    const number = Number(m[1]); const denom = Number(m[2]);
    const tail = t.slice(m.index, m.index + 220);
    const bonus = parseBonus(tail);
    return { kind: "temp", number, denom, bonus };
  }
  // Flat temp hp (keep as custom): "gagne 8 points de vie temporaires" OR "points de vie temporaires égaux à 5 + ..."
  m = t.match(/(?:gagne|obtenez|obtient|reçoit|recevez)[^\n\.]{0,40}(\d+)\s+points?\s+de\s+vie\s+temporaires/);
  if (m) return { kind: "temp", custom: String(Number(m[1])) };
  m = t.match(/points?\s+de\s+vie\s+temporaires[^\n\.]{0,80}(?:[ée]gaux?\s*[àa]|[ée]gal\s*[àa]|=)\s*(\d+)\b/);
  if (m) return { kind: "temp", custom: String(Number(m[1])) };

  // HEALING - dice BEFORE or AFTER "points de vie"
  // ex: "récupère 1d8 + mod ... points de vie"
  m = t.match(/(\d+)\s*d\s*(\d+)[^\n\.]{0,160}points?\s+de\s+vie\b/);
  if (m) {
    const number = Number(m[1]); const denom = Number(m[2]);
    const tail = t.slice(m.index, m.index + 260);
    const bonus = parseBonus(tail);
    return { kind: "healing", number, denom, bonus };
  }
  // ex: "récupère un nombre de points de vie égal à 1d8 + mod"
  m = t.match(/points?\s+de\s+vie[^\n\.]{0,160}(?:[ée]gaux?\s*[àa]|[ée]gal\s*[àa]|=)\s*(\d+)\s*d\s*(\d+)/);
  if (m) {
    const number = Number(m[1]); const denom = Number(m[2]);
    const tail = t.slice(m.index, m.index + 260);
    const bonus = parseBonus(tail);
    return { kind: "healing", number, denom, bonus };
  }

  // Flat healing (rare): "récupère 5 points de vie"
  m = t.match(/\b(\d+)\b[^\n\.]{0,30}points?\s+de\s+vie\b/);
  if (m && /(r[ée]cup[ée]r|regagn|soign|restaur|rends?)/i.test(t)) {
    return { kind: "healing", custom: String(Number(m[1])) };
  }

  return null;
}

// --- Lot 1 (batch simple) ---------------------------------------------------
// Pragmatic fast-pass: only for explicitly listed simple/ROI spells,
// while excluding already-validated heavy systems (auras/regions/walls/multi-shot-like specials).
const LOT1_SIMPLE_BATCH_SLUGS = new Set([
  "blessure",
  "chatiment-du-ban",
  "chatiment-revelateur",
  "coup-au-but",
  "dissipation-du-mal-et-du-bien",
  "duel-force",
  "ennemis-a-foison",
  "faveur-divine",
  "flammes",
  "fleche-acide-de-melf",
  "fleches-enflammees",
  "forme-gazeuse",
  "foulee-d-ashardalon",
  "frayeur",
  "guerison-de-groupe",
  "image-miroir",
  "invulnerabilite",
  "lame-de-feu",
  "lame-retentissante",
  "lueurs-feeriques",
  "mot-de-guerison-de-groupe",
  "ombre-d-egarement",
  "orbe-chromatique",
  "premonition",
  "priere-de-guerison",
  "protection-contre-le-mal-et-le-bien",
  "protection-contre-le-poison",
  "rayon-de-givre",
  "regeneration",
  "resistance",
  "sauvagerie-primitive",
  "soins",
  "trait-de-feu",
  "vent-protecteur"
]);

// Lot 2 sub-batch (ROI): keep only broad, reusable and low-special-case spells.
// Target families: damage simple + save-then-damage simple.
const LOT2_SIMPLE_BATCH_SLUGS = new Set([
  "boule-de-feu",
  "mains-brulantes",
  "eclair",
  "vague-tonnante",
  "glas",
  "moquerie-cruelle",
  "piqure-mentale",
  "epine-mentale",
  "trait-ensorcele",
  "gelure",
  "poigne-electrique",
  "contact-glacial",
  // Next pragmatic sub-batch (simple/ROI): straightforward damage/save or heal.
  "cone-de-froid",
  "nuee-de-boules-de-neige-de-snilloc",
  "raz-de-maree",
  "secousse-sismique",
  "tempete-de-grele",
  "bouffee-de-poison",
  "catapulte",
  "soins-de-groupe",
  // Next pragmatic sub-batch (ROI): additional straightforward damage/save templates.
  "aspersion-acide",
  "flambee-d-aganazzar",
  "fleche-de-foudre"
]);

const SIMPLE_BATCH_EXCLUDED_SLUGS = new Set([
  // Explicitly out-of-scope for this pass (existing dedicated systems)
  "aura-de-purete",
  "cercle-de-pouvoir",
  "croissance-d-epines",
  "eclair-de-chaos",
  "fleche-de-foudre",
  "mur-d-eau",
  "nuee-de-dagues",
  "tentacules-noirs-d-evard",
  // Not prioritized combat simple mechanics for this pass
  "message",
  "pierre-magique",
  "sieste",
  "sommeil",
  "sphere-resiliente-d-otiluke",
  "tempete-vengeresse"
]);

function isSimpleBatchEligible(spellSlug) {
  const s = String(spellSlug ?? "").toLowerCase().trim();
  return (LOT1_SIMPLE_BATCH_SLUGS.has(s) || LOT2_SIMPLE_BATCH_SLUGS.has(s)) && !SIMPLE_BATCH_EXCLUDED_SLUGS.has(s);
}

const SIMPLE_FRIENDLY_HEAL_SLUGS = new Set([
  "soins-de-groupe",
  "guerison-de-groupe",
  "mot-de-guerison-de-groupe",
  "priere-de-guerison"
]);

function isSimpleFriendlyHeal(spellSlug) {
  return SIMPLE_FRIENDLY_HEAL_SLUGS.has(String(spellSlug ?? "").toLowerCase().trim());
}

function applyFriendlyOnlyHealTarget(act, spellSlug) {
  if (!isSimpleFriendlyHeal(spellSlug)) return;
  act.target = act.target ?? { template: {count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft"}, affects: {count:"", type:"", choice:false, special:""}, prompt: true, override: false };
  act.target.affects = act.target.affects ?? { count: "", type: "", choice: false, special: "" };
  act.target.affects.type = "ally";
  act.target.affects.choice = true;
  act.target.prompt = true;
  act.target.override = true;
}

function parseSimpleBuffChangesFR(descText = "", spellSlug = "") {
  const t = foldKey(descText);
  const slug = String(spellSlug ?? "").toLowerCase().trim();
  const changes = [];

  // Targeted hotfixes (lot 1) with explicit semantics.
  // Protection contre le poison: ensure a useful baseline buff even if wording varies.
  if (slug === "protection-contre-le-poison") {
    changes.push({ key: "system.traits.dr.value", mode: 2, value: "poison", priority: 20 });
  }

  // Faveur divine: offensive rider, never immediate damage at cast.
  // Use a single native dnd5e weapon damage bonus (+1d4 radiant) to avoid double counting.
  if (slug === "faveur-divine") {
    changes.push({ key: "system.bonuses.weapon.damage", mode: 2, value: "+1d4[radiant]", priority: 20 });
    changes.push({ key: "flags.encounterplus-importer.simpleRider.divineFavor", mode: 5, value: true, priority: 20 });
  }

  const dmgTypes = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder", "bludgeoning", "piercing", "slashing"];
  const frToSys = new Map([
    ["acide", "acid"], ["froid", "cold"], ["feu", "fire"], ["force", "force"], ["foudre", "lightning"],
    ["necrotique", "necrotic"], ["nécrotique", "necrotic"], ["poison", "poison"], ["psychique", "psychic"],
    ["radiant", "radiant"], ["radieux", "radiant"], ["tonnerre", "thunder"], ["contondant", "bludgeoning"],
    ["contendant", "bludgeoning"], ["perforant", "piercing"], ["tranchant", "slashing"]
  ]);

  for (const [fr, sysType] of frToSys.entries()) {
    const rx = new RegExp(`resistan(?:ce|t)\\s+(?:aux|au|a la|a l')\\s+degats?\\s+(?:de\\s+|d')?${fr}`);
    if (rx.test(t) && dmgTypes.includes(sysType)) {
      changes.push({ key: "system.traits.dr.value", mode: 2, value: sysType, priority: 20 });
    }
  }

  if (/avantage[^\.]{0,80}jets? de sauvegarde/.test(t)) {
    changes.push({ key: "flags.midi-qol.advantage.ability.save.all", mode: 5, value: true, priority: 20 });
  }

  // de-dup
  const seen = new Set();
  return changes.filter((c) => {
    const k = `${c.key}|${c.mode}|${String(c.value)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function resolveLot1BuffTemplateSpec(spellSlug = "", spellName = "", descText = "") {
  const slug = String(spellSlug ?? "").toLowerCase().trim();
  const name = foldKey(String(spellName ?? ""));

  const isDivineFavor = slug === "faveur-divine" || /faveur\s+divine/.test(name);
  if (isDivineFavor) {
    return {
      slug: "faveur-divine",
      targetMode: "self",
      changes: parseSimpleBuffChangesFR(descText, "faveur-divine")
    };
  }

  const isPoisonProtect = slug === "protection-contre-le-poison" || /protection\s+contre\s+le\s+poison/.test(name);
  if (isPoisonProtect) {
    return {
      slug: "protection-contre-le-poison",
      targetMode: "targets",
      changes: parseSimpleBuffChangesFR(descText, "protection-contre-le-poison")
    };
  }

  return null;
}

function attachLot1BuffTemplateEffect(itemObj, sp, durationObj) {
  const rawSlug = String(sp?.slug ?? "").toLowerCase();
  const spellName = String(itemObj?.name ?? sp?.name ?? "");
  const desc = stripHtmlToText(cleanEncounterLinks(sp?.descr ?? ""));
  const spec = resolveLot1BuffTemplateSpec(rawSlug, spellName, desc);
  if (!spec) return { attached: false, reason: "no-spec" };

  itemObj.effects = Array.isArray(itemObj.effects) ? itemObj.effects : [];

  const spellSlug = String(spec.slug ?? rawSlug).toLowerCase();
  const targetMode = String(spec.targetMode ?? "targets").toLowerCase();
  const changes = Array.isArray(spec.changes) ? spec.changes : [];
  if (!changes.length) return { attached: false, reason: "no-changes", spellSlug };

  const existing = itemObj.effects.find(e => {
    const f = e?.flags?.["encounterplus-importer"] ?? e?.flags?.[MODULE_ID] ?? {};
    return !!f?.simpleLot1Buff && !!f?.applyOnCast && String(f?.slug ?? "").toLowerCase() === spellSlug;
  });
  if (existing) return { attached: false, reason: "already-exists", spellSlug, effectName: existing?.name ?? "" };

  const effectId = foundry?.utils?.randomID ? foundry.utils.randomID(16) : crypto.randomUUID().slice(0, 16);
  const effectName = `${itemObj.name} — Buff simple`;
  itemObj.effects.push({
    _id: effectId,
    name: effectName,
    icon: itemObj.img ?? "icons/svg/aura.svg",
    origin: null,
    disabled: false,
    transfer: false,
    duration: (typeof toEffectDuration === "function") ? toEffectDuration(itemObj?.system?.duration ?? durationObj) : {},
    changes,
    flags: {
      [MODULE_ID]: {
        simpleLot1Buff: true,
        slug: spellSlug,
        family: "buffs-resistances",
        applyOnCast: true,
        targetMode
      },
      "encounterplus-importer": {
        simpleLot1Buff: true,
        slug: spellSlug,
        family: "buffs-resistances",
        applyOnCast: true,
        targetMode
      }
    }
  });

  console.log(`[EPI lot1 buff debug] importer attached AE template`, {
    slug: spellSlug,
    effectName,
    effectsCount: itemObj.effects.length
  });

  return { attached: true, spellSlug, effectName, effectId };
}



function parseMaxTargetsFR(text) {
  const t = String(text ?? "").toLowerCase();

  const map = new Map([
    ["un", 1], ["une", 1],
    ["deux", 2],
    ["trois", 3],
    ["quatre", 4],
    ["cinq", 5],
    ["six", 6],
    ["sept", 7],
    ["huit", 8],
    ["neuf", 9],
    ["dix", 10],
    ["onze", 11],
    ["douze", 12],
    ["treize", 13],
    ["quatorze", 14],
    ["quinze", 15],
    ["seize", 16],
    ["dix-sept", 17], ["dix sept", 17],
    ["dix-huit", 18], ["dix huit", 18],
    ["dix-neuf", 19], ["dix neuf", 19],
    ["vingt", 20],
    ["trente", 30],
  ]);

  const toNum = (s) => {
    if (!s) return null;
    const k = String(s).toLowerCase().trim();
    if (/^\d+$/.test(k)) return Number(k);
    return map.get(k) ?? null;
  };

  const qty = "(\\d+|une|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix[\\s-]sept|dix[\\s-]huit|dix[\\s-]neuf|vingt|trente)";
  const tgt = "(créatures?|cibles?|alli[ée]s?)";

  // "jusqu'à un maximum de six créatures"
  let m = t.match(new RegExp(`jusqu[’']?à\\s+(?:un\\s+)?maximum\\s+de\\s+${qty}\\s+${tgt}`, "i"));
  if (m) return toNum(m[1]);

  // "jusqu'à six créatures"
  m = t.match(new RegExp(`jusqu[’']?à\\s+${qty}\\s+${tgt}`, "i"));
  if (m) return toNum(m[1]);

  // "un maximum de six créatures" / "maximum de six créatures"
  m = t.match(new RegExp(`(?:un\\s+)?maximum\\s+de\\s+${qty}\\s+${tgt}`, "i"));
  if (m) return toNum(m[1]);

  // "au maximum six créatures"
  m = t.match(new RegExp(`au\\s+maximum\\s+${qty}\\s+${tgt}`, "i"));
  if (m) return toNum(m[1]);

  // "choisissez X créatures / vous pouvez choisir X créatures"
  m = t.match(new RegExp(`(?:vous\\s+pouvez\\s+choisir|choisissez|peut\\s+choisir)[^\\.]{0,80}\\b${qty}\\s+${tgt}`, "i"));
  if (m) return toNum(m[1]);

  // "affecte X créatures (de votre choix)"
  m = t.match(new RegExp(`affecte[^\\.]{0,120}\\b${qty}\\s+${tgt}(?:\\s+de\\s+votre\\s+choix)?`, "i"));
  if (m) return toNum(m[1]);

  // "un nombre de créatures égal à ..." (rare; keep digits only)
  m = t.match(/nombre\s+de\s+créatures\s+[ée]gal\s*[àa]\s+(\d+)\b/i);
  if (m) return Number(m[1]);

  return null;
}


function parseUnlimitedTargetsFR(text) {
  const t = String(text ?? "").toLowerCase();

  // "toutes les créatures", "chaque créature", "toutes les cibles" (no explicit max)
  if (/(toutes?\s+les\s+créatures?|chaque\s+créature)/i.test(t)) return true;
  if (/(toutes?\s+les\s+cibles?|chaque\s+cible)/i.test(t)) return true;

  // Often used in support spells: "toutes les créatures de votre choix que vous pouvez voir"
  if (/de\s+votre\s+choix[^\.]{0,80}(toutes?\s+les\s+créatures?|chaque\s+créature)/i.test(t)) return true;

  return false;
}

function parseMultiShotTargetsFR(text) {
  const t = String(text ?? "").toLowerCase();

  const map = new Map([
    ["un", 1], ["une", 1],
    ["deux", 2],
    ["trois", 3],
    ["quatre", 4],
    ["cinq", 5],
    ["six", 6],
    ["sept", 7],
    ["huit", 8],
    ["neuf", 9],
    ["dix", 10],
    ["onze", 11],
    ["douze", 12],
  ]);

  const toNum = (s) => {
    if (!s) return null;
    const k = String(s).toLowerCase().trim();
    if (/^\d+$/.test(k)) return Number(k);
    return map.get(k) ?? null;
  };

  const qty = "(\\d+|une|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)";
  // Things that behave like separate "targets": darts/rays/bolts/missiles/beams
  const noun = "(dards?|rayons?|faisceaux?|projectiles?|traits?|missiles?|orbes?|fl(?:e|é|è)ches?|fl(?:e|é|è)chettes?|carreaux?)";// NOTE: FR may use fléchettes (Projectiles magiques)

  // "Vous créez trois rayons..." / "Vous créez trois dards..."
  let m = t.match(new RegExp(`vous\\s+cr[ée]ez\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // "Le sort crée trois projectiles..." / "Le sort crée trois rayons..."
  m = t.match(new RegExp(`(?:le\\s+sort\\s+)?cr[ée]e\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // EN variant: "The spell creates three rays / darts / missiles ..."
  m = t.match(new RegExp(`(?:the\\s+spell\\s+)?creates?\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // "tire trois rayons" / "lance trois projectiles"
  m = t.match(new RegExp(`(?:tire|lance|projette)\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // EN variant: "fire/shoot/cast three rays/missiles"
  m = t.match(new RegExp(`(?:fire|fires|shoot|shoots|cast|casts|launch|launches)\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // "chacun des X rayons" (sometimes phrased like this)
  m = t.match(new RegExp(`chacun[e]?\\s+des?\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // "jusqu'à trois rayons" / "up to three rays"
  m = t.match(new RegExp(`(?:jusqu['’]?\\s*[àa]|up\\s+to)\\s+${qty}\\s+${noun}`, "i"));
  if (m) return toNum(m[1]);

  // "un rayon/fléchette de plus par niveau ..." => infer base count from common baseline spells.
  const hasPerSlotExtra = /(?:rayon|faisceau|projectile|dard|trait|missile|fl[ée]chette|carreau)\\s+de\\s+plus\\s+par\\s+niveau/i.test(t)
    || /one\\s+(?:ray|beam|dart|missile)\\s+more\\s+per\\s+slot/i.test(t);
  if (hasPerSlotExtra) {
    if (/rayon\\s+ardent|scorching\\s+ray/i.test(t)) return 3;
    if (/projectile\\s+magique|magic\\s+missile/i.test(t)) return 3;
  }

  // "deux rayons au niveau 5 ..." (beam-scaling cantrips like Eldritch Blast)
  const hasCantripBeamScale = /(deux|2)\\s+rayons?\\s+au\\s+niveau\\s+5|(trois|3)\\s+rayons?\\s+au\\s+niveau\\s+11|(quatre|4)\\s+rayons?\\s+au\\s+niveau\\s+17/i.test(t)
    || /two\\s+beams?\\s+at\\s+5th\\s+level|three\\s+beams?\\s+at\\s+11th\\s+level|four\\s+beams?\\s+at\\s+17th\\s+level/i.test(t);
  if (hasCantripBeamScale) return 1;

  return null;
}



function applySpellActivitiesFromEncounter(data, rawText, resolved){
  if (!resolved || !(resolved instanceof Map) || !resolved.size) return;
  const mentions = extractSpellMentionsWithCosts(String(rawText ?? ""));
  if (!mentions.length) return;
  for (const m of mentions) {
    const hit = resolved.get(m.name);
    if (hit?.uuid) ensureCastActivity(data, hit.uuid, hit.label ?? m.name, m.cost ?? 1);
  }
}

function parseChargeRecovery(rawText) {
  const raw = String(rawText ?? "");
  // FR/EN patterns: "regagne 1d6+1 charges ... à l'aube" / "regains 1d6+1 ... at dawn"
  let m = raw.match(/regagn(?:e|er)[^\.\n]{0,120}?(\d+d\d+(?:\s*\+\s*\d+)?)\s+charges?[^\.\n]{0,120}?\b(a l['’]?aube|à l['’]?aube|au lever du soleil|dawn|daily at dawn|each day at dawn)\b/i);
  if (!m) m = raw.match(/recuper(?:e|er)[^\.\n]{0,120}?(\d+d\d+(?:\s*\+\s*\d+)?)\s+charges?[^\.\n]{0,120}?\b(a l['’]?aube|à l['’]?aube|au lever du soleil|dawn|daily at dawn|each day at dawn)\b/i);
  if (!m) return null;
  const formula = String(m[1]).replace(/\s+/g, "");
  const timingRaw = String(m[2] ?? "dawn").toLowerCase();
  const timing = /dawn|aube|lever/.test(timingRaw) ? "dawn" : "day";
  return { formula, timing };
}


function stripHtmlToText__epi(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function detectLastChargeDestruction(textOrHtml) {
  const t = stripHtmlToText__epi(textOrHtml);
  const fr = /derni[eè]re charge[\s\S]{0,260}?d20[\s\S]{0,260}?(d[eé]truit|d[eé]truite|vole en [ée]clats|se d[eé]sagr[eè]ge|tombe en poussi[eè]re)[\s\S]{0,160}?\b(1|un)\b/i;
  const en = /last charge[\s\S]{0,260}?roll a d20[\s\S]{0,260}?destroyed[\s\S]{0,160}?\b1\b/i;
  return fr.test(t) || en.test(t);
}

function normalizeLookupName(s) {
  const str = String(s ?? "");
  return foldKey(str)
    .replace(/[’'`´]/g, "'")
    .replace(/\s*\([^)]*\)\s*$/g, "")  // trailing notes
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripHtmlToText(html) {
  const s = String(html ?? "");
  // Keep line breaks so spellcasting sections can be parsed reliably.
  let out = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  // Collapse spaces/tabs but keep newlines
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n[ \t]+/g, "\n").replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{2,}/g, "\n");
  return out.trim();
}


// --- Item spell refs: convert Encounter "[Nom](spell)" to bold + Foundry UUID links ---
function extractEncounterSpellMentions(text) {
  const out = [];
  if (!text) return out;
  const t = String(text);
  const re = /\[([^\]]+?)\]\(spell\)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const name = (m[1] ?? "").trim();
    if (name) out.push(name);
  }
  return [...new Set(out)];
}

async function formatEncounterSpellMentions(text) {
  const raw = String(text ?? "");
  const names = extractEncounterSpellMentions(raw);
  if (!names.length) return { html: toRichText(raw), spellUuids: [] };

  // Resolve spells from world/compendium (Babele-friendly, name normalized)
  const resolved = new Map(); // name -> {uuid, label}
  for (const n of names) {
    const doc = await findItemTemplateByName(n, "spell");
    if (doc?.uuid) resolved.set(n, { uuid: doc.uuid, label: doc.name ?? n });
  }

  // Replace mentions
  const replaced = raw.replace(/\[([^\]]+?)\]\(spell\)/gi, (full, inner) => {
    const nm = String(inner ?? "").trim();
    const hit = resolved.get(nm);
    if (hit?.uuid) return `**@UUID[${hit.uuid}]{${hit.label}}**`;
    return `**${nm}**`;
  });

  const spellUuids = [...new Set([...resolved.values()].map(v => v.uuid))];
  return { html: toRichText(replaced), spellUuids, resolved };
}

// Add a transferred Active Effect (+AC) for items like Staff of Defense when equipped/held.
function addAcBonusEffectIfNeeded(data, name, text) {
  try {
    const t = stripHtmlToText(text ?? "");
    const raw = `${name ?? ""}\n${t}`;
    // Match "bonus de +1 à la classe d'armure" / "bonus de +2 ..."
    const m = raw.match(/bonus\s+de\s*\+(\d)\s+à\s+la\s+classe\s+d['’]armure/i);
    if (!m) return;
    const n = Number(m[1]);
    if (!(n >= 1 && n <= 3)) return;

    data.effects = Array.isArray(data.effects) ? data.effects : [];
    data.effects.push({
      name: `${data.name ?? name ?? "Objet"} : +${n} CA`,
      icon: data.img ?? "icons/svg/aura.svg",
      origin: null,
      disabled: false,
      transfer: true,
      duration: {},
      flags: { dnd5e: { transfer: true } },
      changes: [
        { key: "system.attributes.ac.value", mode: 2, value: String(n), priority: 20 }
      ]
    });
  } catch (e) {}
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Convert Encounter text to a safe-ish rich text HTML block.
// If it already contains HTML tags, keep it (after rewriting asset URLs elsewhere).
function toRichText(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  // crude HTML detection
  if (/<\/?[a-z][\s\S]*>/i.test(t)) return t;
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
}


async function buildSpellIndexOnce({ forceDeep = false } = {}) {
  if (_spellIndexCache.built && (!_spellIndexCache.deepBuilt || !forceDeep)) return _spellIndexCache.map;
  if (_spellIndexCache.deepBuilt && !forceDeep) return _spellIndexCache.map;

  const packs = (game.packs ?? []).filter(p => p.documentName === "Item");
  // Pick likely spell packs first (collection/label)
  let packsToScan = packs
    .map(p => {
      const coll = String(p.collection ?? "").toLowerCase();
      const label = String(p.metadata?.label ?? "").toLowerCase();
      let score = 0;
      if (/(spells|sorts)/i.test(label)) score += 5;
      if (/(spells|sorts)/i.test(coll)) score += 3;
      if (/\.spells($|\b)/i.test(coll)) score += 3;
      if (p.metadata?.package === "dnd5e") score += 2;
      if (p.metadata?.package === "dnd5e_fr-FR") score += 1;
      return { p, score, coll, label };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.p);

  // Fallback: if we didn't detect any "spells" pack, scan all Item packs (slower)
  if (!packsToScan.length) packsToScan = packs;

  _spellIndexCache.packsToScan = packsToScan;

  try {
    const packNames = packsToScan.map(p => `${p.collection} (${p.metadata?.label ?? ""})`).slice(0, 20);
    console.log(`${MODULE_ID} | Spell pack candidates (first 20): ${packNames.join(" | ")}`);
  } catch (e) {}

  const babeleActive = !!game.modules?.get("babele")?.active;

  let scannedPacks = 0;
  let scannedEntries = 0;

  // Fast pass: index by compendium index names (cheap)
  for (const pack of packsToScan) {
    scannedPacks++;
    try {
      const idx = await pack.getIndex(); // DON'T pass deep fields (can break with some setups)
      if (!idx?.length) continue;
      for (const e of idx) {
        scannedEntries++;
        const key = normalizeLookupName(e.name);
        if (!key) continue;
        if (!_spellIndexCache.map.has(key)) _spellIndexCache.map.set(key, { packId: pack.collection, docId: e._id, name: e.name });
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Spell index: failed getIndex for ${pack.collection}`, e);
    }
  }

  // Deep pass (Babele-safe): only if needed
  const needsDeep = forceDeep || babeleActive || _spellIndexCache.map.size < 50;
  if (needsDeep && !_spellIndexCache.deepBuilt) {
    let deepDocs = 0;

    for (const pack of packsToScan) {
      try {
        // getDocuments returns translated docs when Babele is active (good for French matching)
        const docs = await pack.getDocuments();
        if (!docs?.length) continue;

        for (const doc of docs) {
          deepDocs++;
          const names = new Set();

          // Translated runtime name
          if (doc.name) names.add(doc.name);

          // OriginalName flags (if present)
          const on1 = doc.flags?.babele?.originalName;
          if (on1) names.add(on1);

          // Some versions keep original data in _source
          const srcName = doc._source?.name;
          if (srcName) names.add(srcName);

          const on2 = doc._source?.flags?.babele?.originalName;
          if (on2) names.add(on2);

          for (const nm of names) {
            const k = normalizeLookupName(nm);
            if (!k) continue;
            if (!_spellIndexCache.map.has(k)) _spellIndexCache.map.set(k, { packId: pack.collection, docId: doc.id, name: doc.name ?? nm });
          }
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | Spell index: failed deep scan for ${pack.collection}`, e);
      }
    }

    _spellIndexCache.deepBuilt = true;
    _spellIndexCache.stats.deepDocs = deepDocs;
  }

  _spellIndexCache.built = true;
  _spellIndexCache.stats.packsScanned = scannedPacks;
  _spellIndexCache.stats.entriesScanned = scannedEntries;
  _spellIndexCache.stats.babele = babeleActive;

  if (!_spellIndexCache.map.size) {
    ui.notifications.warn(`${MODULE_ID} | Aucun sort indexé depuis les compendiums. Ouvre F12 → Console, on log les packs et erreurs éventuelles.`);
  } else {
    console.log(`${MODULE_ID} | Spell index built: ${_spellIndexCache.map.size} keys, packsScanned=${scannedPacks}, entriesScanned=${scannedEntries}, deepBuilt=${_spellIndexCache.deepBuilt}, deepDocs=${_spellIndexCache.stats.deepDocs ?? 0}, babele=${babeleActive}`);
  }

  return _spellIndexCache.map;
}
async function findSpellEntryByName(name) {
  const wanted = normalizeLookupName(name);
  if (!wanted) return null;

  // First try with whatever we have
  let map = await buildSpellIndexOnce();
  let direct = map.get(wanted);
  if (direct) return direct;

  // Fuzzy contains
  let best = null;
  let bestScore = -Infinity;
  for (const [k, v] of map.entries()) {
    if (!k) continue;
    const a = k.includes(wanted);
    const b = wanted.includes(k);
    if (!a && !b) continue;
    const score = 1000 - Math.abs(k.length - wanted.length);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (best) return best;

  // If Babele (or weird packs) prevented reliable index names, do a deep scan once and retry
  if (!_spellIndexCache.deepBuilt) {
    map = await buildSpellIndexOnce({ forceDeep: true });
    direct = map.get(wanted);
    if (direct) return direct;

    best = null;
    bestScore = -Infinity;
    for (const [k, v] of map.entries()) {
      if (!k) continue;
      const a = k.includes(wanted);
      const b = wanted.includes(k);
      if (!a && !b) continue;
      const score = 1000 - Math.abs(k.length - wanted.length);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (best) return best;
  }

  return null;
}

// Parse spell names from spellcasting trait text.
// Returns array of { name, mode, usesMax, usesPer }
// Parse spell names from spellcasting trait text.
// Returns array of { name, mode, usesMax, usesPer }
function parseSpellEntriesFromText(text, { defaultMode = "prepared" } = {}) {
  const raw = String(text ?? "");
  const entries = [];

  // Fast path: Encounter+ embeds spells as markdown links: [spell name](spell)
  const linkRe = /\[([^\]]+)\]\s*\(spell\)/gi;
  let lm;
  while ((lm = linkRe.exec(raw)) !== null) {
    const name = String(lm[1] ?? "").trim();
    if (!name) continue;

    const ctx = foldKey(raw.slice(Math.max(0, lm.index - 140), lm.index));
    let mode = defaultMode;
    let usesMax = null;
    let usesPer = null;

    if (/(sorts mineurs|cantrip|cantrips|at will|a volonte|à volonte)/i.test(ctx)) mode = "atwill";

    let mm = ctx.match(/(\d+)\s*\/\s*(day|jour)/i);
    if (mm) { mode = "innate"; usesMax = Number(mm[1]); usesPer = "day"; }
    mm = ctx.match(/(\d+)\s*\/\s*(short rest|long rest|rest|repos court|repos long|repos)/i);
    if (mm) {
      mode = "innate";
      usesMax = Number(mm[1]);
      if (/short|court/i.test(mm[2])) usesPer = "sr";
      else if (/long/i.test(mm[2])) usesPer = "lr";
      else usesPer = "day";
    }

    entries.push({ name, mode, usesMax, usesPer });
  }

  // If we found links, that's the most reliable signal → skip the fragile fallback parser.
  if (entries.length) {
    const seen = new Set();
    const out = [];
    for (const e of entries) {
      const k = normalizeLookupName(e.name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }

  // Fallback: parse "Header: a, b, c" segments (plain-text exports)
  const normalized = raw
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*;\s*/g, ";\n")
    .replace(/\.\s+/g, ".\n");

  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/:(.+)/);
    if (parts.length < 3) continue;

    const header = parts[0];
    const rhs = parts[1];

    let mode = defaultMode;
    let usesMax = null;
    let usesPer = null;

    const h = foldKey(header);
    if (/(at will|a volonte|à volonte|toujours|constant)/i.test(h)) mode = "atwill";
    if (/(cantrip|cantrips|tour de magie|tours de magie|sorts mineurs)/i.test(h)) mode = "atwill";

    let mm = h.match(/(\d+)\s*\/\s*(day|jour)/i);
    if (mm) { mode = "innate"; usesMax = Number(mm[1]); usesPer = "day"; }

    mm = h.match(/(\d+)\s*\/\s*(short rest|long rest|rest|repos court|repos long|repos)/i);
    if (mm) {
      mode = "innate";
      usesMax = Number(mm[1]);
      if (/short|court/i.test(mm[2])) usesPer = "sr";
      else if (/long/i.test(mm[2])) usesPer = "lr";
      else usesPer = "day";
    }

    const names = String(rhs ?? "").split(/,\s*/g)
      .map(s => s.trim()
        .replace(/^[•\-\u2022]\s*/g, "")
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .replace(/[.;]+$/g, "")
        .replace(/[*_]+/g, "")
        .trim())
      .filter(Boolean)
      .filter(n => !n.includes(":")); // avoid stray "Header: spell" tokens

    for (const n of names) {
      if (!n || n.length < 2) continue;
      entries.push({ name: n, mode, usesMax, usesPer });
    }
  }

  // Deduplicate
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const k = normalizeLookupName(e.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}


// Extract spell slot counts from spellcasting text (FR/EN best-effort).
// Returns map {1: slots, 2: slots, ...}
function parseSpellSlotsFromText(text) {
  const raw = String(text ?? "");
  const slots = {};

  // English: "1st level (4 slots):"
  const reEn = /(\d+)\s*(?:st|nd|rd|th)\s*level\s*\(\s*(\d+)\s*slots?\s*\)/gi;
  let m;
  while ((m = reEn.exec(raw)) !== null) {
    const lvl = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (lvl >= 1 && lvl <= 9 && Number.isFinite(n)) slots[lvl] = n;
  }

  // French: "1er niveau (4 emplacements):" / "2e niveau (3 emplacements):"
  const reFr = /(\d+)\s*(?:er|e|eme|ème)?\s*niveau\s*\(\s*(\d+)\s*(?:emplacements?|slots?)\s*\)/gi;
  while ((m = reFr.exec(raw)) !== null) {
    const lvl = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (lvl >= 1 && lvl <= 9 && Number.isFinite(n)) slots[lvl] = n;
  }

  
  // French alternate: "Niveau 1 (3 emplacements)"
  const reFrAlt = /\bniveau\s*(\d+)\s*\(\s*(\d+)\s*(?:emplacements?|slots?)\s*\)/gi;
  while ((m = reFrAlt.exec(raw)) !== null) {
    const lvl = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (lvl >= 1 && lvl <= 9 && Number.isFinite(n)) slots[lvl] = n;
  }
return slots;
}


// Extract spellcasting stats from intro text (FR/EN best-effort).
// Returns { level, abilityKey, dc, attack } where abilityKey is one of str/dex/con/int/wis/cha.
function parseSpellcastingMetaFromText(text) {
  const raw = String(text ?? "");
  const t = foldKey(raw);

  // Level
  let level = null;
  // FR: "lanceur de sorts de niveau 4"
  let m = t.match(/(?:lanceur|lanceuse) de sorts? de niveau\s*(\d+)/i);
  if (m) level = Number(m[1]);
  // EN: "4th-level spellcaster"
  if (!level) {
    m = t.match(/(\d+)\s*(?:st|nd|rd|th)?\s*[- ]?level\s*spellcaster/i);
    if (m) level = Number(m[1]);
  }
  // Alternative EN: "spellcaster of 4th level"
  if (!level) {
    m = t.match(/spellcaster\s*(?:of)?\s*(\d+)\s*(?:st|nd|rd|th)?\s*level/i);
    if (m) level = Number(m[1]);
  }

  // Ability
  const abilityMap = [
    { rx: /\bintelligence\b/i, key: "int" },
    { rx: /\bsagesse\b|\bwisdom\b/i, key: "wis" },
    { rx: /\bcharisme\b|\bcharisma\b/i, key: "cha" },
    { rx: /\bforce\b|\bstrength\b/i, key: "str" },
    { rx: /\bdexterite\b|\bdext[ée]rit[ée]\b|\bdexterity\b/i, key: "dex" },
    { rx: /\bconstitution\b/i, key: "con" }
  ];

  let abilityKey = null;
  // FR: "caractéristique d'incantation est l'Intelligence"
  m = t.match(/caracteristique\s+d['’]incantation\s+est\s*(?:l['’]?|la\s+|le\s+)?([a-zéèêàùîôç]+)/i);
  if (!m) m = t.match(/spellcasting\s+ability\s+is\s+([a-z]+)/i);
  const maybeWord = m ? String(m[1]) : "";
  if (maybeWord) {
    for (const a of abilityMap) if (a.rx.test(maybeWord)) { abilityKey = a.key; break; }
  }
  // fallback: search anywhere in intro for a known ability word near "spellcasting ability"/"caractéristique"
  if (!abilityKey) {
    const near = raw.slice(0, 220);
    for (const a of abilityMap) if (a.rx.test(near)) { abilityKey = a.key; break; }
  }

  // DC
  let dc = null;

  // Prefer explicit "DD" segment (FR) even when text between is long
  let ddIdx = raw.search(/\bDD\b/i);
  if (ddIdx >= 0) {
    const slice = raw.slice(ddIdx, ddIdx + 140);
    let mm = slice.match(/(\d{1,2})/);
    if (mm) dc = Number(mm[1]);
  }

  // Fallback FR: any "DD ... 12"
  if (!dc) {
    m = t.match(/\bdd\b[^0-9]{0,80}(\d{1,2})/i);
    if (m) dc = Number(m[1]);
  }

  // EN
  if (!dc) {
    m = t.match(/spell\s*save\s*dc\s*(\d{1,2})/i);
    if (m) dc = Number(m[1]);
  }

  // Spell attack
  let attack = null;
  // "+5 pour toucher avec les attaques de sort"
  m = raw.match(/([+\-]\s*\d+)\s*(?:pour\s+toucher|to\s+hit)[^.\n]{0,120}?(?:attaque(?:s)?\s+de\s+sort|spell\s+attacks?)/i);
  if (m) attack = Number(String(m[1]).replace(/\s+/g, ""));
  // Also accept "+5 pour toucher" if the intro mentions spell attacks elsewhere
  if (attack === null) {
    const hasSpellAttackWords = /(attaque(?:s)?\s+de\s+sort|spell\s+attacks?)/i.test(raw);
    if (hasSpellAttackWords) {
      m = raw.match(/([+\-]\s*\d+)\s*(?:pour\s+toucher|to\s+hit)/i);
      if (m) attack = Number(String(m[1]).replace(/\s+/g, ""));
    }
  }

  if (level !== null && !Number.isFinite(level)) level = null;
  if (dc !== null && !Number.isFinite(dc)) dc = null;
  if (attack !== null && !Number.isFinite(attack)) attack = null;

  return { level, abilityKey, dc, attack };
}



// Rewrite spellcasting/innate spellcasting text into a cleaner D&D 5e statblock style.
// - removes [name](spell) / markdown asterisks
// - keeps sections grouped (cantrips, spell levels, per-day innate, etc.)
function formatSpellcastingText(traitName, sourceText) {
  const plain0 = stripHtmlToText(sourceText);
  let txt = String(plain0 ?? "");
  // remove Encounter+ spell links and markdown emphasis
  txt = txt.replace(/\[([^\]]+)\]\s*\(spell\)/gi, "$1");
  txt = txt.replace(/[*_]+/g, "");
  txt = txt.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return (txt || "");

  const looksLikeSection = (line) => {
    const l = foldKey(line);
    if (!line.includes(":")) return false;
    return /(sorts mineurs|tours de magie|cantrip|niveau|level|a volonte|à volonte|at will|\d+\s*\/\s*(jour|day)|short rest|long rest|repos)/i.test(l);
  };

  let firstSectionIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeSection(lines[i])) { firstSectionIdx = i; break; }
  }

  // Intro: join as a single paragraph, remove "Voici la liste ..." sentence if present
  let intro = lines.slice(0, firstSectionIdx).join(" ");
  intro = intro.replace(/Voici la liste[^.]*[.:]?\s*/i, "").trim();
  intro = intro.replace(/Here is the list[^.]*[.:]?\s*/i, "").trim();
  intro = intro.replace(/\s+/g, " ").trim();

  const sections = [];
  for (const rawLine of lines.slice(firstSectionIdx)) {
    let line = rawLine.replace(/^[•\-\u2022]\s*/g, "").trim();
    if (!line) continue;

    const parts = line.split(/:(.+)/);
    if (parts.length < 3) continue;

    let head = parts[0].trim();
    let rhs = (parts[1] ?? "").trim();

    rhs = rhs.replace(/\[([^\]]+)\]\s*\(spell\)/gi, "$1").replace(/[*_]+/g, "").trim();
    rhs = rhs.replace(/\s+/g, " ");
    if (!rhs) continue;

    const hk = foldKey(head);

    // Normalize common headers
    if (/(sorts mineurs|tour de magie|tours de magie|cantrip)/i.test(hk)) {
      const par = head.match(/\(([^)]+)\)/);
      const suffix = par ? `(${par[1].trim()})` : "(à volonté)";
      head = `Tours de magie ${suffix}`.replace(/\s+/g, " ").trim();
    }

    if (/(at will|a volonte|à volonte)/i.test(hk)) {
      head = head.replace(/at will/ig, "À volonté").replace(/a volonte/ig, "À volonté").replace(/à volonte/ig, "À volonté");
    }

    head = head.replace(/\/\s*day/ig, "/jour").replace(/\s+/g, " ").trim();

    sections.push({ head, rhs });
  }

  // If we didn't manage to build sections, return cleaned text
  if (!sections.length) {
    const outPlain = (intro ? intro + "\n\n" : "") + txt;
    // Convert to basic HTML with line breaks
    return `<p>${outPlain.replace(/\n/g, "<br>")}</p>`;
  }

  // Build readable HTML (real line breaks)
  const html = [];
  if (intro) html.push(`<p>${intro}</p>`);
  for (const s of sections) {
    html.push(`<p><strong>${s.head}</strong> : ${s.rhs}</p>`);
  }
  return html.join("\n");
}
async function buildSpellItemData(entry, { mode = "prepared", usesMax = null, usesPer = null } = {}) {
  const found = await findSpellEntryByName(entry);
  if (!found) return null;

  const pack = game.packs.get(found.packId);
  if (!pack) return null;

  const doc = await pack.getDocument(found.docId);
  if (!doc) return null;

  const data = doc.toObject();

  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  // remove pack source flags that can cause confusion
  if (data.flags?.core) delete data.flags.core.sourceId;

  data.system = data.system ?? {};
  data.system.preparation = data.system.preparation ?? {};
  data.system.preparation.mode = mode || "prepared";
  data.system.preparation.prepared = true;

  data.system.prepared = true;
if (usesMax && usesPer) {
    data.system.uses = data.system.uses ?? {};
    data.system.uses.max = usesMax;
    data.system.uses.value = usesMax;
    data.system.uses.per = usesPer;
  }

  return data;
}

function cloneItemObject(obj) {
  const fu = globalThis.foundry?.utils;
  return fu?.deepClone ? fu.deepClone(obj) : JSON.parse(JSON.stringify(obj));
}

function firstActivityId(itemObj) {
  const acts = itemObj?.system?.activities ?? {};
  return Object.keys(acts)[0] ?? "dnd5eactivity000";
}

function applyAttackToItem(itemObj, parsed, {
  fixed = false,
  measurement = "",
  actorAbilities = {},
  crRaw = "0",
  activationType = "action"
} = {}) {
  const sys = itemObj.system ?? (itemObj.system = {});
  // Ensure range struct exists
  sys.range = sys.range ?? { value: null, long: null, units: "ft", reach: null };

  // Reach / Range
  if (parsed.reachFt != null && parsed.reachFt > 5) sys.range.reach = parsed.reachFt;
  if (parsed.range?.value) sys.range.value = parsed.range.value;
  if (parsed.range?.long) sys.range.long = parsed.range.long;
  sys.range.units = "ft";

  // Ensure damage struct
  sys.damage = sys.damage ?? ensureWeaponDamageStruct();
  sys.damage.base = sys.damage.base ?? makeDamagePart({ number: 1, denomination: 4, bonus: "", types: [] });
  sys.damage.versatile = sys.damage.versatile ?? makeDamagePart({ number: null, denomination: null, bonus: "", types: [] });

  // Decide attack ability + bonuses (portable mode)
  const crNum = crToNumber(crRaw);
  const pb = pbFromCr(crNum);

  const strScore = safeInt(actorAbilities?.str, 10);
  const dexScore = safeInt(actorAbilities?.dex, 10);
  const strMod = abilityMod(strScore);
  const dexMod = abilityMod(dexScore);

  const prefer = (parsed.mode === "ranged") ? "dex" : "str";
  let ability = prefer;
  let atkBonus = "";

  if (!fixed && parsed.toHit != null) {
    const extraStr = parsed.toHit - (strMod + pb);
    const extraDex = parsed.toHit - (dexMod + pb);

    // pick the closest (smallest absolute "extra") with a bias to the preferred stat
    const absStr = Math.abs(extraStr);
    const absDex = Math.abs(extraDex);
    if (absDex < absStr - 0.5) ability = "dex";
    else if (absStr < absDex - 0.5) ability = "str";
    else ability = prefer;

    const mod = (ability === "dex") ? dexMod : strMod;
    const extra = parsed.toHit - (mod + pb);
    if (Number.isFinite(extra) && extra !== 0) atkBonus = String(extra);
  }

  // Activities
  sys.activities = sys.activities ?? {};
  const aid = firstActivityId(itemObj);
  const act = sys.activities[aid] ?? (sys.activities[aid] = {
    _id: aid,
    type: "attack",
    activation: { type: "action", value: 1, condition: "", override: false },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { concentration: false, value: "", units: "inst", special: "", override: false },
    effects: [],
    range: { value: "", units: "ft", special: "", override: false },
    target: { template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" }, affects: { count: "1", type: "creature", choice: false, special: "" }, prompt: true, override: false },
    uses: { spent: 0, max: "", recovery: [] },
    attack: { ability: "str", bonus: "", critical: { threshold: null }, flat: false, type: { value: "melee", classification: "weapon" } },
    damage: { critical: { bonus: "" }, includeBase: true, parts: [] },
    sort: 0,
    flags: {},
    visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
    useConditionText: "",
    useConditionReason: "",
    effectConditionText: "",
    macroData: { name: "", command: "" },
    ignoreTraits: { idi: false, idr: false, idv: false, ida: false, idm: false }
  });

  // Activation type (action/reaction)
  try {
    act.activation = act.activation ?? { type: "action", value: 1 };
    act.activation.type = activationType || "action";
  } catch (e) {}

  // Attack type
  act.type = "attack";
  act.attack = act.attack ?? { ability: "str", bonus: "", critical: { threshold: null }, flat: false, type: { value: "melee", classification: "weapon" } };
  act.attack.type = act.attack.type ?? { value: "melee", classification: "weapon" };
  act.attack.type.value = parsed.mode === "ranged" ? "ranged" : "melee";
  act.attack.type.classification = parsed.classification === "spell" ? "spell" : "weapon";

  if (fixed && parsed.toHit != null) {
    // legacy: keep absolute to-hit
    act.attack.flat = true;
    act.attack.bonus = String(parsed.toHit);
    act.attack.ability = "";
  } else {
    // portable: ability + prof + (item bonus)
    act.attack.flat = false;
    act.attack.ability = ability;
    act.attack.bonus = atkBonus;
  }

  // Damage (portable): custom formula includes @mod + any extra beyond ability mod.
  const formatExtra = (n) => {
    if (!Number.isFinite(n) || n === 0) return "";
    return n > 0 ? ` + ${n}` : ` - ${Math.abs(n)}`;
  };

  const chosenMod = (ability === "dex") ? dexMod : strMod;

  if (parsed.base?.dice) {
    const d = parsed.base.dice;
    const dtype = parsed.base.dtype ? [parsed.base.dtype] : (sys.damage.base.types ?? []);
    const total = d.bonusRaw ? safeInt(d.bonusRaw, 0) : 0;
    const extraDmg = fixed ? total : (d.bonusRaw ? (total - chosenMod) : 0);

    sys.damage.base.number = d.number;
    sys.damage.base.denomination = d.denomination;
    sys.damage.base.types = dtype;
    sys.damage.base.bonus = "";
    sys.damage.base.custom = sys.damage.base.custom ?? { enabled: false, formula: "" };
    sys.damage.base.custom.enabled = true;
    sys.damage.base.custom.formula = `${d.number}d${d.denomination} + @mod${formatExtra(extraDmg)}`;
  }

  if (parsed.versatile?.dice) {
    const d = parsed.versatile.dice;
    const dtype = parsed.versatile.dtype ? [parsed.versatile.dtype] : (sys.damage.versatile.types ?? []);
    const total = d.bonusRaw ? safeInt(d.bonusRaw, 0) : 0;
    const extraDmg = fixed ? total : (d.bonusRaw ? (total - chosenMod) : 0);

    sys.damage.versatile.number = d.number;
    sys.damage.versatile.denomination = d.denomination;
    sys.damage.versatile.types = dtype;
    sys.damage.versatile.bonus = "";
    sys.damage.versatile.custom = sys.damage.versatile.custom ?? { enabled: false, formula: "" };
    sys.damage.versatile.custom.enabled = true;
    sys.damage.versatile.custom.formula = `${d.number}d${d.denomination} + @mod${formatExtra(extraDmg)}`;

    // Mark versatile property if needed
    sys.properties = Array.isArray(sys.properties) ? sys.properties : [];
    if (!sys.properties.includes("ver")) sys.properties.push("ver");
  }

  // Extra damage parts (poison, fire, etc.) - keep as flat dice (+ bonus) without @mod
  act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
  act.damage.includeBase = true;
  act.damage.parts = [];
  if (parsed.extras?.length) {
    for (const ex of parsed.extras) {
      const d = ex.dice;
      if (!d) continue;
      act.damage.parts.push({
        number: d.number,
        denomination: d.denomination,
        bonus: "",
        types: ex.dtype ? [ex.dtype] : [],
        custom: { enabled: true, formula: `${d.number}d${d.denomination}${d.bonusRaw ?? ""}` },
        scaling: { mode: "", number: null, formula: "" }
      });
    }
  }

  
  // ---- Special-case: Web / Toile d'araignée (FVTT v13 Regions) ----
  // Web damage only applies if the web is set on fire; we do NOT automate damage.
  // We also avoid OverTime "save each turn" on the target because Web is zone-based.
  if (USE_WEB_REGIONS) {
    const _n = String(itemObj?.name ?? "").toLowerCase();
    const isWeb = _n.includes("toile d") || _n.includes("toile d’") || _n === "web";
    if (isWeb) {
      // Strip any damage parts that may have been inferred from the text.
      const acts = itemObj?.system?.activities ? Object.values(itemObj.system.activities) : [];
      for (const a of acts) {
        if (!a) continue;
        if (a.damage?.parts) a.damage.parts = [];
        if (a.damage?.includeBase != null) a.damage.includeBase = false;
      }
      // Mark for region automation
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].useWebRegions = true;
    }
  }

return itemObj;
}


async function buildAbilityItems(a, ctx) {
  const name = a?.name ?? (ctx.kind === "reaction" ? "Réaction" : "Action");
  const text = a?.text ?? "";
  const parsed = parseAttackText(text, ctx.measurement);

  // Weapon attacks: create ONE weapon item (no duplication), portable formulas (keep extra bonuses).
  if (parsed && parsed.classification === "weapon" && parsed.base?.dice) {
    const baseItem = guessBaseItemFromName(name);
    const template = baseItem ? await getWeaponTemplateByBaseItem(baseItem) : null;

    // Build from template when possible; fallback to dagger template, then a minimal weapon object.
    let w = null;
    if (template) w = cloneItemObject(template);
    else {
      const fallbackT = await getWeaponTemplateByBaseItem("dagger");
      w = fallbackT ? cloneItemObject(fallbackT) : {
        name,
        type: "weapon",
        img: await pickAbilityIcon(name, text, { kind: "weapon" }),
        system: {
          description: { value: text ?? "" },
          quantity: 1,
          weight: null,
          price: { value: 0, denomination: "gp" },
          attunement: 0,
          equipped: true,
          proficient: true,
          range: { value: null, long: null, units: "ft", reach: null },
          uses: { spent: 0, max: "", recovery: [] },
          damage: ensureWeaponDamageStruct(),
          properties: [],
          type: { value: "simpleM", baseItem: baseItem ?? "" },
          activities: {}
        },
        effects: [],
        flags: {}
      };
    }

    w._id = undefined;
    w.name = name;
    w.system = w.system ?? {};
    w.system.description = { value: text ?? "" };
    w.system.equipped = true;
    w.system.proficient = true;
    if (baseItem && w.system?.type) w.system.type.baseItem = baseItem;

    // Ensure an icon even if the template is missing one
    if (!w.img) w.img = await pickAbilityIcon(name, text, { kind: "weapon" });

    // Apply portable attack/damage formulas (no "flat" to-hit).
    applyAttackToItem(w, parsed, {
      fixed: false,
      measurement: ctx.measurement,
      actorAbilities: ctx.abilities ?? {},
      crRaw: ctx.crRaw ?? "0",
      activationType: (ctx.kind === "reaction") ? "reaction" : "action"
    });

    return [w];
  }

  // Default: keep as feat (text only)
  return [await buildFeat(name, text)];
}

const SKILL_KEY_TO_DND5E = {
  acrobatics: "acr",
  animalHandling: "ani",
  arcana: "arc",
  athletics: "ath",
  deception: "dec",
  history: "his",
  insight: "ins",
  intimidation: "itm",
  investigation: "inv",
  medicine: "med",
  nature: "nat",
  perception: "prc",
  performance: "prf",
  persuasion: "per",
  religion: "rel",
  sleightOfHand: "slt",
  stealth: "ste",
  survival: "sur"
};

const SKILL_KEY_TO_ABILITY = {
  acr: "dex",
  ani: "wis",
  arc: "int",
  ath: "str",
  dec: "cha",
  his: "int",
  ins: "wis",
  itm: "cha",
  inv: "int",
  med: "wis",
  nat: "int",
  prc: "wis",
  prf: "cha",
  per: "cha",
  rel: "int",
  slt: "dex",
  ste: "dex",
  sur: "wis"
};

function abilityMod(score) {
  const s = safeInt(score, 10);
  return Math.floor((s - 10) / 2);
}

function mapSkills(skillsObj, abilitiesObj, crRaw) {
  if (!skillsObj || typeof skillsObj !== "object") return null;
  const crNum = crToNumber(crRaw);
  const pb = pbFromCr(crNum);
  const out = {};

  for (const [k, total] of Object.entries(skillsObj)) {
    const abbr = SKILL_KEY_TO_DND5E[k] ?? null;
    if (!abbr) continue;
    const abil = SKILL_KEY_TO_ABILITY[abbr] ?? null;
    const base = abil ? abilityMod(abilitiesObj?.[abil] ?? 10) : 0;
    const tgt = safeInt(total, 0);
    const diff = tgt - base;

    let value = 0;
    let bonus = 0;
    if (Math.abs(diff - pb) <= 0.75) {
      value = 1;
      bonus = diff - pb;
    } else if (Math.abs(diff - 2 * pb) <= 0.75) {
      value = 2;
      bonus = diff - 2 * pb;
    } else if (Math.abs(diff) <= 0.75) {
      value = 0;
      bonus = diff;
    } else {
      // Fallback: assume proficient and store the remainder as bonus
      value = 1;
      bonus = diff - pb;
    }

    out[abbr] = { value, bonus: Math.round(bonus) };
  }

  return Object.keys(out).length ? out : null;
}

function speedExpr(v, measurement) {
  // dnd5e 5.2+ validates speeds as "safe expressions" (string).
  // Encounter+ exports metric speeds as meters (e.g. 9m = 30ft).
  let n = 0;
  if (typeof v === "number") n = v;
  else n = safeFloat(v, 0);

  // Convert metric -> feet for maximum compatibility (avoids relying on dnd5e metric setting).
  if (String(measurement).toLowerCase() === "metric") n = metersToFeet(n);

  // Always return a clean expression string (no brackets, no objects).
  return String(Math.max(0, Math.round(n)));
}

async function getImageDimensions(url) {
  if (!url) return null;
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function toNpc(mon, basePath, fileIndex, folderId) {
  const d = mon.data ?? {};
  const measurement = mon.attributes?.measurement ?? "";
  const ab = d.abilities ?? {};
  const ac = safeInt(d.ac, 10);
  const hp = safeInt(d.hp, 1);
  const sp = d.speed ?? {};
  const crRaw = d.cr ?? "0";
  const crNum = crToNumber(crRaw);

  // dnd5e schema expects movement speeds as string expressions, not nested objects.
  const movement = {
    walk: speedExpr(sp.walk ?? sp.speed ?? 0, measurement),
    climb: speedExpr(sp.climb ?? 0, measurement),
    fly: speedExpr(sp.fly ?? 0, measurement),
    swim: speedExpr(sp.swim ?? 0, measurement),
    burrow: speedExpr(sp.burrow ?? 0, measurement)
  };

  const items = [];
  const slotAcc = {}; // level->slots parsed from spellcasting text
  const spellcastAcc = { level: null, abilityKey: null, dc: null, attack: null }; // parsed spellcasting stats

  // Traits (passifs)
  for (const a of (d.traits ?? [])) {
    const tName = a.name ?? "Trait";
    const tTextRaw = a.text ?? "";

    // Spellcasting / Incantation (incl. Incantation innée)
    const key = foldKey(tName);
    const isSpellcasting = /(spellcasting|innate spellcasting|incantation)/i.test(key);
    const defaultMode = /(innate|innee|innée)/i.test(key) ? "innate" : "prepared";

    // Re-write the description to resemble official 5e statblocks (remove [ ] links, keep levels, etc.)
    const tText = isSpellcasting ? formatSpellcastingText(tName, tTextRaw) : tTextRaw;
    items.push(await buildFeat(tName, tText));

    if (!isSpellcasting) continue;

    const plain = stripHtmlToText(tTextRaw);
    const meta = parseSpellcastingMetaFromText(plain);
    // Prefer regular Spellcasting for level/slots; but keep innate DC/attack if regular not present.
    if (meta.level && defaultMode === "prepared" && !spellcastAcc.level) spellcastAcc.level = meta.level;
    if (meta.abilityKey && !spellcastAcc.abilityKey) spellcastAcc.abilityKey = meta.abilityKey;
    if (meta.dc && !spellcastAcc.dc) spellcastAcc.dc = meta.dc;
    if (meta.attack && !spellcastAcc.attack) spellcastAcc.attack = meta.attack;

    const spellEntries = parseSpellEntriesFromText(plain, { defaultMode });

    // Spell slots (only for regular Spellcasting, not innate)
    if (defaultMode === "prepared") {
      const sMap = parseSpellSlotsFromText(plain);
      for (const [k, v] of Object.entries(sMap)) slotAcc[Number(k)] = Number(v);
    }


    const existing = new Set(items.filter(i => i?.type === "spell").map(i => normalizeLookupName(i.name)));
    const missing = [];
    let imported = 0;

    for (const se of spellEntries) {
      const data = await buildSpellItemData(se.name, { mode: se.mode || defaultMode, usesMax: se.usesMax, usesPer: se.usesPer });
      if (!data) { missing.push(se.name); continue; }
      const nk = normalizeLookupName(data.name);
      if (existing.has(nk)) continue;
      existing.add(nk);
      items.push(data);
      imported++;
    }

    log("Spellcasting import summary:", (mon?.name ?? tName), { found: spellEntries.length, imported, missing: missing.length });
    try { if (spellEntries.length && imported === 0) ui?.notifications?.warn?.(`${MODULE_ID} | ${mon?.name ?? "PNJ"}: aucun sort importé (noms non trouvés dans les compendiums). Ouvre F12 → Console pour la liste.`); } catch (e) {}
    if (missing.length) {
      log("Missing spells (not found in compendiums):", (mon?.name ?? tName), missing.join(", "));
    }
  }

  // Actions / Réactions (tentatives de parsing "rollable" dnd5e)
  for (const a of (d.actions ?? [])) {
    const built = await buildAbilityItems(a, { kind: "action", measurement, abilities: ab, crRaw });
    for (const it of built) items.push(it);
  }
  for (const a of (d.reactions ?? [])) {
    const built = await buildAbilityItems(a, { kind: "reaction", measurement, abilities: ab, crRaw });
    for (const it of built) items.push(it);
  }

  const tokenImgResolved = resolveAssetPath(basePath, fileIndex, mon.token, { kind: "monster-token", allowNoExtension: true });
  const actorImgResolved = resolveAssetPath(basePath, fileIndex, mon.image, { kind: "monster-image", allowNoExtension: true });

  let actorImg = actorImgResolved ?? tokenImgResolved;
  let tokenImg = tokenImgResolved ?? actorImgResolved;

  // If the portrait filename uses decomposed Unicode (NFD), it may fail to load on some systems.
  // In that case, prefer the token image (usually ASCII-safe).
  try {
    const leaf = String(actorImg ?? "").split("/").pop() ?? "";
    if (leaf && leaf.normalize("NFC") !== leaf && tokenImg) actorImg = tokenImg;
  } catch (e) {}


  // Ensure Foundry validations are happy.
  if (!hasValidImageExtension(actorImg)) actorImg = "icons/svg/mystery-man.svg";
  if (!hasValidImageExtension(tokenImg)) tokenImg = actorImg;

  // For Actor/Token document fields, store a data path (not a /files/data URL).
  // Normalize any /files... or http URL back into a data path so Foundry can resolve it.
  actorImg = normalizeDataPath(actorImg) ?? actorImg;
  tokenImg = normalizeDataPath(tokenImg) ?? tokenImg;


  const sizeCode = String(d.size ?? "").toUpperCase();
  const size = sizeCode === "S" ? "sm" : sizeCode === "T" ? "tiny" : sizeCode === "L" ? "lg" : "med";

  const mappedSkills = mapSkills(d.skills, ab, crRaw);

  // Senses: Encounter+ exports numeric values (often meters). We store in ft for consistency.
  const sensesIn = d.senses ?? {};
  const sensesOut = {};
  for (const [k, v] of Object.entries(sensesIn)) {
    const n = safeFloat(v, 0);
    const ft = (String(measurement).toLowerCase() === "metric") ? metersToFeet(n) : n;
    sensesOut[k] = Math.round(ft);
  }
  // Apply spell slots parsed from spellcasting text
  if (Object.keys(slotAcc).length) {
    // dnd5e NPC schema usually uses system.spells.spell1..spell9 {value,max,override}
    const spells = (dnd5e?.actor?.models?.npc?.spells) ? foundry.utils.deepClone(dnd5e.actor.models.npc.spells) : {};
    // If model not available, create minimal structure
    for (let lvl = 1; lvl <= 9; lvl++) {
      const key = `spell${lvl}`;
      spells[key] ??= { value: 0, max: 0, override: null };
    }
    for (const [lvlStr, n] of Object.entries(slotAcc)) {
      const lvl = Number(lvlStr);
      if (!(lvl >= 1 && lvl <= 9)) continue;
      const key = `spell${lvl}`;
      spells[key] ??= { value: 0, max: 0, override: null };
      spells[key].override = Number(n) || 0;
      spells[key].max = Number(n) || 0;
      spells[key].value = Number(n) || 0;
    }
    // We'll attach later by merging into system when building actor data.
    d._spellSlotsParsed = spells;

  // Apply spellcasting stats parsed from spellcasting intro (ability, DC, attack, caster level)
  if (spellcastAcc.abilityKey || spellcastAcc.dc || spellcastAcc.attack || spellcastAcc.level) {
    d._spellcastingParsed = {
      abilityKey: spellcastAcc.abilityKey ?? null,
      dc: spellcastAcc.dc ?? null,
      attack: spellcastAcc.attack ?? null,
      level: spellcastAcc.level ?? null
    };
  }
  }


  return {
    name: mon.name ?? "NPC",
    type: "npc",
    img: actorImg,
    folder: folderId,
    prototypeToken: {
      name: mon.name ?? "NPC",
      texture: { src: tokenImg },
      actorLink: false
    },
    system: {
      ...(d._spellSlotsParsed ? { spells: d._spellSlotsParsed } : {}),
      abilities: {
        str: { value: safeInt(ab.str, 10) },
        dex: { value: safeInt(ab.dex, 10) },
        con: { value: safeInt(ab.con, 10) },
        int: { value: safeInt(ab.int, 10) },
        wis: { value: safeInt(ab.wis, 10) },
        cha: { value: safeInt(ab.cha, 10) }
      },
      attributes: {
        ...(d._spellcastingParsed ? {
          spellcasting: d._spellcastingParsed.abilityKey ?? undefined,
          spelldc: d._spellcastingParsed.dc ?? undefined,
          spellattack: d._spellcastingParsed.attack ?? undefined,
          spellDC: d._spellcastingParsed.dc ?? undefined,
          spellAttack: d._spellcastingParsed.attack ?? undefined
        } : {}),
        ac: { value: ac },
        hp: { value: hp, max: hp },
        movement,
        senses: sensesOut
      },
      details: {
        ...(d._spellcastingParsed ? { spellLevel: (d._spellcastingParsed.level ?? undefined) } : {}),
        cr: crNum,
        type: { value: d.type ?? "" },
        alignment: d.alignment ?? "",
        biography: { value: d.description ?? "" }
      },
      traits: {
        size,
        languages: { custom: d.languages ?? "" }
      },
      ...(mappedSkills ? { skills: mappedSkills } : {})
    },
    items,
    flags: { [MODULE_ID]: { kind: "monster", id: mon.id, slug: mon.slug } }
  };
}


// ===== Item import (dnd5e-friendly) =====
let _itemPackIndexBuilt = false;
const _itemIndexByNormName = new Map(); // normName -> [{pack, id, type, name}]
async function buildItemPackIndex() {
  if (_itemPackIndexBuilt) return;
  _itemPackIndexBuilt = true;
  try {
    for (const p of (game.packs ?? [])) {
      if (p.documentName !== "Item") continue;
      // Some packs may not be accessible
      try {
        const idx = await p.getIndex({ fields: ["name", "type", "flags.babele.originalName"] });
        for (const row of idx) {
          const names = [row.name, row.flags?.babele?.originalName].filter(Boolean);
          for (const n of names) {
            const key = normalizeLookupName(n);
            if (!key) continue;
            const arr = _itemIndexByNormName.get(key) ?? [];
            arr.push({ pack: p.collection, id: row._id, type: row.type, name: row.name });
            _itemIndexByNormName.set(key, arr);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
}

async function findItemTemplateByName(name, typeHint = null) {
  if (!name) return null;
  const key = normalizeLookupName(name);
  if (!key) return null;

  // World first
  try {
    const w = (game.items ?? []).find(i => normalizeLookupName(i?.name ?? "") === key && (!typeHint || i.type === typeHint));
    if (w) return w;
    if (!typeHint) {
      const w2 = (game.items ?? []).find(i => normalizeLookupName(i?.name ?? "") === key);
      if (w2) return w2;
    }
  } catch (e) {}

  await buildItemPackIndex();
  const hits = _itemIndexByNormName.get(key) ?? [];
  const filtered = typeHint ? hits.filter(h => h.type === typeHint) : hits;

  for (const h of filtered) {
    try {
      const pack = game.packs.get(h.pack);
      if (!pack) continue;
      const doc = await pack.getDocument(h.id);
      if (doc) return doc;
    } catch (e) {}
  }

  return null;
}

function parseMagicBonusFromNameOrText(name, text) {
  const raw = `${name ?? ""} ${text ?? ""}`;
  const m = raw.match(/\+(\d)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  return (n >= 1 && n <= 3) ? n : 0;
}

function parseChargesFromText(text) {
  if (!text) return null;
  const t = stripHtmlToText(text);
  // "contient 10 charges" / "a 10 charges"
  let m = t.match(/(?:contient|a)\s+(\d{1,2})\s+charges?/i);
  if (m) return Number(m[1]);
  return null;
}

function requiresAttunement(text) {
  if (!text) return false;
  const t = stripHtmlToText(text).toLowerCase();
  return t.includes("harmoniser") || t.includes("harmonisation") || t.includes("attunement");
}

function guessBaseItemKeys(encType, name, text) {
  const t = `${name ?? ""} ${stripHtmlToText(text ?? "")}`.toLowerCase();

  if (encType === "staff" || t.includes("bâton") || t.includes("baton") || t.includes("staff")) {
    return ["Bâton", "Quarterstaff"];
  }
  if (encType === "meleeWeapon") {
    if (t.includes("masse")) return ["Masse d'armes", "Mace"];
    if (t.includes("épée longue") || t.includes("epee longue") || t.includes("longsword")) return ["Épée longue", "Longsword"];
    if (t.includes("dague") || t.includes("dagger")) return ["Dague", "Dagger"];
    if (t.includes("marteau")) return ["Marteau", "Warhammer", "Hammer"];
  }
  if (encType === "mediumArmor" || t.includes("cuirasse") || t.includes("breastplate")) {
    return ["Cuirasse", "Breastplate"];
  }
  if (encType === "heavyArmor" || t.includes("armure de plates") || t.includes("plate")) {
    return ["Armure de plates", "Plate Armor"];
  }
  if (encType === "shield" || t.includes("bouclier") || t.includes("shield")) {
    return ["Bouclier", "Shield"];
  }
  return [];
}

function applyChargesAndAttunement(itemData, text) {
  const charges = parseChargesFromText(text);
  if (charges && itemData?.system) {
    itemData.system.uses = itemData.system.uses ?? {};
    itemData.system.uses.max = charges;
    itemData.system.uses.value = charges;
    // leave per as null; dnd5e handles uses with max/value; some versions use per = "charges"
    itemData.system.uses.per = itemData.system.uses.per ?? null;
  }
  if (requiresAttunement(text) && itemData?.system) {
    // In dnd5e, attunement: 0 none, 1 required. Some versions use "attunement": 1
    itemData.system.attunement = 1;
  }

  // Charge recovery (dawn/dusk) -> dnd5e uses "lr" period for daily recharge
  try {
    const rec = parseChargeRecoveryV2(text);
    if (rec) {
      itemData.system = itemData.system ?? {};
      itemData.system.uses = itemData.system.uses ?? { spent: 0, recovery: [], max: "" };
      itemData.system.uses.recovery = [{ period: "lr", type: "formula", formula: rec.formula }];
      itemData.flags = itemData.flags ?? {};
      itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] ?? {};
      itemData.flags[MODULE_ID].chargeRecoveryTiming = rec.timing;
    }
  } catch (e) {}

}

function applyWeaponMagicBonus(itemData, bonus) {
  if (!itemData?.system || !bonus) return;
  // Generic: add attack bonus and +bonus to first damage formula if it looks like dice.
  itemData.system.attackBonus = String(bonus);
  const parts = itemData.system.damage?.parts;
  if (Array.isArray(parts) && parts.length) {
    const first = parts[0];
    if (Array.isArray(first) && typeof first[0] === "string") {
      const f = first[0];
      if (/\d+d\d+/.test(f) && !/[+\-]\s*\d+/.test(f)) first[0] = `${f}+${bonus}`;
      else if (/\d+d\d+/.test(f)) first[0] = f.replace(/\s*$/, `+${bonus}`);
    }
  }
}

function applyArmorMagicBonus(itemData, bonus) {
  if (!itemData?.system || !bonus) return;
  const armor = itemData.system.armor;
  if (armor && typeof armor.value === "number") armor.value += bonus;
  // Also keep a note
}


function schoolToDnd5e(s) {
  const v = String(s ?? "").toLowerCase();
  const map = {
    abjuration: "abj",
    conjuration: "con",
    divination: "div",
    enchantment: "enc",
    evocation: "evo",
    illusion: "ill",
    necromancy: "nec",
    transmutation: "trs",
  };
  return map[v] ?? "abj";
}

function cleanEncounterLinks(md) {
  let t = String(md ?? "");
  // Replace markdown links like [inconsciente](/condition/inconscient) -> inconsciente
  t = t.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, "$1");
  // Replace Encounter+ style [spell] tags or similar brackets leftovers
  t = t.replace(/\[(spell|item|condition|monster|journal)\]/gi, "");
  // Normalize bold ***text*** and **text**
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Line breaks -> paragraphs
  const lines = t.split(/\n+/).map(l => l.trim()).filter(Boolean);
  return lines.length ? `<p>${lines.join("</p><p>")}</p>` : "";
}

function toDnd5eRange(sp, measurement) {
  const rt = sp?.data?.rangeType ?? null;
  const r = sp?.data?.range ?? null;
  const srcMetric = (measurement === "metric");
  const wantMetric = srcMetric || !!game.settings.get(MODULE_ID, SETTINGS.USE_METRIC);

  if (rt === "self") return { value: null, units: "self" };
  if (rt === "touch") return { value: null, units: "touch" };
  if (rt === "sight") return { value: null, units: "spec" };
  if (rt === "unlimited") return { value: null, units: "any" };

  if (typeof r === "number") {
    if (wantMetric) {
      const meters = srcMetric ? r : feetToMeters(r);
      return { value: meters, units: "m" };
    } else {
      const feet = srcMetric ? metersToFeet(r) : r;
      return { value: feet, units: "ft" };
    }
  }

  return { value: null, units: "spec" };
}

function toDnd5eDuration(sp) {
  const d = sp?.data?.duration;
  const du = sp?.data?.durationUnit ?? null;
  const dt = sp?.data?.durationType ?? null;
  if (dt === "instant" || dt === "instantaneous") return { value: null, units: "inst", concentration: false };
  const concentration = dt === "concentration";
  if (!d) {
    // e.g. "special"
    return { value: null, units: dt === "special" ? "spec" : "inst", concentration };
  }
  const unitMap = {
    round: "round",
    minute: "minute",
    hour: "hour",
    day: "day",
    week: "week",
    month: "month",
    year: "year",
  };
  return { value: d, units: unitMap[String(du ?? "").toLowerCase()] ?? "minute", concentration };
}

function toDnd5eActivation(sp) {
  const a = sp?.data?.activation ?? {};
  const unit = String(a.unit ?? "action").toLowerCase();
  const unitMap = {
    action: "action",
    bonus: "bonus",
    bonusaction: "bonus",
    reaction: "reaction",
    minute: "minute",
    hour: "hour",
    day: "day",
  };
  return { type: unitMap[unit] ?? "action", cost: a.time ?? 1, condition: "" };
}

function inferAreaFromDescription(descr) {
  const text = String(descr ?? "")
    .replace(/\u2019/g, "'")
    .toLowerCase();

  // Try to infer basic area templates from French descriptions (metric).
  // We keep this conservative to avoid confusing spell range with area.
  const num = (m) => {
    if (!m) return null;
    const v = String(m).replace(",", ".");
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Cube / Square (side length)
  let m = text.match(/\b(cube)\b[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b[^.]{0,40}\b(ar[eê]te|c[oô]t[eé])\b/);
  if (m) return { shape: "cube", size: num(m[2]) };

  m = text.match(/\b(carr[eé]|zone)\b[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b[^.]{0,60}\b(c[oô]t[eé])\b/);
  if (m) return { shape: "square", size: num(m[2]) };

  // Sphere (radius)
  m = text.match(/\b(sph[eè]re)\b[^0-9]{0,60}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b[^.]{0,60}\b(rayon)\b/);
  if (m) return { shape: "sphere", size: num(m[2]) };

  // Cylinder (radius) - very rare in the FR text, but include it
  m = text.match(/\b(cylindre)\b[^0-9]{0,60}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b[^.]{0,60}\b(rayon)\b/);
  if (m) return { shape: "cylinder", size: num(m[2]) };

  // Cone (length)
  m = text.match(/\b(c[oô]ne)\b[^0-9]{0,60}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b/);
  if (m) return { shape: "cone", size: num(m[2]) };

  // Line (length)
  m = text.match(/\b(ligne)\b[^0-9]{0,60}(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres)?\b[^.]{0,40}\b(long|longueur)\b/);
  if (m) return { shape: "line", size: num(m[2]) };

  return null;
}

function toDnd5eTarget(sp, measurement) {
  let shape = String(sp?.data?.areaEffectShape ?? "").toLowerCase();
  let size = sp?.data?.areaEffectSize ?? null;
  const inferred = (!shape || size == null) ? inferAreaFromDescription(sp?.descr) : null;
  if (inferred?.shape && inferred?.size != null) {
    shape = inferred.shape;
    size = inferred.size;
  }
  const rangeType = String(sp?.data?.rangeType ?? "").toLowerCase();
  const srcMetric = (measurement === "metric");
  const wantMetric = srcMetric || !!game.settings.get(MODULE_ID, SETTINGS.USE_METRIC);

  // Hard fallback for Grease: Encounter+ exports sometimes omit the template metadata.
  // RAW: 10-foot square (≈3 m square) centered on a point within range.
  // We intentionally round to 3 m when using metric for nicer scene placement.
  const slug = String(sp?.slug ?? "").toLowerCase();
  if ((!shape || size == null) && (slug === "graisse" || slug === "grease")) {
    return wantMetric
      ? { value: 3, units: "m", type: "cube", prompt: true }
      : { value: 10, units: "ft", type: "cube", prompt: true };
  }

  // Hard fallback for Lightning Bolt: enforce the canonical line template.
  // Some Encounter+ exports provide incomplete/incorrect area metadata for this spell.
  if (slug === "eclair" || slug === "lightning-bolt") {
    return wantMetric
      ? { value: 30, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 100, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallback for Blade Barrier: Encounter+ exports may omit the template metadata.
  // RAW: straight wall up to 100 ft long and 5 ft thick OR ring up to 60 ft diameter and 5 ft thick.
  // We default the item target to the LINE form; applySpellActivities will add an alternate RING activity.
  if ((!shape || size == null) && (slug === "barriere-de-lames" || slug === "blade-barrier")) {
    return wantMetric
      ? { value: 30, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 100, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallback for Wall of Fire: Encounter+ exports may omit the template metadata.
  // RAW: straight wall up to 60 ft long and 1 ft thick OR ring up to 20 ft diameter and 1 ft thick.
  // We default the item target to the LINE form; applySpellActivities will add an alternate CIRCLE activity.
  if ((!shape || size == null) && (slug === "mur-de-feu" || slug === "wall-of-fire")) {
    return wantMetric
      ? { value: 18, units: "m", type: "line", width: 0.3, prompt: true }
      : { value: 60, units: "ft", type: "line", width: 1, prompt: true };
  }

  // Hard fallback for Wall of Thorns: Encounter+ exports may omit the template metadata.
  // RAW: straight wall 60 ft long and 5 ft thick OR ring 20 ft diameter and 5 ft thick.
  // We default the item target to the LINE form; applySpellActivities will add the alternate RING activity.
  if ((!shape || size == null) && (slug === "mur-d-epines" || slug === "wall-of-thorns")) {
    return wantMetric
      ? { value: 18, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 60, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallback for Wall of Light: line wall 60 ft long and 5 ft thick.
  if ((!shape || size == null) && (slug === "mur-de-lumiere" || slug === "wall-of-light")) {
    return wantMetric
      ? { value: 18, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 60, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallback for Flaming Sphere: moving 5-ft sphere template.
  if ((!shape || size == null) && (slug === "sphere-de-feu" || slug === "flaming-sphere")) {
    return wantMetric
      ? { value: 1.5, units: "m", type: "sphere", prompt: true }
      : { value: 5, units: "ft", type: "sphere", prompt: true };
  }

  // Hard fallback for Aqueous Sphere: moving 5-ft sphere template.
  if ((!shape || size == null) && (slug === "sphere-aqueuse" || slug === "aqueous-sphere")) {
    return wantMetric
      ? { value: 1.5, units: "m", type: "sphere", prompt: true }
      : { value: 5, units: "ft", type: "sphere", prompt: true };
  }

  // Hard fallback for Wall of Force: either a line made of 10 panels (up to 100 ft) or a sphere/dome up to 10 ft radius.
  // We default the item target to the LINE form; use-time code can switch to the sphere form.
  if ((!shape || size == null) && (slug === "mur-de-force" || slug === "wall-of-force")) {
    return wantMetric
      ? { value: 30, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 100, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallback for Wall of Ice: line made of 10 panels (up to 100 ft) or sphere/dome up to 10 ft radius.
  if ((!shape || size == null) && (slug === "mur-de-glace" || slug === "wall-of-ice")) {
    return wantMetric
      ? { value: 30, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 100, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Hard fallbacks for the other wall spells whose Encounter+ exports often omit usable template metadata.
  if ((!shape || size == null) && (slug === "mur-de-pierre" || slug === "wall-of-stone")) {
    return wantMetric
      ? { value: 30, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 100, units: "ft", type: "line", width: 5, prompt: true };
  }
  if ((!shape || size == null) && (slug === "mur-de-sable" || slug === "wall-of-sand")) {
    return wantMetric
      ? { value: 9, units: "m", type: "line", width: 3, prompt: true }
      : { value: 30, units: "ft", type: "line", width: 10, prompt: true };
  }
  if ((!shape || size == null) && (slug === "mur-de-vent" || slug === "wall-of-wind")) {
    return wantMetric
      ? { value: 15, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 50, units: "ft", type: "line", width: 5, prompt: true };
  }
  if ((!shape || size == null) && (slug === "mur-d-eau" || slug === "wall-of-water")) {
    return wantMetric
      ? { value: 9, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 30, units: "ft", type: "line", width: 5, prompt: true };
  }
  if ((!shape || size == null) && (slug === "mur-prismatique" || slug === "prismatic-wall")) {
    return wantMetric
      ? { value: 27, units: "m", type: "line", width: 1.5, prompt: true }
      : { value: 90, units: "ft", type: "line", width: 5, prompt: true };
  }

  // Area templates (zones)
  if (shape && size != null) {
    const typeMap = { sphere: "sphere", cone: "cone", cylinder: "cylinder", cube: "cube", square: "cube", line: "line" };
    const type = typeMap[shape] ?? "";
    const base = srcMetric ? Number(size) : roundTo5(size); // keep 5-ft increments for imperial exports
    const val = wantMetric ? (srcMetric ? base : feetToMeters(base)) : (srcMetric ? metersToFeet(base) : base);
    const units = wantMetric ? "m" : "ft";
    if (type === "line") {
      const width = (units === "m") ? 1.5 : 5;
      return { value: val, units, type, width, prompt: true };
    }
    return { value: val, units, type, prompt: true };
  }

  // Single-target / self targeting (best-effort; Encounter+ doesn't store target count)
  if (rangeType === "self") return { value: null, units: "", type: "self", prompt: false };
  if (rangeType === "touch") return { value: 1, units: "", type: "creature", prompt: true };

  // If the spell has a numeric range, assume it targets one creature by default
  if (sp?.data?.range != null) return { value: 1, units: "", type: "creature", prompt: true };

  return { value: null, units: "", type: "", prompt: false };
}


async function toDnd5eSpell(sp, folderId) {
  const name = sp?.name ?? "Sort";
  const measurement = sp?.attributes?.measurement ?? "imperial";
  const descHtml = cleanEncounterLinks(sp?.descr ?? "");
  const descText = stripHtmlToText(descHtml);
  const comps = Array.isArray(sp?.data?.components) ? sp.data.components : [];
  const detail = sp?.data?.componentsDetail ?? null;

  const range = toDnd5eRange(sp, measurement);
  const duration = toDnd5eDuration(sp);
  const activation = toDnd5eActivation(sp);
  const target = toDnd5eTarget(sp, measurement);

  const level = Number(sp?.data?.level ?? 0);
  const school = schoolToDnd5e(sp?.data?.school);

  const src = (sp?.sources?.[0]?.name ?? "");

  const regionRuleBySlug = {
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
  const inferredRegion = inferRegionRuleFromDesc(descText, descHtml);
  const regionRule = regionRuleBySlug[String(sp?.slug ?? "").toLowerCase()] ?? inferredRegion.ruleKey ?? null;
  const regionMeta = inferredRegion.meta ?? null;

  const out = {
    name,
    type: "spell",
    img: await pickSpellIcon(name, school, descText),
    folder: folderId,
    system: {
      level,
      school,
      source: src,
      description: { value: descHtml, chat: "", unidentified: "" },
      activation,
      duration: { value: duration.value, units: duration.units },
      target,
      range,
      uses: { value: null, max: "", per: null },
      consume: { type: "", target: null, amount: null, scale: false },
      ability: "",
      actionType: "util",
      attackBonus: "",
      critical: { threshold: null, damage: "" },
      damage: { parts: [], versatile: "" },
      save: { ability: "", dc: null, scaling: "spell" },
      formula: "",
      properties: [
        duration.concentration ? "concentration" : null,
        (sp?.data?.ritual ? "ritual" : null),
        (comps.includes("V") ? "vocal" : null),
        (comps.includes("S") ? "somatic" : null),
        (comps.includes("M") ? "material" : null)
      ].filter(Boolean),
      materials: { value: detail ?? "", consumed: false, cost: 0, supply: 0 },
      preparation: { mode: "prepared", prepared: false },
    },
    flags: {
      "encounterplus-importer": {
        sourceId: sp?.id ?? null,
        slug: sp?.slug ?? null,
        measurement,
        classes: sp?.data?.classes ?? [],
        regionRule: regionRule,
        regionMeta: regionMeta,
      }
    }
  };

  // Populate Activities + Effects tabs (best-effort, non-breaking)
  try { applySpellActivities(out, sp, duration, measurement); } catch (e) {
    console.warn("encounterplus-importer | applySpellActivities failed", name, e);
  }
  try { applySpellEffects(out, sp, duration, measurement); } catch (e) {
    console.warn("encounterplus-importer | applySpellEffects failed", name, e);
  }

  // Hard guarantee for lot-1 buff templates on imported spell items.
  // If a template should exist (Divine Favor / Protection from Poison), ensure it is present on the final item payload.
  try { attachLot1BuffTemplateEffect(out, sp, duration); } catch (e) {
    console.warn("encounterplus-importer | attachLot1BuffTemplateEffect failed", name, e);
  }

  return out;
}

function applySpellActivities(itemObj, sp, durationObj, measurement) {
  const sys = itemObj.system ?? (itemObj.system = {});
  sys.activities = sys.activities ?? {};

  // IMPORTANT (Foundry v13 / dnd5e v5 + Midi-QOL): we want the Save DC to ALWAYS match the casting actor.
  // We therefore use a dynamic formula that evaluates against the actor rollData.
  // This also avoids edge-cases where an actor's abilities.*.dc ends up at 0 and the system keeps it (nullish).
  const CASTER_DC_FORMULA = "@attributes.spell.dc";
  const forceCasterSaveDC = () => {
    try {
      for (const a of Object.values(sys.activities ?? {})) {
        if (!a || a.type !== "save") continue;
        a.save = a.save ?? { ability: [], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
        a.save.dc = a.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
        // Custom formula mode (empty calculation) → uses formula to compute dc.value.
        a.save.dc.calculation = "";
        a.save.dc.formula = CASTER_DC_FORMULA;
        try { delete a.save.dc.value; } catch (e) { a.save.dc.value = null; }
      }
    } catch (e) { /* ignore */ }
  };

  const descText = stripHtmlToText(cleanEncounterLinks(sp?.descr ?? ""));
  let saveAb = parseSpellSaveFR(descText);
  let atk = parseSpellAttackFR(descText);
  const delayedNextForFilter = parseDelayedDamageNextTurnFR(descText);
  const dotEachTurnForFilter = parseRecurringDamageEachTurnFR(descText);
  const dmgInfo = parseAllDamageDiceFR(descText);
  const damagesRaw = dmgInfo?.hits ?? [];
  let damages = (() => {
    let arr = damagesRaw;

    const removeOne = (spec) => {
      if (!spec) return;
      let idx = -1;
      for (let i = 0; i < arr.length; i++) {
        const h = arr[i];
        if (Number(h?.number) === Number(spec.number) && Number(h?.denom) === Number(spec.denom)) {
          const ht = String(h?.dtype ?? "");
          const dt = String(spec.dtype ?? "");
          if (!dt || !ht || ht === dt) idx = i;
        }
      }
      if (idx >= 0) arr = arr.filter((_, i) => i !== idx);
    };

    // Remove the delayed-next-turn dice phrase from the main damage list (it will be handled by an OverTime effect).
    removeOne(delayedNextForFilter);
    // Remove the recurring each-turn damage phrase from the main damage list (it will be handled by an OverTime effect).
    removeOne(dotEachTurnForFilter);

    return arr;
  })();
  const halfOnSave = !!dmgInfo?.halfOnSave;
  const aoe = parseAoeRadiusFR(descText);
  const isWeaponAoeBuff = isWeaponTriggeredAoeBuff(descText) && String(sp?.data?.rangeType ?? "").toLowerCase() === "self";
  const scaling = parseScalingFR(descText, Number(sys.level ?? 0));
  const __epiSpellSlug = String(sp?.slug ?? "").toLowerCase();
  const __epiSpellName = String(itemObj?.name ?? sp?.name ?? "").toLowerCase();
  const isBeamScalingCantrip = !!(
    scaling?.kind === "cantrip" && (
      __epiSpellSlug === "decharge-occulte"
      || /d[ée]charge\s+occulte|eldritch\s+blast/i.test(__epiSpellName)
      || /jet\s+d['’]attaque\s+distinct\s+pour\s+chaque\s+rayon|attack\s+roll\s+distinct\s+for\s+each\s+beam/i.test(descText)
    )
  );

  // ---- Special-case: FVTT v13 Regions (zone spells) ----
  // For some spells, automation is much easier and more reliable with Regions.
  // We mark the item with a regionRule and let regions-web.mjs handle the logic:
  // - initial application to tokens already in the area
  // - token entry
  // - start/end of turn triggers
  const __spellNameLC = String(itemObj?.name ?? sp?.name ?? "").toLowerCase();
  const __isWeb = __spellNameLC.includes("toile d'araignée") || __spellNameLC.includes("toile d’araignée") || __spellNameLC === "web";
  const __isGrease = __spellNameLC === "graisse" || __spellNameLC === "grease";
  const __isEntangle = __spellNameLC === "enchevêtrement" || __spellNameLC === "entangle";
  const __isTentacles = __spellNameLC.includes("tentacules noirs") || __spellNameLC.includes("black tentacles");
  const __isHadar = __spellNameLC.includes("voracité de hadar") || __spellNameLC.includes("hunger of hadar");
  const __isSpikeGrowth = (__spellNameLC.includes("croissance d") && __spellNameLC.includes("épines")) || __spellNameLC.includes("spike growth");
  const __isInsectPlague = (__spellNameLC.includes("fléau d") && __spellNameLC.includes("insect")) || __spellNameLC.includes("insect plague");
  const __isBladeBarrier = __spellNameLC.includes("barrière de lames") || __spellNameLC.includes("barriere de lames") || __spellNameLC.includes("blade barrier");
  const __isWallOfThorns = (__spellNameLC.includes("mur d’épines") || __spellNameLC.includes("mur d'epines") || __spellNameLC.includes("mur d’epines") || __spellNameLC.includes("wall of thorns"));
  const __isWallOfFire = __spellNameLC.includes("mur de feu") || __spellNameLC.includes("wall of fire");
  const __isWallOfLight = __spellNameLC.includes("mur de lumière") || __spellNameLC.includes("mur de lumiere") || __spellNameLC.includes("wall of light");
  const __isWallOfForce = __spellNameLC.includes("mur de force") || __spellNameLC.includes("wall of force");
  const __isWallOfIce = __spellNameLC.includes("mur de glace") || __spellNameLC.includes("wall of ice");
  const __isWallOfStone = __spellNameLC.includes("mur de pierre") || __spellNameLC.includes("wall of stone");
  const __isWallOfSand = __spellNameLC.includes("mur de sable") || __spellNameLC.includes("wall of sand");
  const __isWallOfWind = __spellNameLC.includes("mur de vent") || __spellNameLC.includes("wall of wind");
  const __isWallOfWater = __spellNameLC.includes("mur d’eau") || __spellNameLC.includes("mur d'eau") || __spellNameLC.includes("wall of water");
  const __isPrismaticWall = __spellNameLC.includes("mur prismatique") || __spellNameLC.includes("prismatic wall");
  const __isFlamingSphere = __spellNameLC.includes("sphère de feu") || __spellNameLC.includes("sphere de feu") || __spellNameLC.includes("flaming sphere");
  const __isAqueousSphere = __spellNameLC.includes("sphère aqueuse") || __spellNameLC.includes("sphere aqueuse") || __spellNameLC.includes("aqueous sphere");
  const __isIncendiaryCloud = __spellNameLC.includes("nuage incendiaire") || __spellNameLC.includes("incendiary cloud");
  const __isStormSphere = __spellNameLC.includes("sphère de tempête") || __spellNameLC.includes("sphere de tempete") || __spellNameLC.includes("storm sphere");
  const __isSleetStorm = __spellNameLC.includes("tempête de neige") || __spellNameLC.includes("tempete de neige") || __spellNameLC.includes("sleet storm");

  const setRegionRule = (rule) => {
    itemObj.flags ??= {};
    itemObj.flags["encounterplus-importer"] ??= {};
    itemObj.flags["encounterplus-importer"].regionRule = rule;
  };

  if (USE_WEB_REGIONS && __isWeb) {
    // Back-compat: keep the legacy flag as well.
    setRegionRule("web");
    itemObj.flags["encounterplus-importer"].useWebRegions = true;
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isGrease) {
    setRegionRule("grease");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isEntangle) {
    setRegionRule("entangle");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isTentacles) {
    setRegionRule("black-tentacles");
    // We fully automate save+damage+restrained with regions.
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isHadar) {
    setRegionRule("hunger-of-hadar");
    // Region handles the per-turn damage.
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isSpikeGrowth) {
    setRegionRule("spike-growth");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isInsectPlague) {
    setRegionRule("insect-plague");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isIncendiaryCloud) {
    // Keep the cast-time save/damage activity for the initial apparition,
    // but use Regions for later entry / end-of-turn damage.
    setRegionRule("incendiary-cloud");
  }
  else if (USE_WEB_REGIONS && __isBladeBarrier) {
    setRegionRule("blade-barrier");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isWallOfThorns) {
    // Keep the cast-time save/damage activity for the initial apparition,
    // but use Regions for the persistent wall damage.
    setRegionRule("wall-of-thorns");
  } else if (USE_WEB_REGIONS && __isWallOfFire) {
    // Keep the cast-time save/damage activity for the initial apparition,
    // but also mark the spell so Regions can handle the persistent wall damage.
    setRegionRule("wall-of-fire");
  } else if (USE_WEB_REGIONS && __isWallOfLight) {
    // Keep ONLY the cast-time save/damage activity for the initial apparition.
    // The spell text later describes a separate repeatable beam attack, but that must not turn
    // the main cast into a hybrid attack+save workflow on the chat card.
    // Regions handle the persistent damage and linked sight-blocking for the wall itself.
    setRegionRule("wall-of-light");
    atk = null;
  } else if (USE_WEB_REGIONS && __isWallOfForce) {
    // Utility spell, but Regions are still useful so the template can own linked blocking walls and concentration cleanup.
    setRegionRule("wall-of-force");
  } else if (USE_WEB_REGIONS && __isWallOfIce) {
    // Keep the cast-time save/damage; Regions own linked blocking walls and sphere-shell targeting refinement.
    setRegionRule("wall-of-ice");
  } else if (USE_WEB_REGIONS && __isWallOfStone) {
    setRegionRule("wall-of-stone");
  } else if (USE_WEB_REGIONS && __isWallOfSand) {
    setRegionRule("wall-of-sand");
  } else if (USE_WEB_REGIONS && __isWallOfWind) {
    // Keep the cast-time save/damage; Regions mainly provide ownership / cleanup for the placed wall template.
    setRegionRule("wall-of-wind");
  } else if (USE_WEB_REGIONS && __isWallOfWater) {
    setRegionRule("wall-of-water");
  } else if (USE_WEB_REGIONS && __isFlamingSphere) {
    // Region handles the ram / proximity damage. The cast itself should only place the sphere.
    setRegionRule("flaming-sphere");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isAqueousSphere) {
    // Region handles the initial/current-overlap STR save and later entries.
    // Keep only a utility cast activity so placing the template does not also
    // create a second dnd5e save workflow on the chat card.
    setRegionRule("aqueous-sphere");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isPrismaticWall) {
    setRegionRule("prismatic-wall");
  } else if (USE_WEB_REGIONS && __isStormSphere) {
    setRegionRule("storm-sphere");
    damages = [];
    saveAb = null;
    atk = null;
  } else if (USE_WEB_REGIONS && __isSleetStorm) {
    setRegionRule("sleet-storm");
    damages = [];
    saveAb = null;
    atk = null;
  }


  
  // If the spell is handled by our Regions automation, do NOT create a "cast-time" damage or save activity.
  // Those would require target selection and would duplicate/override the Region-driven behavior.
  if (USE_WEB_REGIONS) {
    const __rr = itemObj?.flags?.["encounterplus-importer"]?.regionRule ?? null;
    const __fullyRegionHandled = new Set([
      "web",
      "grease",
      "entangle",
      "black-tentacles",
      "hunger-of-hadar",
      "cloud-of-daggers",
      "moonbeam",
      "flaming-sphere",
      "aqueous-sphere",
      "spirit-guardians",
      "stinking-cloud",
      "spike-growth",
      "insect-plague",
      "blade-barrier",
      "storm-sphere",
      "sleet-storm"
    ]);
    if (__rr && __fullyRegionHandled.has(__rr)) {
      damages = [];
      saveAb = null;
      atk = null;
    }
  }

// Target count & templates inferred from FR text (Encounter+ exports are sometimes incomplete)
  const templateTypes__epi = new Set(["cone", "cube", "cylinder", "line", "sphere", "radius", "square"]);
  const maxTargets = parseMaxTargetsFR(descText);
  if (maxTargets && Number(maxTargets) > 1) {
    sys.target = sys.target ?? {};
    const curType = String(sys.target.type ?? "");
    // Only override non-template targets (avoid breaking true AoE templates)
    if (!templateTypes__epi.has(curType)) {
      if (!sys.target.type) sys.target.type = "creature";
      if (sys.target.units == null) sys.target.units = "";
      const curVal = Number(sys.target.value ?? 0) || 0;
      if (curVal <= 1) sys.target.value = Number(maxTargets);
      sys.target.prompt = true;
    }
  }

const multiShotTargets = parseMultiShotTargetsFR(descText);
const unlimitedTargets = parseUnlimitedTargetsFR(descText);
const multiShotCountScaling = parseMultiShotCountScaling(descText, Number(sys.level ?? 0), {
  slug: __epiSpellSlug,
  name: itemObj?.name ?? sp?.name ?? ""
});
const isKnownCountOnlyMultiShot = !!(
  /rayon-ardent|scorching-ray|projectile-magique|magic-missile/.test(String(__epiSpellSlug ?? ""))
  || /rayon\s+ardent|scorching\s+ray|projectile\s+magique|magic\s+missile/.test(String(itemObj?.name ?? sp?.name ?? "").toLowerCase())
);
const isCountOnlyMultiShotSpell = !!(isKnownCountOnlyMultiShot || (Number(multiShotTargets ?? 0) > 1 && !!multiShotCountScaling?.countOnly));

// Multi-shot spells (e.g. Projectiles magiques / Rayon ardent): prefer a target count equal to the number of darts/rays.
if ((!maxTargets || Number(maxTargets) <= 1) && multiShotTargets && Number(multiShotTargets) > 1) {
  // IMPORTANT: for cantrips like "Décharge occulte", the number of rays scales with character level.
  // We should NOT force a fixed target count from phrases like "deux rayons au niveau 5 (2d10)".
  const beamsByLevelCue = /(deux|2)\s+rayons?\s+au\s+niveau\s+5|(trois|3)\s+rayons?\s+au\s+niveau\s+11|(quatre|4)\s+rayons?\s+au\s+niveau\s+17/i.test(descText);
  if (scaling?.kind === "cantrip" && beamsByLevelCue) {
    // For beam-scaling cantrips, don't lock to a fixed count; allow the user to pick targets freely.
    sys.target = sys.target ?? {};
    const curType = String(sys.target.type ?? "");
    if (!templateTypes__epi.has(curType)) {
      sys.target.type = "creature";
      sys.target.units = "";
      sys.target.value = null;
      sys.target.prompt = true;
    }
  } else {
    sys.target = sys.target ?? {};
    const curType = String(sys.target.type ?? "");
    if (!templateTypes__epi.has(curType)) {
      sys.target.type = "creature";
      sys.target.units = "";
      const curVal = Number(sys.target.value ?? 0) || 0;
      if (curVal <= 1) sys.target.value = Number(multiShotTargets);
      sys.target.prompt = true;
    }
  }
}

// Unlimited targeting phrases (e.g. "chaque créature", "toutes les créatures") — clear the misleading default "1 créature"
if (unlimitedTargets && (!maxTargets || Number(maxTargets) <= 1) && (!multiShotTargets || Number(multiShotTargets) <= 1) && !(aoe?.value && aoe?.type)) {
  sys.target = sys.target ?? {};
  const curType = String(sys.target.type ?? "creature") || "creature";
  if (!templateTypes__epi.has(curType)) {
    const curVal = Number(sys.target.value ?? 0) || 0;
    if (curVal <= 1) {
      sys.target.type = "creature";
      sys.target.units = "";
      sys.target.value = null;
      sys.target.prompt = true;
    }
  }
}


  // If Encounter+ did not provide an AoE template but the description clearly states one (sphere/cone/cube/line/cylinder), infer it.
  // BUT: for "next ranged weapon hit" buff spells (Hail of Thorns-like), the AoE is NOT placed at cast time.
  if (!isWeaponAoeBuff && aoe?.value && aoe?.type) {
    const curType = String(sys.target?.type ?? "");
    const explicitChooser = /(choisissez|de\s+votre\s+choix|vous\s+pouvez\s+choisir)/i.test(descText);
    const wantsCountTargets = (maxTargets && Number(maxTargets) > 1 && explicitChooser);

    // Prefer AoE templates unless the text is clearly "choose up to X creatures".
    if (!wantsCountTargets && !templateTypes__epi.has(curType) && (!sys.target?.value || Number(sys.target.value) <= 1) && !/creature|enemy|ally|object/i.test(curType)) {
      sys.target = sys.target ?? {};
      sys.target.type = aoe.type;
      sys.target.value = aoe.value;
      sys.target.units = aoe.units;

      // Support line width / cylinder height when the text provides it.
      if (aoe.type === "line" && aoe.width != null) {
        let w = aoe.width;
        if (aoe.widthUnits && aoe.widthUnits !== aoe.units) {
          w = (aoe.units === "m") ? feetToMeters(w) : metersToFeet(w);
        }
        sys.target.width = w;
      }
      if (aoe.type === "cylinder" && aoe.height != null) {
        let h = aoe.height;
        if (aoe.heightUnits && aoe.heightUnits !== aoe.units) {
          h = (aoe.units === "m") ? feetToMeters(h) : metersToFeet(h);
        }
        sys.target.height = h;
      }

      sys.target.prompt = true;
    }
  }

  // Normalize directional line templates: keep length, but guarantee sane thickness.
  // This prevents frequent imports where line length is correct but width is missing/invalid.
  try {
    const tType = String(sys?.target?.type ?? "").toLowerCase();
    if (tType === "line") {
      const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
      const curW = Number(sys?.target?.width ?? 0);
      const defaultW = units === "m" ? 1.5 : 5;
      if (!Number.isFinite(curW) || curW <= 0) sys.target.width = defaultW;
    }
  } catch (_e) {}

  const isMidi = (() => { try { return !!game.modules?.get?.("midi-qol")?.active; } catch(e){ return false; } })();
  const wantsFR = (() => { try { return String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr"); } catch(e){ return true; } })();

  const isSaveSpell = !!saveAb;
  const isAttackSpell = !!atk;

  const RX_CHAIN = /(puis|ensuite|après|à\s+l['’]impact|explose|éclate|se\s+brise|en\s+plus|de\s+plus)/i;
  const isHybrid = isAttackSpell && isSaveSpell && (RX_CHAIN.test(descText) || damages.length >= 2);

  const midiDefaults = () => ({
    ignoreTraits: [],
    triggeredActivityId: "none",
    triggeredActivityConditionText: "",
    triggeredActivityTargets: "targets",
    triggeredActivityRollAs: "self",
    autoConsume: false,
    forceConsumeDialog: "default",
    forceRollDialog: "default",
    forceDamageDialog: "default",
    confirmTargets: "default",
    autoTargetType: "any",
    autoTargetAction: "default",
    automationOnly: false,
    otherActivityCompatible: true,
    otherActivityAsParentType: true,
    identifier: "",
    displayActivityName: false,
    rollMode: "default",
    chooseEffects: false,
    toggleEffect: false,
    ignoreFullCover: false,
    removeChatButtons: "default",
    magicEffect: false,
    magicDamage: false,
    noConcentrationCheck: false,
    skipConcentrationCheck: false,
    autoCEEffects: "default"
  });

  const baseActivityTemplate = (id) => ({
    _id: id,
    type: "utility",
    name: "Lancer",
    sort: 0,
    activation: { type: "action", value: 1, condition: "", override: false },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { concentration: false, value: "", units: "inst", special: "", override: false },
    effects: [],
    range: { value: "", units: "ft", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false
    },
    uses: { spent: 0, max: "", recovery: [] },
    flags: {},
    visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
    useConditionText: "",
    useConditionReason: "",
    effectConditionText: "",
    macroData: { name: "", command: "" },
    ignoreTraits: { idi: false, idr: false, idv: false, ida: false, idm: false },
    midiProperties: isMidi ? midiDefaults() : { displayActivityName: false },
    isOverTimeFlag: false,
    overTimeProperties: { saveRemoves: true, preRemoveConditionText: "", postRemoveConditionText: "" }
  });

  const makeActivity = (id) => {
    const existing = sys.activities[id];
    if (existing) {
      existing.midiProperties = existing.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
      return existing;
    }
    const act = baseActivityTemplate(id);
    sys.activities[id] = act;
    return act;
  };

  const setCommonFromSpell = (act) => {
    act.activation = { ...(sys.activation ?? act.activation), override: false };
    act.duration = {
      concentration: !!durationObj?.concentration,
      value: (durationObj?.value == null ? "" : String(durationObj.value)),
      units: durationObj?.units ?? "inst",
      special: "",
      override: false
    };
    act.range = {
      value: (sys.range?.value == null ? "" : String(sys.range.value)),
      units: sys.range?.units ?? "ft",
      special: sys.range?.special ?? "",
      override: false
    };

    const tgt = sys.target ?? { value: null, units: "", type: "", prompt: false };
    const tType = String(tgt.type ?? "");
    const templateTypes = new Set(["cone", "cube", "cylinder", "line", "sphere", "radius", "square"]);

    act.target.template = act.target.template ?? { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" };
    act.target.affects = act.target.affects ?? { count:"", type:"", choice:false, special:"" };

    if (templateTypes.has(tType)) {
      act.target.template.type = (tType === "square") ? "cube" : tType;
      act.target.template.size = (tgt.value == null ? "" : String(tgt.value));
      act.target.template.width = (tType === "line")
        ? ((tgt.width != null && String(tgt.width) !== "") ? String(tgt.width) : ((tgt.units === "m") ? "1.5" : "5"))
        : "";
      act.target.template.height = (tType === "cylinder" && tgt.height != null && String(tgt.height) !== "") ? String(tgt.height) : "";
      act.target.template.units = tgt.units || "ft";
      act.target.affects = { count: "", type: "", choice: false, special: "" };
      act.target.prompt = true;
    } else {
      act.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
      const aType = tType || "";
      const aCount = (tgt.value == null ? "" : String(tgt.value));
      act.target.affects = { count: aCount, type: aType, choice: false, special: "" };
      act.target.prompt = !!tgt.prompt;
    }
    act.target.override = false;
  };

  const baseId = firstActivityId(itemObj);
  const spellSlug = String(sp?.slug ?? "").toLowerCase();
  const auraMatch = resolvePhase1AuraKey(spellSlug, itemObj?.name ?? sp?.name ?? "");
  const nativeAuraSpellKey = auraMatch.key;

  // Phase-1 native Aura Effects spells must never go through template-targeting branches.
  // We normalize them immediately to a self utility cast activity and stop here.
  if (nativeAuraSpellKey) {
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);
    act.target = act.target ?? {
      template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
      affects: { count:"1", type:"self", choice:false, special:"" },
      prompt: false,
      override: true
    };
    act.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    act.target.affects = { count: "1", type: "self", choice: false, special: "" };
    act.target.prompt = false;
    act.target.override = true;
    act.type = "utility";
    act.name = act.name || "Lancer";
    return;
  }
  let __beamExtraActivityId = null;

  // Dedicated exception: rebuild Chaos Bolt from a fixed explicit activity shape.
  // We do not reuse the simple batch or parsed primary damage here because the item
  // must visibly carry the canonical 2d8 + 1d6 formula before runtime type injection.
  if (spellSlug === "eclair-de-chaos") {
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);
    act.midiProperties = act.midiProperties ?? {};
    act.midiProperties.displayActivityName = true;
    act.type = "attack";
    act.name = isMidi ? "midi attack" : (wantsFR ? "Attaque" : "Attack");
    act.attack = act.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
    act.attack.type = act.attack.type ?? { value: "ranged", classification: "spell" };
    act.attack.type.value = "ranged";
    act.attack.type.classification = "spell";

    const importedFormula = "2d8 + 1d6";
    const importedDamagePart = {
      number: null,
      denomination: null,
      bonus: "",
      // Placeholder imported type only. Runtime replaces the type after the d8 choice,
      // but the visible sheet formula must already be correct before any roll occurs.
      types: ["force"],
      custom: { enabled: true, formula: importedFormula },
      // Runtime will explicitly rebuild the final upcast formula for Chaos Bolt so the
      // activity never accumulates an unwanted extra d8 from mixed scaling paths.
      scaling: { mode: "", number: 0, formula: "" }
    };

    act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
    act.damage.includeBase = true;
    act.damage.parts = [importedDamagePart];
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = {
      ...(act.flags["encounterplus-importer"] ?? {}),
      generated: true,
      kind: "chaos-bolt-dedicated",
      importedFormula,
      variableDamageTypes: ["acid", "cold", "fire", "force", "lightning", "poison", "psychic", "thunder"]
    };
    act.description = act.description ?? { chatFlavor: "" };
    act.description.chatFlavor = wantsFR
      ? "Éclair de chaos — formule importée fixe : 2d8 + 1d6. Le type est déterminé par un d8 avant l'attaque."
      : "Chaos Bolt — fixed imported formula: 2d8 + 1d6. Damage type is determined by a d8 before the attack.";

    console.debug(`[EPI chaos bolt debug] imported formula`, {
      spellSlug,
      formula: importedFormula,
      custom: importedDamagePart.custom,
      types: importedDamagePart.types
    });

    sys.actionType = "rsak";
    return;
  }

  // Lot 1/2 simple fast-path: keep implementation simple, deterministic, and cheap.
  // This path is intentionally limited to selected simple-batch slugs and avoids touching
  // dedicated complex systems (regions/walls/auras/multi-shot special handling).
  const __simpleBatchEligible = isSimpleBatchEligible(spellSlug)
    && !delayedNextForFilter
    && !dotEachTurnForFilter;
  if (__simpleBatchEligible) {
    if (spellSlug === "faveur-divine") {
      // Hotfix: Divine Favor is a weapon-hit rider buff, not immediate spell damage.
      // Keep cast as a clean self utility/buff setup and stop here.
      const act = makeActivity(baseId);
      act.sort = 0;
      setCommonFromSpell(act);
      act.type = "utility";
      act.name = act.name || "Lancer";
      act.target = act.target ?? {
        template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
        affects: { count:"1", type:"self", choice:false, special:"" },
        prompt: false,
        override: true
      };
      act.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
      act.target.affects = { count: "1", type: "self", choice: false, special: "" };
      act.target.prompt = false;
      act.target.override = true;
      sys.actionType = "";
      return;
    }

    const healCandLot1 = parseHealingOrTempFR(descText);
    const primaryDamage = Array.isArray(damages) && damages.length ? damages[0] : null;

    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);
    act.midiProperties = act.midiProperties ?? {};
    act.midiProperties.displayActivityName = true;

    // Do not route mixed damage+heal descriptions (e.g. Contact glacial)
    // to a pure heal activity; prefer offensive paths when damage is present.
    const shouldRouteHealLot = !!(healCandLot1 && !primaryDamage && !atk && !saveAb);
    if (shouldRouteHealLot) {
      const isTemp = healCandLot1.kind === "temp";
      act.type = "heal";
      act.name = isMidi ? "midi heal" : (wantsFR ? (isTemp ? "PV temporaires" : "Soigner") : (isTemp ? "Temp HP" : "Heal"));
      act.healing = act.healing ?? { number: null, denomination: null, bonus: "", types: [], custom: { enabled: false, formula: "" }, scaling: { mode: "whole", number: 1, formula: "" } };
      act.healing.types = [isTemp ? "temphp" : "healing"];
      applyFriendlyOnlyHealTarget(act, spellSlug);

      if (healCandLot1.custom) {
        act.healing.custom.enabled = true;
        act.healing.custom.formula = String(healCandLot1.custom).trim();
        act.healing.number = null;
        act.healing.denomination = null;
        act.healing.bonus = "";
      } else {
        act.healing.custom.enabled = false;
        act.healing.custom.formula = "";
        act.healing.number = Number(healCandLot1.number ?? 0) || null;
        act.healing.denomination = Number(healCandLot1.denom ?? healCandLot1.denomination ?? 0) || null;
        act.healing.bonus = String(healCandLot1.bonus ?? "");
      }
      sys.actionType = "";
      return;
    }

    if (saveAb && primaryDamage) {
      act.type = "save";
      act.name = isMidi ? "midi save" : (wantsFR ? "Sauvegarde" : "Save");
      act.save = act.save ?? { ability: [saveAb], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
      act.save.ability = [saveAb];
      act.save.dc = act.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
      act.save.dc.calculation = "";
      act.save.dc.formula = CASTER_DC_FORMULA;
      try { delete act.save.dc.value; } catch (e) { act.save.dc.value = null; }
      act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      act.damage.parts = [{
        number: primaryDamage.number,
        denomination: primaryDamage.denom,
        bonus: String(primaryDamage.bonus ?? ""),
        types: [primaryDamage.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      act.description = act.description ?? { chatFlavor: "" };
      act.description.chatFlavor = wantsFR
        ? `JS ${saveAb.toUpperCase()} · ${primaryDamage.number}d${primaryDamage.denom} ${primaryDamage.dtype}${halfOnSave ? " (moitié si réussite)" : ""}`
        : `${saveAb.toUpperCase()} save · ${primaryDamage.number}d${primaryDamage.denom} ${primaryDamage.dtype}${halfOnSave ? " (half on save)" : ""}`;
      sys.actionType = "save";
      return;
    }

    if (atk && primaryDamage) {
      act.type = "attack";
      act.name = isMidi ? "midi attack" : (wantsFR ? "Attaque" : "Attack");
      act.attack = act.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
      act.attack.type = act.attack.type ?? { value: "ranged", classification: "spell" };
      act.attack.type.value = (atk.mode === "melee") ? "melee" : "ranged";
      act.attack.type.classification = "spell";
      act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      act.damage.parts = [{
        number: primaryDamage.number,
        denomination: primaryDamage.denom,
        bonus: String(primaryDamage.bonus ?? ""),
        types: [primaryDamage.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      sys.actionType = atk.actionType;
      return;
    }

    if (primaryDamage) {
      act.type = "damage";
      act.name = isMidi ? "midi damage" : (wantsFR ? "Dégâts" : "Damage");
      act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      act.damage.parts = [{
        number: primaryDamage.number,
        denomination: primaryDamage.denom,
        bonus: String(primaryDamage.bonus ?? ""),
        types: [primaryDamage.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      sys.actionType = "";
      return;
    }
  }

  // Deterministic extra activity IDs (avoid duplicates on re-import)
  const deriveSiblingId = (base, preferChars = ["x","1","2","3","4","5","6","7","8","9","a","b","c","d","e","f"]) => {
    const b = String(base ?? "");
    if (b.length === 16) {
      for (const ch of preferChars) {
        const id = b.slice(0, 15) + String(ch).slice(0, 1);
        if (!sys.activities[id]) return id;
      }
    }
    // Fallback random
    try { if (foundry?.utils?.randomID) return foundry.utils.randomID(16); } catch (e) {}
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };


  const ensureTemplateTarget = (act, { type = "", size = "", width = "", height = "", units = "ft" } = {}) => {
    act.target = act.target ?? {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false
    };
    act.target.template = act.target.template ?? { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    act.target.affects = { count: "", type: "", choice: false, special: "" };
    act.target.template.type = String(type ?? "");
    act.target.template.size = (size == null ? "" : String(size));
    act.target.template.width = (width == null ? "" : String(width));
    act.target.template.height = (height == null ? "" : String(height));
    act.target.template.units = String(units ?? "ft") || "ft";
    act.target.prompt = true;
    act.target.override = true;
  };

  const configureWallOfFireActivity = (act, form = "line") => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 18 : 60;
    const lineWidth = isMetric ? 1.5 : 5;
    const circleRadius = isMetric ? 3 : 10; // 6 m / 20 ft diameter

    act.type = "save";
    act.name = (form === "circle")
      ? (wantsFR ? "Lancer (cercle)" : "Cast (circle)")
      : (wantsFR ? "Lancer (ligne)" : "Cast (line)");
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    // Hide technical wall-form activities from the normal activity list/chat card.
    // The module will prompt for the form (ligne/cercle) and run the chosen activity directly.
    act.midiProperties.automationOnly = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = {
      ...(act.flags["encounterplus-importer"] ?? {}),
      generated: true,
      kind: form === "circle" ? "wall-of-fire-circle" : "wall-of-fire-line"
    };

    if (form === "circle") {
      // Approximation: use a circular template with the OUTER radius.
      // This gives players the correct gabarit choice now; hot-side / annulus automation can be added later.
      ensureTemplateTarget(act, { type: "sphere", size: circleRadius, width: "", height: "", units });
    } else {
      ensureTemplateTarget(act, { type: "line", size: lineLength, width: lineWidth, height: "", units });
    }
  };

  const configureWallOfThornsActivity = (act, form = "line") => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 18 : 60;
    const wallWidth = isMetric ? 1.5 : 5;
    const circleRadius = isMetric ? 3 : 10; // 6 m / 20 ft diameter

    act.type = "save";
    act.name = (form === "circle")
      ? (wantsFR ? "Lancer (anneau)" : "Cast (ring)")
      : (wantsFR ? "Lancer (ligne)" : "Cast (line)");
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    // Keep Wall of Thorns as a SINGLE visible save activity.
    // The form chooser (ligne / anneau) is handled at use-time, like Wall of Fire,
    // otherwise dnd5e renders both save activities on the same chat card and duplicates damage lines.
    act.midiProperties.automationOnly = false;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = {
      ...(act.flags["encounterplus-importer"] ?? {}),
      generated: true,
      kind: form === "circle" ? "wall-of-thorns-circle" : "wall-of-thorns-line",
      wallOfThornsForm: form === "circle" ? "circle" : "line"
    };

    if (form === "circle") {
      ensureTemplateTarget(act, { type: "sphere", size: circleRadius, width: "", height: "", units });
    } else {
      ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
    }
  };

  const configureWallOfLightActivity = (act) => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 18 : 60;
    const wallWidth = isMetric ? 1.5 : 5;
    act.type = "save";
    act.name = wantsFR ? "Lancer" : "Cast";
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: "wall-of-light-line" };
    ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfForceActivity = (act, form = "line") => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 30 : 100;
    const wallWidth = isMetric ? 1.5 : 5;
    const sphereRadius = isMetric ? 3 : 10;
    act.type = "utility";
    act.name = (form === "sphere") ? (wantsFR ? "Lancer (sphère)" : "Cast (sphere)") : (wantsFR ? "Lancer (ligne)" : "Cast (line)");
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.midiProperties.automationOnly = false;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: form === "sphere" ? "wall-of-force-sphere" : "wall-of-force-line", wallOfForceForm: form === "sphere" ? "sphere" : "line" };
    if (form === "sphere") ensureTemplateTarget(act, { type: "sphere", size: sphereRadius, width: "", height: "", units });
    else ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfIceActivity = (act, form = "line") => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 30 : 100;
    const wallWidth = isMetric ? 1.5 : 5;
    const sphereRadius = isMetric ? 3 : 10;
    act.type = "save";
    act.name = (form === "sphere") ? (wantsFR ? "Lancer (sphère)" : "Cast (sphere)") : (wantsFR ? "Lancer (ligne)" : "Cast (line)");
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.midiProperties.automationOnly = false;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: form === "sphere" ? "wall-of-ice-sphere" : "wall-of-ice-line", wallOfIceForm: form === "sphere" ? "sphere" : "line" };
    if (form === "sphere") ensureTemplateTarget(act, { type: "sphere", size: sphereRadius, width: "", height: "", units });
    else ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfStoneActivity = (act) => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const lineLength = units === "m" ? 30 : 100;
    const wallWidth = units === "m" ? 1.5 : 5;
    act.type = "utility";
    act.name = wantsFR ? "Lancer" : "Cast";
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: "wall-of-stone-line" };
    ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfSandActivity = (act) => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const lineLength = units === "m" ? 9 : 30;
    const wallWidth = units === "m" ? 3 : 10;
    act.type = "utility";
    act.name = wantsFR ? "Lancer" : "Cast";
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: "wall-of-sand-line" };
    ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfWindActivity = (act) => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const lineLength = units === "m" ? 15 : 50;
    const wallWidth = units === "m" ? 1.5 : 5;
    act.type = "save";
    act.name = wantsFR ? "Lancer" : "Cast";
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: "wall-of-wind-line" };
    ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configureWallOfWaterActivity = (act) => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const lineLength = units === "m" ? 9 : 30;
    const wallWidth = units === "m" ? 1.5 : 5;
    act.type = "utility";
    act.name = wantsFR ? "Lancer" : "Cast";
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: "wall-of-water-line" };
    ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };

  const configurePrismaticWallActivity = (act, form = "line") => {
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const lineLength = units === "m" ? 27 : 90;
    const wallWidth = units === "m" ? 1.5 : 5;
    const sphereRadius = units === "m" ? 4.5 : 15;
    act.type = "utility";
    act.name = (form === "sphere") ? (wantsFR ? "Lancer (sphère)" : "Cast (sphere)") : (wantsFR ? "Lancer (ligne)" : "Cast (line)");
    act.midiProperties = act.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    act.midiProperties.displayActivityName = true;
    act.flags = act.flags ?? {};
    act.flags["encounterplus-importer"] = { ...(act.flags["encounterplus-importer"] ?? {}), generated: true, kind: form === "sphere" ? "prismatic-wall-sphere" : "prismatic-wall-line", prismaticWallForm: form === "sphere" ? "sphere" : "line" };
    if (form === "sphere") ensureTemplateTarget(act, { type: "sphere", size: sphereRadius, width: "", height: "", units });
    else ensureTemplateTarget(act, { type: "line", size: lineLength, width: wallWidth, height: "", units });
  };


  // ---- Repeat-use spells (cast + follow-up activity without re-casting) ----
const __slug = String(sp?.slug ?? "").toLowerCase();

// Spells that grant a repeatable action/bonus action after the initial cast.
// We implement this as two Activities on the SAME spell:
//  - Cast: normal workflow (slot + concentration)
//  - Follow-up: runs without consuming a slot and without prompting for concentration
const __repeatCfgs = {
  "sphere-de-feu": { followActivation: "bonus", followNameFR: "Percuter (action bonus)", followNameEN: "Ram (bonus action)" },
  "metal-brulant": { followActivation: "bonus", followNameFR: "Réactiver (action bonus)", followNameEN: "Reapply (bonus action)" },
  "appel-de-la-foudre": { followActivation: "action", followNameFR: "Foudre (action)", followNameEN: "Bolt (action)" },
  "rayon-de-soleil": { followActivation: "action", followNameFR: "Rayon (action)", followNameEN: "Ray (action)" },
  "caresse-du-vampire": { followActivation: "action", followNameFR: "Attaque (action)", followNameEN: "Attack (action)" },
  "epee-de-mordenkainen": { followActivation: "bonus", followNameFR: "Attaque (action bonus)", followNameEN: "Attack (bonus action)" },
  "arme-spirituelle": { followActivation: "bonus", followNameFR: "Attaque (action bonus)", followNameEN: "Attack (bonus action)" },
  // Cast creates a resource/effect; the damage only happens on the follow-up.
  "couronne-d-etoiles": { followActivation: "bonus", followNameFR: "Étoile (action bonus)", followNameEN: "Star (bonus action)", castIsUtility: true },
  "minuscules-meteores-de-melf": { followActivation: "bonus", followNameFR: "Météore (action bonus)", followNameEN: "Meteor (bonus action)", castIsUtility: true }
};
const __repeatCfg = __repeatCfgs[__slug] ?? null;

const __getRepeatFlags = () => {
  const epi = itemObj?.flags?.["encounterplus-importer"] ?? {};
  return epi?.repeatActivityIds ?? null;
};

const __setRepeatFlags = (castId, followId, cfg) => {
  itemObj.flags ??= {};
  itemObj.flags["encounterplus-importer"] ??= {};
  itemObj.flags["encounterplus-importer"].repeatActivityIds = { cast: String(castId), follow: String(followId) };
  itemObj.flags["encounterplus-importer"].repeatActivityMeta = {
    followActivation: String(cfg?.followActivation ?? ""),
    needsConcentration: !!durationObj?.concentration,
    slug: __slug
  };
};

const __findExistingRepeatActivityId = (kind) => {
  try {
    for (const [id, a] of Object.entries(sys.activities ?? {})) {
      const f = a?.flags?.["encounterplus-importer"] ?? null;
      if (f?.generated && f?.kind === kind && f?.repeatSlug === __slug) return String(id);
    }
  } catch (e) {}
  return null;
};

const __convertCastToUtility = (castAct) => {
  if (!castAct) return;
  castAct.type = "utility";
  castAct.img = "systems/dnd5e/icons/svg/activity/utility.svg";
  castAct.name = wantsFR ? "Lancer" : "Cast";
  castAct.midiProperties = castAct.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
  castAct.midiProperties.displayActivityName = true;

  // Setup spells typically target self; avoid a confusing "1 creature" target on the cast activity.
  castAct.target = castAct.target ?? {
    template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
    affects: { count: "", type: "self", choice: false, special: "" },
    prompt: false,
    override: true
  };
  castAct.target.template = { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" };
  castAct.target.affects = { count: "", type: "self", choice: false, special: "" };
  castAct.target.prompt = false;
  castAct.target.override = true;

  // Remove resolution fields so this becomes a pure "setup" activity.
  try { delete castAct.attack; } catch (e) {}
  try { delete castAct.save; } catch (e) {}
  try { delete castAct.damage; } catch (e) {}
  try { delete castAct.healing; } catch (e) {}
};

const __makeRepeatFollowUpFrom = (baseAct, cfg) => {
  if (!cfg || !baseAct) return null;

  const existing = __getRepeatFlags();
  const existingFollow = existing?.follow ? String(existing.follow) : null;
  const followId = existingFollow
    ?? __findExistingRepeatActivityId("repeat-followup")
    ?? deriveSiblingId(baseId, ["f","F","b","B","1","2","3","x","y","z"]);

  const clone = (foundry?.utils?.deepClone ? foundry.utils.deepClone(baseAct) : JSON.parse(JSON.stringify(baseAct)));
  clone._id = followId;
  clone.sort = 1;
  clone.name = wantsFR ? (cfg.followNameFR ?? "Action") : (cfg.followNameEN ?? "Action");
  clone.midiProperties = clone.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
  clone.midiProperties.displayActivityName = true;

  // Activation (action / bonus)
  clone.activation = clone.activation ?? { type: cfg.followActivation, value: 1, condition: "", override: true };
  clone.activation.type = cfg.followActivation;
  clone.activation.value = 1;
  clone.activation.override = true;

  // Follow-up is part of an ongoing spell: no slot, no concentration prompt.
  clone.consumption = clone.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false, override: true };
  clone.consumption.spellSlot = false;
  clone.consumption.override = true;

  clone.duration = clone.duration ?? { concentration: false, value: "", units: "inst", special: "", override: true };
  clone.duration.concentration = false;
  clone.duration.value = "";
  clone.duration.units = "inst";
  clone.duration.override = true;

  // Ensure target for attacks is 1 creature.
  if (clone.type === "attack") {
    clone.target = clone.target ?? {
      template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
      affects: { count: "1", type: "creature", choice: false, special: "" },
      prompt: true,
      override: true
    };
    clone.target.template = { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" };
    clone.target.affects = { count: "1", type: "creature", choice: false, special: "" };
    clone.target.prompt = true;
    clone.target.override = true;
  }

  clone.flags = clone.flags ?? {};
  clone.flags["encounterplus-importer"] = { ...(clone.flags["encounterplus-importer"] ?? {}), generated: true, kind: "repeat-followup", repeatSlug: __slug };

  sys.activities[followId] = clone;

  // Rename cast activity for clarity
  try {
    baseAct.name = wantsFR ? "Lancer" : "Cast";
    baseAct.midiProperties = baseAct.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    baseAct.midiProperties.displayActivityName = true;
    baseAct.sort = 0;
    baseAct.flags = baseAct.flags ?? {};
    baseAct.flags["encounterplus-importer"] = { ...(baseAct.flags["encounterplus-importer"] ?? {}), generated: true, kind: "repeat-cast", repeatSlug: __slug };
  } catch (e) {}

  __setRepeatFlags(baseId, followId, cfg);
  return followId;
};

const maybeAddRepeatChoiceActivities = (baseAct) => {
  if (!__repeatCfg) return;
  if (__repeatCfg.castIsUtility) {
    // First clone baseAct as follow-up, then convert cast to utility.
    __makeRepeatFollowUpFrom(baseAct, __repeatCfg);
    __convertCastToUtility(baseAct);
  } else {
    __makeRepeatFollowUpFrom(baseAct, __repeatCfg);
  }
};

  
// OverTime automation templates (preferred): delayed damage next turn + recurring damage each turn.
// We store templates on the item flags and apply them at runtime (main.mjs), instead of embedding ActiveEffects on the item.
// This avoids double-application from DND5E "Apply" + Midi-QOL auto-apply workflows.
const delayedNext = delayedNextForFilter;
const dotEachTurn = dotEachTurnForFilter;

const addDelayedDamageActivity = () => {
  if (!delayedNext && !dotEachTurn) return;

  // Region-managed spells must not also generate importer OverTime templates.
  // Wall of Light end-of-turn damage is handled by Regions only.
  if (USE_WEB_REGIONS && (__isWallOfLight || __epiSpellSlug === "mur-de-lumiere" || __epiSpellSlug === "wall-of-light")) return;

  // Preferred path: Midi-QOL OverTime templates applied at runtime.
  if (isMidi) {
    itemObj.flags = itemObj.flags ?? {};
    itemObj.flags[MODULE_ID] = itemObj.flags[MODULE_ID] ?? {};
    const list = itemObj.flags[MODULE_ID].overtimeTemplates = itemObj.flags[MODULE_ID].overtimeTemplates ?? [];

    const baseLevel = Number(sys.level ?? sp?.data?.level ?? 0) || 0;

    const pushTemplate = (tpl) => {
      // Ensure deterministic-ish ordering without duplicates on re-import
      const sig = JSON.stringify({ kind: tpl.kind, when: tpl.when, cond: tpl.condition, dmg: tpl.damage, saveEnds: tpl.saveEnds });
      const exists = list.some(x => (x?.__sig ?? "") === sig);
      if (!exists) list.push({ ...tpl, __sig: sig });
    };

    if (delayedNext) {
      const when = (delayedNext.when === "start") ? "start" : "end";
      const dtype = String(delayedNext.dtype ?? "").trim();
      const bonus = String(delayedNext.bonus ?? "").trim();

      // If the delayed portion scales too, record the scaling dice for runtime computation.
      const perN = (delayedNext.scales && scaling?.kind === "upcast") ? Number(scaling?.per?.n ?? 1) : 0;
      const perD = (delayedNext.scales && scaling?.kind === "upcast") ? Number(scaling?.per?.d ?? 0) : 0;

      pushTemplate({
        kind: "delayed-damage-next-turn",
        when,
        condition: delayedNext.condition || "",
        statusId: "encounterplus-importer.delayed-damage",
        label: wantsFR ? `Dégâts différés — ${itemObj.name}` : `Delayed Damage — ${itemObj.name}`,
        icon: itemObj.img ?? "icons/magic/time/arrows-circling-green.webp",
        damage: {
          number: Number(delayedNext.number ?? 0) || 0,
          denom: Number(delayedNext.denom ?? delayedNext.denomination ?? 0) || 0,
          bonus,
          dtype,
          baseLevel,
          perN,
          perD
        },
        // Remove after first tick
        removeAfterTick: true
      });
    }

    if (dotEachTurn) {
      const when = (dotEachTurn.when === "start") ? "start" : "end";
      const dtype = String(dotEachTurn.dtype ?? "").trim();
      const bonus = String(dotEachTurn.bonus ?? "").trim();
      const saveEnds = String(dotEachTurn.saveEnds ?? "").trim();

      pushTemplate({
        kind: "damage-each-turn",
        when,
        condition: dotEachTurn.condition || "",
        statusId: "encounterplus-importer.damage-each-turn",
        label: wantsFR ? `Dégâts récurrents — ${itemObj.name}` : `Recurring Damage — ${itemObj.name}`,
        icon: itemObj.img ?? "icons/magic/time/arrows-circling-green.webp",
        damage: {
          number: Number(dotEachTurn.number ?? 0) || 0,
          denom: Number(dotEachTurn.denom ?? dotEachTurn.denomination ?? 0) || 0,
          bonus,
          dtype,
          baseLevel
        },
        saveEnds,
        // Duration is derived from the spell duration at runtime; do NOT auto-remove after 1 tick.
        removeAfterTick: false
      });
    }

    return;
  }

  // Fallback (no Midi-QOL): create a second activity to roll manually (delayed-next-turn only).

  if (!delayedNext) return;

  const delayedId = deriveSiblingId(baseId, ["d","D","y","Y","z","Z","t","T","u","U"]);
  const extra = makeActivity(delayedId);
  extra.sort = 90;
  setCommonFromSpell(extra);

  extra.type = "damage";
  extra.img = "icons/magic/time/arrows-circling-green.webp";
  extra.name = isMidi ? "midi damage delayed" : (wantsFR ? "Dégâts différés" : "Delayed Damage");
  extra.midiProperties.displayActivityName = true;

  extra.damage = extra.damage ?? { critical: { bonus: "" }, includeBase: false, parts: [] };
  extra.damage.includeBase = false;
  extra.damage.parts = [{
    number: delayedNext.number,
    denomination: delayedNext.denom,
    bonus: String(delayedNext.bonus ?? ""),
    types: [delayedNext.dtype || ""],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "whole", number: 1, formula: "" }
  }];

  // If the delayed portion explicitly scales too, allow scaling selection but never consume a spell slot again.
  extra.consumption = extra.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
  extra.consumption.spellSlot = false;
  extra.consumption.scaling = extra.consumption.scaling ?? { allowed: false, max: "" };
  extra.consumption.scaling.allowed = false;

  if (scaling && scaling.kind === "upcast" && delayedNext.scales) {
    extra.consumption.scaling.allowed = true;
    applyScalingToActivityDamage(extra, scaling, { noSpellSlot: true });
  }

  // Manual target selection: apply only to the creatures that were affected (e.g. only on failed save / only on hit).
  extra.target = extra.target ?? { template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
    affects: { count:"", type:"", choice:false, special:"" }, prompt:true, override:false };
  extra.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
  extra.target.affects = { count: "", type: "creature", choice: false, special: "" };
  extra.target.prompt = true;
  extra.target.override = false;

  const whenFr = delayedNext.when === "start" ? "début" : "fin";
  const condFr = delayedNext.condition === "hit" ? " (si touché)" : (delayedNext.condition === "fail" ? " (si échec)" : "");
  extra.description = extra.description ?? { chatFlavor: "" };
  extra.description.chatFlavor = wantsFR
    ? `Dégâts différés — ${whenFr} du prochain tour${condFr}`
    : `Delayed damage — ${delayedNext.when === "start" ? "start" : "end"} of next turn${delayedNext.condition ? " (" + delayedNext.condition + ")" : ""}`;

  extra.flags = extra.flags ?? {};
  extra.flags["encounterplus-importer"] = { ...(extra.flags["encounterplus-importer"] ?? {}), generated: true, kind: "delayed-damage-next-turn" };
};


// Heal / Temp HP: use a proper "heal" activity with a visible name ("midi heal") like SRD.
  const healCand = parseHealingOrTempFR(descText);
  if (healCand) {
    const isTemp = healCand.kind === "temp";
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);

    // If the description says "jusqu'à X créatures", reflect it in target count (e.g., Soins de groupe = 6).
    if (maxTargets && Number(maxTargets) > 1) {
      sys.target = sys.target ?? {};
      if (!sys.target.type) sys.target.type = "creature";
      if (!sys.target.units) sys.target.units = "";
      // Only override obvious defaults
      const current = Number(sys.target.value ?? 0) || 0;
      if (current <= 1) sys.target.value = Number(maxTargets);

      // Also show it in the activity target section
      act.target = act.target ?? { template: {count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft"}, affects: {count:"", type:"", choice:false, special:""}, prompt: true, override: false };
      act.target.affects = act.target.affects ?? { count: "", type: "", choice: false, special: "" };
      act.target.affects.count = String(maxTargets);
      act.target.affects.type = isSimpleFriendlyHeal(spellSlug) ? "ally" : "creature";
      // don't force prompt; let Foundry/Midi handle targets as usual
    }

    act.type = "heal";
    act.img = "systems/dnd5e/icons/svg/activity/heal.svg";
    act.name = isMidi
      ? "midi heal"
      : (wantsFR ? (isTemp ? "PV temporaires" : "Soigner") : (isTemp ? "Temp HP" : "Heal"));

    act.midiProperties = act.midiProperties ?? {};
    act.midiProperties.displayActivityName = true;

    applyFriendlyOnlyHealTarget(act, spellSlug);

    // dnd5e uses "healing" field for heal activities
    act.healing = act.healing ?? { number: null, denomination: null, bonus: "", types: [], custom: { enabled: false, formula: "" }, scaling: { mode: "whole", number: 1, formula: "" } };
    act.healing.types = [isTemp ? "temphp" : "healing"];

    if (healCand.custom) {
      act.healing.custom.enabled = true;
      act.healing.custom.formula = String(healCand.custom).trim();
      act.healing.number = null;
      act.healing.denomination = null;
      act.healing.bonus = "";
    } else {
      act.healing.custom.enabled = false;
      act.healing.custom.formula = "";
      act.healing.number = Number(healCand.number ?? 0) || null;
      act.healing.denomination = Number(healCand.denom ?? healCand.denomination ?? 0) || null;
      act.healing.bonus = String(healCand.bonus ?? "");
    }

    // Upcast scaling for healing (e.g. +1d8 per slot above 1st)
    if (scaling?.kind === "upcast") {
      act.consumption = act.consumption ?? { targets: [], scaling: { allowed: true, max: "" }, spellSlot: true };
      act.consumption.spellSlot = true;
      act.consumption.scaling = act.consumption.scaling ?? { allowed: true, max: "" };
      act.consumption.scaling.allowed = true;
      if (act.consumption.scaling.max == null) act.consumption.scaling.max = "";

      // Upcast scaling: store the die portion in formula (e.g. "d8") so dnd5e doesn't treat the number as a flat +X.
      act.healing.scaling = act.healing.scaling ?? { mode: "whole", number: 1, formula: "" };
      act.healing.scaling.mode = "whole";
      act.healing.scaling.number = Number(scaling.per?.n ?? 1) || 1;
      const _healPerD = String(scaling.per?.d ?? "").trim();
      act.healing.scaling.formula = _healPerD ? `d${_healPerD}` : "";
    }

    // Pure heal/temp spell: stop here so it doesn't fallback to "Lancer"
    if (!isAttackSpell && !isSaveSpell) {
      sys.actionType = "";
      return;
    }
  }

  // Hybrid: Attack + Save => 2 activities
  if (isHybrid) {
    const hitDmg = damages[0] ?? null;
    const saveDmg = damages[1] ?? damages[0] ?? null;

    // Attack
    const a1 = makeActivity(baseId);
    a1.sort = 0;
    setCommonFromSpell(a1);
    a1.type = "attack";
    a1.name = isMidi ? "midi attack" : (wantsFR ? "Attaque" : "Attack");
    a1.midiProperties.displayActivityName = true;

    a1.attack = a1.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
    a1.attack.ability = a1.attack.ability ?? "";
    a1.attack.bonus = a1.attack.bonus ?? "";
    a1.attack.critical = a1.attack.critical ?? { threshold: null };
    a1.attack.flat = (a1.attack.flat ?? false);
    a1.attack.type = a1.attack.type ?? { value: "ranged", classification: "spell" };
    a1.attack.type.value = (atk.mode === "melee") ? "melee" : "ranged";
    a1.attack.type.classification = "spell";

    if (hitDmg) {
      a1.damage = a1.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      a1.damage.parts = [{
        number: hitDmg.number,
        denomination: hitDmg.denom,
        bonus: String(hitDmg.bonus ?? ""),
        types: [hitDmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      applyScalingToActivityDamage(a1, scaling);
      a1.description.chatFlavor = `${atk.actionType.toUpperCase()} · ${hitDmg.number}d${hitDmg.denom} ${hitDmg.dtype}`;
    } else {
      a1.description.chatFlavor = `${atk.actionType.toUpperCase()}`;
    }

    // Save activity (secondary effect)
    let a2id;
    // dnd5e activity _id must be 16 characters, alphanumeric only.
    const genId = () => {
      try {
        if (foundry?.utils?.randomID) return foundry.utils.randomID(16);
      } catch (e) {}
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let s = "";
      for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    };
    do { a2id = genId(); } while (sys.activities[a2id]);
    const a2 = makeActivity(a2id);
    a2.sort = 1;
    setCommonFromSpell(a2);
    a2.type = "save";
    a2.name = isMidi ? (wantsFR ? "midi save" : "midi save") : (wantsFR ? "Sauvegarde" : "Save");
    a2.midiProperties.displayActivityName = true;

    // Override target template if we found a radius
    if (aoe?.value && aoe?.type) {
      a2.target.template.type = aoe.type;
      a2.target.template.size = String(aoe.value);
      a2.target.template.units = aoe.units;
      a2.target.template.width = "";
      a2.target.template.height = "";
      a2.target.affects = { count: "", type: "", choice: false, special: "" };
      a2.target.prompt = true;
    }

    a2.save = a2.save ?? { ability: [saveAb], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
    a2.save.ability = [saveAb];
    a2.save.dc = a2.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
    // Ensure the save DC always matches the caster.
    a2.save.dc.calculation = "";
    a2.save.dc.formula = CASTER_DC_FORMULA;
    try { delete a2.save.dc.value; } catch (e) { a2.save.dc.value = null; }

    // If the description indicates a secondary AoE centered on the HIT TARGET (e.g. Ice Knife explosion),
    // store metadata so runtime can auto-target nearby creatures and roll this save automatically.
    try {
      const around = parseAoeAroundTargetFR(descText);
      if (around?.value) {
        itemObj.flags ??= {};
        itemObj.flags["encounterplus-importer"] ??= {};
        itemObj.flags["encounterplus-importer"].onHitAoe = {
          radius: Number(around.value),
          units: String(around.units ?? "ft"),
          saveActivityId: String(a2id),
          includePrimaryTarget: true
        };
        // Hotfix270: allow the secondary save (AoE centered on the impact target, e.g. Ice Knife) to target MULTIPLE creatures.
        // The base spell target is usually "1 creature", but the explosion affects all adjacent creatures on the grid.
        try {
          a2.target ??= {};
          a2.target.affects ??= { count: "", type: "creature", choice: false, special: "" };
          a2.target.affects.count = "";
          a2.target.affects.type = a2.target.affects.type || "creature";
          a2.target.prompt = false;
          a2.target.template ??= { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
          // No template placement here (runtime handles burst targeting).
          a2.target.template.type = "";
          a2.target.template.size = "";
          a2.target.template.width = "";
          a2.target.template.height = "";

          // IMPORTANT: prevent Midi-QOL from auto-selecting this SAVE as the "other activity" of the attack.
          // For on-hit burst spells (Ice Knife-like), we handle the follow-up SAVE ourselves at runtime (multi-target).
          a2.midiProperties ??= midiDefaults();
          a2.midiProperties.otherActivityCompatible = false;
        } catch (_e) {}

      }
    } catch (e) { /* ignore */ }

    if (saveDmg) {
      a2.damage = a2.damage ?? { onSave: halfOnSave ? "half" : "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      a2.damage.onSave = halfOnSave ? "half" : "none";
      a2.damage.parts = [{
        number: saveDmg.number,
        denomination: saveDmg.denom,
        bonus: String(saveDmg.bonus ?? ""),
        types: [saveDmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      applyScalingToActivityDamage(a2, scaling);
      a2.description.chatFlavor = `JS ${saveAb.toUpperCase()} · ${saveDmg.number}d${saveDmg.denom} ${saveDmg.dtype}${halfOnSave ? " (moitié si réussite)" : ""}`;
    } else {
      a2.description.chatFlavor = `JS ${saveAb.toUpperCase()}`;
    }

    try { addDelayedDamageActivity(); } catch (e) { /* ignore */ }

    // Final sanity: ensure the save DC is caster-based for every save activity.
    forceCasterSaveDC();

    sys.actionType = "";
    return;
  }


  // Dedicated simplification: Lightning Arrow is imported as a direct primary-target attack
  // plus a secondary AoE save around the impact target (no concentration, no cast-time template,
  // no next-shot buff state).
  if (spellSlug === "fleche-de-foudre") {
    console.debug(`[EPI lightning arrow debug] dedicated path reached`, {
      spellSlug,
      itemName: itemObj?.name ?? sp?.name ?? "",
      initialDuration: sys.duration ?? null,
      initialTarget: sys.target ?? null,
      initialProperties: sys.properties ?? null
    });
    const hitDmg = damages[0] ?? null;
    const splashDmg = damages[1] ?? damages[0] ?? null;
    const around = parseAoeAroundTargetFR(descText) ?? (aoe?.value ? { value: aoe.value, units: aoe.units } : null);

    const a1 = makeActivity(baseId);
    a1.sort = 0;
    setCommonFromSpell(a1);
    a1.type = "attack";
    a1.name = isMidi ? "midi attack" : (wantsFR ? "Attaque" : "Attack");
    a1.attack = a1.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
    a1.attack.type = a1.attack.type ?? { value: "ranged", classification: "spell" };
    a1.attack.type.value = "ranged";
    a1.attack.type.classification = "spell";
    a1.target = a1.target ?? {
      template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
      affects: { count:"1", type:"creature", choice:false, special:"" },
      prompt: true,
      override: true
    };
    a1.target.template = { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" };
    a1.target.affects = { count:"1", type:"creature", choice:false, special:"" };
    a1.target.prompt = true;
    a1.target.override = true;
    a1.midiProperties = a1.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    a1.midiProperties.displayActivityName = true;
    if (hitDmg) {
      a1.damage = a1.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      a1.damage.parts = [{
        number: hitDmg.number,
        denomination: hitDmg.denom,
        bonus: String(hitDmg.bonus ?? ""),
        types: [hitDmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      applyScalingToActivityDamage(a1, scaling);
    }

    let a2id = deriveSiblingId(baseId, ["x","y","z","1","2","3","4","5","6","7","8","9","a","b","c","d"]);
    while (sys.activities[a2id]) a2id = deriveSiblingId(baseId);
    const a2 = makeActivity(a2id);
    a2.sort = 1;
    setCommonFromSpell(a2);
    a2.type = "save";
    a2.name = isMidi ? "midi save" : (wantsFR ? "Sauvegarde" : "Save");
    a2.midiProperties = a2.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    a2.midiProperties.displayActivityName = true;
    a2.midiProperties.automationOnly = true;
    a2.midiProperties.otherActivityCompatible = false;
    a2.consumption = a2.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
    a2.consumption.spellSlot = false;
    a2.target = a2.target ?? {};
    a2.target.prompt = false;
    a2.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    a2.target.affects = { count: "99", type: "creature", choice: false, special: "" };
    a2.save = a2.save ?? { ability: [saveAb], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
    a2.save.ability = [saveAb];
    a2.save.dc = a2.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
    a2.save.dc.calculation = "";
    a2.save.dc.formula = CASTER_DC_FORMULA;
    try { delete a2.save.dc.value; } catch (e) { a2.save.dc.value = null; }
    if (splashDmg) {
      a2.damage = a2.damage ?? { onSave: halfOnSave ? "half" : "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      a2.damage.onSave = halfOnSave ? "half" : "none";
      a2.damage.parts = [{
        number: splashDmg.number,
        denomination: splashDmg.denom,
        bonus: String(splashDmg.bonus ?? ""),
        types: [splashDmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      applyScalingToActivityDamage(a2, scaling);
    }

    if (around?.value) {
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].onHitAoe = {
        radius: Number(around.value),
        units: String(around.units ?? "ft"),
        saveActivityId: String(a2id),
        includePrimaryTarget: false
      };
    }

    sys.duration = sys.duration ?? { value: null, units: "inst", concentration: false };
    sys.duration.value = null;
    sys.duration.units = "inst";
    sys.duration.concentration = false;
    sys.target = sys.target ?? { value: 1, units: "", type: "creature", prompt: false };
    sys.target.value = 1;
    sys.target.type = "creature";
    sys.target.units = "";
    sys.target.prompt = false;
    try { delete sys.target.width; } catch (_e) { sys.target.width = ""; }
    try { delete sys.target.height; } catch (_e) { sys.target.height = ""; }
    sys.properties = Array.isArray(sys.properties) ? sys.properties.filter(p => String(p ?? "") !== "concentration") : [];
    a1.duration = { concentration: false, value: "", units: "inst", special: "", override: true };
    a1.target.template = { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" };
    a1.target.prompt = false;
    a1.target.override = true;
    a2.duration = { concentration: false, value: "", units: "inst", special: "", override: true };
    a2.target.prompt = false;
    a2.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    sys.actionType = "rsak";
    console.debug(`[EPI lightning arrow debug] before final return`, {
      spellSlug,
      duration: sys.duration ?? null,
      properties: sys.properties ?? null,
      target: sys.target ?? null,
      onHitAoe: itemObj?.flags?.["encounterplus-importer"]?.onHitAoe ?? null
    });
    console.debug(`[EPI lightning arrow debug] final payload concentration`, {
      itemDurationConcentration: sys.duration?.concentration ?? null,
      hasConcentrationProperty: Array.isArray(sys.properties) ? sys.properties.includes("concentration") : false,
      activity1Duration: a1.duration ?? null,
      activity2Duration: a2.duration ?? null
    });
    console.debug(`[EPI lightning arrow debug] final activity target/template`, {
      itemTarget: sys.target ?? null,
      attackTarget: a1.target ?? null,
      saveTarget: a2.target ?? null
    });
    forceCasterSaveDC();
    return;
  }

  // Buff spells that trigger a secondary AoE SAVE when you next hit with a ranged weapon attack (e.g. Grêle d'épines).
  // These should behave as a SELF buff at cast time (no template, no save, no damage),
  // and then auto-run a hidden SAVE activity on the hit target + adjacent creatures.
  if (isWeaponAoeBuff && isSaveSpell) {
    // Keep the item itself as a SELF-targeting buff (no template at cast time).
    sys.target = sys.target ?? { value: null, units: "", type: "self", prompt: false };
    sys.target.type = "self";
    sys.target.value = null;
    sys.target.units = "";
    sys.target.prompt = false;

    // Ensure item has a marker effect which will be applied to the caster on cast.
    itemObj.effects = Array.isArray(itemObj.effects) ? itemObj.effects : [];
    const effectName = (() => {
      const n = String(itemObj?.name ?? "");
      const nl = n.toLowerCase();
      if (/(grêle|épines|epines|thorns)/i.test(n)) return (wantsFR ? "Grêle d’épines (prêt)" : "Hail of Thorns (ready)");
      if (/(flèche|fleche|éclair|eclair|lightning|arrow)/i.test(nl)) return (wantsFR ? "Flèche éclair (prêt)" : "Lightning Arrow (ready)");
      return (wantsFR ? "Buff AoE (prêt)" : "AoE Buff (ready)");
    })();

    const hasMarker = (e) => !!(e?.flags?.[MODULE_ID]?.onHitAoeBuffMarker || e?.flags?.["encounterplus-importer"]?.onHitAoeBuffMarker);
    let marker = itemObj.effects.find(hasMarker) || itemObj.effects.find(e => foldKey(e?.name ?? "") === foldKey(effectName));

    const genEffectId = () => {
      try { if (foundry?.utils?.randomID) return foundry.utils.randomID(16); } catch (e) {}
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let s = "";
      for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    };

    if (!marker) {
      let eid;
      const used = new Set(itemObj.effects.map(e => String(e?._id ?? "")));
      do { eid = genEffectId(); } while (used.has(eid));
      marker = {
        _id: eid,
        name: effectName,
        img: itemObj?.img ?? "icons/svg/aura.svg",
        disabled: false,
        transfer: false,
        duration: { seconds: 60, startTime: 0 },
        changes: [],
        flags: { [MODULE_ID]: { onHitAoeBuffMarker: true } }
      };
      itemObj.effects.push(marker);
    }

    const markerId = String(marker?._id ?? "");

    // Cast/buff utility activity (base)
    const cast = makeActivity(baseId);
    cast.sort = 0;
    setCommonFromSpell(cast);
    cast.type = "utility";
    cast.name = String(itemObj?.name ?? (wantsFR ? "Buff" : "Buff"));
    cast.midiProperties = cast.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    cast.midiProperties.displayActivityName = true;
    cast.midiProperties.automationOnly = false;

    // Force self-target and no template
    cast.target = cast.target ?? {};
    cast.target.prompt = false;
    cast.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    cast.target.affects = { count: "1", type: "self", choice: false, special: "" };
    cast.effects = [{ _id: markerId }];

    // Ensure bonus action activation (RAW for these spells)
    cast.activation = { type: "bonus", value: 1, condition: "", override: false };

    // Explosion save activity (hidden, automation-only, no slot consumption)
    let saveId = deriveSiblingId(baseId, ["x","y","z","1","2","3","4","5","6","7","8","9","a","b","c","d"]);
    while (sys.activities[saveId]) saveId = deriveSiblingId(baseId);
    const boom = makeActivity(saveId);
    boom.sort = 1;
    setCommonFromSpell(boom);
    boom.type = "save";
    boom.name = isMidi ? "midi save" : (wantsFR ? "Sauvegarde" : "Save");
    boom.midiProperties = boom.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    boom.midiProperties.displayActivityName = true;
    boom.midiProperties.automationOnly = true;
    boom.midiProperties.otherActivityCompatible = false;

    boom.consumption = boom.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
    boom.consumption.spellSlot = false;

    // Multi-target, no template (runtime handles burst selection)
    boom.target = boom.target ?? {};
    boom.target.prompt = false;
    boom.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    boom.target.affects = { count: "99", type: "creature", choice: false, special: "" };

    boom.save = boom.save ?? { ability: [saveAb], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
    boom.save.ability = [saveAb];
    boom.save.dc = boom.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
    boom.save.dc.calculation = "";
    boom.save.dc.formula = CASTER_DC_FORMULA;
    try { delete boom.save.dc.value; } catch (e) { boom.save.dc.value = null; }

    const dmg = damages[0] ?? null;
    if (dmg) {
      boom.damage = boom.damage ?? { onSave: halfOnSave ? "half" : "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      boom.damage.onSave = halfOnSave ? "half" : "none";
      boom.damage.parts = [{
        number: dmg.number,
        denomination: dmg.denom,
        bonus: String(dmg.bonus ?? ""),
        types: [dmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      applyScalingToActivityDamage(boom, scaling);
      boom.description.chatFlavor = wantsFR
        ? `Explosion · JS ${saveAb.toUpperCase()} · ${dmg.number}d${dmg.denom} ${dmg.dtype}${halfOnSave ? " (moitié si réussite)" : ""}`
        : `Explosion · ${saveAb.toUpperCase()} save · ${dmg.number}d${dmg.denom} ${dmg.dtype}${halfOnSave ? " (half on save)" : ""}`;
    } else {
      boom.description.chatFlavor = wantsFR ? `Explosion · JS ${saveAb.toUpperCase()}` : `Explosion · ${saveAb.toUpperCase()} save`;
    }

    // Store metadata for runtime trigger (weapon hit)
    try {
      const around = parseAoeAroundTargetFR(descText) ?? (aoe?.value ? { value: aoe.value, units: aoe.units } : null);
      const triggerOnMiss = /hit\s+or\s+miss|touche\s+ou\s+rate|touche\s+ou\s+manque/i.test(descText);
      if (around?.value) {
        itemObj.flags ??= {};
        itemObj.flags["encounterplus-importer"] ??= {};
        itemObj.flags["encounterplus-importer"].onHitAoeBuff = {
          radius: Number(around.value),
          units: String(around.units ?? "ft"),
          saveActivityId: String(saveId),
          // Lightning Arrow is handled as a main-target weapon hit plus splash around
          // the impact point; the burst should not re-hit the primary target.
          includePrimaryTarget: spellSlug === "fleche-de-foudre" ? false : true,
          triggerOnMiss: !!triggerOnMiss
        };
      }
    } catch (_e) {}

    // Final sanity: ensure the save DC is caster-based for every save activity.
    forceCasterSaveDC();

    sys.actionType = "";
    return;
  }


  // Save-only
  if (isSaveSpell) {
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);
    const dmg = damages[0] ?? null;

    act.type = "save";
    act.name = isMidi ? (wantsFR ? "midi save" : "midi save") : (wantsFR ? "Sauvegarde" : "Save");
    act.midiProperties.displayActivityName = true;

    // Override target template if we found a radius in the description
    if (aoe?.value && aoe?.type) {
      act.target.template.type = aoe.type;
      act.target.template.size = String(aoe.value);
      act.target.template.units = aoe.units;
      act.target.template.width = "";
      act.target.template.height = "";
      act.target.affects = { count: "", type: "", choice: false, special: "" };
      act.target.prompt = true;
    }

    act.save = act.save ?? { ability: [saveAb], dc: { calculation: "", formula: CASTER_DC_FORMULA } };
    act.save.ability = [saveAb];
    act.save.dc = act.save.dc ?? { calculation: "", formula: CASTER_DC_FORMULA };
    // IMPORTANT: Make the Save DC dynamic (depends on the casting actor).
    // Use a custom formula so the DC always matches the caster, including on actors with unusual data.
    act.save.dc.calculation = "";
    act.save.dc.formula = CASTER_DC_FORMULA;
    try { delete act.save.dc.value; } catch (e) { act.save.dc.value = null; }

    if (dmg) {
      act.damage = act.damage ?? { onSave: halfOnSave ? "half" : "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      act.damage.onSave = halfOnSave ? "half" : "none";
      act.damage.parts = [{
        number: dmg.number,
        denomination: dmg.denom,
        bonus: String(dmg.bonus ?? ""),
        types: [dmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      if ((isBeamScalingCantrip && scaling?.kind === "cantrip") || isCountOnlyMultiShotSpell) {
        disableActivityDamageScaling(act);
        if (isCountOnlyMultiShotSpell && Number(multiShotCountScaling?.perLevel ?? 0) > 0) ensureActivitySlotLevelChoice(act);
      } else applyScalingToActivityDamage(act, scaling);
      act.description.chatFlavor = `JS ${saveAb.toUpperCase()} · ${dmg.number}d${dmg.denom} ${dmg.dtype}${halfOnSave ? " (moitié si réussite)" : ""}`;
    } else {
      act.description.chatFlavor = `JS ${saveAb.toUpperCase()}`;
    }

    // Special-case: Wall of Fire remains a SINGLE save activity.
    // We switch its template/variant at use-time (line gauche/droite, anneau interne/externe)
    // so dnd5e does not render/roll multiple SAVE activities on the same card.
    if (__isWallOfFire) {
      configureWallOfFireActivity(act, "line");
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].wallOfFireVariant = itemObj.flags["encounterplus-importer"].wallOfFireVariant ?? "line-right";
    }

    if (__isWallOfThorns) {
      configureWallOfThornsActivity(act, "line");
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].wallOfThornsForm = itemObj.flags["encounterplus-importer"].wallOfThornsForm ?? "line";
    }

    if (__isWallOfLight) {
      configureWallOfLightActivity(act);
    }

    if (__isWallOfIce) {
      configureWallOfIceActivity(act, "line");
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].wallOfIceForm = itemObj.flags["encounterplus-importer"].wallOfIceForm ?? "line";
    }

    if (__isWallOfWind) {
      configureWallOfWindActivity(act);
    }

    try { addDelayedDamageActivity(); } catch (e) { /* ignore */ }

    // Do not rely on legacy actionType/save fields; activities drive the workflow.

    try { maybeAddRepeatChoiceActivities(act); } catch (e) { /* ignore */ }

    sys.actionType = "";
    return;
  }

  // Attack-only
  if (isAttackSpell) {
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);
    const dmg = damages[0] ?? null;

    act.type = "attack";
    act.name = isMidi ? "midi attack" : (wantsFR ? "Attaque" : "Attack");
    act.midiProperties.displayActivityName = true;

    act.attack = act.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
    act.attack.ability = act.attack.ability ?? "";
    act.attack.bonus = act.attack.bonus ?? "";
    act.attack.critical = act.attack.critical ?? { threshold: null };
    act.attack.flat = (act.attack.flat ?? false);
    act.attack.type = act.attack.type ?? { value: "ranged", classification: "spell" };
    act.attack.type.value = (atk.mode === "melee") ? "melee" : "ranged";
    act.attack.type.classification = "spell";

    if (dmg) {
      act.damage = act.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
      act.damage.parts = [{
        number: dmg.number,
        denomination: dmg.denom,
        bonus: String(dmg.bonus ?? ""),
        types: [dmg.dtype || ""],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];
      if ((isBeamScalingCantrip && scaling?.kind === "cantrip") || isCountOnlyMultiShotSpell) {
        disableActivityDamageScaling(act);
        if (isCountOnlyMultiShotSpell && Number(multiShotCountScaling?.perLevel ?? 0) > 0) ensureActivitySlotLevelChoice(act);
      } else applyScalingToActivityDamage(act, scaling);
      act.description.chatFlavor = `${atk.actionType.toUpperCase()} · ${dmg.number}d${dmg.denom} ${dmg.dtype}`;
    } else {
      act.description.chatFlavor = `${atk.actionType.toUpperCase()}`;
    }

    // Multi-ray / multi-shot attack spells (e.g. Rayon ardent, Décharge occulte):
    // Provide an additional "extra shot" activity that does NOT consume a spell slot.
    // This helps when multiple rays target the same creature (or when you want to resolve rays one by one).
    try {
      const multi = (multiShotTargets && Number(multiShotTargets) > 1) ? Number(multiShotTargets) : 1;
      const perShotCue = /pour\s+chaque\s+(?:rayon|faisceau|projectile|dard|trait|fl[ée]chette|carreau)|pour\s+chacun(?:e)?\s+des?\s+(?:rayons?|faisceaux?|projectiles?|dards?|traits?|fl[ée]chettes?|carreaux?)/i.test(descText);
      const beamsByLevelCue = /(deux|2)\s+rayons?\s+au\s+niveau\s+5|(trois|3)\s+rayons?\s+au\s+niveau\s+11|(quatre|4)\s+rayons?\s+au\s+niveau\s+17/i.test(descText);
      const extraShotsPerLevel = Number(multiShotCountScaling?.perLevel ?? 0) || 0;
      const slotScalingBaseLevel = Number(multiShotCountScaling?.baseLevel ?? (sys.level ?? 0)) || Number(sys.level ?? 0) || 0;
      if (perShotCue && (multi > 1 || beamsByLevelCue)) {
        const extraId = deriveSiblingId(baseId, ["x","X","1","2","3","4","5","6","7","8","9","a","b","c","d","e","f"]);
        const extra = makeActivity(extraId);
        extra.sort = 1;
        setCommonFromSpell(extra);

        extra.type = "attack";
        extra.name = isMidi ? "midi attack extra" : (wantsFR ? "Attaque (suppl.)" : "Attack (extra)");
        extra.midiProperties.displayActivityName = false;
        extra.midiProperties.automationOnly = true;

        // Copy attack + damage definition from the base activity (1 ray / 1 projectile)
        extra.attack = foundry?.utils?.deepClone ? foundry.utils.deepClone(act.attack) : JSON.parse(JSON.stringify(act.attack ?? {}));
        extra.damage = foundry?.utils?.deepClone ? foundry.utils.deepClone(act.damage) : JSON.parse(JSON.stringify(act.damage ?? {}));
        if (isBeamScalingCantrip || isCountOnlyMultiShotSpell) disableActivityDamageScaling(extra);
        extra.description = extra.description ?? { chatFlavor: "" };
        extra.description.chatFlavor = (wantsFR ? "Rayon / projectile supplémentaire" : "Extra ray/shot");

        // Force target = 1 creature for the extra shot
        extra.target = extra.target ?? { template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" },
          affects: { count:"", type:"", choice:false, special:"" }, prompt:true, override:false };
        extra.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
        extra.target.affects = { count: "1", type: "creature", choice: false, special: "" };
        extra.target.prompt = true;
        extra.target.override = true;

        // Do not consume spell slot when rolling extra rays/shots
        extra.consumption = extra.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
        extra.consumption.spellSlot = false;

        extra.flags = extra.flags ?? {};
        extra.flags["encounterplus-importer"] = { ...(extra.flags["encounterplus-importer"] ?? {}), generated: true, kind: "multi-attack-extra" };

        itemObj.flags ??= {};
        itemObj.flags["encounterplus-importer"] ??= {};

        if (extraShotsPerLevel > 0 || isCountOnlyMultiShotSpell) {
          // Count-only upcast (e.g. Scorching Ray): slot level adds shots, not damage per shot.
          disableActivityDamageScaling(act);
          disableActivityDamageScaling(extra);
        }

        if (isBeamScalingCantrip) {
          __beamExtraActivityId = String(extraId);
          itemObj.flags["encounterplus-importer"].beamCantrip = {
            enabled: true,
            slug: __epiSpellSlug || "decharge-occulte",
            baseActivityId: String(baseId),
            extraActivityId: String(extraId),
            thresholds: [1, 5, 11, 17]
          };
        }

        itemObj.flags["encounterplus-importer"].multiAttackChain = {
          ...(itemObj.flags["encounterplus-importer"].multiAttackChain ?? {}),
          enabled: true,
          slug: __epiSpellSlug || slugify(String(sys.name ?? sp?.name ?? "") || "multi-attack-chain"),
          baseActivityId: String(baseId),
          extraActivityId: String(extraId),
          fixedCount: multi > 1 ? multi : 1,
          thresholds: isBeamScalingCantrip ? [1, 5, 11, 17] : [],
          countMode: isBeamScalingCantrip ? "cantrip-thresholds" : "fixed",
          slotScaling: extraShotsPerLevel > 0 ? {
            baseLevel: slotScalingBaseLevel,
            perLevel: extraShotsPerLevel,
            countOnly: true
          } : null,
          promptLabel: wantsFR ? "rayon" : "shot"
        };
      }
    } catch (e) { /* ignore */ }

    try {
      if (isBeamScalingCantrip) {
        itemObj.flags ??= {};
        itemObj.flags["encounterplus-importer"] ??= {};
        itemObj.flags["encounterplus-importer"].beamCantrip = {
          ...(itemObj.flags["encounterplus-importer"].beamCantrip ?? {}),
          enabled: true,
          slug: __epiSpellSlug || "decharge-occulte",
          baseActivityId: String(baseId),
          extraActivityId: __beamExtraActivityId ? String(__beamExtraActivityId) : String(itemObj.flags["encounterplus-importer"]?.beamCantrip?.extraActivityId ?? ""),
          thresholds: [1, 5, 11, 17]
        };
        itemObj.flags["encounterplus-importer"].multiAttackChain = {
          ...(itemObj.flags["encounterplus-importer"].multiAttackChain ?? {}),
          enabled: true,
          slug: __epiSpellSlug || "decharge-occulte",
          baseActivityId: String(baseId),
          extraActivityId: __beamExtraActivityId ? String(__beamExtraActivityId) : String(itemObj.flags["encounterplus-importer"]?.multiAttackChain?.extraActivityId ?? itemObj.flags["encounterplus-importer"]?.beamCantrip?.extraActivityId ?? ""),
          fixedCount: 1,
          thresholds: [1, 5, 11, 17],
          countMode: "cantrip-thresholds",
          slotScaling: null,
          promptLabel: wantsFR ? "rayon" : "beam"
        };
      }
    } catch (e) { /* ignore */ }

    try { addDelayedDamageActivity(); } catch (e) { /* ignore */ }

    try { maybeAddRepeatChoiceActivities(act); } catch (e) { /* ignore */ }

    if (isCountOnlyMultiShotSpell) {
      sys.actionType = "";
      sys.formula = "";
      sys.scaling = { mode: "none", formula: "" };
      sys.damage = { parts: [], versatile: "" };
    } else {
      sys.actionType = atk.actionType;
    }
    return;
  }


  // Damage-only (no attack roll, no save): e.g. Projectiles magiques.
  // Foundry dnd5e supports rolling damage from an activity even when no attack/save applies.
  if (!isAttackSpell && !isSaveSpell && !healCand && damages?.length) {
    const act = makeActivity(baseId);
    act.sort = 0;
    setCommonFromSpell(act);

    const dmg = damages[0];
    const multi = (multiShotTargets && Number(multiShotTargets) > 1) ? Number(multiShotTargets) : 1;

    act.type = "damage";
    act.img = "systems/dnd5e/icons/svg/activity/damage.svg";
    act.name = isMidi ? "midi damage" : (wantsFR ? "Dégâts" : "Damage");
    act.midiProperties.displayActivityName = true;

    act.damage = act.damage ?? { onSave: "none", critical: { bonus: "" }, includeBase: true, parts: [] };
    act.damage.onSave = "none";

        // Multiple independent hits without attack rolls (e.g. Magic Missile / "Projectiles magiques").
    // IMPORTANT: For Magic Missile, damage is *per dart* (1d4+1), and darts can be split across targets.
    // We therefore provide:
    //  - a default per-dart activity (applies 1d4+1 to each selected target)
    //  - an optional "focus" activity (aggregates all darts on a single target, with correct upcast scaling)
    const isMagicMissile = /projectile\s*magique|magic\s*missile/i.test(String(sys.name ?? sp?.name ?? "")) || /fl[ée]chette/i.test(descText);

    if (isMagicMissile && multi > 1) {
      // Activity A: per dart (recommended when splitting missiles)
      // Build Magic Missile damage from canonical RAW values (not parser-dependent),
      // so exported activity JSON always contains a complete base damage part.
      const mmBase = {
        number: 1,
        denom: 4,
        bonus: "+1",
        dtype: "force"
      };
      act.name = isMidi ? "midi missile" : (wantsFR ? "Fléchette" : "Dart");
      act.target = act.target ?? { template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" }, affects: { count:"", type:"", choice:false, special:"" }, prompt:true, override:false };
      act.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
      act.target.affects = { count: "1", type: "creature", choice: false, special: "" };
      act.target.prompt = true;
      act.target.override = true;
      act.damage.parts = [{
        number: mmBase.number,
        denomination: mmBase.denom,
        bonus: String(mmBase.bonus ?? ""),
        types: [mmBase.dtype],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 0, formula: "" }
      }];
      act.description.chatFlavor = `1d${mmBase.denom}${mmBase.bonus ? (String(mmBase.bonus).startsWith("@") ? `+${mmBase.bonus}` : `+${mmBase.bonus}`) : ""} ${mmBase.dtype}`;
      ensureActivitySlotLevelChoice(act);

      // Activity B: extra dart for sequential resolution / retargeting
      const extraId = deriveSiblingId(baseId, ["x","X","1","2","3","4","5","6","7","8","9","a","b","c","d","e","f"]);
      const extra = makeActivity(extraId);
      extra.sort = 1;
      setCommonFromSpell(extra);
      extra.type = "damage";
      extra.img = "systems/dnd5e/icons/svg/activity/damage.svg";
      extra.name = isMidi ? "midi missile extra" : (wantsFR ? "Fléchette (suppl.)" : "Dart (extra)");
      extra.midiProperties.displayActivityName = false;
      extra.midiProperties.automationOnly = true;
      extra.target = extra.target ?? { template: { count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft" }, affects: { count:"", type:"", choice:false, special:"" }, prompt:true, override:false };
      extra.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
      extra.target.affects = { count: "1", type: "creature", choice: false, special: "" };
      extra.target.prompt = true;
      extra.target.override = true;
      extra.damage = extra.damage ?? { onSave: "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      extra.damage.onSave = "none";
      extra.damage.parts = [{
        number: mmBase.number,
        denomination: mmBase.denom,
        bonus: String(mmBase.bonus ?? ""),
        types: [mmBase.dtype],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 0, formula: "" }
      }];
      extra.description = extra.description ?? { chatFlavor: "" };
      extra.description.chatFlavor = wantsFR ? "Fléchette supplémentaire" : "Extra dart";
      extra.consumption = extra.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
      extra.consumption.spellSlot = false;
      extra.flags = extra.flags ?? {};
      extra.flags["encounterplus-importer"] = { ...(extra.flags["encounterplus-importer"] ?? {}), generated: true, kind: "multi-attack-extra" };

      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      itemObj.flags["encounterplus-importer"].multiAttackChain = {
        ...(itemObj.flags["encounterplus-importer"].multiAttackChain ?? {}),
        enabled: true,
        slug: __epiSpellSlug || slugify(String(sys.name ?? sp?.name ?? "") || "magic-missile"),
        baseActivityId: String(baseId),
        extraActivityId: String(extraId),
        fixedCount: multi > 1 ? multi : 1,
        thresholds: [],
        countMode: "fixed",
        slotScaling: {
          baseLevel: Number(sys.level ?? 1) || 1,
          perLevel: 1,
          countOnly: true
        },
        promptLabel: wantsFR ? "projectile" : "missile"
      };

      // Activity C: focus (all darts on one target)
      // _id must be 16 characters, alphanumeric only.
      const genId = () => {
        try {
          if (foundry?.utils?.randomID) return foundry.utils.randomID(16);
        } catch (e) {}
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let s = "";
        for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
      };
      let a2id = deriveSiblingId(baseId, ["f","F","x","1","2","3","4","5","6","7","8","9","a","b","c","d","e"]);
      const a2 = makeActivity(a2id);
      a2.sort = 2;
      setCommonFromSpell(a2);
      a2.type = "damage";
      a2.img = "systems/dnd5e/icons/svg/activity/damage.svg";
      a2.name = isMidi ? "midi missile focus" : (wantsFR ? "Projectiles (focus)" : "Missiles (focus)");
      a2.midiProperties.displayActivityName = false;
      a2.midiProperties.automationOnly = true;

      // Override target to 1 creature for focus mode
      a2.target = a2.target ?? { template: {count:"", contiguous:false, type:"", size:"", width:"", height:"", units:"ft"}, affects: {count:"", type:"", choice:false, special:""}, prompt: true, override: false };
      a2.target.affects = a2.target.affects ?? { count: "", type: "", choice: false, special: "" };
      a2.target.affects.count = "1";
      a2.target.affects.type = "creature";
      a2.target.template.type = "";
      a2.target.template.size = "";
      a2.target.template.width = "";
      a2.target.template.height = "";

      a2.damage = a2.damage ?? { onSave: "none", critical: { bonus: "" }, includeBase: true, parts: [] };
      a2.damage.onSave = "none";

      // Aggregate base darts (level 1 = 3 darts)
      let number = Number(mmBase.number ?? 1) * multi;
      let denom = mmBase.denom;
      let bonus = mmBase.bonus ?? "";
      if (bonus && /^-?\d+$/.test(String(bonus))) bonus = String(Number(bonus) * multi);
      // If bonus is @mod, keep it as-is (can't multiply safely).

      a2.damage.parts = [{
        number,
        denomination: denom,
        bonus: String(bonus ?? ""),
        types: [mmBase.dtype],
        custom: { enabled: false, formula: "" },
        scaling: { mode: "whole", number: 1, formula: "" }
      }];

      // Special-case upcast scaling for Magic Missile: "+ 1 fléchette par niveau au-delà du 1er"
      // This effectively adds +1d4+1 per slot above base (focus mode).
      const mmUpcast = /fl[ée]chette[s]?\s+de\s+plus\s+par\s+niveau\s+(?:au[- ]del[aà]\s+du|au[- ]del[aà]\s+de)\s+1(?:er|e|ème|eme)?/i.test(descText)
        || /une\s+fl[ée]chette\s+de\s+plus\s+par\s+niveau\s+au[- ]del[aà]\s+du\s+1(?:er|e|ème|eme)?/i.test(descText);

      if (mmUpcast) {
        a2.consumption = a2.consumption ?? { targets: [], scaling: { allowed: true, max: "" }, spellSlot: true };
        a2.consumption.spellSlot = true;
        a2.consumption.scaling = a2.consumption.scaling ?? { allowed: true, max: "" };
        a2.consumption.scaling.allowed = true;
        if (a2.consumption.scaling.max == null) a2.consumption.scaling.max = "";

        a2.damage.parts[0].scaling = a2.damage.parts[0].scaling ?? { mode: "whole", number: 1, formula: "" };
        a2.damage.parts[0].scaling.mode = "whole";
        a2.damage.parts[0].scaling.number = 1;
        a2.damage.parts[0].scaling.formula = "d4+1";
      } else {
        applyScalingToActivityDamage(a2, scaling);
      }

      a2.flags = a2.flags ?? {};
      a2.flags["encounterplus-importer"] = { ...(a2.flags["encounterplus-importer"] ?? {}), generated: true, kind: "multi-attack-focus" };
      a2.description.chatFlavor = `${number}d${denom}${bonus ? (String(bonus).startsWith("@") ? `+${bonus}` : `+${bonus}`) : ""} ${mmBase.dtype}`;
      try {
        log("[EPI multi-shot debug] magic missile imported damage", {
          spell: String(itemObj?.name ?? sp?.name ?? ""),
          rawDamage: dmg,
          basePart: act?.damage?.parts?.[0] ?? null,
          extraPart: extra?.damage?.parts?.[0] ?? null,
          focusPart: a2?.damage?.parts?.[0] ?? null
        });
      } catch (_e) {}
      try { addDelayedDamageActivity(); } catch (e) { /* ignore */ }

      sys.actionType = "";
      return;
    }

    // Default: if the spell describes multiple hits, aggregate dice for convenience.
    let number = dmg.number;
    let denom = dmg.denom;
    let bonus = dmg.bonus ?? "";
    if (multi > 1) {
      number = Number(dmg.number ?? 1) * multi;
      if (bonus && /^-?\d+$/.test(String(bonus))) bonus = String(Number(bonus) * multi);
      // If bonus is @mod, keep it as-is (can't multiply safely).
    }

    act.damage.parts = [{
      number,
      denomination: denom,
      bonus: String(bonus ?? ""),
      types: [dmg.dtype],
      custom: { enabled: false, formula: "" },
      scaling: { mode: "whole", number: 1, formula: "" }
    }];

    // Scaling rules (if detected)
    applyScalingToActivityDamage(act, scaling);

    act.description.chatFlavor = `${number}d${denom}${bonus ? (String(bonus).startsWith("@") ? `+${bonus}` : `+${bonus}`) : ""} ${dmg.dtype}`;
    try { addDelayedDamageActivity(); } catch (e) { /* ignore */ }

    try { maybeAddRepeatChoiceActivities(act); } catch (e) { /* ignore */ }

    sys.actionType = "";
    return;
  }

  // Utility
  // Special-case: Wall of Force stays as a SINGLE utility activity.
  // We switch its form at use-time (line / sphere) so the player gets a clean chooser instead of two activity entries.
  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "wall-of-force")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    configureWallOfForceActivity(aCast, "line");
    itemObj.flags ??= {};
    itemObj.flags["encounterplus-importer"] ??= {};
    itemObj.flags["encounterplus-importer"].wallOfForceForm = itemObj.flags["encounterplus-importer"].wallOfForceForm ?? "line";
    sys.actionType = "";
    return;
  }

  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "wall-of-stone")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    configureWallOfStoneActivity(aCast);
    sys.actionType = "";
    return;
  }

  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "wall-of-sand")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    configureWallOfSandActivity(aCast);
    sys.actionType = "";
    return;
  }

  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "wall-of-water")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    configureWallOfWaterActivity(aCast);
    sys.actionType = "";
    return;
  }

  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "prismatic-wall")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    configurePrismaticWallActivity(aCast, "line");
    itemObj.flags ??= {};
    itemObj.flags["encounterplus-importer"] ??= {};
    itemObj.flags["encounterplus-importer"].prismaticWallForm = itemObj.flags["encounterplus-importer"].prismaticWallForm ?? "line";
    sys.actionType = "";
    return;
  }

  // Special-case: Blade Barrier has 2 valid layouts (line or ring).
  // We expose those as 2 separate utility activities, each creating a different template.
  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "blade-barrier")) {
    // Activity A: Line (default item target)
    const aLine = makeActivity(baseId);
    aLine.sort = 0;
    setCommonFromSpell(aLine);
    aLine.type = "utility";
    aLine.name = wantsFR ? "Lancer (ligne)" : "Cast (line)";
    aLine.midiProperties = aLine.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    aLine.midiProperties.displayActivityName = true;

    // Force a proper LINE template for the wall form (avoid inheriting a stale target on previously imported items).
    try {
      const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
      const length = (units === "m") ? 30 : 100;
      const width = (units === "m") ? 1.5 : 5;
      aLine.target = aLine.target ?? {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" },
        affects: { count: "", type: "", choice: false, special: "" },
        prompt: true,
        override: false
      };
      aLine.target.template = aLine.target.template ?? { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
      aLine.target.affects = { count: "", type: "", choice: false, special: "" };
      aLine.target.template.type = "line";
      aLine.target.template.size = String(length);
      aLine.target.template.width = String(width);
      aLine.target.template.height = "";
      aLine.target.template.units = units;
      aLine.target.prompt = true;
      // Ensure the activity uses its own target definition (so the line vs ring gabarits are distinct).
      aLine.target.override = true;
    } catch (e) { /* ignore */ }

    // Activity B: Ring (circle template). Region code will convert this circle into an annulus for damage.
    const ringId = deriveSiblingId(baseId, ["r","R","o","O","c","C","2","x","y","z"]);
    const aRing = makeActivity(ringId);
    aRing.sort = 1;
    setCommonFromSpell(aRing);
    aRing.type = "utility";
    aRing.name = wantsFR ? "Lancer (anneau)" : "Cast (ring)";
    aRing.midiProperties = aRing.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    aRing.midiProperties.displayActivityName = true;

    // Override to a circular template.
    const units = String(sys?.target?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const radius = (units === "m") ? 9 : 30; // 60-ft diameter => 30-ft radius (≈9 m)
    aRing.target = aRing.target ?? {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false
    };
    aRing.target.template = aRing.target.template ?? { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    aRing.target.affects = { count: "", type: "", choice: false, special: "" };
    // Use "sphere" here (not "radius") for maximal compatibility across dnd5e versions.
    // Foundry will still place a circular MeasuredTemplate, and our Region code will
    // interpret it as an annulus for Blade Barrier.
    aRing.target.template.type = "sphere";
    aRing.target.template.size = String(radius);
    aRing.target.template.width = "";
    aRing.target.template.height = "";
    aRing.target.template.units = units;
    aRing.target.prompt = true;
    // Ensure the activity uses its own target definition (so the line vs ring gabarits are distinct).
    aRing.target.override = true;

    return;
  }

  // Special-case: Flaming Sphere should only PLACE the template on cast.
  // Damage is handled by the Region when the sphere is moved into a creature or when a creature ends its turn nearby.
  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "flaming-sphere")) {
    const aCast = makeActivity(baseId);
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    aCast.type = "utility";
    aCast.name = wantsFR ? "Lancer" : "Cast";
    aCast.midiProperties = aCast.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    aCast.midiProperties.displayActivityName = true;
    sys.actionType = "";
    return;
  }

  // Special-case: Storm Sphere benefits from a separate Bonus Action activity (lightning bolt).
  // The Region automation handles the AoE (cast + end of turn). This extra activity only rolls the bolt.
  if (USE_WEB_REGIONS && (itemObj?.flags?.["encounterplus-importer"]?.regionRule === "storm-sphere")) {
    // Base activity: keep as a utility "Lancer" so the Region gets created from the template.
    const aCast = makeActivity(baseId);
    // Prefer the cast activity when no explicit activityId is provided.
    // Most dnd5e UI flows pick the lowest sort as the default.
    aCast.sort = 0;
    setCommonFromSpell(aCast);
    aCast.type = "utility";
    aCast.name = wantsFR ? "Lancer" : "Cast";
    aCast.midiProperties = aCast.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    aCast.midiProperties.displayActivityName = true;

    // Bonus action: lightning bolt (ranged spell attack, 4d6 lightning on hit).
    const boltId = deriveSiblingId(baseId, ["b","B","o","O","l","t","1","2","3","x","y","z"]);
    const aBolt = makeActivity(boltId);
    aBolt.sort = 1;
    setCommonFromSpell(aBolt);
    aBolt.type = "attack";
    aBolt.name = wantsFR ? "Éclair (action bonus)" : "Lightning (bonus action)";
    aBolt.midiProperties = aBolt.midiProperties ?? (isMidi ? midiDefaults() : { displayActivityName: false });
    aBolt.midiProperties.displayActivityName = true;

    // Force bonus-action activation.
    aBolt.activation = aBolt.activation ?? { type: "bonus", value: 1, condition: "", override: false };
    aBolt.activation.type = "bonus";
    aBolt.activation.value = 1;

    // Do not consume a spell slot for the bolt (it is part of the ongoing spell).
    // IMPORTANT: We want this to behave like a "free" bonus action attack: no slot, no concentration prompt.
    aBolt.consumption = aBolt.consumption ?? { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false, override: true };
    aBolt.consumption.spellSlot = false;
    aBolt.consumption.override = true;

    // Do not require concentration for the bolt (it does NOT (re)cast the spell).
    aBolt.duration = aBolt.duration ?? { concentration: false, value: "", units: "inst", special: "", override: true };
    aBolt.duration.concentration = false;
    aBolt.duration.value = "";
    aBolt.duration.units = "inst";
    aBolt.duration.override = true;

    // Target 1 creature (no template).
    aBolt.target = aBolt.target ?? {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" },
      affects: { count: "1", type: "creature", choice: false, special: "" },
      prompt: true,
      override: false
    };
    aBolt.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    aBolt.target.affects = { count: "1", type: "creature", choice: false, special: "" };
    aBolt.target.prompt = true;
    aBolt.target.override = true;

    // Range (best-effort): bolt is 60 ft / ~18 m from the sphere.
    try {
      const units = String(sys?.target?.units ?? sys?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
      const r = (units === "m") ? 18 : 60;
      aBolt.range = aBolt.range ?? { value: "", units: units, special: "", override: false };
      aBolt.range.value = String(r);
      aBolt.range.units = units;
      aBolt.range.special = "";
      aBolt.range.override = true;
    } catch (e) { /* ignore */ }

    // Spell ranged attack.
    aBolt.attack = aBolt.attack ?? { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "ranged", classification: "spell" } };
    aBolt.attack.type = aBolt.attack.type ?? { value: "ranged", classification: "spell" };
    aBolt.attack.type.value = "ranged";
    aBolt.attack.type.classification = "spell";
    aBolt.attack.flat = false;
    aBolt.attack.ability = aBolt.attack.ability ?? "";
    aBolt.attack.bonus = aBolt.attack.bonus ?? "";

    // Damage: 4d6 lightning (RAW). No scaling.
    aBolt.damage = aBolt.damage ?? { critical: { bonus: "" }, includeBase: true, parts: [] };
    aBolt.damage.parts = [{
      number: 4,
      denomination: 6,
      bonus: "",
      types: ["lightning"],
      custom: { enabled: false, formula: "" },
      scaling: { mode: "whole", number: 1, formula: "" }
    }];
    aBolt.description = aBolt.description ?? { chatFlavor: "" };
    aBolt.description.chatFlavor = wantsFR ? "Attaque de sort à distance · 4d6 foudre" : "Ranged spell attack · 4d6 lightning";

    // Store the activity ids so we can prompt the user at use-time.
    try {
      itemObj.flags = itemObj.flags ?? {};
      itemObj.flags["encounterplus-importer"] = itemObj.flags["encounterplus-importer"] ?? {};
      itemObj.flags["encounterplus-importer"].stormSphereActivityIds = { cast: baseId, bolt: boltId };
    } catch (e) { /* ignore */ }

    // Region code remains in charge of the AoE damage triggers.
    sys.actionType = "";
    return;
  }

  const act = makeActivity(baseId);
  act.sort = 0;
  setCommonFromSpell(act);
  act.type = "utility";
  act.name = act.name || "Lancer";
}

function applySpellEffects(itemObj, sp, durationObj, measurement) {
  // Best-effort: for "aura" spells (zone centrée sur soi), créer un Active Effect visible
  // pour faciliter l'utilisation (et la compat avec des modules d'aura).
  itemObj.effects = itemObj.effects ?? [];

  // Keep Activities "effects applied" list in sync with item effects.
  // In dnd5e v5+, activities maintain their own list of applicable item effects (by _id).
  const sys = itemObj.system ?? (itemObj.system = {});
  sys.activities = sys.activities ?? {};
  const pruneActivityEffectRefs = (removedIds = []) => {
    if (!removedIds?.length) return;
    for (const actId of Object.keys(sys.activities)) {
      const act = sys.activities[actId];
      if (!act?.effects) continue;
      act.effects = (Array.isArray(act.effects) ? act.effects : [])
        .filter(e => !removedIds.includes(e?._id));
    }
  };
  const addEffectRefToBaseActivity = (effectId) => {
    if (!effectId) return;
    const baseId = firstActivityId(itemObj);
    const act = sys.activities?.[baseId];
    if (!act) return;
    act.effects = Array.isArray(act.effects) ? act.effects : [];
    if (!act.effects.some(e => e?._id === effectId)) act.effects.push({ _id: effectId });
  };

  const addSimpleLot1BuffEffect = () => {
    const res = attachLot1BuffTemplateEffect(itemObj, sp, durationObj);
    if (res?.attached && res?.effectId) addEffectRefToBaseActivity(res.effectId);
  };

  // Nettoie d'éventuels anciens placeholders d'aura
  itemObj.effects = itemObj.effects.filter(e => !(e?.flags?.["encounterplus-importer"]?.aura));

  // Lot-1 simple buffs/resistances (pragmatic batch pass).
  try { addSimpleLot1BuffEffect(); } catch (e) { /* ignore */ }

  // Nettoie aussi d'éventuels anciens placeholders "OverTime" générés par l'import
  {
    const removed = (itemObj.effects ?? [])
      .filter(e => e?.flags?.["encounterplus-importer"]?.overtime)
      .map(e => e?._id)
      .filter(Boolean);
    itemObj.effects = itemObj.effects.filter(e => !(e?.flags?.["encounterplus-importer"]?.overtime));
    pruneActivityEffectRefs(removed);
  }

  // ---- Special-case: FVTT v13 Regions (zone spells) ----
  // When using Regions automation, we do NOT generate OverTime effects for the spells handled by Regions.
  if (USE_WEB_REGIONS) {
    const __n = String(itemObj?.name ?? "").toLowerCase();
    const __rule = itemObj?.flags?.["encounterplus-importer"]?.regionRule ?? null;
    const __auraMatch = resolvePhase1AuraKey(sp?.slug ?? null, itemObj?.name ?? sp?.name ?? "");
    const __isNativeAuraSpell = !!__auraMatch?.key;

    const __isWeb2 = __n.includes("toile d'araignée") || __n.includes("toile d’araignée") || __n === "web";
    const __isGrease2 = __n === "graisse" || __n === "grease";
    const __isEntangle2 = __n === "enchevêtrement" || __n === "entangle";
    const __isTentacles2 = __n.includes("tentacules noirs") || __n.includes("black tentacles");
    const __isHadar2 = __n.includes("voracité de hadar") || __n.includes("hunger of hadar");
    const __isWallOfLight2 = __n.includes("mur de lumière") || __n.includes("mur de lumiere") || __n.includes("wall of light");

    const mark = (rule) => {
      itemObj.flags ??= {};
      itemObj.flags["encounterplus-importer"] ??= {};
      if (rule) itemObj.flags["encounterplus-importer"].regionRule = rule;
    };

    const implied = __rule
      ?? (__isWeb2 ? "web" : null)
      ?? (__isGrease2 ? "grease" : null)
      ?? (__isEntangle2 ? "entangle" : null)
      ?? (__isTentacles2 ? "black-tentacles" : null)
      ?? (__isHadar2 ? "hunger-of-hadar" : null)
      ?? (__isWallOfLight2 ? "wall-of-light" : null);

    if (implied) {
      mark(implied);
      if (implied === "web") itemObj.flags["encounterplus-importer"].useWebRegions = true;
      // Keep Aura Effects native aura creation for known aura spells
      // even when they also carry region metadata.
      if (!__isNativeAuraSpell) return;
    }
  }

// ---------------------------------------------------------------------------
  // Midi-QOL: "sauvegarde à chaque tour" (Hold Person, Tasha's Hideous Laughter, etc.)
  // ---------------------------------------------------------------------------
  try {
    const descText = stripHtmlToText(cleanEncounterLinks(sp?.descr ?? ""));
    const durUnits = (durationObj?.units ?? "inst");
    const __skipRecurringSaveEachTurn = !!(USE_WEB_REGIONS && (String(itemObj?.flags?.["encounterplus-importer"]?.regionRule ?? itemObj?.flags?.[MODULE_ID]?.regionRule ?? "").toLowerCase() === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(String(itemObj?.name ?? ""))));
    if (durUnits !== "inst" && !__skipRecurringSaveEachTurn) {
      const saveEachTurn = parseRecurringSaveEachTurnFR(descText);

      // Convertit la durée du sort en une durée d'Active Effect (priorité aux rounds pour le combat).
      const toEffectDuration = (dur) => {
        const v = Number(dur?.value);
        const u = String(dur?.units ?? "").toLowerCase();
        if (!Number.isFinite(v) || v <= 0) return {};
        if (u === "turn" || u === "turns") return { turns: Math.round(v) };
        if (u === "round" || u === "rounds") return { rounds: Math.round(v) };

        const roundMult = ({
          minute: 10,
          minutes: 10,
          hour: 600,
          hours: 600,
          day: 14400,
          days: 14400,
          week: 100800,
          weeks: 100800,
          month: 432000,
          months: 432000,
          year: 5256000,
          years: 5256000
        })[u];

        if (roundMult) return { rounds: Math.round(v * roundMult) };

        const secMult = ({
          minute: 60,
          minutes: 60,
          hour: 3600,
          hours: 3600,
          day: 86400,
          days: 86400,
          week: 604800,
          weeks: 604800,
          month: 2592000,
          months: 2592000,
          year: 31536000,
          years: 31536000
        })[u];

        if (secMult) return { seconds: Math.round(v * secMult) };
        return {};
      };

      const mkId = () => (foundry?.utils?.randomID ? foundry.utils.randomID(16) : crypto.randomUUID().slice(0, 16));
      const safeLabel = (s) => String(s ?? "").replace(/,/g, " ").trim();

      if (saveEachTurn?.saveAbility) {
        const when = (saveEachTurn.when === "start") ? "start" : "end";
        const ab = saveEachTurn.saveAbility;

        // Try to infer the primary condition the spell imposes so the effect actually enforces it
        // (e.g. Hold Person/Monster => Paralyzed). Keep this conservative to avoid false positives.
        const spellNameLC = String(itemObj?.name ?? "").toLowerCase();
        const descLC = String(descText ?? "").toLowerCase();
        
let inferredStatusIds = [];

// Infer status conditions directly from description (FR/EN) so the effect enforces the real spell outcome.
// Keep it conservative: only add conditions we can detect with high confidence.
const has = (rx) => rx.test(descLC);

// Core conditions
if (has(/paralys/)) inferredStatusIds.push("paralyzed");
if (has(/entrav|restrain/)) inferredStatusIds.push("restrained");
if (has(/effray|frighten/)) inferredStatusIds.push("frightened");
if (has(/aveugl|blinded/)) inferredStatusIds.push("blinded");
if (has(/assourd|deafened/)) inferredStatusIds.push("deafened");

// Tasha-like: incapacitated / can't take actions or reactions (FR: neutralisé)
if (has(/neutralis|incapacit/)) inferredStatusIds.push("incapacitated");

// Prone / falls prone (FR: à terre / tombe à terre)
if (has(/\bà\s+terre\b|tombe\s+à\s+terre|falls\s+prone|\bprone\b/)) inferredStatusIds.push("prone");

// Some spells don't explicitly say "entravé" but clearly describe being unable to move.
const cantMove = has(/(vitesse\s+devient\s+0|vitesse\s+est\s+de\s+0|ne\s+peut\s+pas\s+se\s+déplacer|cannot\s+move|speed\s+becomes\s+0|speed\s+is\s+0)/);
// Tasha's laughter: can't stand up => effectively prevent movement for VTT convenience.
// (Some French sources phrase this in multiple ways; we also treat the spell name as authoritative.)
const cantStandUp = has(/(incapable\s+de\s+se\s+relever|ne\s+peut\s+pas\s+se\s+relever|ne\s+peut\s+se\s+relever|impossible\s+de\s+se\s+relever|can't\s+stand\s+up|cannot\s+stand\s+up)/);

const isTashaLaughter = (
  spellNameLC.includes("fou rire de tasha") ||
  spellNameLC.includes("tasha’s hideous laughter") ||
  spellNameLC.includes("tasha's hideous laughter")
);

// If the spell is clearly about being held (Hold Person/Monster), prefer paralyzed even if text is light.
if ((spellNameLC.includes("immobilisation de monstre") || spellNameLC.includes("immobilisation de personne") || spellNameLC.includes("hold person") || spellNameLC.includes("hold monster"))
    && !inferredStatusIds.includes("paralyzed")) {
  inferredStatusIds.push("paralyzed");
}

// Web / Toile d'araignée often implies Restrained even if the keyword isn't present (depending on source text).
if (!USE_WEB_REGIONS && (spellNameLC.includes("toile d'araignée") || spellNameLC.includes("toile d’araignée") || spellNameLC === "web")
    && !inferredStatusIds.includes("restrained")) {
  inferredStatusIds.push("restrained");
}

// De-duplicate
        // De-duplicate
        inferredStatusIds = [...new Set(inferredStatusIds)];

        // IMPORTANT: For effects applied via item usage with DAE, "@attributes.spelldc" refers to the caster.
        const ot = `turn=${when},rollType=save,saveAbility=${ab},saveDC=@attributes.spell.dc,saveMagic=true,saveCount=1-,label=${safeLabel(itemObj.name)}`;

        const _effId = mkId();
        itemObj.effects.push({
          _id: _effId,
          name: `${itemObj.name} — JS ${ab.toUpperCase()} (${when === "end" ? "fin" : "début"} de tour)`,
          icon: itemObj.img ?? "icons/svg/daze.svg",
          origin: null,
          disabled: false,
          transfer: false,
          duration: toEffectDuration(itemObj?.system?.duration ?? durationObj),
          flags: {
            core: (inferredStatusIds?.length === 1) ? { statusId: inferredStatusIds[0] } : undefined,
            "encounterplus-importer": { overtime: { kind: "saveEachTurn", when, ab, statusIds: inferredStatusIds } }
          },
          statuses: (inferredStatusIds?.length ? inferredStatusIds : undefined),
          changes: [
            { key: "flags.midi-qol.OverTime", mode: 5, value: ot, priority: 20 },
            // Ensure the condition has a tangible impact even without external condition modules.
            ...( (inferredStatusIds.includes("paralyzed") || inferredStatusIds.includes("restrained") || cantMove || isTashaLaughter || (cantStandUp && inferredStatusIds.includes("incapacitated") && inferredStatusIds.includes("prone"))) ? [
              { key: "system.attributes.movement.walk", mode: 5, value: 0, priority: 20 },
              { key: "system.attributes.movement.fly", mode: 5, value: 0, priority: 20 },
              { key: "system.attributes.movement.swim", mode: 5, value: 0, priority: 20 },
              { key: "system.attributes.movement.climb", mode: 5, value: 0, priority: 20 },
              { key: "system.attributes.movement.burrow", mode: 5, value: 0, priority: 20 }
            ] : [])
          ]
        });

        // dnd5e v5+ uses Activity "effects" list as the authoritative list of effects to apply.
        // Without this reference, the effect exists on the item but won't be applied by the activity workflow.
        addEffectRefToBaseActivity(_effId);
      }

      // Web / Toile d'araignée: action to escape (Strength) rather than auto save each turn.
      // We approximate the RAW "Strength check" as a Strength save for midi-qol automation.
      // midi-qol supports actionSave=true for overtime effects (waits for the actor to roll the save on their turn).
      // See midi-qol docs about actionSave usage.
      if ((spellNameLC.includes("toile d'araignée") || spellNameLC.includes("toile d’araignée") || spellNameLC === "web")
          && /utiliser\s+son\s+action/i.test(descText ?? "")
          && /(se\s+libérer|s'échapper|escape)/i.test(descText ?? "")) {
        const when2 = "start";
        const ab2 = "str";
        const ot2 = `turn=${when2},rollType=save,actionSave=true,saveAbility=${ab2},saveDC=@attributes.spell.dc,saveMagic=true,saveCount=1-,label=${safeLabel(itemObj.name)} (se libérer)`;
        const _effId2 = mkId();
        itemObj.effects.push({
          _id: _effId2,
          name: `${itemObj.name} — Se libérer (Action, FOR)`,
          icon: itemObj.img ?? "icons/svg/net.svg",
          origin: null,
          disabled: false,
          transfer: false,
          duration: toEffectDuration(itemObj?.system?.duration ?? durationObj),
          flags: {
            core: { statusId: "restrained" },
            "encounterplus-importer": { overtime: { kind: "actionEscape", when: when2, ab: ab2, statusIds: ["restrained"] } }
          },
          statuses: ["restrained"],
          changes: [
            { key: "flags.midi-qol.OverTime", mode: 5, value: ot2, priority: 20 },
            { key: "system.attributes.movement.walk", mode: 5, value: 0, priority: 20 },
            { key: "system.attributes.movement.fly", mode: 5, value: 0, priority: 20 },
            { key: "system.attributes.movement.swim", mode: 5, value: 0, priority: 20 },
            { key: "system.attributes.movement.climb", mode: 5, value: 0, priority: 20 },
            { key: "system.attributes.movement.burrow", mode: 5, value: 0, priority: 20 }
          ]
        });

        addEffectRefToBaseActivity(_effId2);
      }
    }
  } catch (e) { /* ignore */ }


  const spellSlug = String(sp?.slug ?? "").toLowerCase();

  // Phase 1 only: explicit, reliable matching by slug (+ folded names as fallback).
  // Reusable "families" to batch aura mechanics by capability.
  const AURA_FAMILY_A_SIMPLE = {
    stealthPlus10: {
      changes: [{ key: "system.skills.ste.bonuses.check", mode: 2, value: "+10", priority: 20 }],
      statuses: [],
      runtime: [],
      deferred: []
    },
    necroticResistance: {
      changes: [{ key: "system.traits.dr.value", mode: 2, value: "necrotic", priority: 20 }],
      statuses: [],
      runtime: [],
      deferred: []
    },
    poisonResistance: {
      changes: [{ key: "system.traits.dr.value", mode: 2, value: "poison", priority: 20 }],
      statuses: [],
      runtime: [],
      deferred: []
    },
    auraLifeProtectionFlag: {
      changes: [{ key: "flags.encounterplus-importer.auraLife.protected", mode: 5, value: true, priority: 20 }],
      statuses: [],
      runtime: [],
      deferred: []
    }
  };
  const AURA_FAMILY_B_PROTECTION = {
    purityProtectionPack: {
      changes: [
        { key: "flags.encounterplus-importer.auraPurity.protected", mode: 5, value: true, priority: 20 }
      ],
      statuses: [],
      runtime: [
        "diseasePrevention"
      ],
      deferred: [
        "conditionSaveAdvantagePack: avantage JS contre aveuglé/charmé/assourdi/effrayé/paralysé/empoisonné/étourdi"
      ]
    },
    circleOfPowerProtectionPack: {
      changes: [
        { key: "flags.encounterplus-importer.circleOfPower.protected", mode: 5, value: true, priority: 20 },
        // Best-effort broad automation: advantage on saves (strict "vs magic only" filter remains deferred/runtime).
        { key: "flags.midi-qol.advantage.ability.save.all", mode: 5, value: true, priority: 20 }
      ],
      statuses: [],
      runtime: [],
      deferred: [
        "advantageVsMagicalSaves: filtrer l'avantage JS pour ne l'appliquer qu'aux sources magiques",
        "evadeOnSuccessVsMagical: aucun dégât sur réussite JS magique à demi-dégâts"
      ]
    }
  };
  const AURA_FAMILY_C_RUNTIME = {
    auraLifeRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [
        "hpMaxReductionBlock",
        "hpFloorNonUndead"
      ],
      deferred: []
    },
    crusadersMantleRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: ["extraRadiantWeaponHit"]
    },
    holyAuraRuntimePack: {
      changes: [
        { key: "system.traits.ci.value", mode: 2, value: "frightened", priority: 20 },
        { key: "flags.encounterplus-importer.holyAura.protected", mode: 5, value: true, priority: 20 },
        { key: "flags.midi-qol.advantage.ability.save.all", mode: 5, value: true, priority: 20 }
      ],
      statuses: [],
      runtime: [],
      deferred: [
        "attackDisadvantageOnAttackers",
        "blindOnMeleeHitVsFiendUndead"
      ]
    },
    spiritGuardiansRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: [
        "startTurnDamageAndSpeedPenalty: dégâts/réduction de vitesse dépendants de l'alignement et du choix du lanceur"
      ]
    },
    spiritShroudRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: [
        "onHitExtraDamageAndHealPrevention: dégâts supplémentaires et anti-soin sur cibles touchées"
      ]
    },
    auraOfVitalityRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: [
        "bonusActionHealingPulse: soin ciblé répété en action bonus"
      ]
    },
    antimagicFieldRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: [
        "magicSuppressionBubble: suppression d'effets/sorts/objets magiques dans la zone"
      ]
    },
    antilifeShellRuntimePack: {
      changes: [],
      statuses: [],
      runtime: [],
      deferred: [
        "livingCreatureBarrier: empêche les créatures vivantes d'entrer dans la zone"
      ]
    },
    armorOfAgathysRuntimePack: {
      changes: [
        { key: "system.attributes.hp.temp", mode: 5, value: "@item.level * 5", priority: 20 }
      ],
      statuses: [],
      runtime: [],
      deferred: [
        "retaliatoryColdDamageOnMeleeHit: dégâts de froid en représailles tant que PV temporaires actifs"
      ]
    }
  };
  const buildAuraEffectSpec = (keys = []) => {
    const out = { changes: [], statuses: [], runtime: [], deferred: [] };
    for (const k of keys) {
      const src = AURA_FAMILY_A_SIMPLE[k] ?? AURA_FAMILY_B_PROTECTION[k] ?? AURA_FAMILY_C_RUNTIME[k] ?? null;
      if (!src) continue;
      out.changes.push(...(Array.isArray(src.changes) ? src.changes : []));
      out.statuses.push(...(Array.isArray(src.statuses) ? src.statuses : []));
      out.runtime.push(...(Array.isArray(src.runtime) ? src.runtime : []));
      out.deferred.push(...(Array.isArray(src.deferred) ? src.deferred : []));
    }
    out.changes = out.changes.filter(Boolean);
    out.statuses = [...new Set(out.statuses.map(String))];
    out.runtime = [...new Set(out.runtime.map(String))];
    out.deferred = [...new Set(out.deferred.map(String))];
    return out;
  };

  const auraPhase1Map = {
    // targeting: allies | all | enemies
    "passage-sans-trace": {
      key: "passage-sans-trace",
      support: "A",
      defaultRadiusMetric: 9,
      defaultRadiusImperial: 30,
      targeting: "allies",
      effects: buildAuraEffectSpec(["stealthPlus10"])
    },
    "aura-de-vie": {
      key: "aura-de-vie",
      support: "A",
      targeting: "allies",
      effects: buildAuraEffectSpec(["necroticResistance", "auraLifeProtectionFlag", "auraLifeRuntimePack"])
    },
    "aura-de-purete": {
      key: "aura-de-purete",
      support: "B",
      targeting: "allies",
      effects: buildAuraEffectSpec(["poisonResistance", "purityProtectionPack"])
    },
    "aura-du-croise": {
      key: "aura-du-croise",
      support: "C",
      targeting: "allies",
      effects: buildAuraEffectSpec(["crusadersMantleRuntimePack"])
    },
    "cercle-de-pouvoir": {
      key: "cercle-de-pouvoir",
      support: "B",
      targeting: "allies",
      effects: buildAuraEffectSpec(["circleOfPowerProtectionPack"])
    },
    "aura-sacree": {
      key: "aura-sacree",
      support: "B",
      targeting: "allies",
      effects: buildAuraEffectSpec(["holyAuraRuntimePack"])
    },
    "esprits-gardiens": {
      key: "esprits-gardiens",
      support: "C",
      defaultRadiusMetric: 4.5,
      defaultRadiusImperial: 15,
      targeting: "enemies",
      effects: buildAuraEffectSpec(["spiritGuardiansRuntimePack"])
    },
    "linceul-spirituel": {
      key: "linceul-spirituel",
      support: "C",
      defaultRadiusMetric: 3,
      defaultRadiusImperial: 10,
      targeting: "enemies",
      effects: buildAuraEffectSpec(["spiritShroudRuntimePack"])
    },
    "aura-de-vitalite": {
      key: "aura-de-vitalite",
      support: "C",
      defaultRadiusMetric: 9,
      defaultRadiusImperial: 30,
      targeting: "allies",
      effects: buildAuraEffectSpec(["auraOfVitalityRuntimePack"])
    },
    "coquille-antivie": {
      key: "coquille-antivie",
      support: "C",
      defaultRadiusMetric: 3,
      defaultRadiusImperial: 10,
      targeting: "all",
      effects: buildAuraEffectSpec(["antilifeShellRuntimePack"])
    },
    "champ-antimagie": {
      key: "champ-antimagie",
      support: "C",
      defaultRadiusMetric: 3,
      defaultRadiusImperial: 10,
      targeting: "all",
      effects: buildAuraEffectSpec(["antimagicFieldRuntimePack"])
    },
    "sacre-de-la-glace": {
      key: "sacre-de-la-glace",
      support: "B",
      targeting: "enemies",
      effects: buildAuraEffectSpec(["armorOfAgathysRuntimePack"])
    }
  };
  const auraMatch = resolvePhase1AuraKey(spellSlug, itemObj?.name ?? sp?.name ?? "");
  const matchedAuraKey = auraMatch.key;
  try {
    itemObj.flags ??= {};
    itemObj.flags["encounterplus-importer"] ??= {};
    itemObj.flags["encounterplus-importer"].auraPhase1Audit = {
      slug: spellSlug,
      name: String(itemObj?.name ?? sp?.name ?? ""),
      recognized: !!matchedAuraKey,
      key: matchedAuraKey,
      via: auraMatch.via,
      reason: matchedAuraKey ? "aura-match" : "no-aura-match"
    };
  } catch (_e) {}
  if (!matchedAuraKey) return;
  if ((durationObj?.units ?? "inst") === "inst") return;

  const rangeType = String(sp?.data?.rangeType ?? "").toLowerCase();
  const shape = String(sp?.data?.areaEffectShape ?? "").toLowerCase();
  const size = sp?.data?.areaEffectSize ?? null;
  if (rangeType !== "self") return;

  const srcMetric = (measurement === "metric");
  const wantMetric = srcMetric || !!game.settings.get(MODULE_ID, SETTINGS.USE_METRIC);

  // Rayon + unité : priorité à ce que le sort a réellement dans system.target/template (si déjà calculé)
  const sysTgt = itemObj?.system?.target ?? {};
  const tmpl = sysTgt?.template ?? null;

  const auraDef = auraPhase1Map[matchedAuraKey] ?? null;
  let radius = null;
  let units = wantMetric ? "m" : "ft";
  let auraShape = "sphere";

  if (tmpl && Number.isFinite(Number(tmpl.size))) {
    auraShape = String(tmpl.type ?? shape).toLowerCase();
    radius = Number(tmpl.size);
    units = String(tmpl.units ?? units);
  } else if (Number.isFinite(Number(sysTgt?.value)) && sysTgt?.type) {
    auraShape = String(sysTgt.type).toLowerCase();
    radius = Number(sysTgt.value);
    units = String(sysTgt.units ?? units);
  } else if (shape && size != null) {
    // Fallback : depuis Encounter+ (size en m si metric, sinon ft)
    const base = srcMetric ? Number(size) : roundTo5(size);
    radius = wantMetric ? (srcMetric ? base : feetToMeters(base)) : (srcMetric ? metersToFeet(base) : base);
    units = wantMetric ? "m" : "ft";
    auraShape = shape;
  } else if (auraDef && Number.isFinite(Number(auraDef.defaultRadiusMetric)) && Number.isFinite(Number(auraDef.defaultRadiusImperial))) {
    radius = wantMetric ? Number(auraDef.defaultRadiusMetric) : Number(auraDef.defaultRadiusImperial);
    units = wantMetric ? "m" : "ft";
    auraShape = "sphere";
  }

  if (!Number.isFinite(radius) || radius <= 0) return;

  // Convertit une durée simple en secondes, quand c'est possible.
  const toSeconds = (dur) => {
    const v = Number(dur?.value);
    if (!Number.isFinite(v) || v <= 0) return null;
    const u = dur?.units;
    const mult = ({
      turn: 1, turns: 1,
      round: 6, rounds: 6,
      minute: 60, minutes: 60,
      hour: 3600, hours: 3600,
      day: 86400, days: 86400,
      week: 604800, weeks: 604800,
      month: 2592000, months: 2592000,
      year: 31536000, years: 31536000,
    })[u];
    if (!mult) return null;
    return Math.round(v * mult);
  };

  const seconds = toSeconds(itemObj?.system?.duration);
  const effectId = foundry?.utils?.randomID ? foundry.utils.randomID(16) : crypto.randomUUID().slice(0, 16);

  const auraDispositionByTargeting = {
    allies: "friendly",
    all: "all",
    enemies: "hostile"
  };
  const aura = {
    enabled: true,
    radius,
    shape: auraShape,
    units,
    disposition: auraDispositionByTargeting[auraDef?.targeting] ?? "all",
    phase: "phase1",
    spellKey: matchedAuraKey
  };

  // Real Aura Effects schema (phase-1): effect.type + effect.system + flags.auraeffects.
  const isAuraEffectsNativeSpell = !!auraDef;
  const auraPayload = {
    changes: Array.isArray(auraDef?.effects?.changes) ? auraDef.effects.changes : [],
    statuses: Array.isArray(auraDef?.effects?.statuses) ? auraDef.effects.statuses : [],
    runtime: Array.isArray(auraDef?.effects?.runtime) ? auraDef.effects.runtime : [],
    deferred: Array.isArray(auraDef?.effects?.deferred) ? auraDef.effects.deferred : []
  };
  const resolveAuraEffectsDisposition = (raw) => {
    // Aura Effects expects a numeric disposition choice (Token disposition enum-like values).
    // For phase-1 aura propagation, prefer a permissive default (0 = Any/Neutral-like bucket),
    // then let individual world token dispositions drive effective inclusion.
    const s = String(raw ?? "").toLowerCase().trim();
    if (s === "friendly" || s === "ally" || s === "allies" || s === "non-hostile" || s === "nonhostile") return 1;
    if (s === "all" || s === "any") return 0;
    if (s === "neutral") return 0;
    if (s === "hostile" || s === "enemy" || s === "enemies") return -1;
    const n = Number(raw);
    if (Number.isFinite(n) && (n === -1 || n === 0 || n === 1)) return n;
    return 0;
  };

  const auraEffectsSystem = isAuraEffectsNativeSpell ? {
    showRadius: false,
    applyToSelf: true,
    bestFormula: "",
    canStack: false,
    collisionTypes: ["move"],
    color: "#000000",
    combatOnly: false,
    disableOnHidden: false,
    distanceFormula: String(aura.radius),
    disposition: resolveAuraEffectsDisposition(aura.disposition),
    evaluatePreApply: true,
    opacity: 0.15,
    overrideName: "",
    script: "",
    stashedChanges: Array.isArray(auraPayload.changes) ? auraPayload.changes : [],
    stashedStatuses: Array.isArray(auraPayload.statuses) ? auraPayload.statuses : []
  } : null;

  // Change inoffensif => rend l'effet visible + stocke la config pour nos usages
  const propagatedChanges = Array.isArray(auraPayload.changes) ? auraPayload.changes : [];
  const effect = {
    _id: effectId,
    name: `Aura — ${itemObj.name}`,
    icon: itemObj.img,
    img: itemObj.img,
    ...(isAuraEffectsNativeSpell ? { type: "auraeffects.aura" } : {}),
    ...(auraEffectsSystem ? { system: auraEffectsSystem } : {}),
    origin: null,
    changes: [
      ...(isAuraEffectsNativeSpell ? propagatedChanges : []),
      { key: "flags.encounterplus-importer.aura", mode: 5, value: JSON.stringify(aura), priority: 20 }
    ],
    disabled: false,
    duration: seconds ? { seconds } : {},
    transfer: false,
    flags: {
      "encounterplus-importer": {
        aura,
        auraEffectPlan: {
          support: String(auraDef?.support ?? "C"),
          automatedChanges: auraPayload.changes,
          automatedStatuses: auraPayload.statuses,
          runtime: auraPayload.runtime,
          deferred: auraPayload.deferred
        }
      },
      ...(isAuraEffectsNativeSpell ? { auraeffects: { originalType: "base" } } : {}),
      // Compat for Aura Effects module namespace.
      "aura-effects": {
        isAura: isAuraEffectsNativeSpell,
        radius: aura.radius,
        shape: aura.shape,
        units: aura.units,
        spellKey: matchedAuraKey
      }
    }
  };

  itemObj.effects.push(effect);
  if (isAuraEffectsNativeSpell) addEffectRefToBaseActivity(effectId);
}


async function toDnd5eItem(it, assetBase, fileIndex, folderId) {
  // Default: previous behavior
  const name = it?.name ?? "Objet";
  const text = it?.descr ?? it?.descrText ?? it?.description ?? "";
  const encType = it?.type ?? "";
  const bonus = parseMagicBonusFromNameOrText(name, text);

  // Choose base template candidates
  const baseKeys = guessBaseItemKeys(encType, name, text);

  // Try to resolve a real template
  let template = null;
  let typeHint = null;

  // Determine type hint from encounter type
  if (encType === "mediumArmor" || encType === "heavyArmor" || encType === "shield") typeHint = "equipment";
  if (encType === "meleeWeapon" || encType === "staff" || encType === "rangedWeapon") typeHint = "weapon";

  for (const k of baseKeys) {
    template = await findItemTemplateByName(k, typeHint);
    if (template) break;
    template = await findItemTemplateByName(k, null);
    if (template) break;
  }

  // Fallback: if item name itself exists in compendium/world
  if (!template) template = await findItemTemplateByName(name, typeHint);

  if (template) {
    let data = template.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    // keep img from Encounter if provided
    const img = resolveImg(it?.image, assetBase, fileIndex) ?? data.img;
    data.img = img;
    data.name = name;
    data.folder = folderId;

    // Description: keep Encounter description (more complete for magic items)
    data.system = data.system ?? {};
    data.system.description = data.system.description ?? {};
    const fmt = await formatEncounterSpellMentions(text);
    data.system.description.value = fmt.html;
    
    try {
      data.flags = data.flags ?? {};
      data.flags["encounterplus-importer"] = data.flags["encounterplus-importer"] ?? {};
      if (detectLastChargeDestruction(data.system.description?.value ?? "")) {
        data.flags["encounterplus-importer"].destroyOnLastCharge = true;
      }
    } catch (e) {}
if (fmt.spellUuids?.length) {
      data.flags = data.flags ?? {};
      data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
      data.flags[MODULE_ID].spells = fmt.spellUuids;
    }

    // Apply mechanics
    applyChargesAndAttunement(data, text);
    try { applySpellActivitiesFromEncounter(data, text, fmt.resolved); } catch(e) {}
    try { addExtraDamageFromText(data, text); } catch(e) {}

    if (data.type === "weapon") applyWeaponMagicBonus(data, bonus);
    if (data.type === "equipment") applyArmorMagicBonus(data, bonus);

    // Special: AC bonus effects (e.g., Bâton de défense)
    addAcBonusEffectIfNeeded(data, name, text);

    return data;
  }

  // No template: fallback to loot item (old behavior)
  const loot = toLootItem(it, assetBase, fileIndex, folderId);
  // add basic uses/attunement tags if we can
  try {
    applyChargesAndAttunement(loot, text);
  } catch (e) {}
  return loot;
}
// ===== End Item import =====

function toLootItem(it, basePath, fileIndex, folderId) {
  const imgResolved = resolveAssetPath(basePath, fileIndex, it.image, { kind: "item-image", allowNoExtension: true });
  const img = hasValidImageExtension(imgResolved) ? (normalizeDataPath(imgResolved) ?? imgResolved) : "icons/svg/item-bag.svg";
  return {
    name: it.name ?? "Item",
    type: "loot",
    img,
    folder: folderId,
    system: {
      description: { value: it.descr ?? "" }
    },
    flags: { [MODULE_ID]: { kind: "item", id: it.id, slug: it.slug } }
  };
}

function toJournal(page, basePath, fileIndex, folderId) {
  const content = rewriteHtml(page.content ?? "", basePath, fileIndex);
  return {
    name: page.name ?? "Page",
    folder: folderId,
    pages: [{
      name: page.name ?? "Page",
      type: "text",
      text: { content }
    }],
    flags: { [MODULE_ID]: { kind: "page", id: page.id, slug: page.slug } }
  };
}

function mapGridType(map) {
  const gt = String(map.gridType ?? "").toLowerCase();
  if (gt.includes("hex")) return 2; // coarse mapping; square exports use "square"
  return 1;
}

async function toSceneAsync(map, basePath, fileIndex, folderId) {
  // Prefer the full map image. Encounter+ "floor" assets in some exports are tiny icons.
  let bgPath =
    resolveAssetPath(basePath, fileIndex, map.image, { kind: "map-image", allowNoExtension: true }) ??
    resolveAssetPath(basePath, fileIndex, map.floor, { kind: "map-floor", allowNoExtension: true });
  // Ensure textures have an extension for Foundry validation.
  bgPath = await ensureExtension(bgPath, fileIndex);
  // If the file still has no extension (some servers refuse to serve extensionless files), try resolving by stem.
  if (bgPath) {
    const leaf = String(bgPath).split("/").pop() ?? "";
    if (!/\.[a-z0-9]{2,5}$/i.test(leaf)) {
      const alt = resolveAssetPath(basePath, fileIndex, leaf, { kind: "map-image", allowNoExtension: false });
      if (alt) bgPath = alt;
    }
  }
  const bgSrc = (bgPath && hasValidMediaExtension(bgPath)) ? bgPath : null;
  const bgUrl = bgSrc ? toFilesUrl(bgSrc) : null;
  const gridSize = safeInt(map.gridSize, 100);
  const units = map.gridUnits ?? "ft";
  const distance = safeFloat(map.gridScale, (String(units).toLowerCase() === "m" ? 1.5 : 5));

  let width = safeInt(map.width, 0);
  let height = safeInt(map.height, 0);

  // Some Encounter+ exports store width/height as 0; try to read from image.
  if ((width <= 0 || height <= 0) && bgUrl) {
    const dim = await getImageDimensions(bgUrl);
    if (dim?.width > 0 && dim?.height > 0) {
      width = dim.width;
      height = dim.height;
    }
  }

  // Final fallback to safe positive values.
  if (width <= 0) width = 3000;
  if (height <= 0) height = 2000;

  // Tiles (only those with a valid image extension)
  const tiles = [];
  for (const t of (map.tiles ?? [])) {
    const res = t?.asset?.resource;
    let src = resolveAssetPath(basePath, fileIndex, res, { kind: "map-tile", allowNoExtension: true });
    if (!src) continue;
    src = await ensureExtension(src, fileIndex);
    // If the tile is still extensionless after ensureExtension, Foundry will reject it.
    const leaf2 = String(src).split("/").pop() ?? "";
    if (!/\.[a-z0-9]{2,5}$/i.test(leaf2) || !hasValidMediaExtension(src)) {
      log("Skip tile (no extension)", map?.name, res);
      continue;
    }
    const w = safeInt(t.width, 0);
    const h = safeInt(t.height, 0);
    const sc = safeFloat(t.scale, 1);
    if (w <= 0 || h <= 0) continue;
    tiles.push({
      x: safeInt(t.x, 0),
      y: safeInt(t.y, 0),
      width: Math.max(1, Math.round(w * sc)),
      height: Math.max(1, Math.round(h * sc)),
      rotation: safeFloat(t.rotation, 0),
      alpha: Math.min(1, Math.max(0, safeFloat(t.opacity, 1))),
      hidden: !!t.hidden,
      texture: { src }
    });
  }

  return {
    name: map.name ?? "Map",
    folder: folderId,
    width,
    height,
    ...(bgSrc ? { background: { src: bgSrc } } : {}),
    tiles,
    grid: {
      size: gridSize,
      distance,
      units,
      type: mapGridType(map),
      color: map.gridColor ?? "#000000",
      alpha: safeFloat(map.gridOpacity, 0.2),
      offsetX: safeInt(map.gridOffsetX, 0),
      offsetY: safeInt(map.gridOffsetY, 0)
    },
    flags: { [MODULE_ID]: { kind: "map", id: map.id, slug: map.slug } }
  };
}

function toRollTable(t, folderId) {
  const rows = t.rows ?? [];
  const formula = (t.rolls?.[0]?.formula) || `1d${Math.max(rows.length, 1)}`;
  const results = rows.map((r, i) => ({
    type: 0,
    text: String(r?.[2] ?? r?.[0] ?? "").trim(),
    range: [i+1, i+1],
    weight: 1,
    drawn: false
  }));
  return {
    name: t.name ?? "Table",
    folder: folderId,
    formula,
    results,
    flags: { [MODULE_ID]: { kind: "table", id: t.id, slug: t.slug } }
  };
}

export async function runImport({ sourcePath, prefix = "Encounter+ Import", destination = "world" } = {}) {
  if (!sourcePath) {
    notify("warn", "Chemin source vide.");
    return;
  }

  notify("info", `Import Encounter+ : analyse de ${sourcePath}...`);
  const scan = await scanEncounterPath(sourcePath, { depth: 2 });
  const basePath = sanitizePath(scan.basePath);
  const found = scan.found;

  // Build a small index of files under the export folder, used to resolve images (monsters/items/tokens/maps).
  notify("info", "Indexation des fichiers (pour résoudre les images)…");
  const fileIndex = await buildFileIndex(basePath, { depth: 4 });
  log("File index keys:", fileIndex?.size ?? 0);

  const summary = { pages:0, maps:0, monsters:0, items:0, spells:0, tables:0 };
  const failed = { pages:0, maps:0, monsters:0, items:0, spells:0, tables:0 };
  const firstErrors = [];
  log("Scan basePath:", basePath, "found:", Array.from(found.keys()));

  const jsonUrl = (name) => found.get(name)?.url ?? null;

  // Prefer JSON
  const pagesUrl = jsonUrl("pages.json");
  const mapsUrl = jsonUrl("maps.json");
  const monstersUrl = jsonUrl("monsters.json");
  const itemsUrl = jsonUrl("items.json");
  const spellsUrl = jsonUrl("spells.json");
  const tablesUrl = jsonUrl("tables.json");

  if (!pagesUrl && !mapsUrl && !monstersUrl && !itemsUrl && !tablesUrl && !spellsUrl) {
    notify("error", `Aucun fichier JSON détecté dans ${sourcePath}. (XML non supporté dans cette version)`);
    return;
  }

  // Load data (if missing, use empty arrays)
  const pages = pagesUrl ? await fetchJson(pagesUrl) : [];
  const maps = mapsUrl ? await fetchJson(mapsUrl) : [];
  const monsters = monstersUrl ? await fetchJson(monstersUrl) : [];
  const items = itemsUrl ? await fetchJson(itemsUrl) : [];
  const spells = spellsUrl ? await fetchJson(spellsUrl) : [];
  const tables = tablesUrl ? await fetchJson(tablesUrl) : [];

  // Use basePath for assets resolution
  const assetBase = basePath;

  // Create folders
  const fJournal = await ensureFolder("JournalEntry", `${prefix} - Journaux`);
  const fScene = await ensureFolder("Scene", `${prefix} - Scènes`);
  const fActor = await ensureFolder("Actor", `${prefix} - Monstres`);
  const fItem = await ensureFolder("Item", `${prefix} - Objets`);
  const fSpell = await ensureFolder("Item", `${prefix} - Sorts`);
  const fTable = await ensureFolder("RollTable", `${prefix} - Tables`);


  // Prepare spell subfolders (by level)
  const spellFolders = {};
  try {
    const lvlNames = [
      "Niveau 0 (Tours de magie)",
      "Niveau 1",
      "Niveau 2",
      "Niveau 3",
      "Niveau 4",
      "Niveau 5",
      "Niveau 6",
      "Niveau 7",
      "Niveau 8",
      "Niveau 9",
    ];
    for (let i = 0; i < lvlNames.length; i++) {
      spellFolders[i] = await ensureChildFolder(lvlNames[i], "Item", fSpell.id);
    }
  } catch (e) {
    console.warn("encounterplus-importer | spell folder creation failed", e);
  }

  notify("info", `Import en cours… (journaux=${pages.length}, scènes=${maps.length}, monstres=${monsters.length}, objets=${items.length}, tables=${tables.length})`);

  // Import Journals
  for (const p of pages) {
    try {
      await JournalEntry.create(toJournal(p, assetBase, fileIndex, fJournal.id));
      summary.pages++;
    } catch (e) {
      log("Journal import failed", p?.name, e);
      failed.pages++;
      if (firstErrors.length < 5) firstErrors.push(`Journal: ${p?.name ?? "(sans nom)"} → ${e?.message ?? e}`);
    }
  }

  // Import Scenes
  for (const m of maps) {
    try {
      const data = await toSceneAsync(m, assetBase, fileIndex, fScene.id);
      await Scene.create(data);
      summary.maps++;
    } catch (e) {
      log("Scene import failed", m?.name, e);
      failed.maps++;
      if (firstErrors.length < 5) firstErrors.push(`Scène: ${m?.name ?? "(sans nom)"} → ${e?.message ?? e}`);
    }
  }


  // Import Spells
  if (Array.isArray(spells) && spells.length) {
    notify("info", `Import des sorts (${spells.length})…`);
    for (const sp of spells) {
      try {
        const lvl = Number(sp?.data?.level ?? 0);
        const folder = spellFolders?.[lvl]?.id ?? fSpell.id;
        const data = await toDnd5eSpell(sp, folder);
        await Item.create(data);
        summary.spells++;
      } catch (e) {
        failed.spells++;
        if (firstErrors.length < 5) firstErrors.push({ type:"spell", name: sp?.name, error: String(e) });
        console.warn("Spell import failed", sp?.name, e);
      }
    }
  }

  // Import Items
  const itemSubfolders = await ensureItemSubfolders(fItem.id);
  for (const it of items) {
    try {
      const data = await toDnd5eItem(it, assetBase, fileIndex, fItem.id);
      try {
        const key = classifyItemFolder(data);
        const targetFolder = itemSubfolders?.[key] ?? null;
        if (targetFolder) data.folder = targetFolder.id;
      } catch (e) {}
      await Item.create(data);
      summary.items++;
    } catch (e) {
      log("Item import failed", it?.name, e);
      failed.items++;
      if (firstErrors.length < 5) firstErrors.push(`Objet: ${it?.name ?? "(sans nom)"} → ${e?.message ?? e}`);
    }
  }

  

    // Import Monsters
  for (const mon of monsters) {
    try {
      const created = await Actor.create(await toNpc(mon, assetBase, fileIndex, fActor.id));
      // If the monster/NPC has no portrait image, reuse the token image as portrait.
      try {
        const img = created?.img ?? "";
        const tokenSrc = created?.prototypeToken?.texture?.src ?? "";
        const leaf = String(img).split("/").pop() ?? "";
        const unicodeOdd = (leaf && (()=>{ try { return leaf.normalize("NFC") !== leaf; } catch(e){ return false; } })());
        const isMissing = !img || img.includes("icons/svg/mystery-man") || img.includes("mystery-man") || unicodeOdd;
        if (isMissing && tokenSrc) await created.update({ img: tokenSrc });
      } catch (e) {
        // ignore portrait fallback errors
      }
      summary.monsters++;
    } catch (e) {
      log("Monster import failed", mon?.name, e);
      failed.monsters++;
      if (firstErrors.length < 5) firstErrors.push(`Monstre: ${mon?.name ?? "(sans nom)"} → ${e?.message ?? e}`);
    }
  }

  

  // Import Tables// Import Tables
  for (const t of tables) {
    try {
      await RollTable.create(toRollTable(t, fTable.id));
      summary.tables++;
    } catch (e) {
      log("Table import failed", t?.name, e);
      failed.tables++;
      if (firstErrors.length < 5) firstErrors.push(`Table: ${t?.name ?? "(sans nom)"} → ${e?.message ?? e}`);
    }
  }

  const ok = `Journaux:${summary.pages} | Scènes:${summary.maps} | Monstres:${summary.monsters} | Objets:${summary.items} | Tables:${summary.tables}`;
  const ko = `échecs → Journaux:${failed.pages} | Scènes:${failed.maps} | Monstres:${failed.monsters} | Objets:${failed.items} | Tables:${failed.tables}`;
  notify("info", `Import terminé ✅ ${ok} (${ko})`);
  if (firstErrors.length) {
    notify("warn", `Quelques erreurs (voir Console F12 pour tout) :\n- ${firstErrors.join("\n- ")}`);
  }
  log("Import summary:", summary);
  log("Import failed:", failed);
  if (firstErrors.length) log("First errors:", firstErrors);
}

// --- Post-processing helpers -------------------------------------------------

export async function repairJournalImages({ sourcePath, prefix = "Encounter+ Import" } = {}) {
  if (!game.user?.isGM) return notify("warn", "GM only");
  if (!sourcePath) return notify("warn", "Chemin source vide.");

  notify("info", "Réparation des images dans les journaux…");
  const scan = await scanEncounterPath(sourcePath, { depth: 4 });
  const basePath = scan.basePath;
  const fileIndex = await buildFileIndex(basePath, { depth: 4 });

  const folderName = `${prefix} - Journaux`;
  const folder = game.folders?.find(f => f.type === "JournalEntry" && f.name === folderName);
  const journals = folder ? folder.contents : game.journal.contents;

  let updated = 0;
  let pagesUpdated = 0;

  for (const j of journals) {
    const updates = [];
    for (const p of j.pages.contents) {
      if (p.type !== "text") continue;
      const old = p.text?.content ?? "";
      const neu = rewriteHtml(old, basePath, fileIndex);
      if (neu !== old) {
        updates.push({ _id: p.id, text: { content: neu } });
        pagesUpdated++;
      }
    }
    if (updates.length) {
      await j.update({ pages: updates });
      updated++;
    }
  }

  notify("info", `Journaux réparés ✅ ${updated}/${journals.length} (pages modifiées: ${pagesUpdated})`);
}



export async function repairSpellDistances({ sourcePath, prefix = "Encounter+ Import" } = {}) {
  if (!game.user?.isGM) return notify("warn", "GM only");
  if (!sourcePath) return notify("warn", "Chemin source vide.");

  notify("info", "Réparation des distances (sorts)...");
  try {
    const found = await scanEncounterPath(sourcePath);
    const spellsUrl = found.get("spells.json")?.url ?? null;
    if (!spellsUrl) {
      notify("warn", "Aucun spells.json trouvé dans le dossier source.");
      return;
    }

    const spells = await fetchJson(spellsUrl);
    const byId = new Map();
    for (const sp of (Array.isArray(spells) ? spells : [])) {
      if (sp?.id != null) byId.set(sp.id, sp);
    }

    let updated = 0;
    let skipped = 0;

    for (const it of (game.items?.contents ?? [])) {
      if (it.type !== "spell") continue;
      const sid = it.flags?.["encounterplus-importer"]?.sourceId ?? null;
      if (!sid) continue;

      const sp = byId.get(sid);
      if (!sp) { skipped++; continue; }

      const measurement = sp?.attributes?.measurement ?? it.flags?.["encounterplus-importer"]?.measurement ?? "imperial";

      const range = toDnd5eRange(sp, measurement);
      const target = toDnd5eTarget(sp, measurement);
      const duration = toDnd5eDuration(sp);

      // Rebuild activities/effects (best-effort)
      const obj = it.toObject();
      obj.system = obj.system ?? {};
      obj.system.range = range;
      obj.system.target = target;

      // Avoid stacking duplicated aura placeholder effects
      if (Array.isArray(obj.effects)) {
        obj.effects = obj.effects.filter(e => !(e?.flags?.["encounterplus-importer"]?.aura));
      }

      try { applySpellActivities(obj, sp, duration, measurement); } catch (e) { log("applySpellActivities failed", obj?.name, e); }
      try { applySpellEffects(obj, sp, duration, measurement); } catch (e) { log("applySpellEffects failed", obj?.name, e); }

      await it.update({
        "system.range": obj.system.range,
        "system.target": obj.system.target,
        "system.activities": obj.system.activities,
        "effects": obj.effects
      });

      updated++;
    }

    notify("info", `Distances réparées ✅ Sorts mis à jour : ${updated} (ignorés : ${skipped})`);
  } catch (e) {
    log("Repair spell distances failed", e);
    notify("error", `Réparation distances: erreur (voir Console).`);
  }
}


export async function repairActorPortraits({ prefix = "Encounter+ Import" } = {}) {
  if (!game.user?.isGM) return notify("warn", "GM only");
  notify("info", "Réparation des portraits PNJ/Monstres (fallback token)…");
  const folderName = `${prefix} - Monstres`;
  const folder = game.folders?.find(f => f.type === "Actor" && f.name === folderName);
  const actors = folder ? folder.contents : game.actors.contents;
  let fixed = 0;
  for (const a of actors) {
    if (a.type !== "npc") continue;
    const img = a.img ?? "";
    const tokenSrc = a.prototypeToken?.texture?.src ?? "";
    if (!tokenSrc) continue;
    const leaf = String(img).split("/").pop() ?? "";
    let unicodeOdd = false;
    try { unicodeOdd = !!leaf && leaf.normalize("NFC") !== leaf; } catch (e) {}
    const missing = !img || img.includes("icons/svg/mystery-man") || img.includes("mystery-man") || unicodeOdd;
    if (missing) {
      await a.update({ img: tokenSrc });
      fixed++;
    }
  }
  notify("info", `Portraits réparés ✅ ${fixed}`);
}

function buildSlugIndexForKind(kind) {
  const idx = new Map();
  if (kind === "scene") {
    for (const s of game.scenes.contents) {
      const slug = s.flags?.[MODULE_ID]?.slug;
      if (slug) idx.set(String(slug), s);
    }
  } else if (kind === "actor") {
    for (const a of game.actors.contents) {
      const slug = a.flags?.[MODULE_ID]?.slug;
      if (slug) idx.set(String(slug), a);
    }
  }
  return idx;
}

function rewriteLinksToUUID(html, scenesBySlug, actorsBySlug) {
  if (!html) return html;
  let out = String(html);

  const linkRe = /<a([^>]*?)href=["'](\/map\/([^"'#]+)|\/monster\/([^"'#]+))[^"']*["']([^>]*)>(.*?)<\/a>/gi;
  out = out.replace(linkRe, (m, pre, _href, mapSlug, monSlug, post, label) => {
    const slug = (mapSlug ?? monSlug ?? "").trim();
    const isMap = !!mapSlug;
    const doc = isMap ? scenesBySlug.get(slug) : actorsBySlug.get(slug);
    if (!doc) return m;
    const uuid = doc.uuid;
    // Keep label as-is.
    return `<a class="content-link" data-uuid="${uuid}">${label}</a>`;
  });

  return out;
}

export async function repairEncounterLinks({ prefix = "Encounter+ Import" } = {}) {
  if (!game.user?.isGM) return notify("warn", "GM only");
  notify("info", "Réparation des liens Encounter+ (maps/monstres)…");

  const scenesBySlug = buildSlugIndexForKind("scene");
  const actorsBySlug = buildSlugIndexForKind("actor");

  const folderName = `${prefix} - Journaux`;
  const folder = game.folders?.find(f => f.type === "JournalEntry" && f.name === folderName);
  const journals = folder ? folder.contents : game.journal.contents;

  let updated = 0;
  let pagesUpdated = 0;

  for (const j of journals) {
    const updates = [];
    for (const p of j.pages.contents) {
      if (p.type !== "text") continue;
      const old = p.text?.content ?? "";
      const neu = rewriteLinksToUUID(old, scenesBySlug, actorsBySlug);
      if (neu !== old) {
        updates.push({ _id: p.id, text: { content: neu } });
        pagesUpdated++;
      }
    }
    if (updates.length) {
      await j.update({ pages: updates });
      updated++;
    }
  }

  notify("info", `Liens réparés ✅ ${updated}/${journals.length} (pages modifiées: ${pagesUpdated})`);
}
