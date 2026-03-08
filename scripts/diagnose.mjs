import { log } from "./module.mjs";

const WANTED = new Set([
  "module.xml","compendium.xml",
  "pages.json","maps.json","monsters.json","items.json","spells.json","tables.json","groups.json","module.json"
]);


const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;


function sanitizePath(p) {
  // FilePicker expects unescaped folder names; dialogs can return URL-encoded strings.
  if (!p) return p;
  let s = String(p);
  // Normalize Windows backslashes
  s = s.replaceAll("\\\\", "/");
  try {
    // decode if it contains %xx sequences
    if (/%[0-9A-Fa-f]{2}/.test(s)) s = decodeURIComponent(s);
  } catch (e) {}
  // Trim trailing slashes
  s = s.replace(/\/+$/, "");
  return s;
}


function dataPathToFilesUrl(p) {
  // Convert a "data" source path (relative to userData) into a /files/ URL.
  // Encode each segment to survive spaces, commas, accents.
  const parts = String(p ?? "").replace(/^[\/]+/, "").split("/").filter(Boolean);
  const enc = parts.map(s => encodeURIComponent(s));
  return `${window.location.origin}/files/${enc.join("/")}`;
}

async function probeJsonInDir(dirPath) {
  // Try to directly fetch known JSON files without relying on FilePicker directory listings.
  for (const name of WANTED) {
    try {
      const url = dataPathToFilesUrl(`${sanitizePath(dirPath)}/${name}`);
      const r = await fetch(url, { method: "GET", cache: "no-store" });
      if (r?.ok) return { name, url, dir: dirPath };
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function basenameFromAny(s) {
  try {
    const u = new URL(s, window.location.origin);
    return decodeURIComponent(u.pathname.split("/").pop() || "");
  } catch(e) {
    return decodeURIComponent(String(s).split("/").pop() || "");
  }
}

export async function scanEncounterPath(rootPath, { depth = 2 } = {}) {
  const source = "data";
  const queue = [{ path: rootPath, d: 0 }];
  const found = new Map(); // name -> { url, dir }

  while (queue.length) {
    const cur = queue.shift();
    let res;
    try {
      res = await FP.browse(source, sanitizePath(cur.path));
      // Some Foundry dialogs/browsers may omit files unless a wildcard/extension filter is provided.
      if (!res?.files || res.files.length === 0) {
        try {
          const res2 = await FP.browse(source, sanitizePath(cur.path), { wildcard: "*.json" });
          if (res2?.files?.length) res.files = res2.files;
          if (res2?.dirs?.length && (!res?.dirs || res.dirs.length === 0)) res.dirs = res2.dirs;
        } catch (e2) {
          // ignore
        }
      }

      // If directory listing still returns no files, probe for JSON files directly via /files/.
      if ((!res?.files || res.files.length === 0) && (!res?.dirs || res.dirs.length === 0)) {
        const hit = await probeJsonInDir(cur.path);
        if (hit && !found.has(hit.name)) {
          found.set(hit.name, { url: hit.url, dir: hit.dir });
        }
      }
    } catch (e) {
      log("Browse failed", cur.path, e);
      continue;
    }

    for (const f of (res.files ?? [])) {
      const b = basenameFromAny(f);
      if (WANTED.has(b) && !found.has(b)) found.set(b, { url: f, dir: cur.path });
    }

    if (cur.d < depth) {
      for (const d of (res.dirs ?? [])) queue.push({ path: d, d: cur.d + 1 });
    }
  }

  // pick best base dir: prefer where module.xml lives else where pages.json lives else rootPath
  const base =
    found.get("module.xml")?.dir ??
    found.get("pages.json")?.dir ??
    found.get("compendium.xml")?.dir ??
    rootPath;

  return { basePath: base, found };
}
