import { MODULE_ID, SETTINGS } from "./module.mjs";


const EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME = "EPI_WallOfLight_BlindEndTurn";
const EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME_LEGACY = "[EPI] Mur de lumière — JS CON fin de tour";

function __epiBuildWallOfLightBlindMacroCommand() {
  return String.raw`
const MODULE_ID = "encounterplus-importer";
try {
  const a = Array.isArray(args) ? args : [];
  const lastArg = a.length ? a[a.length - 1] : {};
  if (String(a[0] ?? '').toLowerCase() === 'off') return;
  let actor = null;
  let tokenDoc = null;
  try {
    const actorUuid = lastArg?.actorUuid ?? lastArg?.actor?.uuid ?? lastArg?.workflow?.actor?.uuid ?? null;
    if (actorUuid) actor = await fromUuid(actorUuid);
    const tokenUuid = lastArg?.tokenUuid ?? lastArg?.token?.uuid ?? lastArg?.token?.document?.uuid ?? lastArg?.workflow?.token?.document?.uuid ?? null;
    if (!actor && tokenUuid) {
      const tok = await fromUuid(tokenUuid);
      tokenDoc = tok?.document ?? tok ?? null;
      actor = tok?.actor ?? tok?.document?.actor ?? null;
    }
    if (!actor && lastArg?.uuid) {
      const doc = await fromUuid(lastArg.uuid).catch(() => null);
      actor = doc?.actor ?? doc?.parent ?? actor;
      tokenDoc = doc?.documentName === 'Token' ? doc : tokenDoc;
    }
  } catch (_e) {}
  if (!actor && lastArg?.actorId) actor = game.actors?.get?.(lastArg.actorId) ?? null;
  if (!actor && lastArg?.tokenId) {
    tokenDoc = canvas?.scene?.tokens?.get?.(lastArg.tokenId) ?? canvas?.tokens?.get?.(lastArg.tokenId)?.document ?? null;
    actor = tokenDoc?.actor ?? null;
  }
  if (!actor && this?.actor) actor = this.actor;
  if (!actor && tokenDoc?.actor) actor = tokenDoc.actor;
  if (!actor) return;

  let effect = null;
  const effectId = lastArg?.effectId ?? lastArg?.efData?._id ?? lastArg?.effectData?._id ?? null;
  if (effectId) effect = actor.effects?.get?.(effectId) ?? Array.from(actor.effects ?? []).find(e => String(e.id ?? e._id ?? '') === String(effectId)) ?? null;
  if (!effect) {
    effect = Array.from(actor.effects ?? []).find(e => !!(e?.flags?.[MODULE_ID]?.wallOfLightBlind || e?.flags?.['encounterplus-importer']?.wallOfLightBlind)) ?? null;
  }
  if (!effect) return;
  const effectFlags = effect.flags?.[MODULE_ID] ?? effect.flags?.['encounterplus-importer'] ?? {};
  const dc = Number(effectFlags.wallOfLightBlindDc ?? 0) || 0;
  if (!(dc > 0)) return;
  const combat = game.combat ?? null;
  if (combat?.started) {
    const round = Number(combat.round ?? 0) || 0;
    const turn = Number(combat.turn ?? -1);
    const key = [combat.id, round, turn, actor.uuid, effect.id ?? effect._id ?? effect.name].join('|');
    const lastDone = String(effect.getFlag(MODULE_ID, 'wallOfLightBlindLastMacroKey') ?? '');
    if (lastDone === key) return;
    await effect.setFlag(MODULE_ID, 'wallOfLightBlindLastMacroKey', key).catch(() => {});
  }
  const roll = await actor.rollAbilitySave('con', {
    chatMessage: true,
    flavor: String(effect.name ?? 'Mur de lumière') + ' — JS de Constitution (fin de tour)'
  });
  const total = Number(roll?.total ?? roll?.rolls?.[0]?.total ?? roll?.[0]?.total ?? 0) || 0;
  if (total >= dc) {
    await effect.delete().catch(() => {});
  }
} catch (err) {
  console.warn('[encounterplus-importer] Wall of Light blind macro failed', err);
}
`;
}

async function __epiEnsureWallOfLightBlindMacro() {
  try {
    if (!game.user?.isGM) return null;
    const command = __epiBuildWallOfLightBlindMacroCommand();
    const names = [EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME, EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME_LEGACY];
    let primary = null;
    for (const name of names) {
      let macro = game.macros?.find?.(m => String(m.name ?? '') === name) ?? null;
      if (!macro) {
        macro = await Macro.create({
          name,
          type: 'script',
          scope: 'global',
          command,
          img: 'systems/dnd5e/icons/svg/statuses/blinded.svg',
          ownership: { default: 3 },
          flags: { [MODULE_ID]: { wallOfLightBlindMacro: true } }
        }, { renderSheet: false });
      } else if (String(macro.command ?? '') !== command || !macro?.flags?.[MODULE_ID]?.wallOfLightBlindMacro) {
        await macro.update({ command, type: 'script', scope: 'global', img: macro.img || 'systems/dnd5e/icons/svg/statuses/blinded.svg', ownership: { ...(macro.ownership ?? {}), default: 3 }, [`flags.${MODULE_ID}.wallOfLightBlindMacro`]: true });
      }
      if (String(name) === String(EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME)) primary = macro;
    }
    return primary ?? (game.macros?.find?.(m => String(m.name ?? '') === EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME) ?? null);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Failed to ensure Wall of Light blind macro`, e);
    return null;
  }
}

function __epiIsWallOfLightItem(item) {
  try {
    const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.['encounterplus-importer']?.slug ?? item?.system?.identifier ?? '').toLowerCase();
    const name = String(item?.name ?? '').toLowerCase();
    const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.['encounterplus-importer']?.regionRule ?? '').toLowerCase();
    return slug === 'mur-de-lumiere' || slug === 'wall-of-light' || rr === 'wall-of-light' || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
  } catch (_e) {
    return false;
  }
}



/**
 * Helper: infer metadata for "buff -> AoE on next ranged weapon hit" spells (Hail of Thorns / Lightning Arrow).
 * This MUST be in module scope (not inside a Hook callback), because other ready hooks reference it.
 */
function inferOnHitAoeBuffFromItem(item) {
  try {
    const name = String(item?.name ?? "");
    const desc = String(item?.system?.description?.value ?? "");
    const text = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    const looksLikeBuff =
      /next\s+time\s+you\s+hit\s+.*ranged\s+weapon\s+attack/i.test(text)
      || /la\s+prochaine\s+fois\s+que\s+vous\s+touchez\s+.*attaque\s+d['’]arme\s+à\s+distance/i.test(text)
      || /la\s+prochaine\s+attaque\s+d['’]arme\s+à\s+distance\s+qui\s+touche/i.test(text);

    const nameLooksKnown = /grêle\s*d['’]?épines|hail\s+of\s+thorns|flèche\s+éclair|lightning\s+arrow/i.test(name);
    if (!looksLikeBuff && !nameLooksKnown) return null;

    let radius = null;
    let units = null;

    const frRay = text.match(/rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|mètre|mètres)\s+de\s+la\s+cible/);
    if (frRay) { radius = Number(frRay[1].replace(",", ".")); units = "m"; }
    const frRay2 = text.match(/dans\s+un\s+rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|mètre|mètres)/);
    if (!radius && frRay2) { radius = Number(frRay2[1].replace(",", ".")); units = "m"; }

    const en = text.match(/within\s*(\d+)\s*(feet|foot|ft)\s*of\s*the\s*target/);
    if (!radius && en) { radius = Number(en[1]); units = "ft"; }

    if (!radius && /grêle\s*d['’]?épines|hail\s+of\s+thorns/i.test(name)) { radius = 5; units = "ft"; }
    if (!radius && /flèche\s+éclair|lightning\s+arrow/i.test(name)) { radius = 10; units = "ft"; }
    if (!radius) return null;

    const triggerOnMiss =
      /hit\s+or\s+miss/i.test(text)
      || /touche\s+ou\s+rate|touche\s+ou\s+manque/i.test(text)
      || /flèche\s+éclair|lightning\s+arrow/i.test(name);

    const acts = item?.system?.activities ?? null;
    let list = [];
    try {
      if (Array.isArray(acts)) list = acts;
      else if (acts?.contents && Array.isArray(acts.contents)) list = acts.contents;
      else if (typeof acts?.values === "function") list = Array.from(acts.values());
      else if (acts && typeof acts === "object") list = Object.values(acts);
    } catch (_e) { list = []; }
    list = (Array.isArray(list) ? list : []).filter(a => a && typeof a === "object" && (a?._id || a?.id));

    const consumesSlot = (a) => (a?.consumption?.spellSlot ?? a?.system?.consumption?.spellSlot);
    const save = list.find(a => a?.type === "save" && consumesSlot(a) === false) ?? list.find(a => a?.type === "save") ?? null;
    if (!save) return null;

    return {
      radius,
      units: units || "ft",
      saveActivityId: String(save?._id ?? save?.id ?? ""),
      includePrimaryTarget: true,
      triggerOnMiss
    };
  } catch (_e) {
    return null;
  }
}


/**
 * Hotfix75:
 * - Ensure the module ALWAYS registers settings (so it shows up in Configure Settings)
 * - Avoid hard dependency on ApplicationV2 APIs at load time.
 * - Provide a legacy FormApplication-based UI that works across Foundry V12/V13.
 */

class EncounterImporterLegacyApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "encounterplus-importer",
      title: game.i18n.localize("EPI.App.Title"),
      template: `modules/${MODULE_ID}/templates/importer.hbs`,
      width: 720,
      height: "auto",
      resizable: true,
      classes: ["encounterplus-importer"]
    });
  }

  getData(options={}) {
    return {
      sourcePath: game.settings.get(MODULE_ID, SETTINGS.SOURCE_PATH) || "",
      prefix: game.settings.get(MODULE_ID, SETTINGS.PREFIX) || "Encounter+ Import"
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='browse']").on("click", async (ev) => {
      ev.preventDefault();
      const input = html.find("input[name='sourcePath']")[0];
      const current = input?.value || "";
      const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      new FP({
        type: "folder",
        current,
        callback: (path) => { if (input) input.value = path; }
      }).render(true);
    });

    html.find("[data-action='import']").on("click", async (ev) => {
      ev.preventDefault();
      const sourcePath = (html.find("input[name='sourcePath']").val() ?? "").trim();
      const prefix = (html.find("input[name='prefix']").val() ?? "").trim() || "Encounter+ Import";
      const destination = "world";

      await game.settings.set(MODULE_ID, SETTINGS.SOURCE_PATH, sourcePath);
      await game.settings.set(MODULE_ID, SETTINGS.PREFIX, prefix);

      const { runImport } = await import("./importer.mjs");
      await runImport({ sourcePath, prefix, destination });
    });

    html.find("[data-action='fixAll']").on("click", async (ev) => {
      ev.preventDefault();
      const sourcePath = (html.find("input[name='sourcePath']").val() ?? "").trim();
      const prefix = (html.find("input[name='prefix']").val() ?? "").trim() || "Encounter+ Import";
      if (!sourcePath) return ui.notifications.warn("Chemin source vide.");

      const { repairJournalImages, repairActorPortraits, repairEncounterLinks } = await import("./importer.mjs");
      await repairJournalImages({ sourcePath, prefix });
      await repairActorPortraits({ prefix });
      await repairEncounterLinks({ prefix });
    });
  }

  async _updateObject(_event, _formData) {
    // Not used (we handle buttons manually)
  }
}

Hooks.once("init", () => {
  // Ensure we ALWAYS register at least one config-visible setting.
  game.settings.register(MODULE_ID, SETTINGS.SOURCE_PATH, {
    name: game.i18n.localize("EPI.Settings.SourcePath.Name"),
    hint: game.i18n.localize("EPI.Settings.SourcePath.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.PREFIX, {
    name: game.i18n.localize("EPI.Settings.Prefix.Name"),
    hint: game.i18n.localize("EPI.Settings.Prefix.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "Encounter+ Import"
  });

  game.settings.register(MODULE_ID, SETTINGS.USE_METRIC, {
    name: game.i18n.localize("EPI.Settings.UseMetric.Name"),
    hint: game.i18n.localize("EPI.Settings.UseMetric.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_MIDI_APPLY_EFFECTS, {
    name: game.i18n.localize("EPI.Settings.AutoMidiApplyEffects.Name"),
    hint: game.i18n.localize("EPI.Settings.AutoMidiApplyEffects.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Internal one-time migration flag
  game.settings.register(MODULE_ID, "migrationHotfix181", {
    name: "Migration hotfix181 (internal)",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "migrationHotfix270", {
    name: "Migration hotfix270 (internal)",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Internal one-time migration flag (introduced hotfix270o)
  game.settings.register(MODULE_ID, "migrationHotfix270o", {
    name: "Migration hotfix270o (internal)",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });




// Internal one-time migration flag (introduced hotfix270s)
game.settings.register(MODULE_ID, "migrationHotfix270s", {
  name: "Migration hotfix270s (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});

// Internal one-time migration flag (introduced hotfix270t)
game.settings.register(MODULE_ID, "migrationHotfix270t", {
  name: "Migration hotfix270t (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix270u)
game.settings.register(MODULE_ID, "migrationHotfix270u", {
  name: "Migration hotfix270u (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271o)
game.settings.register(MODULE_ID, "migrationHotfix271o", {
  name: "Migration hotfix271o (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271p)
game.settings.register(MODULE_ID, "migrationHotfix271p", {
  name: "Migration hotfix271p (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271q)
game.settings.register(MODULE_ID, "migrationHotfix271q", {
  name: "Migration hotfix271q (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271s)
game.settings.register(MODULE_ID, "migrationHotfix271s", {
  name: "Migration hotfix271s (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271ai)
game.settings.register(MODULE_ID, "migrationHotfix271ai", {
  name: "Migration hotfix271ai (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});

// Internal one-time migration flag (introduced hotfix271ap)
game.settings.register(MODULE_ID, "migrationHotfix271ap", {
  name: "Migration hotfix271ap (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271aq)
game.settings.register(MODULE_ID, "migrationHotfix271aq", {
  name: "Migration hotfix271aq (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});
// Internal one-time migration flag (introduced hotfix271au)
game.settings.register(MODULE_ID, "migrationHotfix271ay", {
  name: "Migration hotfix271ay (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});

game.settings.register(MODULE_ID, "migrationHotfix271au", {
  name: "Migration hotfix271au (internal)",
  scope: "world",
  config: false,
  type: Boolean,
  default: false
});



  // Always extend DND5E config dropdowns to include meters/kilometers (harmless if unused).
  try {
    const cfg = CONFIG?.DND5E ?? null;
    if (cfg) {
      const addUnit = (obj, key, labelKey) => {
        if (!obj || typeof obj !== "object") return;
        if (!(key in obj)) obj[key] = labelKey;
      };
      addUnit(cfg.distanceUnits, "m", "EPI.Units.M");
      addUnit(cfg.distanceUnits, "km", "EPI.Units.KM");
      addUnit(cfg.rangeUnits, "m", "EPI.Units.M");
      addUnit(cfg.rangeUnits, "km", "EPI.Units.KM");
      addUnit(cfg.movementUnits, "m", "EPI.Units.M");
      addUnit(cfg.movementUnits, "km", "EPI.Units.KM");
      addUnit(cfg.targetUnits, "m", "EPI.Units.M");
      addUnit(cfg.targetUnits, "km", "EPI.Units.KM");
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Metric config patch failed`, e);
  }


  game.settings.register(MODULE_ID, SETTINGS.IMPORT_DEST, {
    name: game.i18n.localize("EPI.Settings.Destination.Name"),
    hint: game.i18n.localize("EPI.Settings.Destination.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: { world: game.i18n.localize("EPI.DestWorld") },
    default: "world"
  });

  // Settings menu (always available)
  game.settings.registerMenu(MODULE_ID, "importer", {
    name: game.i18n.localize("EPI.Menu.Name"),
    label: game.i18n.localize("EPI.Menu.Label"),
    hint: game.i18n.localize("EPI.Menu.Hint"),
    icon: "fas fa-file-import",
    type: EncounterImporterLegacyApp,
    restricted: true
  });
});

// Helpful runtime confirmation
Hooks.once("ready", async () => {
  const mod = game.modules?.get?.(MODULE_ID);
  const v = mod?.version ?? "(unknown)";
  console.log(`[${MODULE_ID}] Loaded version`, v);
  console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hardproof main.mjs loaded (post-ready)`);

  // Hotfix270 safety: clean up any legacy Midi-QOL OnUse macros injected by earlier experimental hotfixes.
  // This prevents broken automation persisting on items even after reverting the module.
  try {
    if (game.user?.isGM) {
      const bad = ["epiOnHitAoePreSave", "function.epiOnHitAoePreSave", "__EPI_DEBUG", "__EPI_DEBUG_ICEKNIFE"];
      const cleanStr = (s) => {
        if (typeof s !== "string") return s;
        let parts = s.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
        const before = parts.length;
        parts = parts.filter(p => !bad.some(b => p.includes(b)));
        return (parts.length === before) ? s : parts.join(", ");
      };
      const maybeCleanItem = async (it) => {
        const cur = it?.getFlag?.("midi-qol", "onUseMacroName") ?? it?.flags?.["midi-qol"]?.onUseMacroName;
        if (!cur || typeof cur !== "string") return 0;
        const nxt = cleanStr(cur);
        if (nxt === cur) return 0;
        await it.update({ "flags.midi-qol.onUseMacroName": nxt });
        return 1;
      };
      let cleaned = 0;
      for (const it of (game.items ?? [])) cleaned += await maybeCleanItem(it);
      for (const a of (game.actors ?? [])) {
        for (const it of (a.items ?? [])) cleaned += await maybeCleanItem(it);
      }
      if (cleaned) console.log(`[${MODULE_ID}] Hotfix270 cleanup removed legacy Midi OnUse macro entries from`, cleaned, "item(s).");
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix270 cleanup failed`, e);
  }


  // Hotfix181 migration: for Region-handled spells, remove cast-time damage/save activities that require targeting.
  try {
    if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix181")) {
      const handled = new Set([
        "web","grease","entangle","black-tentacles","hunger-of-hadar",
        "cloud-of-daggers","moonbeam","spirit-guardians","stinking-cloud"
      ]);
      const items = (game.items ?? []).filter(i => i?.type === "spell" && handled.has(i.getFlag(MODULE_ID, "regionRule")));
      let patched = 0;
      for (const item of items) {
        const acts = foundry.utils.deepClone(item.system?.activities ?? {});
        let changed = false;
        for (const [k,a] of Object.entries(acts)) {
          const t = String(a?.type ?? "").toLowerCase();
          if (t === "damage" || t === "save" || t === "attack" || t === "midi-damage" || t === "midi-save") {
            delete acts[k];
            changed = true;
          }
        }
        if (changed) {
          await item.update({
            "system.activities": acts,
            "system.damage.parts": [],
            "system.save.ability": "",
            "system.actionType": "util"
          });
          patched++;
        }
      }
      await game.settings.set(MODULE_ID, "migrationHotfix181", true);
      if (patched) console.log(`[${MODULE_ID}] Hotfix181 migration patched`, patched, "spell(s).");
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix181 migration failed`, e);
  }

  
  // Hotfix270 migration: ensure onHitAoe secondary SAVE activities can target MULTIPLE creatures.
  // NOTE: Midi-QOL may enforce single-target when an activity has no explicit max-target count and isn't recognized as AoE.
  // We set a generous explicit max ("99") to avoid the workflow being aborted for multi-target secondary bursts.
  try {
    if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix270")) {
      const getMeta = (it) =>
        it?.getFlag?.(MODULE_ID, "onHitAoe")
        ?? it?.getFlag?.("encounterplus-importer", "onHitAoe")
        ?? it?.flags?.[MODULE_ID]?.onHitAoe
        ?? it?.flags?.["encounterplus-importer"]?.onHitAoe
        ?? null;

      const patchItem = async (it) => {
        const meta = getMeta(it);
        if (!meta?.saveActivityId) return 0;
        const aId = String(meta.saveActivityId);
        const act = it?.system?.activities?.get?.(aId) ?? it?.system?.activities?.[aId] ?? null;
        if (!act) return 0;

        // Patch any explicit single-target ("1") OR empty/missing count.
        const curCount = String(act?.target?.affects?.count ?? "");
        if (curCount === "99") return 0;

        const update = {};
        update[`system.activities.${aId}.target.affects.count`] = "99";
        update[`system.activities.${aId}.target.affects.type`] = String(act?.target?.affects?.type ?? "creature") || "creature";
        update[`system.activities.${aId}.target.prompt`] = false;
        // Ensure we don't accidentally prompt for template placement.
        update[`system.activities.${aId}.target.template.type`] = "";
        update[`system.activities.${aId}.target.template.size`] = "";
        update[`system.activities.${aId}.target.template.width`] = "";
        update[`system.activities.${aId}.target.template.height`] = "";
        await it.update(update);
        return 1;
      };

      let patched = 0;
      for (const it of (game.items ?? [])) if (it?.type === "spell") patched += await patchItem(it);
      for (const a of (game.actors ?? [])) {
        for (const it of (a.items ?? [])) if (it?.type === "spell") patched += await patchItem(it);
      }

      await game.settings.set(MODULE_ID, "migrationHotfix270", true);
      if (patched) console.log(`[${MODULE_ID}] Hotfix270 migration patched`, patched, "spell(s) with onHitAoe.");
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix270 migration failed`, e);
  }

  // Hotfix270o migration: upgrade earlier Hotfix270 installations that set count to "".
  // If we detect onHitAoe and the secondary activity still has empty count, force it to "99".
  try {
    if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix270o")) {
      const getMeta = (it) =>
        it?.getFlag?.(MODULE_ID, "onHitAoe")
        ?? it?.getFlag?.("encounterplus-importer", "onHitAoe")
        ?? it?.flags?.[MODULE_ID]?.onHitAoe
        ?? it?.flags?.["encounterplus-importer"]?.onHitAoe
        ?? null;

      const patchItem = async (it) => {
        const meta = getMeta(it);
        if (!meta?.saveActivityId) return 0;
        const aId = String(meta.saveActivityId);
        const act = it?.system?.activities?.get?.(aId) ?? it?.system?.activities?.[aId] ?? null;
        if (!act) return 0;
        const curCount = String(act?.target?.affects?.count ?? "");
        if (curCount && curCount !== "") return 0;
        const update = {};
        update[`system.activities.${aId}.target.affects.count`] = "99";
        update[`system.activities.${aId}.target.affects.type`] = String(act?.target?.affects?.type ?? "creature") || "creature";
        update[`system.activities.${aId}.target.prompt`] = false;
        await it.update(update);
        return 1;
      };

      let patched = 0;
      for (const it of (game.items ?? [])) if (it?.type === "spell") patched += await patchItem(it);
      for (const a of (game.actors ?? [])) {
        for (const it of (a.items ?? [])) if (it?.type === "spell") patched += await patchItem(it);
      }

      await game.settings.set(MODULE_ID, "migrationHotfix270o", true);
      if (patched) console.log(`[${MODULE_ID}] Hotfix270o migration patched`, patched, "spell(s) with onHitAoe (count->99).");
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix270o migration failed`, e);
  }



// Hotfix270s migration: mark known "next ranged weapon hit" buff spells (Hail of Thorns / Lightning Arrow)
// with onHitAoeBuff metadata, and ensure their secondary SAVE activity can target multiple creatures.
try {
  if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix270s")) {
    const patchBuff = async (it) => {
      if (!it || it?.type !== "spell") return 0;
      const name = String(it?.name ?? "");
      if (!/grêle\s*d['’]?épines|hail\s+of\s+thorns|flèche\s+éclair|lightning\s+arrow/i.test(name)) return 0;

      const existing =
        it?.getFlag?.(MODULE_ID, "onHitAoeBuff")
        ?? it?.getFlag?.("encounterplus-importer", "onHitAoeBuff")
        ?? it?.flags?.[MODULE_ID]?.onHitAoeBuff
        ?? it?.flags?.["encounterplus-importer"]?.onHitAoeBuff;

      const meta = existing?.radius ? existing : inferOnHitAoeBuffFromItem(it);
      if (!meta?.radius || !meta?.saveActivityId) return 0;

      const aId = String(meta.saveActivityId);
      const act = it?.system?.activities?.get?.(aId) ?? it?.system?.activities?.[aId] ?? null;
      const update = {};
      update[`flags.${MODULE_ID}.onHitAoeBuff`] = meta;

      if (act) {
        update[`system.activities.${aId}.target.affects.count`] = "99";
        update[`system.activities.${aId}.target.affects.type`] = String(act?.target?.affects?.type ?? "creature") || "creature";
        update[`system.activities.${aId}.target.prompt`] = false;
        update[`system.activities.${aId}.target.template.type`] = "";
        update[`system.activities.${aId}.target.template.size`] = "";
        update[`system.activities.${aId}.target.template.width`] = "";
        update[`system.activities.${aId}.target.template.height`] = "";
      }

      await it.update(update);
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchBuff(it);
    for (const a of (game.actors ?? [])) {
      for (const it of (a.items ?? [])) patched += await patchBuff(it);
    }

    await game.settings.set(MODULE_ID, "migrationHotfix270s", true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix270s migration patched`, patched, "buff spell(s) (onHitAoeBuff).");
  }
} catch (e) {
  console.warn(`[${MODULE_ID}] Hotfix270s migration failed`, e);
}

// Hotfix270t migration: reconfigure buff-on-next-ranged-hit spells to be true buffs.
// - Cast should NOT place a template, roll a save, or deal damage.
// - Cast should apply an Active Effect to the caster.
// - Explosion SAVE activity is marked automationOnly so it doesn't appear in the cast activity picker.
try {
  if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix270t")) {
    const isBuffName = (n) => /grêle\s*d['’]?épines|hail\s+of\s+thorns|flèche\s+éclair|lightning\s+arrow/i.test(String(n ?? ""));

    const desired = (it) => {
      const n = String(it?.name ?? "").toLowerCase();
      if (n.includes("grêle") || n.includes("épines") || n.includes("thorns")) return { key: "thorns", effectName: "Grêle d’épines (prêt)" };
      if (n.includes("flèche") || n.includes("éclair") || n.includes("lightning") || n.includes("arrow")) return { key: "arrow", effectName: "Flèche éclair (prêt)" };
      return { key: "buff", effectName: "Buff AoE (prêt)" };
    };

    const ensureMarkerEffect = async (it) => {
      const { effectName } = desired(it);
      const effects = Array.from(it?.effects ?? []);
      let ef = effects.find(e => e?.getFlag?.(MODULE_ID, "onHitAoeBuffMarker"))
        ?? effects.find(e => String(e?.name ?? "").toLowerCase() === effectName.toLowerCase());

      if (ef) return ef;

      const [created] = await it.createEmbeddedDocuments("ActiveEffect", [{
        name: effectName,
        img: it?.img ?? "icons/svg/aura.svg",
        disabled: false,
        transfer: false,
        duration: { seconds: 60, startTime: 0 },
        changes: [],
        flags: { [MODULE_ID]: { onHitAoeBuffMarker: true } }
      }]);
      return created ?? null;
    };

    const getActs = (it) => {
      const acts = it?.system?.activities;
      if (!acts) return [];
      try {
        if (typeof acts?.values === "function") return Array.from(acts.values());
        if (Array.isArray(acts?.contents)) return acts.contents;
        if (Array.isArray(acts)) return acts;
        return Object.values(acts);
      } catch (_e) { return []; }
    };

    const ensureUtilityActivity = async (it, effectId) => {
      const list = getActs(it);
      const hasEffect = (a) => Array.isArray(a?.effects) && a.effects.some(e => String(e?._id ?? "") === String(effectId));
      let util = list.find(a => a?.type === "utility" && hasEffect(a))
        ?? list.find(a => a?.type === "utility" && /grêle|épines|hail|thorns|flèche|éclair|lightning|arrow/i.test(String(a?.name ?? "")));

      // Create a new utility activity skeleton if needed
      if (!util) {
        const src = it.toObject();
        const before = new Set(Object.keys(src?.system?.activities ?? {}));
        // offset chosen to avoid colliding with dnd5eactivity0/1/2...
        CONFIG.DND5E.activityTypes.utility.documentClass.createInitialActivity(src, { offset: 9 });
        const after = Object.keys(src?.system?.activities ?? {});
        const newId = after.find(k => !before.has(k));
        if (!newId) return null;
        const u = src.system.activities[newId];

        // Configure as self-target buff application
        const { effectName } = desired(it);
        u.name = effectName;
        u.sort = Math.min(0, ...list.map(a => Number(a?.sort ?? 0))) - 10;
        u.activation = { type: "bonus", value: 1, condition: "" };
        u.target ??= {};
        u.target.prompt = false;
        u.target.affects = { count: "1", type: "self", choice: false, special: "" };
        u.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
        u.effects = [{ _id: String(effectId) }];
        u.midiProperties ??= {};
        u.midiProperties.automationOnly = false;
        // Let the cast consume a spell slot normally
        u.consumption ??= { spellSlot: true, targets: [], scaling: { allowed: true, max: "" } };
        u.consumption.spellSlot = true;

        await it.update({ [`system.activities.${newId}`]: u });
        // refetch
        util = it?.system?.activities?.get?.(newId) ?? null;
      } else {
        // Patch existing utility activity to be self-target, no template
        const uId = String(util?._id ?? util?.id ?? "");
        if (!uId) return util;
        const update = {};
        update[`system.activities.${uId}.target.prompt`] = false;
        update[`system.activities.${uId}.target.affects.count`] = "1";
        update[`system.activities.${uId}.target.affects.type`] = "self";
        update[`system.activities.${uId}.target.template.type`] = "";
        update[`system.activities.${uId}.target.template.size`] = "";
        update[`system.activities.${uId}.target.template.width`] = "";
        update[`system.activities.${uId}.target.template.height`] = "";
        update[`system.activities.${uId}.midiProperties.automationOnly`] = false;
        // ensure effect is applied by the activity
        if (!hasEffect(util)) update[`system.activities.${uId}.effects`] = [{ _id: String(effectId) }];
        await it.update(update);
      }

      return util;
    };

    const patchBuffSpell = async (it) => {
      if (!it || it.type !== "spell") return 0;
      if (!isBuffName(it.name)) return 0;

      let meta = it?.getFlag?.(MODULE_ID, "onHitAoeBuff")
        ?? it?.getFlag?.("encounterplus-importer", "onHitAoeBuff")
        ?? it?.flags?.[MODULE_ID]?.onHitAoeBuff
        ?? it?.flags?.["encounterplus-importer"]?.onHitAoeBuff;
      if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeBuffFromItem(it);
      if (!meta?.radius || !meta?.saveActivityId) return 0;

      const saveId = String(meta.saveActivityId);
      const saveAct = it?.system?.activities?.get?.(saveId) ?? it?.system?.activities?.[saveId] ?? null;
      if (!saveAct) return 0;

      const marker = await ensureMarkerEffect(it);
      if (!marker) return 0;

      await ensureUtilityActivity(it, marker.id ?? marker._id);

      // Patch the explosion SAVE activity: multi-target, no template, does not consume a slot, and hidden from chooser.
      const update = {};
      update[`flags.${MODULE_ID}.onHitAoeBuff`] = meta;
      update[`system.activities.${saveId}.target.affects.count`] = "99";
      update[`system.activities.${saveId}.target.affects.type`] = String(saveAct?.target?.affects?.type ?? "creature") || "creature";
      update[`system.activities.${saveId}.target.prompt`] = false;
      update[`system.activities.${saveId}.target.template.type`] = "";
      update[`system.activities.${saveId}.target.template.size`] = "";
      update[`system.activities.${saveId}.target.template.width`] = "";
      update[`system.activities.${saveId}.target.template.height`] = "";
      update[`system.activities.${saveId}.consumption.spellSlot`] = false;
      update[`system.activities.${saveId}.midiProperties.automationOnly`] = true;
      await it.update(update);

      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchBuffSpell(it);
    for (const a of (game.actors ?? [])) {
      for (const it of (a.items ?? [])) patched += await patchBuffSpell(it);
    }

    await game.settings.set(MODULE_ID, "migrationHotfix270t", true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix270t migration patched`, patched, "buff spell(s) (true buff cast + automationOnly explosion).");
  }
} catch (e) {
  console.warn(`[${MODULE_ID}] Hotfix270t migration failed`, e);
}


// Hotfix270u: patch buff-on-next-ranged-hit spells EVEN if they live in compendiums, and add a safety net that
// auto-fixes any newly imported copies on Actors/World items.
// This addresses cases where the spell only has a SAVE activity and no embedded effects/utility activity (as in your screenshots).
try {
  const isBuffName = (n) => /grêle\s*d['’]?épines|hail\s+of\s+thorns|flèche\s+éclair|lightning\s+arrow/i.test(String(n ?? ""));

  const patchOne = async (it) => {
    if (!it || it.type !== "spell") return 0;
    if (!isBuffName(it.name)) return 0;

    // If it's already configured as a true buff (marker effect exists + some utility activity exists), skip.
    try {
      const effects = Array.from(it?.effects ?? []);
      const hasMarker = effects.some(e => e?.getFlag?.(MODULE_ID, "onHitAoeBuffMarker"));
      const acts = it?.system?.activities;
      let list = [];
      if (acts) {
        try {
          if (typeof acts?.values === "function") list = Array.from(acts.values());
          else if (Array.isArray(acts?.contents)) list = acts.contents;
          else if (Array.isArray(acts)) list = acts;
          else if (acts && typeof acts === "object") list = Object.values(acts);
        } catch (_e) { list = []; }
      }
      const hasUtility = list.some(a => String(a?.type ?? "").toLowerCase() === "utility");
      const anySaveHidden = list.some(a => (String(a?.type ?? "").toLowerCase() === "save") && (a?.midiProperties?.automationOnly === true || a?.system?.midiProperties?.automationOnly === true));
      if (hasMarker && hasUtility && anySaveHidden) return 0;
    } catch (_e) {}

    // Reuse the hotfix270t logic by invoking the same inference + patch approach inline.
    let meta = it?.getFlag?.(MODULE_ID, "onHitAoeBuff")
      ?? it?.getFlag?.("encounterplus-importer", "onHitAoeBuff")
      ?? it?.flags?.[MODULE_ID]?.onHitAoeBuff
      ?? it?.flags?.["encounterplus-importer"]?.onHitAoeBuff;
    if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeBuffFromItem(it);
    if (!meta?.radius || !meta?.saveActivityId) return 0;

    const saveId = String(meta.saveActivityId);
    const saveAct = it?.system?.activities?.get?.(saveId) ?? it?.system?.activities?.[saveId] ?? null;
    if (!saveAct) return 0;

    // Ensure marker effect on the spell item
    const effectName = /flèche\s+éclair|lightning\s+arrow/i.test(String(it.name ?? "")) ? "Flèche éclair (prêt)" : "Grêle d’épines (prêt)";
    const effects = Array.from(it?.effects ?? []);
    let marker = effects.find(e => e?.getFlag?.(MODULE_ID, "onHitAoeBuffMarker")) ?? effects.find(e => String(e?.name ?? "").toLowerCase() === effectName.toLowerCase());
    if (!marker) {
      const created = await it.createEmbeddedDocuments("ActiveEffect", [{
        name: effectName,
        img: it?.img ?? "icons/svg/aura.svg",
        disabled: false,
        transfer: false,
        duration: { seconds: 60, startTime: 0 },
        changes: [],
        flags: { [MODULE_ID]: { onHitAoeBuffMarker: true } }
      }]);
      marker = created?.[0] ?? null;
    }
    const markerId = String(marker?.id ?? marker?._id ?? "");
    if (!markerId) return 0;

    // Ensure a UTILITY activity exists that applies the marker effect (buff cast).
    // If no utility activity exists, create one by cloning an initial activity and writing back the full activities object.
    const acts = it?.system?.activities;
    let list = [];
    try {
      if (typeof acts?.values === "function") list = Array.from(acts.values());
      else if (Array.isArray(acts?.contents)) list = acts.contents;
      else if (Array.isArray(acts)) list = acts;
      else if (acts && typeof acts === "object") list = Object.values(acts);
    } catch (_e) { list = []; }
    list = (Array.isArray(list) ? list : []).filter(a => a && (a?._id || a?.id));

    const hasEffect = (a) => Array.isArray(a?.effects) && a.effects.some(e => String(e?._id ?? "") === markerId);
    let util = list.find(a => String(a?.type ?? "").toLowerCase() === "utility" && hasEffect(a))
      ?? list.find(a => String(a?.type ?? "").toLowerCase() === "utility" && /grêle|épines|hail|thorns|flèche|éclair|lightning|arrow/i.test(String(a?.name ?? "")));

    if (!util) {
      const src = it.toObject();
      const before = new Set(Object.keys(src?.system?.activities ?? {}));
      CONFIG.DND5E.activityTypes.utility.documentClass.createInitialActivity(src, { offset: 9 });
      const after = Object.keys(src?.system?.activities ?? {});
      const newId = after.find(k => !before.has(k));
      if (newId) {
        const u = src.system.activities[newId];
        u.name = /flèche\s+éclair|lightning\s+arrow/i.test(String(it.name ?? "")) ? "Flèche éclair" : "Grêle d’épines";
        u.sort = Math.min(0, ...list.map(a => Number(a?.sort ?? 0))) - 10;
        u.activation = { type: "bonus", value: 1, condition: "" };
        u.target ??= {};
        u.target.prompt = false;
        u.target.affects = { count: "1", type: "self", choice: false, special: "" };
        u.target.template = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
        u.effects = [{ _id: markerId }];
        u.midiProperties ??= {};
        u.midiProperties.automationOnly = false;
        u.consumption ??= { spellSlot: true, targets: [], scaling: { allowed: true, max: "" } };
        u.consumption.spellSlot = true;
        // Write back entire activities object to ensure the new key is created.
        await it.update({ "system.activities": src.system.activities });
      }
    } else {
      const uId = String(util?._id ?? util?.id ?? "");
      if (uId) {
        const update = {};
        update[`system.activities.${uId}.target.prompt`] = false;
        update[`system.activities.${uId}.target.affects.count`] = "1";
        update[`system.activities.${uId}.target.affects.type`] = "self";
        update[`system.activities.${uId}.target.template.type`] = "";
        update[`system.activities.${uId}.target.template.size`] = "";
        update[`system.activities.${uId}.target.template.width`] = "";
        update[`system.activities.${uId}.target.template.height`] = "";
        update[`system.activities.${uId}.midiProperties.automationOnly`] = false;
        if (!hasEffect(util)) update[`system.activities.${uId}.effects`] = [{ _id: markerId }];
        await it.update(update);
      }
    }

    // Patch the explosion SAVE activity: multi-target, no template, no slot consumption, hidden from chooser.
    const update = {};
    update[`flags.${MODULE_ID}.onHitAoeBuff`] = meta;
    update[`system.activities.${saveId}.target.affects.count`] = "99";
    update[`system.activities.${saveId}.target.affects.type`] = String(saveAct?.target?.affects?.type ?? "creature") || "creature";
    update[`system.activities.${saveId}.target.prompt`] = false;
    update[`system.activities.${saveId}.target.template.type`] = "";
    update[`system.activities.${saveId}.target.template.size`] = "";
    update[`system.activities.${saveId}.target.template.width`] = "";
    update[`system.activities.${saveId}.target.template.height`] = "";
    update[`system.activities.${saveId}.consumption.spellSlot`] = false;
    update[`system.activities.${saveId}.midiProperties.automationOnly`] = true;
    await it.update(update);

    return 1;
  };

  // 1) Always patch World items + Actor embedded spells (safety net)
  if (game.user?.isGM) {
    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const a of (game.actors ?? [])) for (const it of (a.items ?? [])) patched += await patchOne(it);
    if (patched) console.log(`[${MODULE_ID}] Hotfix270u safety net patched`, patched, "buff spell(s) on world/actors.");
  }

  // 2) One-time compendium pass (only for packs that are not locked)
  if (game.user?.isGM && !game.settings.get(MODULE_ID, "migrationHotfix270u")) {
    let patched = 0;
    for (const pack of Array.from(game.packs ?? [])) {
      try {
        if (pack?.documentName !== "Item") continue;
        if (pack?.locked) continue;
        const idx = pack?.index?.contents ?? Array.from(pack?.index ?? []);
        for (const e of idx) {
          if (String(e?.type ?? "") !== "spell") continue;
          if (!isBuffName(e?.name)) continue;
          const doc = await pack.getDocument(e._id);
          patched += await patchOne(doc);
        }
      } catch (_e) { /* ignore pack */ }
    }
    await game.settings.set(MODULE_ID, "migrationHotfix270u", true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix270u compendium pass patched`, patched, "buff spell(s) in compendiums.");
  }
} catch (e) {
  console.warn(`[${MODULE_ID}] Hotfix270u failed`, e);
}

// Hotfix271p: Wall of Fire gets two visible cast activities (line / circle) instead of a single ambiguous save activity.
// Hotfix271s: collapse Wall of Fire to a single save activity.
// dnd5e tends to render/roll every visible SAVE activity on the same item card,
// so keeping both line/circle activities causes duplicate damage workflows.
try {
  const isWallOfFireItem = (it) => {
    const slug = String(it?.getFlag?.("encounterplus-importer", "slug") ?? it?.flags?.["encounterplus-importer"]?.slug ?? "").toLowerCase();
    const name = String(it?.name ?? "").toLowerCase();
    return slug === "mur-de-feu" || slug === "wall-of-fire" || /mur\s+de\s+feu|wall\s+of\s+fire/i.test(name);
  };

  const setTemplate = (act, { type = "", size = "", width = "", height = "", units = "ft" } = {}) => {
    act.target ??= { template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" }, affects: { count: "", type: "", choice: false, special: "" }, prompt: true, override: false };
    act.target.template ??= { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" };
    act.target.affects = { count: "", type: "", choice: false, special: "" };
    act.target.template.type = String(type ?? "");
    act.target.template.size = (size == null ? "" : String(size));
    act.target.template.width = (width == null ? "" : String(width));
    act.target.template.height = (height == null ? "" : String(height));
    act.target.template.units = String(units ?? "ft") || "ft";
    act.target.prompt = true;
    act.target.override = true;
  };

  const configureWallActivity = (act, variant = "line-right") => {
    const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
    const isMetric = units === "m";
    const lineLength = isMetric ? 18 : 60;
    const lineWidth = isMetric ? 1.5 : 5;
    const circleRadius = isMetric ? 3 : 10;
    const isCircle = String(variant).startsWith("ring-");
    const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
    const names = fr ? {
      "line-left": "Lancer (ligne gauche)",
      "line-right": "Lancer (ligne droite)",
      "ring-inner": "Lancer (anneau interne)",
      "ring-outer": "Lancer (anneau externe)"
    } : {
      "line-left": "Cast (line left)",
      "line-right": "Cast (line right)",
      "ring-inner": "Cast (ring inner)",
      "ring-outer": "Cast (ring outer)"
    };

    act.type = "save";
    act.name = names[String(variant)] ?? names["line-right"];
    act.flags ??= {};
    act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), generated: true, kind: isCircle ? "wall-of-fire-circle" : "wall-of-fire-line", wallOfFireVariant: String(variant) };
    act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), generated: true, kind: isCircle ? "wall-of-fire-circle" : "wall-of-fire-line", wallOfFireVariant: String(variant) };
    act.midiProperties ??= {};
    act.midiProperties.automationOnly = false;
    act.midiProperties.displayActivityName = true;

    if (isCircle) setTemplate(act, { type: "sphere", size: circleRadius, width: "", height: "", units });
    else setTemplate(act, { type: "line", size: lineLength, width: lineWidth, height: "", units });
  };

  const patchOne = async (it) => {
    if (!it || it.type !== "spell" || !isWallOfFireItem(it)) return 0;
    const src = it.toObject();
    src.flags ??= {};
    src.flags["encounterplus-importer"] ??= {};
    src.flags[MODULE_ID] ??= {};
    src.flags["encounterplus-importer"].regionRule = "wall-of-fire";
    src.flags[MODULE_ID].regionRule = "wall-of-fire";
    src.flags["encounterplus-importer"].wallOfFireVariant = src.flags["encounterplus-importer"].wallOfFireVariant ?? "line-right";
    src.flags[MODULE_ID].wallOfFireVariant = src.flags[MODULE_ID].wallOfFireVariant ?? src.flags["encounterplus-importer"].wallOfFireVariant;

    const actsObj = src.system?.activities ?? {};
    const activities = Object.values(actsObj ?? {}).filter(a => a && (a._id || a.id));
    if (!activities.length) return 0;
    let base = activities.find(a => String(a?.type ?? "").toLowerCase() === "save") ?? activities[0];
    const baseId = String(base?._id ?? base?.id ?? Object.keys(actsObj)[0] ?? "");
    if (!baseId || !actsObj[baseId]) return 0;

    const newActs = {};
    newActs[baseId] = foundry?.utils?.deepClone ? foundry.utils.deepClone(actsObj[baseId]) : JSON.parse(JSON.stringify(actsObj[baseId] ?? {}));
    newActs[baseId]._id = baseId;
    newActs[baseId].sort = 0;
    configureWallActivity(newActs[baseId], String(src.flags["encounterplus-importer"].wallOfFireVariant ?? "line-right"));

    await it.update({
      "system.activities": newActs,
      [`flags.${MODULE_ID}.forceActivityChooser`]: false,
      [`flags.${MODULE_ID}.wallOfFireVariant`]: src.flags[MODULE_ID].wallOfFireVariant,
      "flags.encounterplus-importer.forceActivityChooser": false,
      "flags.encounterplus-importer.wallOfFireVariant": src.flags["encounterplus-importer"].wallOfFireVariant
    });
    return 1;
  };

  if (game.user?.isGM) {
    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    if (!game.settings.get(MODULE_ID, "migrationHotfix271s")) await game.settings.set(MODULE_ID, "migrationHotfix271s", true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix271s collapsed`, patched, "Wall of Fire spell(s) to one activity.");
  }
} catch (e) {
  console.warn(`[${MODULE_ID}] Hotfix271s failed`, e);
}


// Hotfix271q: ensure existing Wall of Fire items are flagged for Regions automation.
Hooks.once("ready", async () => {
  try {
    const isWallOfFireItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      return slug === "mur-de-feu" || slug === "wall-of-fire" || /mur\s+de\s+feu|wall\s+of\s+fire/i.test(name);
    };

    const patchOne = async (it) => {
      if (!it || it.type !== "spell" || !isWallOfFireItem(it)) return 0;
      const src = it.toObject();
      src.flags ??= {};
      src.flags[MODULE_ID] ??= {};
      src.flags["encounterplus-importer"] ??= {};
      const before = `${src.flags[MODULE_ID].regionRule ?? ""}|${src.flags["encounterplus-importer"].regionRule ?? ""}`;
      src.flags[MODULE_ID].regionRule = "wall-of-fire";
      src.flags["encounterplus-importer"].regionRule = "wall-of-fire";
      const after = `${src.flags[MODULE_ID].regionRule}|${src.flags["encounterplus-importer"].regionRule}`;
      if (before === after) return 0;
      await it.update({ flags: src.flags }, { diff: false, recursive: false, noHook: false });
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    if (!game.settings.get(MODULE_ID, "migrationHotfix271q")) {
      await game.settings.set(MODULE_ID, "migrationHotfix271q", true);
    }
    if (patched) console.log(`[${MODULE_ID}] Hotfix271q patched`, patched, "Wall of Fire spell(s) with Region flags.");
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix271q failed`, e);
  }
});


// Hotfix271ap: restore Wall of Light to a single stable save-based cast activity with template/concentration.
Hooks.once("ready", async () => {
  try {
    if (!game.user?.isGM || game.settings.get(MODULE_ID, "migrationHotfix271ap")) return;

    const isWallOfLightItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
      return slug === "mur-de-lumiere" || slug === "wall-of-light" || rr === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
    };
    const clone = (obj) => foundry?.utils?.deepClone ? foundry.utils.deepClone(obj) : JSON.parse(JSON.stringify(obj ?? {}));
    const pickUnits = (src) => {
      const vals = [
        src?.system?.target?.units,
        ...Object.values(src?.system?.activities ?? {}).flatMap(a => [a?.target?.template?.units, a?.range?.units])
      ].map(v => String(v ?? '').toLowerCase()).filter(Boolean);
      return vals.some(v => v === 'm') ? 'm' : 'ft';
    };
    const normalizePart = (p = null) => ({
      number: Number(p?.number ?? 4) || 4,
      denomination: Number(p?.denomination ?? p?.denom ?? 8) || 8,
      bonus: String(p?.bonus ?? ""),
      types: Array.isArray(p?.types) && p.types.length ? [String(p.types[0] ?? 'radiant') || 'radiant'] : ['radiant'],
      custom: { enabled: false, formula: "" },
      scaling: {
        mode: String(p?.scaling?.mode ?? 'whole') || 'whole',
        number: Number(p?.scaling?.number ?? 1) || 1,
        formula: String(p?.scaling?.formula ?? "")
      }
    });
    const findBestDamagePart = (src) => {
      const acts = Object.values(src?.system?.activities ?? {}).filter(Boolean);
      for (const a of acts) {
        const part = a?.damage?.parts?.[0] ?? null;
        if (part) return normalizePart(part);
      }
      return normalizePart(null);
    };
    const pickBestTemplate = (src, units) => {
      const fallback = { type: 'line', size: (units === 'm' ? 18 : 60), width: (units === 'm' ? 1.5 : 5), units };
      try {
        const candidates = [
          src?.system?.target,
          ...Object.values(src?.system?.activities ?? {}).map(a => a?.target?.template).filter(Boolean)
        ].filter(Boolean);
        for (const t of candidates) {
          const type = String(t?.type ?? '').toLowerCase();
          const size = Number(t?.size ?? t?.value ?? 0) || 0;
          const width = Number(t?.width ?? 0) || 0;
          const tu = String(t?.units ?? units ?? 'ft').toLowerCase();
          if (type === 'line' && size > 0) return { type: 'line', size, width: width || (tu === 'm' ? 1.5 : 5), units: tu === 'm' ? 'm' : 'ft' };
        }
      } catch (_e) {}
      return fallback;
    };
    const setTemplate = (act, { type, size, width, units }) => {
      act.target ??= { template: { count:'', contiguous:false, type:'', size:'', width:'', height:'', units }, affects: { count:'', type:'', choice:false, special:'' }, prompt:true, override:true };
      act.target.template ??= { count:'', contiguous:false, type:'', size:'', width:'', height:'', units };
      act.target.template.type = String(type ?? 'line');
      act.target.template.size = String(size ?? '');
      act.target.template.width = String(width ?? '');
      act.target.template.height = '';
      act.target.template.units = String(units ?? 'ft');
      act.target.affects = { count:'', type:'creature', choice:false, special:'' };
      act.target.prompt = true;
      act.target.override = true;
    };
    const configureCast = (act, damagePart, units, templateData) => {
      act.type = 'save';
      act.name = 'Lancer';
      act.img = 'systems/dnd5e/icons/svg/activity/save.svg';
      act.midiProperties ??= {};
      act.midiProperties.displayActivityName = true;
      act.midiProperties.automationOnly = false;
      act.activation ??= { type: 'action', value: 1, condition: '', override: true };
      act.activation.type = 'action';
      act.activation.value = 1;
      act.activation.override = true;
      act.consumption ??= { targets: [], scaling: { allowed: true, max: '' }, spellSlot: true, override: true };
      act.consumption.spellSlot = true;
      act.consumption.override = true;
      act.consumption.scaling ??= { allowed: true, max: '' };
      act.consumption.scaling.allowed = true;
      act.duration ??= { concentration: true, value: '10', units: 'minute', special: '', override: true };
      act.duration.concentration = true;
      act.duration.value = '10';
      act.duration.units = 'minute';
      act.duration.override = true;
      act.range ??= { value: '36', units, special: '', override: true };
      act.range.value = String(units === 'm' ? 36 : 120);
      act.range.units = units;
      act.range.override = true;
      act.save = { ability: ['con'], dc: { calculation: '', formula: '@attributes.spell.dc' } };
      act.damage = { onSave: 'half', critical: { bonus: '' }, includeBase: true, parts: [normalizePart(damagePart)] };
      delete act.attack;
      delete act.healing;
      act.description ??= {};
      act.description.chatFlavor = `JS CON · ${act.damage.parts[0].number}d${act.damage.parts[0].denomination} ${act.damage.parts[0].types?.[0] ?? 'radiant'} (moitié si réussite)`;
      act.flags ??= {};
      act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), generated: true, kind: 'wall-of-light-line' };
      act.flags['encounterplus-importer'] = { ...(act.flags?.['encounterplus-importer'] ?? {}), generated: true, kind: 'wall-of-light-line' };
      setTemplate(act, templateData ?? { type: 'line', size: (units === 'm' ? 18 : 60), width: (units === 'm' ? 1.5 : 5), units });
    };

    const patchOne = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      src.flags ??= {};
      src.flags[MODULE_ID] ??= {};
      src.flags['encounterplus-importer'] ??= {};
      src.flags[MODULE_ID].regionRule = 'wall-of-light';
      src.flags['encounterplus-importer'].regionRule = 'wall-of-light';
      const actsObj = src.system?.activities ?? {};
      const actIds = Object.keys(actsObj ?? {});
      if (!actIds.length) return 0;
      const baseId = String(actIds[0] ?? '');
      const units = pickUnits(src);
      const templateData = pickBestTemplate(src, units);
      const damagePart = findBestDamagePart(src);
      const base = clone(actsObj[baseId] ?? { _id: baseId });
      base._id = baseId;
      base.sort = 0;
      configureCast(base, damagePart, units, templateData);
      const newActs = { [baseId]: base };
      await it.update({
        'system.activities': newActs,
        'system.actionType': '',
        'system.target': {
          value: '',
          units: templateData.units,
          type: 'line',
          width: templateData.width,
          prompt: true,
          template: { type: 'line', size: templateData.size, width: templateData.width, height: '', units: templateData.units }
        },
        'system.damage': { parts: [], versatile: '', value: '' },
        'system.formula': '',
        'system.save': null,
        'system.duration': { value: '10', units: 'minute', concentration: true },
        [`flags.${MODULE_ID}.regionRule`]: 'wall-of-light',
        'flags.encounterplus-importer.regionRule': 'wall-of-light',
        [`flags.${MODULE_ID}.forceActivityChooser`]: false,
        'flags.encounterplus-importer.forceActivityChooser': false,
        [`flags.${MODULE_ID}.wallOfLightActivityIds`]: null,
        'flags.encounterplus-importer.wallOfLightActivityIds': null,
        [`flags.${MODULE_ID}.repeatActivityIds`]: null,
        'flags.encounterplus-importer.repeatActivityIds': null,
        [`flags.${MODULE_ID}.repeatActivityMeta`]: null,
        'flags.encounterplus-importer.repeatActivityMeta': null
      });
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    await game.settings.set(MODULE_ID, "migrationHotfix271ap", true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix271ap normalized`, patched, 'Wall of Light spell(s).');
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix271ap failed`, e);
  }
});

// Hotfix271aq: Wall of Light should cast as a pure CON save (no attack on the main card)
// and apply the Blinded effect on failed saves, with an end-of-turn CON save to remove it.
Hooks.once("ready", async () => {
  try {
    if (!game.user?.isGM || game.settings.get(MODULE_ID, "migrationHotfix271aq")) return;

    const isWallOfLightItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
      return slug === "mur-de-lumiere" || slug === "wall-of-light" || rr === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
    };
    const clone = (obj) => foundry?.utils?.deepClone ? foundry.utils.deepClone(obj) : JSON.parse(JSON.stringify(obj ?? {}));
    const randomId = () => {
      try { if (foundry?.utils?.randomID) return foundry.utils.randomID(16); } catch (_e) {}
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let s = "";
      for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    };
    const safeLabel = (s) => String(s ?? "").replace(/,/g, " ").trim();
    const pickUnits = (src) => {
      const vals = [
        src?.system?.target?.units,
        ...Object.values(src?.system?.activities ?? {}).flatMap(a => [a?.target?.template?.units, a?.range?.units])
      ].map(v => String(v ?? '').toLowerCase()).filter(Boolean);
      return vals.some(v => v === 'm') ? 'm' : 'ft';
    };
    const normalizePart = (p = null) => ({
      number: Number(p?.number ?? 4) || 4,
      denomination: Number(p?.denomination ?? p?.denom ?? 8) || 8,
      bonus: String(p?.bonus ?? ""),
      types: Array.isArray(p?.types) && p.types.length ? [String(p.types[0] ?? 'radiant') || 'radiant'] : ['radiant'],
      custom: { enabled: false, formula: "" },
      scaling: {
        mode: String(p?.scaling?.mode ?? 'whole') || 'whole',
        number: Number(p?.scaling?.number ?? 1) || 1,
        formula: String(p?.scaling?.formula ?? "")
      }
    });
    const findBestDamagePart = (src) => {
      const acts = Object.values(src?.system?.activities ?? {}).filter(Boolean);
      for (const a of acts) {
        const part = a?.damage?.parts?.[0] ?? null;
        if (part) return normalizePart(part);
      }
      return normalizePart(null);
    };
    const pickBestTemplate = (src, units) => {
      const fallback = { type: 'line', size: (units === 'm' ? 18 : 60), width: (units === 'm' ? 1.5 : 5), units };
      try {
        const candidates = [src?.system?.target, ...Object.values(src?.system?.activities ?? {}).map(a => a?.target?.template).filter(Boolean)].filter(Boolean);
        for (const t of candidates) {
          const type = String(t?.type ?? '').toLowerCase();
          const size = Number(t?.size ?? t?.value ?? 0) || 0;
          const width = Number(t?.width ?? 0) || 0;
          const tu = String(t?.units ?? units ?? 'ft').toLowerCase();
          if (type === 'line' && size > 0) return { type: 'line', size, width: width || (tu === 'm' ? 1.5 : 5), units: tu === 'm' ? 'm' : 'ft' };
        }
      } catch (_e) {}
      return fallback;
    };
    const setTemplate = (act, { type, size, width, units }) => {
      act.target ??= { template: { count:'', contiguous:false, type:'', size:'', width:'', height:'', units }, affects: { count:'', type:'', choice:false, special:'' }, prompt:true, override:true };
      act.target.template ??= { count:'', contiguous:false, type:'', size:'', width:'', height:'', units };
      act.target.template.type = String(type ?? 'line');
      act.target.template.size = String(size ?? '');
      act.target.template.width = String(width ?? '');
      act.target.template.height = '';
      act.target.template.units = String(units ?? 'ft');
      act.target.affects = { count:'', type:'creature', choice:false, special:'' };
      act.target.prompt = true;
      act.target.override = true;
    };
    const ensureBlindEffect = (src, baseId) => {
      src.effects = Array.isArray(src.effects) ? src.effects : [];
      let effect = src.effects.find(e => e?.flags?.[MODULE_ID]?.wallOfLightBlind || e?.flags?.["encounterplus-importer"]?.wallOfLightBlind);
      if (!effect) {
        effect = src.effects.find(e => {
          const statuses = Array.isArray(e?.statuses) ? e.statuses.map(String) : [];
          const changes = Array.isArray(e?.changes) ? e.changes : [];
          return statuses.includes('blinded') && changes.some(c => String(c?.key ?? '') === 'flags.midi-qol.OverTime' && /saveAbility=con/i.test(String(c?.value ?? '')));
        });
      }
      if (!effect) {
        effect = {
          _id: randomId(),
          name: `${src.name} — Aveuglé (JS CON fin de tour)`,
          icon: 'systems/dnd5e/icons/svg/statuses/blinded.svg',
          origin: null,
          disabled: false,
          transfer: false,
          duration: { rounds: 10 },
          flags: {
            core: { statusId: 'blinded' },
            [MODULE_ID]: { wallOfLightBlind: true },
            'encounterplus-importer': {
              wallOfLightBlind: true,
              overtime: { kind: 'wallOfLightBlind', when: 'end', ab: 'con', statusIds: ['blinded'] }
            }
          },
          statuses: ['blinded'],
          changes: []
        };
        src.effects.push(effect);
      } else {
        effect.flags ??= {};
        effect.flags[MODULE_ID] = { ...(effect.flags?.[MODULE_ID] ?? {}), wallOfLightBlind: true };
        effect.flags['encounterplus-importer'] = { ...(effect.flags?.['encounterplus-importer'] ?? {}), wallOfLightBlind: true, overtime: { kind: 'wallOfLightBlind', when: 'end', ab: 'con', statusIds: ['blinded'] } };
        effect.statuses = Array.isArray(effect.statuses) ? Array.from(new Set([...effect.statuses.map(String), 'blinded'])) : ['blinded'];
        effect.icon = effect.icon || 'systems/dnd5e/icons/svg/statuses/blinded.svg';
        effect.transfer = false;
        effect.disabled = false;
        effect.duration = effect.duration ?? { rounds: 10 };
        effect.changes = Array.isArray(effect.changes) ? effect.changes.filter(c => String(c?.key ?? '') !== 'flags.midi-qol.OverTime') : [];
      }
      const act = src.system?.activities?.[baseId];
      if (act) {
        act.effects = Array.isArray(act.effects) ? act.effects : [];
        if (!act.effects.some(e => e?._id === effect._id)) act.effects.push({ _id: effect._id });
      }
    };
    const configureCast = (act, damagePart, units, templateData) => {
      act.type = 'save';
      act.name = 'Lancer';
      act.img = 'systems/dnd5e/icons/svg/activity/save.svg';
      act.midiProperties ??= {};
      act.midiProperties.displayActivityName = true;
      act.midiProperties.automationOnly = false;
      act.activation ??= { type: 'action', value: 1, condition: '', override: true };
      act.activation.type = 'action';
      act.activation.value = 1;
      act.activation.override = true;
      act.consumption ??= { targets: [], scaling: { allowed: true, max: '' }, spellSlot: true, override: true };
      act.consumption.spellSlot = true;
      act.consumption.override = true;
      act.consumption.scaling ??= { allowed: true, max: '' };
      act.consumption.scaling.allowed = true;
      if (act.consumption.scaling.max == null) act.consumption.scaling.max = '';
      act.duration ??= { concentration: true, value: '10', units: 'minute', special: '', override: true };
      act.duration.concentration = true;
      act.duration.value = '10';
      act.duration.units = 'minute';
      act.duration.override = true;
      act.range ??= { value: '36', units, special: '', override: true };
      act.range.value = String(units === 'm' ? 36 : 120);
      act.range.units = units;
      act.range.override = true;
      act.save = { ability: ['con'], dc: { calculation: '', formula: '@attributes.spell.dc' } };
      act.damage = { onSave: 'half', critical: { bonus: '' }, includeBase: true, parts: [normalizePart(damagePart)] };
      delete act.attack;
      delete act.healing;
      act.description ??= {};
      act.description.chatFlavor = `JS CON · ${act.damage.parts[0].number}d${act.damage.parts[0].denomination} ${act.damage.parts[0].types?.[0] ?? 'radiant'} (moitié si réussite) · Aveuglé en cas d'échec`;
      act.flags ??= {};
      act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), generated: true, kind: 'wall-of-light-line' };
      act.flags['encounterplus-importer'] = { ...(act.flags?.['encounterplus-importer'] ?? {}), generated: true, kind: 'wall-of-light-line' };
      setTemplate(act, templateData ?? { type: 'line', size: (units === 'm' ? 18 : 60), width: (units === 'm' ? 1.5 : 5), units });
    };

    const patchOne = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      src.flags ??= {};
      src.flags[MODULE_ID] ??= {};
      src.flags['encounterplus-importer'] ??= {};
      src.flags[MODULE_ID].regionRule = 'wall-of-light';
      src.flags['encounterplus-importer'].regionRule = 'wall-of-light';
      const actsObj = src.system?.activities ?? {};
      const actIds = Object.keys(actsObj ?? {});
      if (!actIds.length) return 0;
      const baseId = String(actIds[0] ?? '');
      const units = pickUnits(src);
      const templateData = pickBestTemplate(src, units);
      const damagePart = findBestDamagePart(src);
      const base = clone(actsObj[baseId] ?? { _id: baseId });
      base._id = baseId;
      base.sort = 0;
      configureCast(base, damagePart, units, templateData);
      const newActs = { [baseId]: base };
      src.system ??= {};
      src.system.activities = newActs;
      ensureBlindEffect(src, baseId);
      await it.update({
        'system.activities': src.system.activities,
        'effects': src.effects,
        'system.actionType': '',
        'system.target': {
          value: '',
          units: templateData.units,
          type: 'line',
          width: templateData.width,
          prompt: true,
          template: { type: 'line', size: templateData.size, width: templateData.width, height: '', units: templateData.units }
        },
        'system.damage': { parts: [], versatile: '', value: '' },
        'system.formula': '',
        'system.save': null,
        'system.duration': { value: '10', units: 'minute', concentration: true },
        [`flags.${MODULE_ID}.regionRule`]: 'wall-of-light',
        'flags.encounterplus-importer.regionRule': 'wall-of-light',
        [`flags.${MODULE_ID}.forceActivityChooser`]: false,
        'flags.encounterplus-importer.forceActivityChooser': false,
        [`flags.${MODULE_ID}.wallOfLightActivityIds`]: null,
        'flags.encounterplus-importer.wallOfLightActivityIds': null,
        [`flags.${MODULE_ID}.repeatActivityIds`]: null,
        'flags.encounterplus-importer.repeatActivityIds': null,
        [`flags.${MODULE_ID}.repeatActivityMeta`]: null,
        'flags.encounterplus-importer.repeatActivityMeta': null
      });
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    await game.settings.set(MODULE_ID, 'migrationHotfix271aq', true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix271aq normalized`, patched, 'Wall of Light spell(s).');
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix271aq failed`, e);
  }
});



// Hotfix271ar: Wall of Light should not keep importer-generated recurring damage/save effects on the item.
// Persistent end-of-turn damage belongs to the Region only. Keep only the initial blinded-on-failed-save effect.
Hooks.once("ready", async () => {
  try {
    if (!game.user?.isGM || game.settings.get(MODULE_ID, "migrationHotfix271ar")) return;

    const isWallOfLightItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
      return slug === "mur-de-lumiere" || slug === "wall-of-light" || rr === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
    };

    const patchOne = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      src.flags ??= {};
      src.flags[MODULE_ID] ??= {};
      src.flags['encounterplus-importer'] ??= {};
      src.flags[MODULE_ID].regionRule = 'wall-of-light';
      src.flags['encounterplus-importer'].regionRule = 'wall-of-light';

      const epiFlag = src.flags[MODULE_ID] ??= {};
      const legacyFlag = src.flags['encounterplus-importer'] ??= {};
      if (Array.isArray(epiFlag.overtimeTemplates)) {
        epiFlag.overtimeTemplates = epiFlag.overtimeTemplates.filter(t => {
          const k = String(t?.kind ?? '').toLowerCase();
          return !(['damage-each-turn','delayed-damage-next-turn'].includes(k));
        });
        if (!epiFlag.overtimeTemplates.length) delete epiFlag.overtimeTemplates;
      }
      if (Array.isArray(legacyFlag.overtimeTemplates)) {
        legacyFlag.overtimeTemplates = legacyFlag.overtimeTemplates.filter(t => {
          const k = String(t?.kind ?? '').toLowerCase();
          return !(['damage-each-turn','delayed-damage-next-turn'].includes(k));
        });
        if (!legacyFlag.overtimeTemplates.length) delete legacyFlag.overtimeTemplates;
      }

      const removedIds = [];
      src.effects = Array.isArray(src.effects) ? src.effects.filter(e => {
        const flags = e?.flags?.['encounterplus-importer']?.overtime ?? e?.flags?.[MODULE_ID]?.overtime ?? null;
        const kind = String(flags?.kind ?? '').toLowerCase();
        const keep = kind !== 'saveeachturn' && kind !== 'damage-each-turn' && kind !== 'delayed-damage-next-turn';
        if (!keep && e?._id) removedIds.push(String(e._id));
        return keep;
      }) : [];

      const acts = src.system?.activities ?? {};
      for (const act of Object.values(acts)) {
        if (!act) continue;
        act.effects = Array.isArray(act.effects) ? act.effects.filter(ref => !removedIds.includes(String(ref?._id ?? ''))) : [];
      }

      await it.update({
        'system.activities': acts,
        'effects': src.effects,
        [`flags.${MODULE_ID}.regionRule`]: 'wall-of-light',
        'flags.encounterplus-importer.regionRule': 'wall-of-light',
        [`flags.${MODULE_ID}.overtimeTemplates`]: epiFlag.overtimeTemplates ?? null,
        'flags.encounterplus-importer.overtimeTemplates': legacyFlag.overtimeTemplates ?? null
      });
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    await game.settings.set(MODULE_ID, 'migrationHotfix271ar', true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix271ar cleaned`, patched, 'Wall of Light spell(s).');
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix271ar failed`, e);
  }
});



// Hotfix271as: Wall of Light imported after ready still carried generic importer overtime/save-each-turn automation,
// which duplicated the Region end-of-turn damage and produced an extra CON-save effect.
// Keep only the custom blinded-on-failed-save effect; all recurring end-turn damage belongs to the Region.
Hooks.once("ready", async () => {
  try {
    if (!game.user?.isGM || game.settings.get(MODULE_ID, "migrationHotfix271as")) return;

    const isWallOfLightItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
      return slug === "mur-de-lumiere" || slug === "wall-of-light" || rr === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
    };

    const patchOne = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      src.flags ??= {};
      src.flags[MODULE_ID] ??= {};
      src.flags['encounterplus-importer'] ??= {};
      src.flags[MODULE_ID].regionRule = 'wall-of-light';
      src.flags['encounterplus-importer'].regionRule = 'wall-of-light';

      // Remove any lingering importer overtime templates (generic delayed/recurring damage).
      for (const scope of [MODULE_ID, 'encounterplus-importer']) {
        const f = src.flags[scope] ??= {};
        if (Array.isArray(f.overtimeTemplates)) {
          f.overtimeTemplates = f.overtimeTemplates.filter(t => {
            const kind = String(t?.kind ?? '').toLowerCase();
            return !['damage-each-turn', 'delayed-damage-next-turn'].includes(kind);
          });
          if (!f.overtimeTemplates.length) delete f.overtimeTemplates;
        }
      }

      // Remove generic saveEachTurn / damage-each-turn importer effects while preserving the dedicated blind effect.
      const removedIds = [];
      src.effects = Array.isArray(src.effects) ? src.effects.filter(e => {
        const epi = e?.flags?.[MODULE_ID] ?? e?.flags?.['encounterplus-importer'] ?? {};
        const overtime = epi?.overtime ?? null;
        const kind = String(overtime?.kind ?? '').toLowerCase();
        const keepDedicatedBlind = !!(epi?.wallOfLightBlind || e?.flags?.['encounterplus-importer']?.wallOfLightBlind);
        const remove = !keepDedicatedBlind && (kind === 'saveeachturn' || kind === 'damage-each-turn' || kind === 'delayed-damage-next-turn');
        if (remove && e?._id) removedIds.push(String(e._id));
        return !remove;
      }) : [];

      const acts = src.system?.activities ?? {};
      for (const act of Object.values(acts)) {
        if (!act) continue;
        act.effects = Array.isArray(act.effects) ? act.effects.filter(ref => !removedIds.includes(String(ref?._id ?? ''))) : [];
      }

      await it.update({
        'effects': src.effects,
        'system.activities': acts,
        [`flags.${MODULE_ID}.regionRule`]: 'wall-of-light',
        'flags.encounterplus-importer.regionRule': 'wall-of-light',
        [`flags.${MODULE_ID}.overtimeTemplates`]: src.flags?.[MODULE_ID]?.overtimeTemplates ?? null,
        'flags.encounterplus-importer.overtimeTemplates': src.flags?.['encounterplus-importer']?.overtimeTemplates ?? null
      });
      return 1;
    };

    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchOne(it);
    for (const actor of (game.actors ?? [])) for (const it of (actor.items ?? [])) patched += await patchOne(it);
    await game.settings.set(MODULE_ID, 'migrationHotfix271as', true);
    if (patched) console.log(`[${MODULE_ID}] Hotfix271as cleaned`, patched, 'Wall of Light spell(s).');
  } catch (e) {
    console.warn(`[${MODULE_ID}] Hotfix271as failed`, e);
  }
});

// Optional: auto-configure Midi-QOL to apply item effects automatically to targets
  try {
    const wants = !!game.settings.get(MODULE_ID, SETTINGS.AUTO_MIDI_APPLY_EFFECTS);
    const midiActive = !!game.modules?.get?.("midi-qol")?.active;
    if (wants && midiActive) {
      const candidates = [];
      for (const [fullKey, s] of game.settings.settings) {
        if (s?.namespace !== "midi-qol") continue;
        const key = String(s.key ?? "");
        const name = String(s.name ?? "");
        const hint = String(s.hint ?? "");
        const blob = `${key} ${name} ${hint}`.toLowerCase();
        if (!blob.includes("auto")) continue;
        if (!(blob.includes("effect") || blob.includes("effet"))) continue;
        if (!(blob.includes("target") || blob.includes("cible") || blob.includes("item"))) continue;
        // Prefer the canonical key names when present
        const score = (key.toLowerCase().includes("autoitemeffects") ? 100 : 0)
          + (key.toLowerCase().includes("autoeffects") ? 50 : 0)
          + (blob.includes("apply") || blob.includes("appliquer") ? 10 : 0);
        candidates.push({ key, s, score });
      }
      candidates.sort((a,b)=> (b.score-a.score));

      const chosen = candidates[0]?.key;
      if (chosen) {
        const setting = candidates[0].s;
        let value;
        if (setting.choices && typeof setting.choices === "object") {
          const keys = Object.keys(setting.choices);
          const pick = keys.find(k => String(k).toLowerCase().includes("apply"))
            || keys.find(k => String(k).toLowerCase().includes("on"))
            || keys.find(k => String(k).toLowerCase().includes("always"))
            || keys[0];
          value = pick;
        } else if (setting.type === Boolean) {
          value = true;
        } else {
          value = true;
        }
        const current = game.settings.get("midi-qol", chosen);
        if (current !== value) {
          await game.settings.set("midi-qol", chosen, value);
          console.log(`[${MODULE_ID}] Midi-QOL auto item effects enabled via setting`, chosen, value);
        }
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Unable to auto-configure Midi-QOL item effects`, e);
  }
});


// Hide the DnD5e system "Apply Active Effects" button on chat cards for importer-generated OverTime effects.
// When Midi-QOL auto-apply is enabled, clicking that system button will apply the same effect a second time.
// Foundry V13+ deprecates renderChatMessage (jQuery) in favor of renderChatMessageHTML (HTMLElement).
async function _epiHandleChatMessageRender(message, htmlLike) {
  try {
    const el = (htmlLike && htmlLike.querySelector) ? htmlLike : (htmlLike?.[0] ?? htmlLike);
    if (!el?.querySelector) return;

    // Try to resolve the item used for this chat card.
    let uuid = null;
    try {
      uuid = el.querySelector("[data-uuid]")?.dataset?.uuid
        ?? el.querySelector(".item-card")?.dataset?.uuid
        ?? el.querySelector(".dnd5e.chat-card")?.dataset?.uuid
        ?? el.querySelector(".dnd5e2.chat-card")?.dataset?.uuid
        ?? null;
    } catch (e) { /* ignore */ }

    const f = message?.flags?.dnd5e ?? {};
    uuid = uuid
      ?? f?.origin?.uuid
      ?? (typeof f?.origin === "string" ? f.origin : null)
      ?? f?.item?.uuid
      ?? f?.itemUuid
      ?? f?.uuid
      ?? null;

    if (!uuid) return;

    const doc = await fromUuid(uuid);
    const item = (doc?.documentName === "Item") ? doc : (doc?.item ?? null);
    if (!item || item.type !== "spell") return;

    const effects = item.effects ? Array.from(item.effects) : [];
    const hasOverTime = effects.some(e => e?.flags?.[MODULE_ID]?.kind === "delayed-damage-next-turn");
    if (!hasOverTime) return;

    // Remove the system apply button(s) so users don't accidentally double-apply.
    const selectors = [
      "button[data-action='applyActiveEffects']",
      "button[data-action='applyEffects']",
      "button[data-action='apply-effects']",
      "button.apply-effects",
      "a[data-action='applyActiveEffects']",
      "a[data-action='applyEffects']",
      "a.apply-effects"
    ];
    for (const n of el.querySelectorAll(selectors.join(","))) n.remove();
  } catch (e) {
    // ignore
  }
}

Hooks.on("renderChatMessage", (message, html) => { void _epiHandleChatMessageRender(message, html); });
Hooks.on("renderChatMessageHTML", (message, html) => { void _epiHandleChatMessageRender(message, html); });


// Auto-apply importer-generated effects (OverTime delayed damage, etc.) even when Midi-QOL doesn't auto-apply them.
// This uses the effect metadata flags stored by the importer.
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    // Detect whether Midi-QOL is configured to auto-apply item effects.
    // We don't early-return anymore: importer OverTime templates are applied by this module (not via item effects).
    // We only use this to decide whether to process legacy item-embedded effects.
    let midiAutoApplyEnabled = false;
    try {
      const midiActive = !!game.modules?.get?.("midi-qol")?.active;
      if (midiActive) {
        let autoKey = null;

        const preferred = [
          "autoApplyEffects",
          "autoApplyItemEffects",
          "autoApplyItemEffectsToTargets",
          "autoApplyEffectsToTargets"
        ];
        for (const k of preferred) {
          if (game.settings.settings?.has?.(`midi-qol.${k}`)) { autoKey = k; break; }
        }

        if (!autoKey) {
          for (const [fullKey, s] of game.settings.settings) {
            if (s?.namespace !== "midi-qol") continue;
            const key = String(s.key ?? "");
            const name = String(s.name ?? "");
            const hint = String(s.hint ?? "");
            const blob = `${key} ${name} ${hint}`.toLowerCase();
            if (!blob.includes("auto")) continue;
            if (!(blob.includes("effect") || blob.includes("effet"))) continue;
            if (!(blob.includes("apply") || blob.includes("appli"))) continue;
            autoKey = key;
            if (key.toLowerCase().includes("autoapply")) break;
          }
        }

        if (autoKey) {
          const val = game.settings.get("midi-qol", autoKey);
          const txt = String(val).toLowerCase();
          const disabled = (val === false) || (val === 0) || txt.includes("none") || txt.includes("off") || txt.includes("no") || txt.includes("never") || txt.includes("disabled");
          midiAutoApplyEnabled = !disabled;
        }
      }
    } catch (e) {
      // ignore
    }

    const wants = !!game.settings.get(MODULE_ID, SETTINGS.AUTO_MIDI_APPLY_EFFECTS);
    if (!wants) return;
    if (!workflow?.item) return;

    const item = workflow.item;

    const epi = item?.flags?.[MODULE_ID] ?? item?.flags?.["encounterplus-importer"] ?? {};
    const templates = Array.isArray(epi?.overtimeTemplates) ? epi.overtimeTemplates : [];

    // Back-compat: older imports stored the OverTime as item effects.
    const legacyEffects = midiAutoApplyEnabled ? [] : (item.effects ? Array.from(item.effects) : []).filter(e => e?.flags?.[MODULE_ID]?.generated && e?.flags?.[MODULE_ID]?.kind);

    const todo = [
      ...templates.map(t => ({ kind: "template", t })),
      ...legacyEffects.map(e => ({ kind: "legacy", e }))
    ];

    if (!todo.length) return;

    const caster = workflow.actor;
    const spelldc = Number(caster?.system?.attributes?.spelldc ?? caster?.system?.attributes?.spellDc ?? caster?.system?.attributes?.spellDC ?? 0) || 0;

    const castLevel = Number(
      workflow?.castData?.castLevel ??
      workflow?.spellLevel ??
      workflow?.itemLevel ??
      workflow?.options?.spellLevel ??
      workflow?.options?.castLevel ??
      item?.system?.level ??
      0
    ) || 0;

    const durationToRounds = (dur) => {
      const value = Number(dur?.value ?? 0) || 0;
      const units = String(dur?.units ?? "").toLowerCase();
      if (!value) return 0;
      if (units.startsWith("round")) return value;
      if (units.startsWith("turn")) return value;
      if (units.startsWith("minute") || units === "min") return value * 10;
      if (units.startsWith("hour") || units === "hr") return value * 600;
      if (units.startsWith("day")) return value * 14400;
      if (units.startsWith("week")) return value * 100800;
      return 0;
    };

    const getTargetsFor = (cond) => {
      const c = String(cond ?? "").toLowerCase();

      if (c.includes("hit")) return workflow.hitTargets ?? workflow.targets;
      if (c.includes("fail")) return workflow.failedSaves ?? workflow.targets;
      if (c.includes("failedsave")) return workflow.failedSaves ?? workflow.targets;

      // Default: prefer hitTargets for attacks, failedSaves for saves.
      if ((workflow?.hitTargets?.size ?? 0) > 0) return workflow.hitTargets;
      if ((workflow?.failedSaves?.size ?? 0) > 0) return workflow.failedSaves;
      return workflow.targets;
    };

    const buildDamageRoll = (dmg, { allowUpcast = false } = {}) => {
      const number = Number(dmg?.number ?? 0) || 0;
      const denom = Number(dmg?.denom ?? dmg?.denomination ?? 0) || 0;
      const baseLevel = Number(dmg?.baseLevel ?? 0) || 0;
      const perN = Number(dmg?.perN ?? 0) || 0;
      const perD = Number(dmg?.perD ?? 0) || 0;

      let n = number;

      if (allowUpcast && castLevel && baseLevel && perN && perD && denom && perD === denom && castLevel > baseLevel) {
        n = number + (castLevel - baseLevel) * perN;
      }

      let roll = `${Math.max(0, n)}d${denom || 0}`;

      const bonus = String(dmg?.bonus ?? "").trim();
      if (bonus) {
        if (bonus === "@mod") roll += "+@mod";
        else if (/^[+-]?\d+$/.test(bonus)) roll += `+${Number(bonus)}`;
        else roll += `+${bonus}`;
      }
      return roll;
    };

    const applyOverTime = async (token, data) => {
      const actor = token?.actor;
      if (!actor) return;

      const statusId = data?.flags?.core?.statusId ?? data?.flags?.core?.statusId ?? "encounterplus-importer.overtime";
      const name = data?.name ?? "";

      // quick guard (preCreateActiveEffect also dedupes)
      const exists = actor.effects?.some(ae => (ae?.flags?.core?.statusId === statusId) && (ae?.name === name));
      if (exists) return;

      await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    };

    for (const entry of todo) {
      if (entry.kind === "legacy") {
        const ef = entry.e;
        const kind = ef?.flags?.[MODULE_ID]?.kind ?? "";
        if (kind !== "delayed-damage-next-turn") continue;

        const targets = getTargetsFor(ef?.flags?.[MODULE_ID]?.condition);
        if (!targets || targets.size === 0) continue;

        const statusId = ef?.flags?.core?.statusId ?? "encounterplus-importer.delayed-damage";

        for (const token of targets) {
          const actor = token?.actor;
          if (!actor) continue;

          const already = actor.effects?.some(ae => (ae?.flags?.core?.statusId === statusId) && (ae?.origin === item.uuid));
          if (already) continue;

          const data = ef.toObject ? ef.toObject() : foundry.utils.deepClone(ef);
          delete data._id;
          data.origin = item.uuid;

          data.flags = data.flags ?? {};
          data.flags.core = data.flags.core ?? {};
          data.flags.core.statusId = data.flags.core.statusId ?? statusId;

          data.statuses = Array.isArray(data.statuses) && data.statuses.length ? data.statuses : [statusId];

          data.duration = data.duration ?? {};
          data.duration.rounds = Math.max(Number(data.duration.rounds ?? 0) || 0, 2);
          data.duration.turns = Number(data.duration.turns ?? 0) || 0;

          await actor.createEmbeddedDocuments("ActiveEffect", [data]);
        }
        continue;
      }

      // New template path
      const tpl = entry.t;
      const kind = String(tpl?.kind ?? "");
      const targets = getTargetsFor(tpl?.condition);
      if (!targets || targets.size === 0) continue;

      const statusId = String(tpl?.statusId ?? "encounterplus-importer.overtime");
      const dtype = String(tpl?.damage?.dtype ?? "").trim();
      const label = String(tpl?.label ?? item.name ?? "").replace(/,/g, "");

      const when = (String(tpl?.when ?? "end") === "start") ? "start" : "end";
      const removeAfterTick = !!tpl?.removeAfterTick;

      const dmgRoll = buildDamageRoll(tpl?.damage, { allowUpcast: !!tpl?.damage?.perN });

      // OverTime specification (see Midi-QOL docs)
      const spec = [
        `turn=${when}`,
        `label=${label}`,
        `damageRoll=${dmgRoll}`,
        (dtype ? `damageType=${dtype}` : ""),
        (dtype ? `type=${dtype}` : ""),
      ];

      const saveEnds = String(tpl?.saveEnds ?? "").trim();
      if (saveEnds) {
        spec.push(`saveAbility=${saveEnds}`);
        if (spelldc) spec.push(`saveDC=${spelldc}`);
        spec.push("saveMagic=true");
        spec.push("saveRemove=true");
        // For common "save ends at end of turn" patterns, apply damage before the save is adjudicated.
        spec.push("damageBeforeSave=true");
      }

      if (removeAfterTick) spec.push("removeCondition=1==1");

      const overTime = spec.filter(Boolean).join(",");

      const rounds = (() => {
        if (kind === "delayed-damage-next-turn") return 2;
        if (kind === "damage-each-turn") {
          const r = durationToRounds(item?.system?.duration);
          return Math.max(1, r || 1);
        }
        return 1;
      })();

      for (const token of targets) {
        const data = {
          name: String(tpl?.label?.startsWith("Dégâts") ? tpl.label : (tpl?.label ?? "")) || (kind === "delayed-damage-next-turn" ? `Dégâts différés — ${item.name}` : `Dégâts récurrents — ${item.name}`),
          icon: tpl?.icon ?? item.img ?? "icons/magic/time/arrows-circling-green.webp",
          img: tpl?.icon ?? item.img ?? "icons/magic/time/arrows-circling-green.webp",
          origin: item.uuid,
          changes: [{ key: "flags.midi-qol.OverTime", mode: 5, value: overTime, priority: 20 }],
          disabled: false,
          transfer: false,
          duration: { rounds, turns: 0 },
          flags: {
            core: { statusId },
            [MODULE_ID]: { generated: true, kind, condition: tpl?.condition ?? "", sourceItemUuid: item.uuid }
          },
          statuses: [statusId]
        };

        await applyOverTime(token, data);
      }
    }  } catch (e) {
    console.warn(`[${MODULE_ID}] Auto-apply importer effects failed`, e);
  }
});

// Lot-1 simple buff applicator: create real Active Effects on cast for importer-marked buff spells.
// We hook both preItemRoll and RollComplete because some workflows don't keep targets/item data consistently at completion time.
const __EPI_LOT1_BUFF_DEBUG_PREFIX = "[EPI lot1 buff debug]";
const __EPI_LOT1_BUFF_DEBUG_SLUGS = new Set(["protection-contre-le-poison", "faveur-divine"]);

console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hardproof main.mjs loaded`);

function __epiLot1BuffSlugFromItem(item) {
  try {
    const slug = String(
      item?.flags?.[MODULE_ID]?.slug
      ?? item?.flags?.["encounterplus-importer"]?.slug
      ?? item?.system?.identifier
      ?? ""
    ).toLowerCase().trim();
    if (slug) return slug;
    const name = String(item?.name ?? "").toLowerCase();
    if (/faveur\s+divine/i.test(name)) return "faveur-divine";
    if (/protection\s+contre\s+le\s+poison/i.test(name)) return "protection-contre-le-poison";
    return "";
  } catch (_e) {
    return "";
  }
}

function __epiLot1BuffDebug(slug, msg, extra = undefined) {
  if (!__EPI_LOT1_BUFF_DEBUG_SLUGS.has(String(slug ?? "").toLowerCase())) return;
  if (extra !== undefined) console.debug(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} ${msg}`, extra);
  else console.debug(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} ${msg}`);
}

async function __epiApplyLot1BuffEffects(workflow, hookName = "unknown") {
  try {
    console.debug(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hook=${hookName} fired`, { hasWorkflow: !!workflow });
    if (!game.user?.isGM) return;
    const wfItem = workflow?.item ?? null;
    const earlySlug = __epiLot1BuffSlugFromItem(wfItem);
    if (__EPI_LOT1_BUFF_DEBUG_SLUGS.has(earlySlug)) {
      __epiLot1BuffDebug(earlySlug, `hook=${hookName} skipped (wrapper primary path)`);
      return;
    }
    if (__EPI_LOT1_BUFF_DEBUG_SLUGS.has(earlySlug)) {
      console.debug(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hook=${hookName} item seen`, {
        slug: earlySlug,
        item: wfItem?.name ?? "",
        hasActor: !!workflow?.actor,
        hasToken: !!workflow?.token
      });
    }
    if (!wfItem || wfItem.type !== "spell") return;

    // Prefer owned item document when available (some Midi workflow clones can lose embedded effect data).
    const actor = workflow?.actor ?? wfItem?.parent ?? null;
    const owned = actor?.items?.get?.(wfItem.id) ?? null;
    const item = owned ?? wfItem;

    const itemEffects = item.effects ? Array.from(item.effects) : [];
    const buffEffects = itemEffects.filter((e) => {
      const f = e?.flags?.[MODULE_ID] ?? e?.flags?.["encounterplus-importer"] ?? {};
      return !!f?.simpleLot1Buff && !!f?.applyOnCast;
    });
    if (!buffEffects.length) return;

    const getSelfToken = () =>
      workflow?.token
      ?? (workflow?.tokenUuid ? canvas?.tokens?.get?.(String(workflow.tokenUuid).split(".").pop()) : null)
      ?? (Array.from(actor?.getActiveTokens?.() ?? [])[0] ?? null);

    for (const ef of buffEffects) {
      const f = ef?.flags?.[MODULE_ID] ?? ef?.flags?.["encounterplus-importer"] ?? {};
      const slug = String(f?.slug ?? __epiLot1BuffSlugFromItem(item) ?? "").toLowerCase();
      const mode = String(f?.targetMode ?? "targets").toLowerCase();
      __epiLot1BuffDebug(slug, `hook=${hookName} reached`, {
        mode,
        item: item?.name,
        workflowItem: wfItem?.name,
        effectName: ef?.name
      });

      const targets = (() => {
        if (mode === "self") return [getSelfToken()].filter(Boolean);
        const t1 = Array.from(workflow?.targets ?? []);
        if (t1.length) return t1;
        const t2 = Array.from(workflow?.hitTargets ?? []);
        if (t2.length) return t2;
        return [];
      })();

      __epiLot1BuffDebug(slug, `targets resolved`, targets.map(t => t?.actor?.name ?? t?.name ?? "?") );
      if (!targets.length) continue;

      for (const token of targets) {
        const targetActor = token?.actor;
        if (!targetActor) continue;

        const key = `${item.uuid}|${slug}|${ef.name ?? ""}`;
        const already = Array.from(targetActor.effects ?? []).some((ae) => {
          const af = ae?.flags?.[MODULE_ID] ?? ae?.flags?.["encounterplus-importer"] ?? {};
          return String(af?.simpleLot1BuffKey ?? "") === key;
        });
        if (already) {
          __epiLot1BuffDebug(slug, `skip existing effect`, { actor: targetActor?.name, key });
          continue;
        }

        const data = ef.toObject ? ef.toObject() : foundry.utils.deepClone(ef);
        delete data._id;
        data.origin = item.uuid;
        data.transfer = false;
        data.disabled = false;
        data.flags = data.flags ?? {};
        data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), simpleLot1BuffKey: key, slug };
        data.flags["encounterplus-importer"] = {
          ...(data.flags["encounterplus-importer"] ?? {}),
          simpleLot1Buff: true,
          simpleLot1BuffKey: key,
          slug
        };

        __epiLot1BuffDebug(slug, `create AE attempt`, { actor: targetActor?.name, mode, key });
        try {
          await targetActor.createEmbeddedDocuments("ActiveEffect", [data]);
          __epiLot1BuffDebug(slug, `create AE success`, { actor: targetActor?.name, mode });
        } catch (e) {
          __epiLot1BuffDebug(slug, `create AE error`, { actor: targetActor?.name, error: String(e) });
        }
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Lot-1 simple buff apply-on-cast failed`, e);
  }
}

Hooks.on("midi-qol.preItemRoll", async (workflow) => {
  await __epiApplyLot1BuffEffects(workflow, "midi-qol.preItemRoll");
});

Hooks.on("midi-qol.RollComplete", async (workflow) => {
  await __epiApplyLot1BuffEffects(workflow, "midi-qol.RollComplete");
});

console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hardproof hooks registered`, ["midi-qol.preItemRoll", "midi-qol.RollComplete", "createActiveEffect"]);


function __epiIsWallOfLightCastWorkflow(workflow) {
  try {
    const item = workflow?.item;
    if (!item) return false;
    const n = String(item?.name ?? '').toLowerCase();
    if (!(n.includes('mur de lumière') || n.includes('mur de lumiere') || n.includes('wall of light'))) return false;
    const activity = workflow?.activity ?? workflow?.item?.system?.activities?.[workflow?.activityId] ?? null;
    const aType = String(activity?.type ?? '').toLowerCase();
    if (aType && aType !== 'save') return false;
    const tplType = String(activity?.target?.template?.type ?? '').toLowerCase();
    if (tplType && tplType !== 'line') return false;
    const epiItem = item?.flags?.[MODULE_ID] ?? item?.flags?.['encounterplus-importer'] ?? {};
    const epiAct = activity?.flags?.[MODULE_ID] ?? activity?.flags?.['encounterplus-importer'] ?? {};
    if (String(epiItem?.regionRule ?? '').toLowerCase() === 'wall-of-light') return true;
    if (String(epiAct?.kind ?? '').toLowerCase() === 'wall-of-light-line') return true;
    return !!(workflow?.templateId || workflow?.templateUuid || tplType === 'line');
  } catch (_e) {
    return false;
  }
}

function __epiResolveWallOfLightSaveDc(item, workflow) {
  try {
    const activity = workflow?.activity ?? workflow?.currentActivity ?? null;
    const actor = workflow?.actor ?? item?.actor ?? activity?.actor ?? null;
    const direct = Number(
      workflow?.saveDC
      ?? workflow?.saveData?.dc
      ?? workflow?.saveDetails?.dc
      ?? activity?.save?.dc?.value
      ?? activity?.save?.dc
      ?? activity?.system?.save?.dc?.value
      ?? activity?.system?.save?.dc
      ?? (typeof item?.getSaveDC === 'function' ? item.getSaveDC() : undefined)
      ?? item?.system?.save?.dc
      ?? item?.system?.save?.value
      ?? actor?.system?.attributes?.spell?.dc
      ?? actor?.system?.attributes?.spelldc
      ?? actor?.system?.attributes?.spellsave
      ?? actor?.system?.attributes?.spellDc
      ?? actor?.system?.attributes?.spellDC
      ?? 0
    ) || 0;
    return direct;
  } catch (_e) {
    return 0;
  }
}

function __epiBuildWallOfLightBlindEffectData(item, workflow) {
  const dc = __epiResolveWallOfLightSaveDc(item, workflow);
  const label = String(item?.name ?? 'Mur de lumière').replace(/,/g, ' ').trim();
  const src = (item?.effects ?? []).find(e => e?.flags?.[MODULE_ID]?.wallOfLightBlind || e?.flags?.['encounterplus-importer']?.wallOfLightBlind);
  let data = null;
  try {
    if (src) data = src.toObject ? src.toObject() : foundry.utils.deepClone(src);
  } catch (_e) { data = null; }
  if (!data) {
    data = {
      name: `${item?.name ?? 'Mur de lumière'} — Aveuglé (JS CON fin de tour)`,
      icon: 'systems/dnd5e/icons/svg/statuses/blinded.svg',
      disabled: false,
      transfer: false,
      duration: { rounds: 10 },
      flags: {
        core: { statusId: 'blinded' },
        [MODULE_ID]: { wallOfLightBlind: true, wallOfLightBlindDc: dc },
        'encounterplus-importer': {
          wallOfLightBlind: true,
          wallOfLightBlindDc: dc,
          overtime: { kind: 'wallOfLightBlind', when: 'end', ab: 'con', statusIds: ['blinded'] }
        }
      },
      statuses: ['blinded'],
      changes: []
    };
  }
  try { delete data._id; } catch (_e) {}
  data.origin = item?.uuid ?? null;
  data.disabled = false;
  data.transfer = false;
  data.duration = data.duration ?? { rounds: 10 };
  data = __epiCleanWallOfLightBlindEffectData(data, dc, label);
  return data;
}

Hooks.on('midi-qol.RollComplete', async (workflow) => {
  try {
    if (!__epiIsWallOfLightCastWorkflow(workflow)) return;
    const failed = workflow?.failedSaves;
    if (!failed || !(failed instanceof Set) || failed.size === 0) return;
    const item = workflow.item;
    const effectData = __epiBuildWallOfLightBlindEffectData(item, workflow);
    for (const token of failed) {
      const actor = token?.actor;
      if (!actor) continue;
      const exists = actor.effects?.some(ae => {
        const statuses = Array.isArray(ae?.statuses) ? ae.statuses.map(String) : [];
        return !!(ae?.flags?.[MODULE_ID]?.wallOfLightBlind || ae?.flags?.['encounterplus-importer']?.wallOfLightBlind)
          && (ae?.origin === item?.uuid || statuses.includes('blinded'));
      });
      if (exists) continue;
      await actor.createEmbeddedDocuments('ActiveEffect', [foundry.utils.deepClone(effectData)]);
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Wall of Light blinded auto-apply failed`, e);
  }
});

const __EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS = globalThis.__EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS ?? (globalThis.__EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS = new Set());
const __EPI_COMBAT_PREV_STATE = globalThis.__EPI_COMBAT_PREV_STATE ?? (globalThis.__EPI_COMBAT_PREV_STATE = new Map());

function __epiIsWallOfLightBlindEffect(effect) {
  try {
    if (!effect) return false;
    return !!(effect?.flags?.[MODULE_ID]?.wallOfLightBlind || effect?.flags?.['encounterplus-importer']?.wallOfLightBlind);
  } catch (_e) {
    return false;
  }
}

function __epiGetWallOfLightBlindDc(effect) {
  try {
    const direct = Number(effect?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? effect?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0;
    if (direct > 0) return direct;
    const changes = Array.isArray(effect?.changes) ? effect.changes : [];
    const ot = String(changes.find(c => String(c?.key ?? '') === 'flags.midi-qol.OverTime')?.value ?? '');
    const m = ot.match(/saveDC=(\d+)/i);
    return Number(m?.[1] ?? 0) || 0;
  } catch (_e) {
    return 0;
  }
}


function __epiBuildWallOfLightBlindMacroChange() {
  return `"${EPI_WALL_OF_LIGHT_BLIND_MACRO_NAME}"`;
}

function __epiCleanWallOfLightBlindEffectData(data, dc, label='Mur de lumière') {
  data ??= {};
  data.flags ??= {};
  data.flags.core = { ...(data.flags.core ?? {}), statusId: 'blinded' };
  data.flags[MODULE_ID] = {
    ...(data.flags?.[MODULE_ID] ?? {}),
    wallOfLightBlind: true,
    wallOfLightBlindDc: dc
  };
  data.flags['encounterplus-importer'] = {
    ...(data.flags?.['encounterplus-importer'] ?? {}),
    wallOfLightBlind: true,
    wallOfLightBlindDc: dc,
    overtime: { kind: 'wallOfLightBlind', when: 'end', ab: 'con', statusIds: ['blinded'] }
  };
  // Keep this self-contained on the Active Effect itself via Midi-QOL OverTime.
  delete data.flags.dae;
  data.statuses = Array.isArray(data.statuses) ? Array.from(new Set([...data.statuses.map(String), 'blinded'])) : ['blinded'];
  data.icon = data.icon || 'systems/dnd5e/icons/svg/statuses/blinded.svg';
  const safeLabel = String(label || 'Mur de lumière').replace(/[,;]/g, ' ').trim();
  const ot = [
    'turn=end',
    'saveAbility=con',
    `saveDC=${Math.max(0, Number(dc) || 0)}`,
    'saveMagic=true',
    'saveRemove=true',
    'saveDamage=nodamage',
    `label=${safeLabel} — JS de Constitution (fin de tour)`
  ].filter(Boolean).join(',');
  data.changes = Array.isArray(data.changes) ? data.changes.filter(c => !['flags.midi-qol.OverTime', 'macro.execute'].includes(String(c?.key ?? ''))) : [];
  data.changes.push({ key: 'flags.midi-qol.OverTime', mode: 5, value: ot, priority: 20 });
  return data;
}

function __epiHasWallOfLightBlindOverTime(effect) {
  try {
    const changes = Array.isArray(effect?.changes) ? effect.changes : [];
    const ot = String(changes.find(c => String(c?.key ?? '') === 'flags.midi-qol.OverTime')?.value ?? '');
    return (/saveAbility=con/i.test(ot) && /saveDC=/i.test(ot));
  } catch (_e) {
    return false;
  }
}

const __EPI_AURA_LIFE_TURN_KEYS = globalThis.__EPI_AURA_LIFE_TURN_KEYS ?? (globalThis.__EPI_AURA_LIFE_TURN_KEYS = new Set());

function __epiIsLivingCreatureActor(actor) {
  try {
    const t = String(actor?.system?.details?.type?.value ?? actor?.system?.details?.race ?? "").toLowerCase();
    if (!t) return true;
    if (t.includes("undead") || t.includes("mort-vivant") || t.includes("mort vivant")) return false;
    if (t.includes("construct") || t.includes("artificiel")) return false;
    return true;
  } catch (_e) {
    return true;
  }
}

function __epiHasAuraLifeProtection(actor) {
  try {
    const viaFlag = !!foundry?.utils?.getProperty?.(actor, "flags.encounterplus-importer.auraLife.protected");
    if (viaFlag) return true;
    const effects = Array.from(actor?.effects ?? []);
    return effects.some((e) => {
      const ch = Array.isArray(e?.changes) ? e.changes : [];
      return ch.some(c => String(c?.key ?? "") === "flags.encounterplus-importer.auraLife.protected");
    });
  } catch (_e) {
    return false;
  }
}

function __epiHasAuraPurityProtection(actor) {
  try {
    const viaFlag = !!foundry?.utils?.getProperty?.(actor, "flags.encounterplus-importer.auraPurity.protected");
    if (viaFlag) return true;
    const effects = Array.from(actor?.effects ?? []);
    return effects.some((e) => {
      const ch = Array.isArray(e?.changes) ? e.changes : [];
      return ch.some(c => String(c?.key ?? "") === "flags.encounterplus-importer.auraPurity.protected");
    });
  } catch (_e) {
    return false;
  }
}

function __epiHasHolyAuraProtection(actor) {
  try {
    const viaFlag = !!foundry?.utils?.getProperty?.(actor, "flags.encounterplus-importer.holyAura.protected");
    if (viaFlag) return true;
    const effects = Array.from(actor?.effects ?? []);
    return effects.some((e) => {
      const ch = Array.isArray(e?.changes) ? e.changes : [];
      return ch.some(c => String(c?.key ?? "") === "flags.encounterplus-importer.holyAura.protected");
    });
  } catch (_e) {
    return false;
  }
}

function __epiLooksLikeDiseaseEffect(effectData) {
  try {
    const name = String(effectData?.name ?? "").toLowerCase();
    const label = String(effectData?.label ?? "").toLowerCase();
    const statuses = Array.isArray(effectData?.statuses) ? effectData.statuses.map(s => String(s).toLowerCase()) : [];
    if (statuses.includes("diseased") || statuses.includes("disease")) return true;
    return /\b(disease|diseased|maladie|malade)\b/i.test(`${name} ${label}`);
  } catch (_e) {
    return false;
  }
}

Hooks.on("preCreateActiveEffect", (effect, data) => {
  try {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (!actor || !__epiHasAuraPurityProtection(actor)) return;
    if (__epiLooksLikeDiseaseEffect(data ?? effect)) {
      console.debug(`[${MODULE_ID}] Aura de pureté: prevented disease effect on`, actor?.name);
      return false;
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Aura de pureté disease prevention failed`, e);
  }
});

// Lot-1 targeted hook: Protection contre le poison should immediately neutralize poisoned condition.
Hooks.on("createActiveEffect", async (effect) => {
  try {
    if (!game.user?.isGM) return;
    const actor = effect?.parent;
    if (!actor) return;
    const slug = String(effect?.flags?.[MODULE_ID]?.slug ?? effect?.flags?.["encounterplus-importer"]?.slug ?? "").toLowerCase();
    if (slug !== "protection-contre-le-poison") return;

    const poisoned = Array.from(actor.effects ?? []).filter((e) => {
      const s = e?.statuses;
      return s?.has?.("poisoned") || (Array.isArray(s) && s.includes("poisoned"));
    });
    if (!poisoned.length) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", poisoned.map(e => e.id).filter(Boolean));
    console.debug(`[${MODULE_ID}] Protection contre le poison: removed poisoned condition from`, actor?.name);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Protection contre le poison condition cleanup failed`, e);
  }
});

Hooks.on("midi-qol.preAttackRoll", (workflow) => {
  try {
    if (!game.user?.isGM || !workflow) return;
    const targets = Array.from(workflow.targets ?? []);
    if (!targets.length) return;
    const hasProtectedTarget = targets.some(t => __epiHasHolyAuraProtection(t?.actor ?? null));
    if (!hasProtectedTarget) return;
    workflow.disadvantage = true;
  } catch (e) {
    console.warn(`[${MODULE_ID}] Aura sacrée preAttackRoll disadvantage failed`, e);
  }
});

Hooks.on("preUpdateActor", (actor, changed) => {
  try {
    if (!game.user?.isGM || !actor || !__epiHasAuraLifeProtection(actor)) return;
    const cur = Number(actor?.system?.attributes?.hp?.max ?? 0);
    const nextRaw = foundry?.utils?.getProperty?.(changed, "system.attributes.hp.max");
    if (nextRaw == null) return;
    const next = Number(nextRaw);
    if (!Number.isFinite(next) || !Number.isFinite(cur)) return;
    if (next < cur) {
      foundry?.utils?.setProperty?.(changed, "system.attributes.hp.max", cur);
      console.debug(`[${MODULE_ID}] Aura de vie: blocked HP max reduction on`, actor?.name);
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Aura de vie preUpdateActor guard failed`, e);
  }
});

Hooks.on("updateCombat", async (combat, changed) => {
  try {
    if (!game.user?.isGM || !combat?.started) return;
    if (!('turn' in (changed ?? {})) && !('round' in (changed ?? {}))) return;
    const cbt = combat.combatant ?? (Array.isArray(combat.turns) ? (combat.turns[Number(combat.turn) ?? 0] ?? null) : null);
    const actor = cbt?.actor ?? null;
    if (!actor || !__epiHasAuraLifeProtection(actor) || !__epiIsLivingCreatureActor(actor)) return;
    const hp = Number(actor?.system?.attributes?.hp?.value ?? 0);
    if (hp !== 0) return;
    const key = [combat.id, Number(combat.round ?? 0), Number(combat.turn ?? -1), actor.uuid].join("|");
    if (__EPI_AURA_LIFE_TURN_KEYS.has(key)) return;
    __EPI_AURA_LIFE_TURN_KEYS.add(key);
    setTimeout(() => __EPI_AURA_LIFE_TURN_KEYS.delete(key), 15000);
    await actor.update({ "system.attributes.hp.value": 1 });
    console.debug(`[${MODULE_ID}] Aura de vie: restored ${actor?.name} to 1 HP at turn start.`);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Aura de vie start-turn recovery failed`, e);
  }
});

Hooks.on('preUpdateCombat', (combat, changed) => {
  try {
    if (!game.user?.isGM || !combat) return;
    if (!Object.prototype.hasOwnProperty.call(changed ?? {}, 'turn') && !Object.prototype.hasOwnProperty.call(changed ?? {}, 'round')) return;
    __EPI_COMBAT_PREV_STATE.set(combat.id, {
      round: Number(combat.round ?? 0) || 0,
      turn: Number(combat.turn ?? -1),
      combatantId: combat?.combatant?.id ?? null
    });
  } catch (_e) {}
});

Hooks.on('updateCombat', async (combat, changed) => {
  try {
    if (!game.user?.isGM) return;
    if (!combat || (!Object.prototype.hasOwnProperty.call(changed ?? {}, 'turn') && !Object.prototype.hasOwnProperty.call(changed ?? {}, 'round'))) return;
    const prev = __EPI_COMBAT_PREV_STATE.get(combat.id) ?? { round: Number(combat.round ?? 0) || 0, turn: Number(combat.turn ?? -1), combatantId: null };
    __EPI_COMBAT_PREV_STATE.delete(combat.id);
    const prevTurn = Number(prev?.turn);
    if (!Number.isFinite(prevTurn) || prevTurn < 0) return;
    const endedCombatant = (prev?.combatantId ? combat.combatants?.get?.(prev.combatantId) : null)
      ?? combat?.turns?.[prevTurn]
      ?? combat?.combatants?.contents?.[prevTurn]
      ?? null;
    const actor = endedCombatant?.actor ?? null;
    if (!actor) return;
    const effects = Array.from(actor.effects ?? []).filter(e => __epiIsWallOfLightBlindEffect(e) && !__epiHasWallOfLightBlindOverTime(e));
    if (!effects.length) return;
    for (const effect of effects) {
      const dc = __epiGetWallOfLightBlindDc(effect);
      if (!(dc > 0)) continue;
      const key = [combat.id, prev?.round ?? combat.round, prevTurn, actor.uuid, effect.id ?? effect._id ?? effect.name].join('|');
      if (__EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.has(key)) continue;
      __EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.add(key);
      setTimeout(() => __EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.delete(key), 5000);
      const roll = await actor.rollAbilitySave('con', {
        chatMessage: true,
        flavor: String(effect.name ?? 'Mur de lumière') + ' — JS de Constitution (fin de tour)'
      });
      const total = Number(roll?.total ?? roll?.rolls?.[0]?.total ?? roll?.[0]?.total ?? 0) || 0;
      if (total >= dc) {
        try { await effect.delete(); } catch (_e) {}
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Wall of Light blinded end-turn save failed`, e);
  }
});

Hooks.on('deleteCombat', (combat) => {
  try { __EPI_COMBAT_PREV_STATE.delete(combat?.id); } catch (_e) {}
});


// hotfix271aw: fallback Wall of Light blind end-of-turn save using the same previous-token tracking pattern
// as Region end/start-of-turn automation. This is more reliable than relying only on preUpdateCombat state.
const __EPI_WALL_OF_LIGHT_LAST_TURN = globalThis.__EPI_WALL_OF_LIGHT_LAST_TURN ?? (globalThis.__EPI_WALL_OF_LIGHT_LAST_TURN = new Map());

async function __epiProcessWallOfLightBlindEndTurnForToken(combat, tokenDoc) {
  try {
    if (!game.user?.isGM || !combat?.started || !tokenDoc?.actor) return;
    const actor = tokenDoc.actor;
    const effects = Array.from(actor.effects ?? []).filter(e => __epiIsWallOfLightBlindEffect(e) && !__epiHasWallOfLightBlindOverTime(e));
    if (!effects.length) return;
    const round = Number(combat.round ?? 0) || 0;
    const turn = Number(combat.turn ?? -1);
    for (const effect of effects) {
      const dc = __epiGetWallOfLightBlindDc(effect);
      if (!(dc > 0)) continue;
      const key = [combat.id, round, 'ended', tokenDoc.id ?? tokenDoc.uuid ?? actor.uuid, effect.id ?? effect._id ?? effect.name].join('|');
      if (__EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.has(key)) continue;
      __EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.add(key);
      setTimeout(() => __EPI_WALL_OF_LIGHT_BLIND_TURN_KEYS.delete(key), 8000);
      const roll = await actor.rollAbilitySave('con', {
        chatMessage: true,
        flavor: String(effect.name ?? 'Mur de lumière') + ' — JS de Constitution (fin de tour)'
      });
      const total = Number(roll?.total ?? roll?.rolls?.[0]?.total ?? roll?.[0]?.total ?? 0) || 0;
      if (total >= dc) {
        try { await effect.delete(); } catch (_e) {}
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] Wall of Light blinded fallback end-turn save failed`, e);
  }
}

Hooks.on('updateCombat', async (combat, changed) => {
  try {
    if (!game.user?.isGM) return;
    if (!combat?.started) return;
    if (!('turn' in (changed ?? {})) && !('round' in (changed ?? {}))) return;
    const scene = canvas?.scene;
    if (!scene) return;

    // Previous token = token whose turn just ended.
    const prevInfo = __EPI_WALL_OF_LIGHT_LAST_TURN.get(combat.id) ?? null;
    let prevTokenDoc = null;
    if (prevInfo?.tokenId) prevTokenDoc = scene.tokens?.get?.(prevInfo.tokenId) ?? null;
    if (prevTokenDoc) await __epiProcessWallOfLightBlindEndTurnForToken(combat, prevTokenDoc);

    const combatant = combat.combatant
      ?? (Array.isArray(combat.turns) ? (combat.turns[Number(combat.turn) ?? 0] ?? null) : null);
    const tokenId = combatant?.tokenId ?? combatant?.token?.id ?? null;
    __EPI_WALL_OF_LIGHT_LAST_TURN.set(combat.id, { tokenId: tokenId ?? null, t: Date.now() });
  } catch (e) {
    console.warn(`[${MODULE_ID}] Wall of Light blind turn tracker failed`, e);
  }
});

Hooks.on('deleteCombat', (combat) => {
  try { __EPI_WALL_OF_LIGHT_LAST_TURN.delete(combat?.id); } catch (_e) {}
});


// hotfix271au: Wall of Light blinded must use a dedicated end-of-turn CON save driven by this module,
// not a Midi-QOL OverTime string on the target effect (which can be unreliable / duplicate depending on setup).
Hooks.once("ready", async () => {
  try {
    if (!game.user?.isGM || game.settings.get(MODULE_ID, "migrationHotfix271au")) return;
    const isWallOfLightItem = (item) => {
      const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
      const name = String(item?.name ?? "").toLowerCase();
      const rr = String(item?.flags?.[MODULE_ID]?.regionRule ?? item?.flags?.["encounterplus-importer"]?.regionRule ?? "").toLowerCase();
      return slug === "mur-de-lumiere" || slug === "wall-of-light" || rr === "wall-of-light" || /mur\s+de\s+lumi[èe]re|wall\s+of\s+light/i.test(name);
    };
    const cleanEffect = (e) => {
      if (!e) return e;
      e.flags ??= {};
      e.flags[MODULE_ID] = { ...(e.flags?.[MODULE_ID] ?? {}), wallOfLightBlind: true };
      const dc = Number(e?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? e?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0;
      return __epiCleanWallOfLightBlindEffectData(e, dc, e?.name ?? 'Mur de lumière');
    };
    const patchItem = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      let changed = false;
      src.effects = Array.isArray(src.effects) ? src.effects.map(e => {
        const isBlind = !!(e?.flags?.[MODULE_ID]?.wallOfLightBlind || e?.flags?.['encounterplus-importer']?.wallOfLightBlind);
        if (!isBlind) return e;
        changed = true;
        return cleanEffect(e);
      }) : [];
      if (changed) await it.update({ effects: src.effects });
      return changed ? 1 : 0;
    };
    let patched = 0;
    for (const it of (game.items ?? [])) patched += await patchItem(it);
    for (const actor of (game.actors ?? [])) {
      for (const it of (actor.items ?? [])) patched += await patchItem(it);
      const blindEffects = Array.from(actor.effects ?? []).filter(__epiIsWallOfLightBlindEffect);
      for (const ae of blindEffects) {
        const parsedDc = __epiGetWallOfLightBlindDc(ae);
        const cleaned = __epiCleanWallOfLightBlindEffectData(ae.toObject ? ae.toObject() : foundry.utils.deepClone(ae), parsedDc > 0 ? parsedDc : (Number(ae?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? ae?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0), ae?.name ?? 'Mur de lumière');
        const updates = {
          changes: cleaned.changes,
          'flags.dae': cleaned.flags?.dae ?? {},
          [`flags.${MODULE_ID}.wallOfLightBlind`]: true,
          [`flags.${MODULE_ID}.wallOfLightBlindEffectMacro`]: true,
          'flags.encounterplus-importer.wallOfLightBlind': true,
          'flags.encounterplus-importer.wallOfLightBlindEffectMacro': true
        };
        if (parsedDc > 0) {
          updates[`flags.${MODULE_ID}.wallOfLightBlindDc`] = parsedDc;
          updates['flags.encounterplus-importer.wallOfLightBlindDc'] = parsedDc;
        }
        const finalDc = parsedDc > 0 ? parsedDc : Number(ae?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? ae?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0;
        updates[`flags.${MODULE_ID}.wallOfLightBlindDc`] = finalDc;
        updates['flags.encounterplus-importer.wallOfLightBlindDc'] = finalDc;
        await ae.update(updates).catch(() => {});
      }
    }
    await game.settings.set(MODULE_ID, "migrationHotfix271au", true);
    if (patched > 0) console.log(`[${MODULE_ID}] hotfix271au: cleaned Wall of Light blind effects on ${patched} item(s).`);
  } catch (e) {
    console.warn(`[${MODULE_ID}] hotfix271au migration failed`, e);
  }
});

// Dedupe importer-generated OverTime effects so they cannot be applied twice (e.g. Midi auto-apply + manual "Apply Effects" click).
// This is intentionally conservative and only targets effects created by the importer.
// Prevent duplicate application of importer-generated OverTime effects on targets.
// This can happen when Midi-QOL auto-apply is enabled AND a system/manual apply runs too.
// We dedupe both against existing effects and against same-batch creations.
const __EPI_PENDING_EFFECTS = globalThis.__EPI_PENDING_EFFECTS ?? (globalThis.__EPI_PENDING_EFFECTS = new Set());

Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
  try {
    const actor = effect?.parent;
    if (!actor) return;

    const flags = data?.flags ?? effect?.flags ?? {};
    const epi = flags?.[MODULE_ID] ?? flags?.["encounterplus-importer"] ?? null;

    // Only for importer-generated effects (we tag them on the item effect)
    const isImporter = !!(epi?.generated) || String(data?.name ?? "").startsWith("Dégâts différés —") || String(data?.name ?? "").startsWith("Delayed Damage —");
    if (!isImporter) return;

    const changes = Array.isArray(data?.changes) ? data.changes : (effect?.changes ?? []);
    const ot = changes.find(c => c?.key === "flags.midi-qol.OverTime")?.value ?? null;
    if (!ot) return;

    const name = data?.name ?? effect?.name ?? "";
    const sig = `${actor.uuid}|${name}|${ot}`;

    // Same-batch / same-tick dedupe
    if (__EPI_PENDING_EFFECTS.has(sig)) return false;
    __EPI_PENDING_EFFECTS.add(sig);
    setTimeout(() => __EPI_PENDING_EFFECTS.delete(sig), 2000);

    // Existing-effect dedupe
    const exists = actor.effects?.some(ae => {
      const aName = ae?.name ?? "";
      if (aName !== name) return false;
      const aChanges = Array.isArray(ae?.changes) ? ae.changes : [];
      const aOt = aChanges.find(c => c?.key === "flags.midi-qol.OverTime")?.value ?? null;
      return aOt === ot;
    });

    if (exists) return false;
  } catch (e) {
    // ignore
  }
});


// Regions (FVTT v13): zone spells automation (Web, Grease, Entangle, Tentacles, ...)
Hooks.once("ready", async () => {
  try {
    const { initWebRegions } = await import("./regions-web.mjs");
    initWebRegions();
    console.log(`[${MODULE_ID}] Regions (zone spells) automation enabled`);
  } catch (e) {
    console.warn(`[${MODULE_ID}] Regions automation failed to initialize: ${e?.message ?? e}`, e?.stack ?? e);
  }
});


// ------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------

/**
 * Storm Sphere: open an activity-choice dialog that matches the dnd5e “multi-activity” style
 * (like Barrière de lames), instead of the default spell-cast config dialog.
 */
/**
 * Small app that mimics the dnd5e multi-activity chooser UI (like "Barrière de lames").
 * We use an Application (not a legacy Dialog) so we fully control layout and styling.
 */
/**
 * Storm Sphere: open the SAME dnd5e activity-choice dialog as the system uses (e.g. Barrière de lames).
 * Returns the chosen activityId (string) or null.
 */
async function epiStormSphereChoiceDialog(item) {
  try {
    const DialogClass =
      foundry?.utils?.getProperty?.(game, "dnd5e.applications.activity.ActivityChoiceDialog")
      ?? foundry?.utils?.getProperty?.(globalThis, "game.dnd5e.applications.activity.ActivityChoiceDialog");

    const ActivityChoiceDialog = DialogClass
      ?? (await import("/systems/dnd5e/module/applications/activity/activity-choice-dialog.mjs")).default;

    const activity = await ActivityChoiceDialog.create(item);
    const id = activity?._id ?? activity?.id ?? null;
    return id ? String(id) : null;
  } catch (e) {
    console.warn(`[${MODULE_ID}] Failed to open dnd5e ActivityChoiceDialog`, e);
    return null;
  }
}


function epiIsWallOfFireItem(item) {
  const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  return slug === "mur-de-feu" || slug === "wall-of-fire" || /mur\s+de\s+feu|wall\s+of\s+fire/i.test(name);
}

function epiGetWallOfFireBaseActivity(item) {
  const acts = epiListActivities(item);
  return acts.find(a => String(a?.type ?? "").toLowerCase() === "save") ?? acts[0] ?? null;
}

function epiWallOfFireVariantLabel(variant) {
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const labels = fr ? {
    "line-left": "Ligne, côté chaud à gauche",
    "line-right": "Ligne, côté chaud à droite",
    "ring-inner": "Anneau, côté chaud à l'intérieur",
    "ring-outer": "Anneau, côté chaud à l'extérieur"
  } : {
    "line-left": "Line, hot side left",
    "line-right": "Line, hot side right",
    "ring-inner": "Ring, hot side inward",
    "ring-outer": "Ring, hot side outward"
  };
  return labels[String(variant)] ?? String(variant);
}

async function epiWallOfFireChoiceDialog(item) {
  const title = String(item?.name ?? "Mur de feu");
  const content = `<p><strong>${title}</strong></p><p>Choisis la forme et le côté chaud du mur.</p>`;
  const buttons = [
    { action: "line-left", label: epiWallOfFireVariantLabel("line-left") },
    { action: "line-right", label: epiWallOfFireVariantLabel("line-right"), default: true },
    { action: "ring-inner", label: epiWallOfFireVariantLabel("ring-inner") },
    { action: "ring-outer", label: epiWallOfFireVariantLabel("ring-outer") },
    { action: "cancel", label: "Annuler" }
  ];

  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      const result = await DialogV2.wait({ window: { title }, content, buttons, modal: true, rejectClose: false });
      if (["line-left","line-right","ring-inner","ring-outer"].includes(result)) return result;
      return null;
    }
  } catch (_e) {}

  try {
    return await new Promise(resolve => {
      new globalThis.Dialog({
        title,
        content,
        buttons: {
          lineLeft: { label: epiWallOfFireVariantLabel("line-left"), callback: () => resolve("line-left") },
          lineRight: { label: epiWallOfFireVariantLabel("line-right"), callback: () => resolve("line-right") },
          ringInner: { label: epiWallOfFireVariantLabel("ring-inner"), callback: () => resolve("ring-inner") },
          ringOuter: { label: epiWallOfFireVariantLabel("ring-outer"), callback: () => resolve("ring-outer") },
          cancel: { label: "Annuler", callback: () => resolve(null) }
        },
        default: "lineRight",
        close: () => resolve(null)
      }).render(true);
    });
  } catch (_e) {}

  return "line-right";
}

async function epiSetWallOfFireVariant(item, variant) {
  if (!item || !variant) return null;
  const src = item.toObject();
  src.flags ??= {};
  src.flags[MODULE_ID] ??= {};
  src.flags["encounterplus-importer"] ??= {};
  src.flags[MODULE_ID].wallOfFireVariant = String(variant);
  src.flags["encounterplus-importer"].wallOfFireVariant = String(variant);

  const actsObj = src.system?.activities ?? {};
  const baseId = Object.keys(actsObj)[0] ?? null;
  if (!baseId || !actsObj[baseId]) return null;

  const act = actsObj[baseId];
  const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
  const isMetric = units === "m";
  const lineLength = isMetric ? 18 : 60;
  const lineWidth = isMetric ? 1.5 : 5;
  const circleRadius = isMetric ? 3 : 10;
  const isCircle = String(variant).startsWith("ring-");
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const names = fr ? {
    "line-left": "Lancer (ligne gauche)",
    "line-right": "Lancer (ligne droite)",
    "ring-inner": "Lancer (anneau interne)",
    "ring-outer": "Lancer (anneau externe)"
  } : {
    "line-left": "Cast (line left)",
    "line-right": "Cast (line right)",
    "ring-inner": "Cast (ring inner)",
    "ring-outer": "Cast (ring outer)"
  };

  act.name = names[String(variant)] ?? names["line-right"];
  act.flags ??= {};
  act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), kind: isCircle ? "wall-of-fire-circle" : "wall-of-fire-line", wallOfFireVariant: String(variant) };
  act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), kind: isCircle ? "wall-of-fire-circle" : "wall-of-fire-line", wallOfFireVariant: String(variant) };
  act.target ??= { template: {}, affects: {}, prompt: true, override: true };
  act.target.template ??= {};
  act.target.affects = { count: "", type: "", choice: false, special: "" };
  act.target.template.type = isCircle ? "sphere" : "line";
  act.target.template.size = String(isCircle ? circleRadius : lineLength);
  act.target.template.width = isCircle ? "" : String(lineWidth);
  act.target.template.height = "";
  act.target.template.units = units;
  act.target.prompt = true;
  act.target.override = true;

  await item.update({
    "system.activities": actsObj,
    [`flags.${MODULE_ID}.wallOfFireVariant`]: String(variant),
    "flags.encounterplus-importer.wallOfFireVariant": String(variant)
  });
  return epiGetWallOfFireBaseActivity(item);
}

function epiIsWallOfThornsItem(item) {
  const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  return slug === "mur-d-epines" || slug === "wall-of-thorns" || /mur\s+d[’']?epines|mur\s+d[’']?épines|wall\s+of\s+thorns/i.test(name);
}

function epiGetWallOfThornsBaseActivity(item) {
  const acts = epiListActivities(item);
  return acts.find(a => String(a?.type ?? "").toLowerCase() === "save") ?? acts[0] ?? null;
}

function epiWallOfThornsFormLabel(form) {
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const labels = fr ? {
    line: "Ligne",
    circle: "Anneau"
  } : {
    line: "Line",
    circle: "Ring"
  };
  return labels[String(form)] ?? String(form);
}

async function epiWallOfThornsChoiceDialog(item) {
  const title = String(item?.name ?? "Mur d’épines");
  const content = `<p><strong>${title}</strong></p><p>Choisis la forme du mur.</p>`;
  const buttons = [
    { action: "line", label: epiWallOfThornsFormLabel("line"), default: true },
    { action: "circle", label: epiWallOfThornsFormLabel("circle") },
    { action: "cancel", label: "Annuler" }
  ];

  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      const result = await DialogV2.wait({ window: { title }, content, buttons, modal: true, rejectClose: false });
      if (["line","circle"].includes(result)) return result;
      return null;
    }
  } catch (_e) {}

  try {
    return await new Promise(resolve => {
      new globalThis.Dialog({
        title,
        content,
        buttons: {
          line: { label: epiWallOfThornsFormLabel("line"), callback: () => resolve("line") },
          circle: { label: epiWallOfThornsFormLabel("circle"), callback: () => resolve("circle") },
          cancel: { label: "Annuler", callback: () => resolve(null) }
        },
        default: "line",
        close: () => resolve(null)
      }).render(true);
    });
  } catch (_e) {}

  return "line";
}

async function epiSetWallOfThornsForm(item, form) {
  if (!item || !form) return null;
  const src = item.toObject();
  src.flags ??= {};
  src.flags[MODULE_ID] ??= {};
  src.flags["encounterplus-importer"] ??= {};
  src.flags[MODULE_ID].wallOfThornsForm = String(form);
  src.flags["encounterplus-importer"].wallOfThornsForm = String(form);

  const actsObj = src.system?.activities ?? {};
  const baseId = Object.keys(actsObj)[0] ?? null;
  if (!baseId || !actsObj[baseId]) return null;

  const act = actsObj[baseId];
  const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
  const isMetric = units === "m";
  const lineLength = isMetric ? 18 : 60;
  const wallWidth = isMetric ? 1.5 : 5;
  const circleRadius = isMetric ? 3 : 10;
  const isCircle = String(form) === "circle";
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");

  act.name = isCircle ? (fr ? "Lancer (anneau)" : "Cast (ring)") : (fr ? "Lancer (ligne)" : "Cast (line)");
  act.flags ??= {};
  act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), kind: isCircle ? "wall-of-thorns-circle" : "wall-of-thorns-line", wallOfThornsForm: String(form) };
  act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), kind: isCircle ? "wall-of-thorns-circle" : "wall-of-thorns-line", wallOfThornsForm: String(form) };
  act.target ??= { template: {}, affects: {}, prompt: true, override: true };
  act.target.template ??= {};
  act.target.affects = { count: "", type: "", choice: false, special: "" };
  act.target.template.type = isCircle ? "sphere" : "line";
  act.target.template.size = String(isCircle ? circleRadius : lineLength);
  act.target.template.width = isCircle ? "" : String(wallWidth);
  act.target.template.height = "";
  act.target.template.units = units;
  act.target.prompt = true;
  act.target.override = true;

  await item.update({
    "system.activities": actsObj,
    [`flags.${MODULE_ID}.wallOfThornsForm`]: String(form),
    "flags.encounterplus-importer.wallOfThornsForm": String(form)
  });
  return epiGetWallOfThornsBaseActivity(item);
}

function epiIsWallOfForceItem(item) {
  const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  return slug === "mur-de-force" || slug === "wall-of-force" || /mur\s+de\s+force|wall\s+of\s+force/i.test(name);
}

function epiIsWallOfIceItem(item) {
  const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  return slug === "mur-de-glace" || slug === "wall-of-ice" || /mur\s+de\s+glace|wall\s+of\s+ice/i.test(name);
}

function epiGetWallOfIceBaseActivity(item) {
  const acts = epiListActivities(item);
  return acts.find(a => String(a?.type ?? "").toLowerCase() === "save") ?? acts[0] ?? null;
}

function epiWallOfIceFormLabel(form) {
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const labels = fr ? { line: "Ligne", sphere: "Sphère" } : { line: "Line", sphere: "Sphere" };
  return labels[String(form)] ?? String(form);
}

async function epiWallOfIceChoiceDialog(item) {
  const title = String(item?.name ?? "Mur de glace");
  const content = `<p><strong>${title}</strong></p><p>Choisis la forme du mur.</p>`;
  const buttons = [
    { action: "line", label: epiWallOfIceFormLabel("line"), default: true },
    { action: "sphere", label: epiWallOfIceFormLabel("sphere") },
    { action: "cancel", label: "Annuler" }
  ];
  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      const result = await DialogV2.wait({ window: { title }, content, buttons, modal: true, rejectClose: false });
      if (["line","sphere"].includes(result)) return result;
      return null;
    }
  } catch (_e) {}
  try {
    return await new Promise(resolve => {
      new globalThis.Dialog({
        title, content,
        buttons: {
          line: { label: epiWallOfIceFormLabel("line"), callback: () => resolve("line") },
          sphere: { label: epiWallOfIceFormLabel("sphere"), callback: () => resolve("sphere") },
          cancel: { label: "Annuler", callback: () => resolve(null) }
        },
        default: "line",
        close: () => resolve(null)
      }).render(true);
    });
  } catch (_e) {}
  return "line";
}

async function epiSetWallOfIceForm(item, form) {
  if (!item || !form) return null;
  const src = item.toObject();
  src.flags ??= {};
  src.flags[MODULE_ID] ??= {};
  src.flags["encounterplus-importer"] ??= {};
  src.flags[MODULE_ID].wallOfIceForm = String(form);
  src.flags["encounterplus-importer"].wallOfIceForm = String(form);

  const actsObj = src.system?.activities ?? {};
  const baseId = Object.keys(actsObj)[0] ?? null;
  if (!baseId || !actsObj[baseId]) return null;
  const act = actsObj[baseId];
  const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
  const isMetric = units === "m";
  const lineLength = isMetric ? 30 : 100;
  const wallWidth = isMetric ? 1.5 : 5;
  const sphereRadius = isMetric ? 3 : 10;
  const isSphere = String(form) === "sphere";
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");

  act.name = isSphere ? (fr ? "Lancer (sphère)" : "Cast (sphere)") : (fr ? "Lancer (ligne)" : "Cast (line)");
  act.flags ??= {};
  act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), kind: isSphere ? "wall-of-ice-sphere" : "wall-of-ice-line", wallOfIceForm: String(form) };
  act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), kind: isSphere ? "wall-of-ice-sphere" : "wall-of-ice-line", wallOfIceForm: String(form) };
  act.target ??= { template: {}, affects: {}, prompt: true, override: true };
  act.target.template ??= {};
  act.target.affects = { count: "", type: "", choice: false, special: "" };
  act.target.template.type = isSphere ? "sphere" : "line";
  act.target.template.size = String(isSphere ? sphereRadius : lineLength);
  act.target.template.width = isSphere ? "" : String(wallWidth);
  act.target.template.height = "";
  act.target.template.units = units;
  act.target.prompt = true;
  act.target.override = true;

  await item.update({
    "system.activities": actsObj,
    [`flags.${MODULE_ID}.wallOfIceForm`]: String(form),
    "flags.encounterplus-importer.wallOfIceForm": String(form)
  });
  return epiGetWallOfIceBaseActivity(item);
}

function epiIsPrismaticWallItem(item) {
  const slug = String(item?.flags?.[MODULE_ID]?.slug ?? item?.flags?.["encounterplus-importer"]?.slug ?? item?.system?.identifier ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  return slug === "mur-prismatique" || slug === "prismatic-wall" || /mur\s+prismatique|prismatic\s+wall/i.test(name);
}

function epiGetPrismaticWallBaseActivity(item) {
  const acts = epiListActivities(item);
  return acts.find(a => String(a?.type ?? "").toLowerCase() === "utility") ?? acts[0] ?? null;
}

function epiPrismaticWallFormLabel(form) {
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const labels = fr ? { line: "Ligne", sphere: "Sphère" } : { line: "Line", sphere: "Sphere" };
  return labels[String(form)] ?? String(form);
}

async function epiPrismaticWallChoiceDialog(item) {
  const title = String(item?.name ?? "Mur prismatique");
  const content = `<p><strong>${title}</strong></p><p>Choisis la forme du mur.</p>`;
  const buttons = [
    { action: "line", label: epiPrismaticWallFormLabel("line"), default: true },
    { action: "sphere", label: epiPrismaticWallFormLabel("sphere") },
    { action: "cancel", label: "Annuler" }
  ];
  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      const result = await DialogV2.wait({ window: { title }, content, buttons, modal: true, rejectClose: false });
      if (["line","sphere"].includes(result)) return result;
      return null;
    }
  } catch (_e) {}
  try {
    return await new Promise(resolve => {
      new globalThis.Dialog({
        title, content,
        buttons: {
          line: { label: epiPrismaticWallFormLabel("line"), callback: () => resolve("line") },
          sphere: { label: epiPrismaticWallFormLabel("sphere"), callback: () => resolve("sphere") },
          cancel: { label: "Annuler", callback: () => resolve(null) }
        },
        default: "line",
        close: () => resolve(null)
      }).render(true);
    });
  } catch (_e) {}
  return "line";
}

async function epiSetPrismaticWallForm(item, form) {
  if (!item || !form) return null;
  const src = item.toObject();
  src.flags ??= {};
  src.flags[MODULE_ID] ??= {};
  src.flags["encounterplus-importer"] ??= {};
  src.flags[MODULE_ID].prismaticWallForm = String(form);
  src.flags["encounterplus-importer"].prismaticWallForm = String(form);

  const actsObj = src.system?.activities ?? {};
  const baseId = Object.keys(actsObj)[0] ?? null;
  if (!baseId || !actsObj[baseId]) return null;
  const act = actsObj[baseId];
  const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
  const isMetric = units === "m";
  const lineLength = isMetric ? 27 : 90;
  const wallWidth = isMetric ? 1.5 : 5;
  const sphereRadius = isMetric ? 4.5 : 15;
  const isSphere = String(form) === "sphere";
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");

  act.name = isSphere ? (fr ? "Lancer (sphère)" : "Cast (sphere)") : (fr ? "Lancer (ligne)" : "Cast (line)");
  act.flags ??= {};
  act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), kind: isSphere ? "prismatic-wall-sphere" : "prismatic-wall-line", prismaticWallForm: String(form) };
  act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), kind: isSphere ? "prismatic-wall-sphere" : "prismatic-wall-line", prismaticWallForm: String(form) };
  act.target ??= { template: {}, affects: {}, prompt: true, override: true };
  act.target.template ??= {};
  act.target.affects = { count: "", type: "", choice: false, special: "" };
  act.target.template.type = isSphere ? "sphere" : "line";
  act.target.template.size = String(isSphere ? sphereRadius : lineLength);
  act.target.template.width = isSphere ? "" : String(wallWidth);
  act.target.template.height = "";
  act.target.template.units = units;
  act.target.prompt = true;
  act.target.override = true;

  await item.update({
    "system.activities": actsObj,
    [`flags.${MODULE_ID}.prismaticWallForm`]: String(form),
    "flags.encounterplus-importer.prismaticWallForm": String(form)
  });
  return epiGetPrismaticWallBaseActivity(item);
}

function epiGetWallOfForceBaseActivity(item) {
  const acts = epiListActivities(item);
  return acts.find(a => String(a?.type ?? "").toLowerCase() === "utility") ?? acts[0] ?? null;
}

function epiWallOfForceFormLabel(form) {
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const labels = fr ? { line: "Ligne", sphere: "Sphère" } : { line: "Line", sphere: "Sphere" };
  return labels[String(form)] ?? String(form);
}

async function epiWallOfForceChoiceDialog(item) {
  const title = String(item?.name ?? "Mur de force");
  const content = `<p><strong>${title}</strong></p><p>Choisis la forme du mur.</p>`;
  const buttons = [
    { action: "line", label: epiWallOfForceFormLabel("line"), default: true },
    { action: "sphere", label: epiWallOfForceFormLabel("sphere") },
    { action: "cancel", label: "Annuler" }
  ];
  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      const result = await DialogV2.wait({ window: { title }, content, buttons, modal: true, rejectClose: false });
      if (["line","sphere"].includes(result)) return result;
      return null;
    }
  } catch (_e) {}

  try {
    return await new Promise(resolve => {
      new globalThis.Dialog({
        title, content,
        buttons: {
          line: { label: epiWallOfForceFormLabel("line"), callback: () => resolve("line") },
          sphere: { label: epiWallOfForceFormLabel("sphere"), callback: () => resolve("sphere") },
          cancel: { label: "Annuler", callback: () => resolve(null) }
        },
        default: "line",
        close: () => resolve(null)
      }).render(true);
    });
  } catch (_e) {}
  return "line";
}

async function epiSetWallOfForceForm(item, form) {
  if (!item || !form) return null;
  const src = item.toObject();
  src.flags ??= {};
  src.flags[MODULE_ID] ??= {};
  src.flags["encounterplus-importer"] ??= {};
  src.flags[MODULE_ID].wallOfForceForm = String(form);
  src.flags["encounterplus-importer"].wallOfForceForm = String(form);

  const actsObj = src.system?.activities ?? {};
  const baseId = Object.keys(actsObj)[0] ?? null;
  if (!baseId || !actsObj[baseId]) return null;

  const act = actsObj[baseId];
  const units = String(act?.target?.template?.units ?? act?.range?.units ?? "ft").toLowerCase() === "m" ? "m" : "ft";
  const isMetric = units === "m";
  const lineLength = isMetric ? 30 : 100;
  const wallWidth = isMetric ? 1.5 : 5;
  const sphereRadius = isMetric ? 3 : 10;
  const fr = String(game.i18n?.lang ?? "en").toLowerCase().startsWith("fr");
  const isSphere = String(form) === "sphere";

  act.name = isSphere ? (fr ? "Lancer (sphère)" : "Cast (sphere)") : (fr ? "Lancer (ligne)" : "Cast (line)");
  act.flags ??= {};
  act.flags[MODULE_ID] = { ...(act.flags?.[MODULE_ID] ?? {}), kind: isSphere ? "wall-of-force-sphere" : "wall-of-force-line", wallOfForceForm: String(form) };
  act.flags["encounterplus-importer"] = { ...(act.flags?.["encounterplus-importer"] ?? {}), kind: isSphere ? "wall-of-force-sphere" : "wall-of-force-line", wallOfForceForm: String(form) };
  act.target ??= { template: {}, affects: {}, prompt: true, override: true };
  act.target.template ??= {};
  act.target.affects = { count: "", type: "", choice: false, special: "" };
  act.target.template.type = isSphere ? "sphere" : "line";
  act.target.template.size = String(isSphere ? sphereRadius : lineLength);
  act.target.template.width = isSphere ? "" : String(wallWidth);
  act.target.template.height = "";
  act.target.template.units = units;
  act.target.prompt = true;
  act.target.override = true;

  await item.update({
    "system.activities": actsObj,
    [`flags.${MODULE_ID}.wallOfForceForm`]: String(form),
    "flags.encounterplus-importer.wallOfForceForm": String(form)
  });
  return epiGetWallOfForceBaseActivity(item);
}

// ---------------------------------------------------------------------------
// Multi-activity spell chooser (generic)
// ---------------------------------------------------------------------------

function epiListActivities(item) {
  const acts = item?.system?.activities ?? null;
  let list = [];
  try {
    if (Array.isArray(acts)) list = acts;
    else if (acts?.contents && Array.isArray(acts.contents)) list = acts.contents;
    else if (typeof acts?.values === "function") list = Array.from(acts.values());
    else if (acts && typeof acts === "object") list = Object.values(acts);
  } catch (_e) { list = []; }
  return (Array.isArray(list) ? list : []).filter(a => a && (a._id || a.id));
}

function epiGetActivityById(item, id) {
  const acts = item?.system?.activities ?? null;
  const sid = String(id ?? "");
  if (!sid) return null;

  try {
    if (acts?.get) return acts.get(sid);
  } catch (_e) {}

  // Object keyed by id
  try {
    if (acts && typeof acts === "object" && acts[sid]) return acts[sid];
  } catch (_e) {}

  // Fallback scan
  try {
    if (acts && typeof acts === "object") {
      const ent = Object.entries(acts).find(([k, a]) => String(a?._id ?? a?.id ?? k) === sid);
      if (ent) return ent[1];
    }
  } catch (_e) {}

  const list = epiListActivities(item);
  return list.find(a => String(a?._id ?? a?.id ?? "") === sid) ?? null;
}

function epiActivityConsumesSpellSlot(act) {
  const c = act?.consumption ?? act?.system?.consumption ?? act?.data?.consumption ?? null;
  // dnd5e activities (legacy object) use "consumption.spellSlot"
  if (c && typeof c === "object" && "spellSlot" in c) return !!c.spellSlot;
  // Default: if spellSlot is not explicitly present, assume it DOES consume a slot.
  // This makes the chooser robust across sheets that omit/normalize the consumption object.
  return true;
}

function epiIsAutomationOnlyActivity(act) {
  if (!act) return false;
  const midi = act?.midiProperties ?? act?.system?.midiProperties ?? {};
  if (midi?.automationOnly === true) return true;
  const f = act?.flags?.[MODULE_ID] ?? act?.flags?.["encounterplus-importer"] ?? {};
  return f?.kind === "multi-attack-extra" || f?.kind === "multi-attack-focus";
}

function epiShouldPromptActivityChoice(item) {
  if (!item || item.type !== "spell") return false;

  // If importer explicitly marked it, trust the flag.
  const epi = item?.flags?.[MODULE_ID] ?? item?.flags?.["encounterplus-importer"] ?? {};
  if (epi?.forceActivityChooser) return true;
  if (epi?.beamCantrip?.enabled) return false;

  const list = epiListActivities(item);
  const visible = list.filter(a => !epiIsAutomationOnlyActivity(a));
  // Do NOT rely on canUse here: some sheets mark follow-up activities as "not usable"
  // until the parent effect/region exists, which would incorrectly bypass the chooser.
  if ((visible?.length ?? 0) < 2) return false;

  const hasCast = visible.some(a => epiActivityConsumesSpellSlot(a));
  const hasFollow = visible.some(a => !epiActivityConsumesSpellSlot(a));
  return hasCast && hasFollow;
}

function epiGetRepeatChoiceActivityIds(item) {
  const epi = item?.flags?.[MODULE_ID] ?? item?.flags?.["encounterplus-importer"] ?? {};
  const ids = epi?.repeatActivityIds ?? null;
  const meta = epi?.repeatActivityMeta ?? {};

  // Extract activities (Collection/Map/array/object).
  const acts = item?.system?.activities ?? null;
  let list = [];
  try {
    if (Array.isArray(acts)) list = acts;
    else if (acts?.contents && Array.isArray(acts.contents)) list = acts.contents;
    else if (typeof acts?.values === "function") list = Array.from(acts.values());
    else if (acts && typeof acts === "object") list = Object.values(acts);
  } catch (e) { list = []; }
  list = (Array.isArray(list) ? list : []).filter(a => a && typeof a === "object" && (a?._id || a?.id));

  if (ids?.cast && ids?.follow) {
    return { castId: String(ids.cast), followId: String(ids.follow), needsConcentration: !!meta?.needsConcentration };
  }

  // Fallback inference: follow-up is the activity that does NOT consume a spell slot.
  const getSlot = (a) => (a?.consumption?.spellSlot ?? a?.system?.consumption?.spellSlot);
  const castAct = list.find(a => (getSlot(a) ?? true) !== false);
  const followAct = list.find(a => getSlot(a) === false);
  const castId = castAct?._id ?? castAct?.id ?? null;
  const followId = followAct?._id ?? followAct?.id ?? null;
  if (!castId || !followId) return null;

  // Best-effort: needs concentration if the item (cast) is a concentration spell.
  const needsConcentration = !!item?.system?.duration?.concentration;
  return { castId: String(castId), followId: String(followId), needsConcentration };
}

function epiActorIsConcentrating(actor) {
  try {
    return !!actor?.effects?.some(e => e?.statuses?.has?.("concentrating") || /concentration/i.test(String(e?.name ?? "")));
  } catch (e) {
    return false;
  }
}

async function epiRunRepeatFollowUp(item, followDoc, meta = {}) {
  const actor = item?.actor ?? null;
  if (meta?.needsConcentration && actor && !epiActorIsConcentrating(actor)) {
    ui?.notifications?.warn?.("Tu n'es pas en concentration : action impossible (sort non actif).");
    return null;
  }

  const usage = {
    consume: { spellSlot: false, resources: false },
    scaling: false,
    __epiRepeatChoiceDone: true,
    midiOptions: {
      fastForward: true,
      workflowOptions: { noConcentrationCheck: true }
    }
  };
  const dialog = { configure: false, options: { display: { all: false } } };
  const message = { create: true };

  try {
    const midiOk = !!game?.modules?.get?.("midi-qol")?.active && !!globalThis?.MidiQOL?.completeActivityUse;
    if (midiOk) return await globalThis.MidiQOL.completeActivityUse(followDoc, usage, dialog, message);
  } catch (e) { /* ignore fallback */ }

  try {
    if (followDoc?.use) return await followDoc.use(usage, dialog, message);
  } catch (e) {}

  return await followDoc?.use?.({ __epiRepeatChoiceDone: true });
}


// Helper: run an Activity via Midi-QOL when available (prevents consuming a spell slot on follow-up activities)
async function epiUseActivityViaMidi(activityDoc, usage = {}, dialog = {}, message = {}) {
  try {
    const midiOk = !!game?.modules?.get?.("midi-qol")?.active && !!globalThis?.MidiQOL?.completeActivityUse;
    if (midiOk) {
      const ref = (typeof activityDoc === "string")
        ? activityDoc
        : String(activityDoc?.uuid ?? activityDoc?.document?.uuid ?? "");
      // Prefer UUID string if we have one.
      if (ref) return await globalThis.MidiQOL.completeActivityUse(ref, usage, dialog, message);
      return await globalThis.MidiQOL.completeActivityUse(activityDoc, usage, dialog, message);
    }
  } catch (_e) { /* ignore */ }

  // Fallback to system activity usage
  try {
    if (activityDoc?.use) return await activityDoc.use(usage, dialog, message);
  } catch (_e) {}
  return await activityDoc?.use?.(usage);
}



function epiGetBeamCantripMeta(item) {
  const epi = item?.flags?.[MODULE_ID] ?? item?.flags?.["encounterplus-importer"] ?? {};
  const meta0 = epi?.beamCantrip ?? null;
  if (meta0?.enabled) {
    return {
      enabled: true,
      slug: String(meta0.slug ?? ""),
      baseActivityId: String(meta0.baseActivityId ?? meta0.castActivityId ?? ""),
      extraActivityId: String(meta0.extraActivityId ?? meta0.followActivityId ?? ""),
      thresholds: Array.isArray(meta0.thresholds) && meta0.thresholds.length ? meta0.thresholds : [1, 5, 11, 17]
    };
  }

  const name = String(item?.name ?? "").toLowerCase();
  if (!/d[ée]charge\s+occulte|eldritch\s+blast/i.test(name)) return null;

  const acts = epiListActivities(item);
  const extra = acts.find(a => {
    const f = a?.flags?.[MODULE_ID] ?? a?.flags?.["encounterplus-importer"] ?? {};
    return f?.kind === "multi-attack-extra";
  }) ?? null;
  const base = acts.find(a => String(a?._id ?? a?.id ?? "") !== String(extra?._id ?? extra?.id ?? "")) ?? acts[0] ?? null;
  if (!base || !extra) return null;

  return {
    enabled: true,
    slug: "decharge-occulte",
    baseActivityId: String(base?._id ?? base?.id ?? ""),
    extraActivityId: String(extra?._id ?? extra?.id ?? ""),
    thresholds: [1, 5, 11, 17]
  };
}

function epiGetMultiAttackMeta(item) {
  const epi = item?.flags?.[MODULE_ID] ?? item?.flags?.["encounterplus-importer"] ?? {};
  const meta0 = epi?.multiAttackChain ?? null;
  if (meta0?.enabled) {
    return {
      enabled: true,
      slug: String(meta0.slug ?? ""),
      baseActivityId: String(meta0.baseActivityId ?? meta0.castActivityId ?? ""),
      extraActivityId: String(meta0.extraActivityId ?? meta0.followActivityId ?? ""),
      fixedCount: Math.max(1, Number(meta0.fixedCount ?? 1) || 1),
      countMode: String(meta0.countMode ?? (Array.isArray(meta0.thresholds) && meta0.thresholds.length ? "cantrip-thresholds" : "fixed")),
      thresholds: Array.isArray(meta0.thresholds) && meta0.thresholds.length ? meta0.thresholds.map(n => Number(n) || 0) : [1, 5, 11, 17],
      slotScaling: meta0?.slotScaling ? {
        baseLevel: Number(meta0?.slotScaling?.baseLevel ?? item?.system?.level ?? 0) || 0,
        perLevel: Number(meta0?.slotScaling?.perLevel ?? 0) || 0,
        countOnly: !!meta0?.slotScaling?.countOnly
      } : null,
      promptLabel: String(meta0.promptLabel ?? "rayon")
    };
  }

  const beam = epiGetBeamCantripMeta(item);
  if (beam?.enabled) {
    return {
      enabled: true,
      slug: String(beam.slug ?? ""),
      baseActivityId: String(beam.baseActivityId ?? ""),
      extraActivityId: String(beam.extraActivityId ?? ""),
      fixedCount: 1,
      countMode: "cantrip-thresholds",
      thresholds: Array.isArray(beam.thresholds) && beam.thresholds.length ? beam.thresholds.map(n => Number(n) || 0) : [1, 5, 11, 17],
      slotScaling: null,
      promptLabel: "rayon"
    };
  }

  // Legacy fallback: older imports may have created the extra activity but missed multiAttackChain flags.
  // Infer a conservative fixed chain for known multi-hit spells.
  try {
    const name = String(item?.name ?? "").toLowerCase();
    const acts = epiListActivities(item);
    const extra = acts.find(a => {
      const f = a?.flags?.[MODULE_ID] ?? a?.flags?.["encounterplus-importer"] ?? {};
      return f?.kind === "multi-attack-extra";
    }) ?? null;
    const base = acts.find(a => String(a?._id ?? a?.id ?? "") !== String(extra?._id ?? extra?.id ?? "")) ?? acts[0] ?? null;
    if (!base || !extra) return null;

    if (/rayon\s+ardent|scorching\s+ray/i.test(name)) {
      return {
        enabled: true,
        slug: "rayon-ardent",
        baseActivityId: String(base?._id ?? base?.id ?? ""),
        extraActivityId: String(extra?._id ?? extra?.id ?? ""),
        fixedCount: 3,
        countMode: "fixed",
        thresholds: [],
        slotScaling: {
          baseLevel: Math.max(2, Number(item?.system?.level ?? 2) || 2),
          perLevel: 1,
          countOnly: true
        },
        promptLabel: "rayon"
      };
    }

    if (/projectile\s+magique|magic\s+missile/i.test(name)) {
      return {
        enabled: true,
        slug: "projectile-magique",
        baseActivityId: String(base?._id ?? base?.id ?? ""),
        extraActivityId: String(extra?._id ?? extra?.id ?? ""),
        fixedCount: 3,
        countMode: "fixed",
        thresholds: [],
        slotScaling: {
          baseLevel: Math.max(1, Number(item?.system?.level ?? 1) || 1),
          perLevel: 1,
          countOnly: true
        },
        promptLabel: "projectile"
      };
    }
  } catch (_e) { /* ignore */ }

  return null;
}

function epiParseFractionishNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value ?? "").trim();
  if (!s) return 0;
  if (/^\d+\s*\/\s*\d+$/.test(s)) {
    const [a, b] = s.split("/").map(n => Number(n));
    return b ? (a / b) : 0;
  }
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function epiGetActorCantripScaleLevel(actor) {
  let lvl = 0;
  try {
    const direct = Number(actor?.system?.details?.level ?? 0) || 0;
    if (direct > lvl) lvl = direct;
  } catch (_e) {}

  try {
    const classes = actor?.classes ?? actor?.system?.classes ?? null;
    if (classes) {
      let sum = 0;
      const vals = (typeof classes?.values === "function") ? Array.from(classes.values()) : Object.values(classes);
      for (const cls of (Array.isArray(vals) ? vals : [])) {
        sum += Number(cls?.system?.levels ?? cls?.levels ?? 0) || 0;
      }
      if (sum > lvl) lvl = sum;
    }
  } catch (_e) {}

  try {
    const cr = epiParseFractionishNumber(actor?.system?.details?.cr ?? 0);
    if (cr > lvl) lvl = cr;
  } catch (_e) {}

  return Math.max(0, Math.floor(Number(lvl) || 0));
}

function epiGetBeamCantripCount(actor, meta = {}) {
  const thresholds = Array.isArray(meta?.thresholds) && meta.thresholds.length ? meta.thresholds.map(n => Number(n) || 0) : [1, 5, 11, 17];
  const lvl = epiGetActorCantripScaleLevel(actor);
  let count = 1;
  if (lvl >= (thresholds[1] ?? 5)) count = 2;
  if (lvl >= (thresholds[2] ?? 11)) count = 3;
  if (lvl >= (thresholds[3] ?? 17)) count = 4;
  return Math.max(1, count);
}

function epiGetCastLevelFromUsage(item, usage = {}, result = null) {
  const baseLevel = Number(item?.system?.level ?? 0) || 0;

  const parseSlot = (slotLike) => {
    const s = String(slotLike ?? "").toLowerCase().trim();
    if (!s) return undefined;
    if (/^spell\d+$/.test(s)) return Number(s.replace("spell", ""));
    // Some systems/workflows may expose plain numeric slot strings.
    if (/^\d+$/.test(s)) return Number(s);
    return undefined;
  };

  const raw = Number(
    usage?.spellLevel ??
    usage?.castLevel ??
    usage?.__epiDetectedSlotLevel ??
    usage?.level ??
    usage?.slotLevel ??
    usage?.spell?.level ??
    usage?.spell?.castLevel ??
    parseSlot(usage?.spell?.slot) ??
    usage?.midiOptions?.workflowOptions?.castLevel ??
    result?.castData?.castLevel ??
    result?.castData?.slotLevel ??
    result?.castData?.baseLevel ??
    result?.castLevel ??
    result?.workflow?.castData?.castLevel ??
    result?.workflow?.castData?.slotLevel ??
    result?.workflow?.castData?.baseLevel ??
    result?.workflow?.workflowOptions?.castLevel ??
    result?.workflow?.options?.castLevel ??
    result?.workflow?.options?.spellLevel ??
    result?.workflow?.spellLevel ??
    result?.workflow?.itemLevel ??
    result?.workflowOptions?.castLevel ??
    result?.options?.castLevel ??
    result?.options?.spellLevel ??
    parseSlot(result?.options?.spell?.slot) ??
    result?.spellLevel ??
    result?.itemLevel ??
    baseLevel
  ) || baseLevel;

  return Math.max(baseLevel, raw);
}

function epiGetMultiAttackCount(item, usage = {}, meta = null, result = null) {
  if (!meta?.enabled) return 1;
  let count = Math.max(1, Number(meta?.fixedCount ?? 1) || 1);
  if (String(meta?.countMode ?? "") === "cantrip-thresholds") {
    count = epiGetBeamCantripCount(item?.actor ?? null, meta);
  }
  const slotScaling = meta?.slotScaling ?? null;
  if (slotScaling?.perLevel) {
    const castLevel = epiGetCastLevelFromUsage(item, usage, result);
    const baseLevel = Number(slotScaling?.baseLevel ?? item?.system?.level ?? 0) || 0;
    if (castLevel > baseLevel) count += (castLevel - baseLevel) * (Number(slotScaling?.perLevel ?? 0) || 0);
  }
  return Math.max(1, Math.floor(Number(count) || 1));
}

async function epiPromptNextBeam(item, shotIndex, totalShots, meta = null) {
  const title = String(item?.name ?? "Décharge occulte");
  const label = String(meta?.promptLabel ?? "rayon");
  const content = `<p><strong>${title}</strong> — ${label} ${shotIndex}/${totalShots}</p><p>Tu peux changer de cible avant de continuer.</p>`;

  try {
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
    if (DialogV2?.confirm) {
      return await DialogV2.confirm({
        window: { title },
        content,
        modal: false,
        rejectClose: false,
        yes: { label: "Continuer" },
        no: { label: "Arrêter" }
      });
    }
  } catch (_e) {}

  try {
    if (globalThis?.Dialog?.confirm) {
      return await new Promise(resolve => {
        globalThis.Dialog.confirm({
          title,
          content,
          yes: () => resolve(true),
          no: () => resolve(false),
          defaultYes: true,
          close: () => resolve(false)
        });
      });
    }
  } catch (_e) {}

  return true;
}



// ---------------------------------------------------------------------------
// Storm Sphere: UNIVERSAL click interceptor
// Disabled: we now rely on the system ActivityChoiceDialog via the Item.use wrapper (stable with Tidy5e/Midi-QOL).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Storm Sphere: Item.use wrapper (SpellBook / custom sheets compatibility)
// Some sheets call item.use with a pre-selected activity (often the bonus-action bolt).
// Wrapping Item.use is the most reliable way to force an activity chooser while still letting Midi-QOL run.
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  try {
    if (globalThis.__epiStormSphereItemUseWrapperInstalled) return;
    globalThis.__epiStormSphereItemUseWrapperInstalled = true;

    const lw = globalThis.libWrapper ?? null;
    const hasLW = !!game?.modules?.get?.("lib-wrapper")?.active && !!lw?.register;
    if (!hasLW) {
      console.warn(`[${MODULE_ID}] Storm Sphere Item.use wrapper skipped (libWrapper not active).`);
      return;
    }

    // IMPORTANT: use MIXED because in some branches (bonus-action bolt) we intentionally
    // do NOT call the next wrapper (we route directly to MidiQOL.completeActivityUse).
    // Using WRAPPER would violate libWrapper's chaining requirement and cause the wrapper
    // to be auto-unregistered.
    lw.register(MODULE_ID, "CONFIG.Item.documentClass.prototype.use", async function (wrapped, ...args) {
  try {
    const item = this;
    try {
      const slugDbg = __epiLot1BuffSlugFromItem(item);
      if (__EPI_LOT1_BUFF_DEBUG_SLUGS.has(slugDbg)) {
        console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} hardproof Item.use path reached`, {
          slug: slugDbg,
          item: item?.name ?? "",
          actor: item?.parent?.name ?? item?.actor?.name ?? ""
        });
      }
    } catch (_e) {}

// args[0] is usually the "usage" options object; preserve the rest (dialog/message) when present.
    const opts0 = (args.length && args[0] && typeof args[0] === "object") ? args[0] : {};
    const ev = opts0?.event ?? (args.find(a => a?.event)?.event ?? null);
    const __epiMaybeApplyWrapperBuff = async (res) => {
      await __epiApplyLot1BuffViaWrapper(item, opts0, res);
      return res;
    };

    const bypass = !!ev?.shiftKey
      || !!opts0.__epiBypassActivityChooser
      || !!opts0.__epiActivityChoiceDone;

    if (bypass) return await __epiMaybeApplyWrapperBuff(await wrapped(...args));

    const explicitActivityId = String(opts0?.activityId ?? opts0?.activity?._id ?? opts0?.activity?.id ?? "");

    // Wall of Fire: keep a single SAVE activity and retarget/relabel it right before use.
    // This avoids dnd5e bundling multiple SAVE activities into the same card and rolling damage twice.
    if (!explicitActivityId && epiIsWallOfFireItem(item)) {
      const baseDoc = epiGetWallOfFireBaseActivity(item);
      if (baseDoc) {
        const choice = await epiWallOfFireChoiceDialog(item);
        if (!choice) return null;
        const updatedBase = await epiSetWallOfFireVariant(item, choice);
        const targetDoc = updatedBase ?? epiGetWallOfFireBaseActivity(item) ?? baseDoc;
        const usage = foundry.utils.mergeObject(opts0, {
          __epiActivityChoiceDone: true,
          __epiBypassActivityChooser: true,
          activityId: String(targetDoc?._id ?? targetDoc?.id ?? ""),
          activity: targetDoc ?? String(targetDoc?._id ?? targetDoc?.id ?? "")
        }, { inplace: false });

        // Prefer using the activity document directly so dnd5e opens the normal template targeting flow.
        // Routing through Item.use(activityId=...) can skip the gabarit placement on some SAVE/template spells.
        try {
          if (targetDoc?.use) return await targetDoc.use(usage, args[1] ?? {}, args[2] ?? {});
        } catch (e) {
          console.warn(`[${MODULE_ID}] Wall of Fire direct activity.use failed, falling back to Item.use`, e);
        }

        const nextArgs = [usage, ...args.slice(1)];
        return await wrapped(...nextArgs);
      }
    }

    // Wall of Thorns: same issue as Wall of Fire on dnd5e item cards —
    // multiple visible SAVE activities produce duplicated damage sections.
    if (!explicitActivityId && epiIsWallOfThornsItem(item)) {
      const baseDoc = epiGetWallOfThornsBaseActivity(item);
      if (baseDoc) {
        const choice = await epiWallOfThornsChoiceDialog(item);
        if (!choice) return null;
        const updatedBase = await epiSetWallOfThornsForm(item, choice);
        const targetDoc = updatedBase ?? epiGetWallOfThornsBaseActivity(item) ?? baseDoc;
        const usage = foundry.utils.mergeObject(opts0, {
          __epiActivityChoiceDone: true,
          __epiBypassActivityChooser: true,
          activityId: String(targetDoc?._id ?? targetDoc?.id ?? ""),
          activity: targetDoc ?? String(targetDoc?._id ?? targetDoc?.id ?? "")
        }, { inplace: false });

        try {
          if (targetDoc?.use) return await targetDoc.use(usage, args[1] ?? {}, args[2] ?? {});
        } catch (e) {
          console.warn(`[${MODULE_ID}] Wall of Thorns direct activity.use failed, falling back to Item.use`, e);
        }

        const nextArgs = [usage, ...args.slice(1)];
        return await wrapped(...nextArgs);
      }
    }

    if (!explicitActivityId && epiIsWallOfForceItem(item)) {
      const baseDoc = epiGetWallOfForceBaseActivity(item);
      if (baseDoc) {
        const choice = await epiWallOfForceChoiceDialog(item);
        if (!choice) return null;
        const updatedBase = await epiSetWallOfForceForm(item, choice);
        const targetDoc = updatedBase ?? epiGetWallOfForceBaseActivity(item) ?? baseDoc;
        const usage = foundry.utils.mergeObject(opts0, {
          __epiActivityChoiceDone: true,
          __epiBypassActivityChooser: true,
          activityId: String(targetDoc?._id ?? targetDoc?.id ?? ""),
          activity: targetDoc ?? String(targetDoc?._id ?? targetDoc?.id ?? "")
        }, { inplace: false });

        try {
          if (targetDoc?.use) return await targetDoc.use(usage, args[1] ?? {}, args[2] ?? {});
        } catch (e) {
          console.warn(`[${MODULE_ID}] Wall of Force direct activity.use failed, falling back to Item.use`, e);
        }

        const nextArgs = [usage, ...args.slice(1)];
        return await wrapped(...nextArgs);
      }
    }

    if (!explicitActivityId && epiIsWallOfIceItem(item)) {
      const baseDoc = epiGetWallOfIceBaseActivity(item);
      if (baseDoc) {
        const choice = await epiWallOfIceChoiceDialog(item);
        if (!choice) return null;
        const updatedBase = await epiSetWallOfIceForm(item, choice);
        const targetDoc = updatedBase ?? epiGetWallOfIceBaseActivity(item) ?? baseDoc;
        const usage = foundry.utils.mergeObject(opts0, {
          __epiActivityChoiceDone: true,
          __epiBypassActivityChooser: true,
          activityId: String(targetDoc?._id ?? targetDoc?.id ?? ""),
          activity: targetDoc ?? String(targetDoc?._id ?? targetDoc?.id ?? "")
        }, { inplace: false });

        try {
          if (targetDoc?.use) return await targetDoc.use(usage, args[1] ?? {}, args[2] ?? {});
        } catch (e) {
          console.warn(`[${MODULE_ID}] Wall of Ice direct activity.use failed, falling back to Item.use`, e);
        }

        const nextArgs = [usage, ...args.slice(1)];
        return await wrapped(...nextArgs);
      }
    }

    if (!explicitActivityId && epiIsPrismaticWallItem(item)) {
      const baseDoc = epiGetPrismaticWallBaseActivity(item);
      if (baseDoc) {
        const choice = await epiPrismaticWallChoiceDialog(item);
        if (!choice) return null;
        const updatedBase = await epiSetPrismaticWallForm(item, choice);
        const targetDoc = updatedBase ?? epiGetPrismaticWallBaseActivity(item) ?? baseDoc;
        const usage = foundry.utils.mergeObject(opts0, {
          __epiActivityChoiceDone: true,
          __epiBypassActivityChooser: true,
          activityId: String(targetDoc?._id ?? targetDoc?.id ?? ""),
          activity: targetDoc ?? String(targetDoc?._id ?? targetDoc?.id ?? "")
        }, { inplace: false });

        try {
          if (targetDoc?.use) return await targetDoc.use(usage, args[1] ?? {}, args[2] ?? {});
        } catch (e) {
          console.warn(`[${MODULE_ID}] Prismatic Wall direct activity.use failed, falling back to Item.use`, e);
        }

        const nextArgs = [usage, ...args.slice(1)];
        return await wrapped(...nextArgs);
      }
    }

    const multiMeta = epiGetMultiAttackMeta(item);
    const multiBaseId = String(multiMeta?.baseActivityId ?? "");
    const shouldAutoMulti = !!(multiMeta?.enabled && (!explicitActivityId || explicitActivityId === multiBaseId));
    if (shouldAutoMulti) {
      const baseDoc = epiGetActivityById(item, multiMeta.baseActivityId);
      const extraDoc = epiGetActivityById(item, multiMeta.extraActivityId);
      if (baseDoc && extraDoc) {
        const baseUsage = foundry.utils.mergeObject(opts0, {
          __epiBypassActivityChooser: true,
          __epiActivityChoiceDone: true,
          activityId: String(baseDoc?._id ?? baseDoc?.id ?? ""),
          activity: baseDoc ?? String(baseDoc?._id ?? baseDoc?.id ?? "")
        }, { inplace: false });

        const countOnlySlotScaling = !!(
          Number(multiMeta?.slotScaling?.perLevel ?? 0) > 0
          && (
            !!multiMeta?.slotScaling?.countOnly
            || /rayon-ardent|scorching-ray|projectile-magique|magic-missile/i.test(String(multiMeta?.slug ?? ""))
            || /rayon\s+ardent|scorching\s+ray|projectile\s+magique|magic\s+missile/i.test(String(item?.name ?? ""))
          )
        );
        const isMultiShotDebugSpell = /rayon-ardent|scorching-ray|projectile-magique|magic-missile/i.test(String(multiMeta?.slug ?? ""))
          || /rayon\s+ardent|scorching\s+ray|projectile\s+magique|magic\s+missile/i.test(String(item?.name ?? ""));
        if (countOnlySlotScaling) {
          // IMPORTANT: do not mutate imported activity documents at cast-time.
          // Count-only behavior must be guaranteed by importer data and usage payload only.
        }

        if (isMultiShotDebugSpell) {
          try {
            const basePart = baseDoc?.damage?.parts?.[0] ?? null;
            const extraPart = extraDoc?.damage?.parts?.[0] ?? null;
            console.log('[EPI multi-shot debug] pre-cast', {
              item: item?.name,
              slug: multiMeta?.slug,
              countOnlySlotScaling,
              baseUsageScaling: baseUsage?.scaling,
              baseUsageConsumeScaling: baseUsage?.consume?.scaling,
              itemActionType: item?.system?.actionType,
              itemScaling: item?.system?.scaling,
              basePart,
              extraPart,
              baseConsumption: baseDoc?.consumption,
              extraConsumption: extraDoc?.consumption
            });
          } catch (_e) {}
        }

        const snapshotSpellSlots = (actor) => {
          const out = {};
          try {
            for (let lvl = 1; lvl <= 9; lvl += 1) {
              const key = `spell${lvl}`;
              out[key] = Number(actor?.system?.spells?.[key]?.value ?? 0) || 0;
            }
            out.pactValue = Number(actor?.system?.spells?.pact?.value ?? 0) || 0;
            out.pactLevel = Number(actor?.system?.spells?.pact?.level ?? 0) || 0;
          } catch (_e) {}
          return out;
        };

        const inferCastLevelFromSlotDelta = (before, after) => {
          try {
            for (let lvl = 9; lvl >= 1; lvl -= 1) {
              const key = `spell${lvl}`;
              const b = Number(before?.[key] ?? 0) || 0;
              const a = Number(after?.[key] ?? 0) || 0;
              // dnd5e tracks remaining slots in `.value`; spending a slot decreases it.
              if (a < b) return lvl;
            }
            const pactBefore = Number(before?.pactValue ?? 0) || 0;
            const pactAfter = Number(after?.pactValue ?? 0) || 0;
            const pactLevel = Number(after?.pactLevel ?? before?.pactLevel ?? 0) || 0;
            if (pactAfter < pactBefore && pactLevel > 0) return pactLevel;
          } catch (_e) {}
          return null;
        };

        const inferCastLevelFromArgs = (arr = [], minLevel = 1) => {
          const seen = new Set();
          const toNum = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };
          const walk = (obj, depth = 0) => {
            if (!obj || depth > 4) return null;
            if (typeof obj !== 'object') return null;
            if (seen.has(obj)) return null;
            seen.add(obj);

            const direct = [
              obj.castLevel, obj.spellLevel, obj.slotLevel, obj.level,
              obj?.spell?.castLevel, obj?.spell?.level, obj?.spell?.slot,
              obj?.castData?.castLevel, obj?.castData?.slotLevel,
              obj?.workflow?.castData?.castLevel, obj?.workflow?.castData?.slotLevel,
              obj?.workflowOptions?.castLevel, obj?.midiOptions?.workflowOptions?.castLevel
            ];
            for (const v of direct) {
              const n = toNum(v);
              if (n && n >= minLevel && n <= 9) return n;
              const s = String(v ?? '').toLowerCase();
              if (/^spell\d+$/.test(s)) {
                const sn = Number(s.replace('spell', ''));
                if (sn >= minLevel && sn <= 9) return sn;
              }
            }

            for (const val of Object.values(obj)) {
              const n = walk(val, depth + 1);
              if (n) return n;
            }
            return null;
          };
          for (const a of arr) {
            const n = walk(a, 0);
            if (n) return n;
          }
          return null;
        };

        const detectSpentSlotLevel = async (actor, before, attempts = 10, waitMs = 150) => {
          let latest = snapshotSpellSlots(actor);
          let lvl = inferCastLevelFromSlotDelta(before, latest);
          if (lvl) return lvl;

          for (let i = 0; i < attempts; i += 1) {
            try { await new Promise(resolve => setTimeout(resolve, waitMs)); } catch (_e) {}
            latest = snapshotSpellSlots(actor);
            lvl = inferCastLevelFromSlotDelta(before, latest);
            if (lvl) return lvl;
          }
          return null;
        };

        const promptCastLevelFallback = async (itemDoc, meta) => {
          try {
            const base = Math.max(1, Number(itemDoc?.system?.level ?? 1) || 1);
            const maxLvl = 9;
            const opts = [];
            for (let lvl = base; lvl <= maxLvl; lvl += 1) {
              opts.push(`<option value="${lvl}">${lvl}</option>`);
            }
            const content = `
              <form>
                <div class="form-group">
                  <label>Niveau d'emplacement utilisé</label>
                  <select id="epi-cast-level">${opts.join("")}</select>
                </div>
              </form>`;

            const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis?.foundry?.applications?.api?.DialogV2;
            if (DialogV2?.wait) {
              const val = await DialogV2.wait({
                window: { title: String(itemDoc?.name ?? 'Sort') },
                content,
                buttons: [
                  { action: 'ok', label: 'Valider', default: true, callback: (event, button, html) => Number(html?.querySelector?.('#epi-cast-level')?.value ?? base) || base },
                  { action: 'cancel', label: 'Annuler', callback: () => null }
                ],
                modal: true
              });
              if (Number.isFinite(Number(val)) && Number(val) >= base) return Number(val);
              return null;
            }

            if (globalThis?.Dialog) {
              const val = await new Promise(resolve => {
                new globalThis.Dialog({
                  title: String(itemDoc?.name ?? 'Sort'),
                  content,
                  buttons: {
                    ok: { label: 'Valider', callback: (html) => resolve(Number(html.find?.('#epi-cast-level')?.val?.() ?? base) || base) },
                    cancel: { label: 'Annuler', callback: () => resolve(null) }
                  },
                  default: 'ok',
                  close: () => resolve(null)
                }).render(true);
              });
              if (Number.isFinite(Number(val)) && Number(val) >= base) return Number(val);
            }
          } catch (_e) {}
          return null;
        };

        const beforeSlots = snapshotSpellSlots(item?.actor);
        const baseArgs = [baseUsage, ...args.slice(1)];
        const result = await wrapped(...baseArgs);
        if (isMultiShotDebugSpell) {
          try {
            const baseAfter = epiGetActivityById(item, multiMeta?.baseActivityId);
            const extraAfter = epiGetActivityById(item, multiMeta?.extraActivityId);
            console.log('[EPI multi-shot debug] post-base-cast', {
              item: item?.name,
              slug: multiMeta?.slug,
              resultCastData: result?.castData ?? result?.workflow?.castData ?? null,
              resultDamageTotal: result?.damageTotal ?? result?.workflow?.damageTotal ?? null,
              resultDamageRoll: String(result?.damageRoll ?? result?.workflow?.damageRoll ?? ''),
              basePartAfter: baseAfter?.damage?.parts?.[0] ?? null,
              extraPartAfter: extraAfter?.damage?.parts?.[0] ?? null
            });
          } catch (_e) {}
        }

        // Slot consumption can be applied asynchronously by dnd5e/Midi;
        // poll briefly so upcast-dependent multi-shot counts (e.g. Magic Missile) are correct.
        const inferredSlotLevel = await detectSpentSlotLevel(item?.actor, beforeSlots);
        if (inferredSlotLevel) baseUsage.__epiDetectedSlotLevel = inferredSlotLevel;

        // Fallback: some workflows never expose slot spend synchronously on actor data.
        // Try to recover an explicit cast/slot level from wrapper args/result payloads.
        if (!baseUsage.__epiDetectedSlotLevel) {
          const minLevel = Math.max(1, Number(item?.system?.level ?? 1) || 1);
          const fromArgs = inferCastLevelFromArgs([opts0, args[1], args[2], result], minLevel);
          if (fromArgs) baseUsage.__epiDetectedSlotLevel = fromArgs;
        }

        // Last-resort fallback: ask the user for the cast slot level when automatic detection failed.
        if (!baseUsage.__epiDetectedSlotLevel && (Number(multiMeta?.slotScaling?.perLevel ?? 0) > 0)) {
          const manual = await promptCastLevelFallback(item, multiMeta);
          if (manual) baseUsage.__epiDetectedSlotLevel = manual;
        }

        const multiCount = epiGetMultiAttackCount(item, baseUsage, multiMeta, result);
        for (let shotIndex = 2; shotIndex <= multiCount; shotIndex += 1) {
          const go = await epiPromptNextBeam(item, shotIndex, multiCount, multiMeta);
          if (!go) break;

          const extraUsage = foundry.utils.mergeObject(opts0, {
            __epiBypassActivityChooser: true,
            __epiActivityChoiceDone: true,
            consume: { spellSlot: false, resources: false },
            scaling: false,
            spellLevel: epiGetCastLevelFromUsage(item, baseUsage, result),
            castLevel: epiGetCastLevelFromUsage(item, baseUsage, result),
            spell: {
              slot: (() => {
                const lvl = epiGetCastLevelFromUsage(item, baseUsage, result);
                return lvl ? `spell${lvl}` : undefined;
              })()
            },
            midiOptions: {
              fastForward: true,
              workflowOptions: { noConcentrationCheck: true }
            }
          }, { inplace: false });
          const extraDialog = foundry.utils.mergeObject(args[1] ?? {}, { configure: false }, { inplace: false });
          await epiUseActivityViaMidi(extraDoc, extraUsage, extraDialog, args[2] ?? {});
        }

        return result;
      }
    }

    // Generic: prompt a dnd5e ActivityChoiceDialog when the spell has BOTH:
    // - at least one activity that consumes a spell slot (cast)
    // - at least one activity that does NOT consume a spell slot (repeat/follow-up)
    if (!epiShouldPromptActivityChoice(item)) return await __epiMaybeApplyWrapperBuff(await wrapped(...args));


    // If there isn't more than one usable activity, don't prompt.
    try {
      const acts = item?.system?.activities ?? null;
      const list = (acts?.filter ? acts : (acts?.contents ?? (typeof acts?.values === "function" ? Array.from(acts.values()) : Object.values(acts ?? {}))));
      const usable = (Array.isArray(list) ? list : []).filter(a => a?.canUse && !epiIsAutomationOnlyActivity(a));
      if ((usable?.length ?? 0) < 2) return await wrapped(...args);
    } catch (e) { /* ignore */ }

    const choiceId = await epiStormSphereChoiceDialog(item);
    if (!choiceId) return await __epiMaybeApplyWrapperBuff(await wrapped(...args));

    
    // Run the chosen activity.
    const chosenDoc = epiGetActivityById(item, choiceId);
    if (!chosenDoc) return await wrapped(...args);

    const usage0 = (args.length && args[0] && typeof args[0] === "object") ? args[0] : {};
    const usage = foundry.utils.mergeObject(usage0, { __epiActivityChoiceDone: true }, { inplace: false });

    // Follow-up activity: do NOT consume slot or re-prompt concentration; route through Midi if possible.
    if (!epiActivityConsumesSpellSlot(chosenDoc)) {
      return await epiUseActivityViaMidi(chosenDoc, usage, args[1] ?? {}, args[2] ?? {});
    }

    // Cast activity: run normally (slot + concentration).
    try {
      if (chosenDoc?.use) return await chosenDoc.use(usage, args[1] ?? {}, args[2] ?? {});
    } catch (e) { /* fallback below */ }

    const nextOpts = foundry.utils.mergeObject(usage, { __epiBypassActivityChooser: true }, { inplace: false });
    nextOpts.activityId = String(chosenDoc?._id ?? chosenDoc?.id ?? "");
    nextOpts.activity = chosenDoc ?? String(nextOpts.activityId);
    const nextArgs = [nextOpts, ...args.slice(1)];
    return await wrapped(...nextArgs);

  } catch (e) {
    console.warn(`[${MODULE_ID}] Item.use chooser wrapper failed`, e);
    return await wrapped(...args);
  }
}, "MIXED");

    console.log(`[${MODULE_ID}] Chooser installed (Item.use wrapper: Storm Sphere + repeat-use spells).`);

    // NOTE: We intentionally do NOT wrap Activity.use here.
    // Some dnd5e V13 builds and sheets don't expose a stable ActivityDocument prototype path early enough,
    // and attempting to wrap it triggers noisy libWrapper errors.
    // Item.use wrapping is sufficient in practice for our activity chooser.
  } catch (e) {
    console.warn(`[${MODULE_ID}] Storm Sphere Item.use wrapper install failed`, e);
  }
});


// ---------------------------------------------------------------------------
// On-hit secondary AoE (e.g. Ice Knife explosion around the hit target)
// ---------------------------------------------------------------------------

function epiTokenCenter(tok) {
  const tdoc = tok?.document ?? tok;
  const gs = Number(canvas?.grid?.size ?? 0) || 0;
  const w = (Number(tdoc?.width ?? 1) || 1) * gs;
  const h = (Number(tdoc?.height ?? 1) || 1) * gs;
  return { x: (Number(tdoc?.x ?? 0) || 0) + w / 2, y: (Number(tdoc?.y ?? 0) || 0) + h / 2 };
}

function epiMeasureDistance(a, b) {
  try {
    return canvas?.grid?.measureDistance?.(a, b) ?? Math.hypot((a.x - b.x), (a.y - b.y));
  } catch (_e) {
    return Math.hypot((a.x - b.x), (a.y - b.y));
  }
}

function epiUnitsToSceneDistance(value, units) {
  // scene distance units are usually ft in dnd5e; if metric is enabled, they might be m.
  const sceneUnits = String(canvas?.scene?.grid?.units ?? "ft").toLowerCase();
  const u = String(units ?? "ft").toLowerCase();
  const v = Number(value) || 0;
  if (!v) return 0;
  if (u === sceneUnits) return v;
  // convert ft <-> m
  if (u === "m" && sceneUnits === "ft") return v * 3.28084;
  if (u === "ft" && sceneUnits === "m") return v / 3.28084;
  return v;
}

function __epiResolveActorsFromUsageForLot1(opts0 = {}, item = null) {
  const out = [];
  const pushActor = (a) => { if (a && !out.includes(a)) out.push(a); };
  const pushTokenLike = (t) => { const a = t?.actor ?? t?.document?.actor ?? null; if (a) pushActor(a); };

  // Explicit usage targets (when available)
  const usageTargets = opts0?.targets ?? opts0?.targetUuids ?? opts0?.tokenUuids ?? null;
  if (usageTargets) {
    const arr = Array.isArray(usageTargets) ? usageTargets : (usageTargets instanceof Set ? Array.from(usageTargets) : [usageTargets]);
    for (const it of arr) {
      if (!it) continue;
      if (typeof it === "string") {
        const id = it.split(".").pop();
        const tok = canvas?.tokens?.get?.(id) ?? canvas?.scene?.tokens?.get?.(id)?.object ?? null;
        if (tok?.actor) pushActor(tok.actor);
      } else if (it?.actor || it?.document?.actor) {
        pushTokenLike(it);
      }
    }
  }

  // Fallback to current user targets at cast time.
  if (!out.length) {
    for (const t of Array.from(game.user?.targets ?? [])) pushTokenLike(t);
  }

  // Last fallback: the caster itself.
  if (!out.length) {
    const caster = item?.parent ?? item?.actor ?? null;
    if (caster?.documentName === "Actor") pushActor(caster);
  }

  return out;
}

async function __epiApplyLot1BuffViaWrapper(item, opts0 = {}, result = null) {
  try {
    const slug = __epiLot1BuffSlugFromItem(item);
    if (!(slug === "faveur-divine" || slug === "protection-contre-le-poison")) return;

    console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} wrapper apply path`, {
      slug,
      item: item?.name ?? "",
      hasResult: result !== undefined
    });

    const itemEffects = item?.effects ? Array.from(item.effects) : [];
    const src = itemEffects.find((e) => {
      const f = e?.flags?.[MODULE_ID] ?? e?.flags?.["encounterplus-importer"] ?? {};
      return !!f?.simpleLot1Buff && String(f?.slug ?? "").toLowerCase() === slug;
    });
    if (!src) {
      console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} wrapper AE error`, { slug, error: "no-item-effect-template" });
      return;
    }

    const caster = item?.parent ?? item?.actor ?? null;
    const targets = (slug === "faveur-divine")
      ? [caster].filter(a => a?.documentName === "Actor")
      : __epiResolveActorsFromUsageForLot1(opts0, item);

    for (const actor of targets) {
      const key = `${item.uuid}|${slug}|${src.name ?? ""}`;
      const exists = Array.from(actor?.effects ?? []).some((ae) => {
        const af = ae?.flags?.[MODULE_ID] ?? ae?.flags?.["encounterplus-importer"] ?? {};
        return String(af?.simpleLot1BuffKey ?? "") === key;
      });
      if (exists) continue;

      const data = src.toObject ? src.toObject() : foundry.utils.deepClone(src);
      delete data._id;
      data.origin = item.uuid;
      data.transfer = false;
      data.disabled = false;
      data.flags = data.flags ?? {};
      data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), simpleLot1BuffKey: key, slug };
      data.flags["encounterplus-importer"] = { ...(data.flags["encounterplus-importer"] ?? {}), simpleLot1Buff: true, simpleLot1BuffKey: key, slug };

      try {
        await actor.createEmbeddedDocuments("ActiveEffect", [data]);
        if (slug === "protection-contre-le-poison") {
          const poisoned = Array.from(actor.effects ?? []).filter((e) => {
            const s = e?.statuses;
            return s?.has?.("poisoned") || (Array.isArray(s) && s.includes("poisoned"));
          });
          if (poisoned.length) await actor.deleteEmbeddedDocuments("ActiveEffect", poisoned.map(e => e.id).filter(Boolean));
        }
        console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} wrapper AE success`, { slug, actor: actor?.name ?? "" });
      } catch (e) {
        console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} wrapper AE error`, { slug, actor: actor?.name ?? "", error: String(e) });
      }
    }
  } catch (e) {
    console.log(`${__EPI_LOT1_BUFF_DEBUG_PREFIX} wrapper AE error`, { error: String(e) });
  }
}

Hooks.once("ready", () => {
  const midiActive = !!game?.modules?.get?.("midi-qol")?.active;
  if (!midiActive) return;

  function inferOnHitAoeFromItem(item) {
    try {
      const desc = String(item?.system?.description?.value ?? "");
      const text = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

      const acts = Object.values(item?.system?.activities ?? {});
      const hasSaveAct = acts.some(a => a?.type === "save");
      const hasAtkAct = acts.some(a => a?.type === "attack");
      if (!hasSaveAct || !hasAtkAct) return null;

      let radius = null;
      let units = null;

      const fr = text.match(/rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|mètre|mètres)\s+de\s+la\s+cible/);
      if (fr) { radius = Number(fr[1].replace(",", ".")); units = "m"; }
      const en = text.match(/within\s*(\d+)\s*(feet|foot|ft)\s*of\s*the\s*target/);
      if (!radius && en) { radius = Number(en[1]); units = "ft"; }
      if (!radius) return null;

      const save = acts.find(a => a?.type === "save") ?? null;
      if (!save) return null;

      return {
        radius,
        units,
        saveActivityId: String(save?._id ?? save?.id ?? ""),
        includePrimaryTarget: false
      };
    } catch (_e) {
      return null;
    }
  }

  // Hotfix270: Ice Knife-like secondary AoE (burst on grid) without breaking Midi-QOL.
// We run this AFTER the main workflow completes, and only apply the secondary SAVE/Damage to EXTRA adjacent tokens.
function epiTokenRect(tok) {
  const gs = Number(canvas?.grid?.size ?? 1) || 1;
  const d = tok?.document ?? tok;
  return {
    col: Math.floor((Number(d?.x ?? 0) || 0) / gs),
    row: Math.floor((Number(d?.y ?? 0) || 0) / gs),
    w: Math.max(1, Number(d?.width ?? 1) || 1),
    h: Math.max(1, Number(d?.height ?? 1) || 1)
  };
}
function epiRectChebyshev(a, b) {
  const aMaxC = a.col + a.w - 1, aMaxR = a.row + a.h - 1;
  const bMaxC = b.col + b.w - 1, bMaxR = b.row + b.h - 1;
  const dx = Math.max(0, Math.max(a.col - bMaxC, b.col - aMaxC));
  const dy = Math.max(0, Math.max(a.row - bMaxR, b.row - aMaxR));
  return Math.max(dx, dy);
}
function epiTokensInGridBurst(centerTok, candidates, steps = 1) {
  const cRect = epiTokenRect(centerTok);
  return (candidates ?? []).filter(t => epiRectChebyshev(cRect, epiTokenRect(t)) <= steps);
}

// Hotfix270k: Ice Knife-like secondary AoE (burst on grid) without breaking Midi-QOL.
// We capture the primary target early (some Midi-QOL builds clear workflow.targets by RollComplete),
// then re-run the secondary SAVE/Damage activity on EXTRA adjacent tokens (3×3 grid burst).
const __epiOnHitAoeCache = (globalThis.__EPI_ON_HIT_AOE_CACHE ??= new Map());
const __epiOnHitAoeDone = (globalThis.__EPI_ON_HIT_AOE_DONE ??= new Map());

function epiNowMs() { return Date.now(); }
function epiWorkflowKey(wf) {
  return String(
    wf?.uuid ??
    wf?.id ??
    wf?.itemCardId ??
    wf?.item?.uuid ??
    wf?.item?.id ??
    ""
  );
}
function epiDoneKey(wf, primaryId) {
  const itemKey = String(wf?.item?.uuid ?? wf?.item?.id ?? "");
  // Midi-QOL can fire multiple completion hooks (RollComplete + DamageRollComplete) where some
  // identifiers may be missing in one callback. Prefer a stable workflow key to avoid reruns.
  const wfKey = String(
    wf?.uuid ??
    wf?.itemCardId ??
    wf?.sequenceId ??
    wf?.id ??
    ""
  );
  return `${itemKey}|${wfKey}|${primaryId}`;
}
function epiDoneRecently(key, windowMs = 3000) {
  const t = __epiOnHitAoeDone.get(key);
  if (!t) return false;
  if ((epiNowMs() - t) <= windowMs) return true;
  __epiOnHitAoeDone.delete(key);
  return false;
}
function epiMarkDone(key) {
  __epiOnHitAoeDone.set(key, epiNowMs());
  // lightweight cleanup
  for (const [k, t] of __epiOnHitAoeDone) {
    if ((epiNowMs() - t) > 60000) __epiOnHitAoeDone.delete(k);
  }
}

function epiHasOnHitAoeMeta(item) {
  const meta =
    item?.getFlag?.(MODULE_ID, "onHitAoe")
    ?? item?.getFlag?.("encounterplus-importer", "onHitAoe")
    ?? item?.flags?.[MODULE_ID]?.onHitAoe
    ?? item?.flags?.["encounterplus-importer"]?.onHitAoe;
  return !!(meta?.radius && meta?.saveActivityId);
}

function epiExtractPrimaryToken(workflow) {
  const pickFromSet = (s) => {
    try {
      const arr = Array.from(s ?? []);
      return arr[0] ?? null;
    } catch (_e) { return null; }
  };

  // Best sources first
  return (
    pickFromSet(workflow?.targets)
    ?? pickFromSet(workflow?.hitTargets)
    ?? null
  );
}

function epiCachePrimary(workflow) {
  try {
    const item = workflow?.item;
    if (!item || !epiHasOnHitAoeMeta(item)) return;

    const primary = epiExtractPrimaryToken(workflow);
    if (!primary) return;

    const k = epiWorkflowKey(workflow);
    if (!k) return;

    __epiOnHitAoeCache.set(k, {
      primaryId: String(primary?.id ?? primary?._id ?? ""),
      primaryUuid: String(primary?.document?.uuid ?? primary?.uuid ?? ""),
      ts: epiNowMs()
    });

    // cleanup old cache entries
    for (const [ck, v] of __epiOnHitAoeCache) {
      if ((epiNowMs() - (v?.ts ?? 0)) > 60000) __epiOnHitAoeCache.delete(ck);
    }
  } catch (_e) {}
}

function epiResolveTokenById(id) {
  const tid = String(id ?? "");
  if (!tid) return null;
  const list = canvas?.tokens?.placeables ?? [];
  return list.find(t => String(t?.id ?? t?.document?.id ?? "") === tid) ?? null;
}

async function epiSetUserTargets(tokenIds) {
  const ids = (tokenIds ?? []).map(String).filter(Boolean);
  const prev = Array.from(game.user?.targets ?? []).map(t => String(t?.id ?? t?.document?.id ?? "")).filter(Boolean);

  // Clear previous
  try {
    if (game.user?.updateTokenTargets) game.user.updateTokenTargets([]);
  } catch (_e) {}
  try {
    for (const t of canvas?.tokens?.placeables ?? []) {
      const tid = String(t?.id ?? "");
      if (prev.includes(tid)) {
        try { await t.setTarget(false, { user: game.user, releaseOthers: false }); } catch (_e) {}
      }
    }
  } catch (_e) {}

  // Set new
  try {
    if (game.user?.updateTokenTargets) game.user.updateTokenTargets(ids);
  } catch (_e) {}
  try {
    for (const id of ids) {
      const tok = epiResolveTokenById(id);
      if (!tok) continue;
      try { await tok.setTarget(true, { user: game.user, releaseOthers: false }); } catch (_e) {}
    }
  } catch (_e) {}

  // Let the target set propagate before calling Midi
  await new Promise(r => setTimeout(r, 0));
  return prev;
}

async function epiRestoreUserTargets(prevIds) {
  const ids = (prevIds ?? []).map(String).filter(Boolean);
  try {
    if (game.user?.updateTokenTargets) game.user.updateTokenTargets(ids);
  } catch (_e) {}
  try {
    // Best-effort ensure via setTarget
    // First clear all, then re-set
    for (const t of canvas?.tokens?.placeables ?? []) {
      try { await t.setTarget(false, { user: game.user, releaseOthers: false }); } catch (_e) {}
    }
    for (const id of ids) {
      const tok = epiResolveTokenById(id);
      if (!tok) continue;
      try { await tok.setTarget(true, { user: game.user, releaseOthers: false }); } catch (_e) {}
    }
  } catch (_e) {}
}

function inferOnHitAoeFromItemHotfix270k(item) {
  // Robust inference for Ice Knife-like spells:
  // - Radius parsed from description (FR/EN)
  // - SAVE activity resolved by key even if activities have no _id/id fields
  try {
    const desc = String(item?.system?.description?.value ?? "");
    const text = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    const acts = item?.system?.activities ?? null;

    // Build [key, activity] list across possible shapes
    let entries = [];
    try {
      if (acts?.entries && typeof acts.entries === "function") entries = Array.from(acts.entries());
      else if (acts?.contents && Array.isArray(acts.contents)) entries = acts.contents.map(a => [String(a?._id ?? a?.id ?? ""), a]);
      else if (typeof acts?.values === "function") {
        // Map-like values() without keys: synthesize ids from _id/id when possible
        entries = Array.from(acts.values()).map(a => [String(a?._id ?? a?.id ?? ""), a]);
      } else if (acts && typeof acts === "object") entries = Object.entries(acts);
    } catch (_e) { entries = []; }

    const isSaveAct = (a) => {
      const t = String(a?.type ?? a?.actionType ?? a?.activation?.type ?? "").toLowerCase();
      return t.includes("save") || !!(a?.save ?? a?.system?.save ?? a?.data?.save);
    };
    const isAttackAct = (a) => {
      const t = String(a?.type ?? a?.actionType ?? a?.activation?.type ?? "").toLowerCase();
      return t.includes("attack") || !!(a?.attack ?? a?.system?.attack ?? a?.data?.attack);
    };

    const saveEntry = entries.find(([, a]) => isSaveAct(a)) ?? null;
    const atkEntry  = entries.find(([, a]) => isAttackAct(a)) ?? null;

    // Ice Knife needs a SAVE activity; attack is strongly expected but we don't hard-require it
    if (!saveEntry) return null;

    let radius = null;
    let units = null;

    // FR: "dans un rayon de 1,50 mètre(s) de celle-ci / de la cible"
    let m =
      text.match(/rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|m[eè]tre|m[eè]tres|mètres)\s+(?:(?:autour\s+)?de\s+)?(?:la\s+cible|celle\s*-?\s*ci)/);
    if (m) { radius = Number(m[1].replace(",", ".")); units = "m"; }

    // FR alternative: "à 1,5 m de la cible / de celle-ci"
    if (!radius) {
      m = text.match(/\bà\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|m[eè]tre|m[eè]tres|mètres)\s+de\s+(?:la\s+cible|celle\s*-?\s*ci)\b/);
      if (m) { radius = Number(m[1].replace(",", ".")); units = "m"; }
    }

    // EN: "within 5 feet of the target / it"
    if (!radius) {
      m = text.match(/within\s*(\d+)\s*(feet|foot|ft)\s*of\s*(?:the\s*target|it)/);
      if (m) { radius = Number(m[1]); units = "ft"; }
    }
    if (!radius) return null;

    const [saveKey, saveAct] = saveEntry;
    const saveId = String(saveAct?._id ?? saveAct?.id ?? saveKey ?? "");
    if (!saveId) return null;

    return {
      radius,
      units,
      saveActivityId: saveId,
      includePrimaryTarget: true,
      __inferred: true,
      __hasAttack: !!atkEntry
    };
  } catch (_e) {
    return null;
  }
}

// Disable Midi-QOL "other activity" auto-selection for on-hit AoE spells (Ice Knife-like).
// Otherwise Midi-QOL will automatically pick the ONLY other compatible activity (the save activity)
// and roll it for the primary target only, which causes a double save when we later run the AoE follow-up.
function epiDisableOtherActivityForOnHitAoe(workflow) {
  try {
    if (!workflow?.item || !workflow?.activity) return;
    const actType = String(workflow.activity?.type ?? workflow.activity?.actionType ?? "").toLowerCase();
    if (!actType.includes('attack')) return;

    const item = workflow.item;

    let meta =
      item?.getFlag?.(MODULE_ID, "onHitAoe")
      ?? item?.getFlag?.("encounterplus-importer", "onHitAoe")
      ?? item?.flags?.[MODULE_ID]?.onHitAoe
      ?? item?.flags?.["encounterplus-importer"]?.onHitAoe;

    if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeFromItemHotfix270k(item);
    if (!meta?.radius || !meta?.saveActivityId) return;

    // Block Midi-QOL's auto-pick of the only other activity.
    // (AttackActivity.otherActivityId === "" triggers auto-pick when exactly one other compatible activity exists.)
    try {
      if (workflow.activity && ("otherActivityId" in workflow.activity)) workflow.activity.otherActivityId = "none";
    } catch (_e) {}
    try {
      if (workflow.activity && ("_otherActivity" in workflow.activity)) workflow.activity._otherActivity = null;
    } catch (_e) {}

    // Also mark the save activity as not compatible as an "other activity" (best-effort, runtime-only).
    try {
      const saveAct = epiGetActivityById(item, String(meta.saveActivityId));
      if (saveAct?.midiProperties) saveAct.midiProperties.otherActivityCompatible = false;
    } catch (_e) {}

  } catch (_e) {}
}

// Capture primary target as early as possible (works even if RollComplete has empty targets)
for (const ev of [
  "midi-qol.preItemRoll",
  "midi-qol.preTargeting",
  "midi-qol.preAttackRoll",
  "midi-qol.preCheckHits",
  "midi-qol.postCheckHits",
  "midi-qol.preDamageRoll",
  "midi-qol.postDamageRoll"
]) {
  Hooks.on(ev, (...args) => {
    const wf = args.find(a => a && typeof a === "object" && (a.item || a.itemUuid || a.itemId));
    if (wf) {
      epiCachePrimary(wf);
      epiDisableOtherActivityForOnHitAoe(wf);
    }
  });
}

async function epiRunOnHitAoeSecondary(workflow) {
  try {
    // Skip secondary workflows created by this feature to avoid recursion.
    if (!workflow) return;
    // Skip secondary workflows created by this feature to avoid recursion.
    // Midi-QOL stores flags in slightly different places depending on call path.
    if (
      workflow?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.options?.__epiSecondaryOnHitAoe ||
      workflow?.options?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.workflowOptions?.workflowOptions?.__epiSecondaryOnHitAoe
    ) return;

    // Any workflow created via MidiQOL.completeActivityUse() will have forceCompletion=true.
    // We use completeActivityUse() for the follow-up AoE activity; skip those workflows entirely
    // to prevent re-triggering on their RollComplete events (extra JdS/dégâts).
    if (
      workflow?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.forceCompletion === true
    ) return;

    const item = workflow?.item ?? null;
    if (!item) return;

    let meta =
      item?.getFlag?.(MODULE_ID, "onHitAoe")
      ?? item?.getFlag?.("encounterplus-importer", "onHitAoe")
      ?? item?.flags?.[MODULE_ID]?.onHitAoe
      ?? item?.flags?.["encounterplus-importer"]?.onHitAoe;

    if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeFromItemHotfix270k(item);
    if (!meta?.radius || !meta?.saveActivityId) {
      if (/couteau\s+de\s+glace|ice\s+knife/i.test(String(item?.name ?? ""))) {
        const acts = item?.system?.activities ?? {};
        const keys = (() => {
          try {
            return (acts?.entries && typeof acts.entries === "function")
              ? Array.from(acts.entries()).map(([k,a]) => ({k, type: a?.type}))
              : Object.entries(acts).map(([k,a]) => ({k, type: a?.type}));
          } catch (_e) { return []; }
        })();
        console.log(`[${MODULE_ID}] onHitAoe meta NOT inferred`, { item: item?.name, activityTypes: keys, descSample: String(item?.system?.description?.value ?? "").slice(0, 220) });
      }
      return;
    }

    // If this workflow IS already the secondary SAVE activity, do nothing
    // (prevents double application if user clicks it, or if hooks fire from the follow-up workflow).
    try {
      const wActId = String(
        workflow?.activity?.id ??
        workflow?.activity?._id ??
        workflow?.activity?.activity?.id ??
        workflow?.activityId ??
        workflow?.options?.activityId ??
        workflow?.options?.activity?.id ??
        workflow?.options?.activity?._id ??
        workflow?.options?.midiOptions?.activityId ??
        ""
      );
      if (wActId && wActId === String(meta.saveActivityId)) return;
    } catch (_e) {}

    // Resolve primary target (may be cleared by RollComplete)
    let primary = epiExtractPrimaryToken(workflow);
    if (!primary) {
      const k = epiWorkflowKey(workflow);
      const cached = k ? __epiOnHitAoeCache.get(k) : null;
      if (cached?.primaryId) primary = epiResolveTokenById(cached.primaryId);
    }
    if (!primary) return;

    const doneKey = epiDoneKey(workflow, String(primary.id ?? ""));
    if (epiDoneRecently(doneKey)) return;

    const gridDist = Number(canvas?.scene?.grid?.distance ?? 5) || 5;
    const rScene = epiUnitsToSceneDistance(meta.radius, meta.units);
    if (!rScene) return;

    const steps = Math.max(1, Math.round(rScene / gridDist)); // 1 for 5ft / 1.5m
    const tokens = (canvas?.tokens?.placeables ?? []).filter(t => t?.actor);
    let targets = epiTokensInGridBurst(primary, tokens, steps);

    if (!meta?.includePrimaryTarget) targets = targets.filter(t => String(t?.id ?? "") !== String(primary?.id ?? ""));
    if (!targets.length) return;

    const act = epiGetActivityById(item, String(meta.saveActivityId));
    // Prefer passing a UUID string to Midi-QOL (more robust than passing an Activity object which might be a plain data object).
    const actUuid =
      String(act?.uuid ?? act?.document?.uuid ?? "")
      || (item?.uuid ? `${item.uuid}.Activity.${String(meta.saveActivityId)}` : "");

    if (!actUuid) return;

    const targetUuids = targets
      .map(t => String(t?.document?.uuid ?? t?.uuid ?? ""))
      .filter(Boolean);
    // Debug: show resolved target UUIDs (useful for V13 token/document differences)
    // Note: use Scene Token UUIDs explicitly; some modules/contexts can yield token.document.uuid variants.
    console.debug(`[${MODULE_ID}] onHitAoeBuff hotfix271d targetUuids`, targetUuids);

    if (!targetUuids.length) return;

    // Debug (always visible in console logs)
    console.log(`[${MODULE_ID}] onHitAoe hotfix270r`, {
      item: item?.name,
      primary: primary?.name ?? primary?.id,
      targets: targets.map(t => t?.name ?? t?.id),
      radius: meta.radius,
      units: meta.units,
      steps
    });

    // Preserve upcast scaling when re-running the secondary save activity.
    const baseLevel = Number(item?.system?.level ?? 0) || 0;
    const castLevel = Number(
      workflow?.castData?.castLevel ??
      workflow?.spellLevel ??
      workflow?.itemLevel ??
      workflow?.workflowOptions?.castLevel ??
      workflow?.options?.spellLevel ??
      workflow?.options?.castLevel ??
      baseLevel
    ) || baseLevel;
    const scaling = Math.max(0, castLevel - baseLevel);

    const usage = {
      consume: { spellSlot: false },
      scaling,
      spell: { slot: castLevel ? `spell${castLevel}` : undefined },
      midiOptions: {
        targetUuids,
        // Secondary on-hit bursts (Ice Knife, etc.) are multi-target but may not be recognized as AoE by Midi-QOL.
        // Disable target-count enforcement for this follow-up activity to prevent workflow abortion.
        proceedChecks: { checkTargets: false },
        workflowOptions: {
          __epiSecondaryOnHitAoe: true,
          targetConfirmation: "none",
          // Avoid side-effects (reactions/confirm dialogs) on the follow-up AoE roll.
          noProvokeReaction: true,
          fastForward: true,
          fastForwardDamage: true
        }
      },
      __epiBypassActivityChooser: true,
      __epiActivityChoiceDone: true
    };
    const dialog = { configure: false, options: { display: { all: false } } };
    const message = { create: true };

    epiMarkDone(doneKey);

    // Run the secondary SAVE activity through Midi-QOL.
    await globalThis.MidiQOL.completeActivityUse(actUuid, usage, dialog, message);
  } catch (e) {
    console.warn(`[${MODULE_ID}] onHitAoe hotfix270r failed`, e);
  }
}



// ---------------------------------------------------------------------------
// Buff-triggered on-hit AoE (e.g. Hail of Thorns / Lightning Arrow)
// These spells apply an Active Effect on the caster, then detonate on the next ranged weapon attack.
// We detect the effect on the attacker when a ranged weapon attack completes, then re-run the spell's
// secondary SAVE/Damage activity centered on the hit target.
// ---------------------------------------------------------------------------

const __epiOnHitAoeBuffDone = (globalThis.__EPI_ON_HIT_AOE_BUFF_DONE ??= new Map());

function epiBuffDoneKey(workflow, effId, primaryId) {
  const wfKey = String(workflow?.uuid ?? workflow?.sequenceId ?? workflow?.id ?? workflow?.itemCardId ?? "");
  const actorKey = String(workflow?.actor?.uuid ?? workflow?.actor?.id ?? "");
  return `${actorKey}|${wfKey}|${String(effId ?? "")}|${String(primaryId ?? "")}`;
}
function epiBuffDoneRecently(key, windowMs = 3000) {
  const t = __epiOnHitAoeBuffDone.get(key);
  if (!t) return false;
  if ((epiNowMs() - t) <= windowMs) return true;
  __epiOnHitAoeBuffDone.delete(key);
  return false;
}
function epiMarkBuffDone(key) {
  __epiOnHitAoeBuffDone.set(key, epiNowMs());
  for (const [k, t] of __epiOnHitAoeBuffDone) {
    if ((epiNowMs() - t) > 60000) __epiOnHitAoeBuffDone.delete(k);
  }
}

function epiGetBuffMeta(item) {
  return (
    item?.getFlag?.(MODULE_ID, "onHitAoeBuff")
    ?? item?.getFlag?.("encounterplus-importer", "onHitAoeBuff")
    ?? item?.flags?.[MODULE_ID]?.onHitAoeBuff
    ?? item?.flags?.["encounterplus-importer"]?.onHitAoeBuff
    ?? null
  );
}

function inferOnHitAoeBuffFromItem(item) {
  try {
    const name = String(item?.name ?? "");
    const desc = String(item?.system?.description?.value ?? "");
    const text = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    // Detect "next ranged weapon attack" style wording (FR/EN).
    const looksLikeBuff =
      /next\s+time\s+you\s+hit\s+.*ranged\s+weapon\s+attack/i.test(text)
      || /la\s+prochaine\s+fois\s+que\s+vous\s+touchez\s+.*attaque\s+d['’]arme\s+à\s+distance/i.test(text)
      || /la\s+prochaine\s+attaque\s+d['’]arme\s+à\s+distance\s+qui\s+touche/i.test(text);

    // We also allow explicit known spell names as a fallback.
    const nameLooksKnown = /grêle\s*d['’]?épines|hail\s+of\s+thorns|flèche\s+éclair|lightning\s+arrow/i.test(name);

    if (!looksLikeBuff && !nameLooksKnown) return null;

    // Radius parsing (FR/EN)
    let radius = null;
    let units = null;

    const frRay = text.match(/rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|mètre|mètres)\s+de\s+la\s+cible/);
    if (frRay) { radius = Number(frRay[1].replace(",", ".")); units = "m"; }
    const frRay2 = text.match(/dans\s+un\s+rayon\s+de\s*([0-9]+(?:[\.,][0-9]+)?)\s*(m|m\.|mètre|mètres)/);
    if (!radius && frRay2) { radius = Number(frRay2[1].replace(",", ".")); units = "m"; }

    const en = text.match(/within\s*(\d+)\s*(feet|foot|ft)\s*of\s*the\s*target/);
    if (!radius && en) { radius = Number(en[1]); units = "ft"; }

    // Fallback by known names (RAW defaults)
    if (!radius && /grêle\s*d['’]?épines|hail\s+of\s+thorns/i.test(name)) { radius = 5; units = "ft"; }
    if (!radius && /flèche\s+éclair|lightning\s+arrow/i.test(name)) { radius = 10; units = "ft"; }

    if (!radius) return null;

    // trigger on miss wording (Lightning Arrow)
    const triggerOnMiss =
      /hit\s+or\s+miss/i.test(text)
      || /touche\s+ou\s+rate|touche\s+ou\s+manque/i.test(text)
      || /flèche\s+éclair|lightning\s+arrow/i.test(name);

    // Choose a SAVE activity to run (prefer non-slot consuming if present).
    const acts = item?.system?.activities ?? null;
    let list = [];
    try {
      if (Array.isArray(acts)) list = acts;
      else if (acts?.contents && Array.isArray(acts.contents)) list = acts.contents;
      else if (typeof acts?.values === "function") list = Array.from(acts.values());
      else if (acts && typeof acts === "object") list = Object.values(acts);
    } catch (_e) { list = []; }
    list = (Array.isArray(list) ? list : []).filter(a => a && typeof a === "object" && (a?._id || a?.id));

    const consumesSlot = (a) => (a?.consumption?.spellSlot ?? a?.system?.consumption?.spellSlot);
    const save = list.find(a => a?.type === "save" && consumesSlot(a) === false) ?? list.find(a => a?.type === "save") ?? null;
    if (!save) return null;

    return {
      radius,
      units: units || "ft",
      saveActivityId: String(save?._id ?? save?.id ?? ""),
      includePrimaryTarget: true,
      triggerOnMiss
    };
  } catch (_e) {
    return null;
  }
}

function epiEffectOriginUuid(effect) {
  return String(
    effect?.origin
    ?? effect?.flags?.dnd5e?.origin
    ?? effect?.flags?.core?.sourceId
    ?? ""
  );
}

async function epiFindFirstBuffSpellEffect(actor) {
  const effects = Array.from(actor?.effects ?? []).filter(e => e && !e?.disabled);

  const isMarker = (e) =>
    !!(
      e?.getFlag?.(MODULE_ID, "onHitAoeBuffMarker")
      ?? e?.flags?.[MODULE_ID]?.onHitAoeBuffMarker
      ?? e?.flags?.["encounterplus-importer"]?.onHitAoeBuffMarker
    );

  // Prefer explicit marker effects; fallback to name heuristics.
  const markers = effects.filter(isMarker);
  const likelyByName = effects.filter(e => /grêle|épines|hail|thorns|flèche|éclair|lightning|arrow|\(prêt\)|ready/i.test(String(e?.name ?? "")));
  const candidates = (markers.length ? markers : (likelyByName.length ? likelyByName : effects));

  const resolveItemFromOrigin = async (origin) => {
    if (!origin) return null;

    // 1) normal fromUuid path
    try {
      const doc = await fromUuid(origin);
      const item = doc?.item ?? doc;
      if (item) return item;
    } catch (_e) {}

    // 2) fallback parse origin for embedded item
    try {
      const s = String(origin);
      const m = s.match(/Actor\.([^.]+)\.Item\.([^.]+)/);
      if (m && actor) {
        const itemId = m[2];
        const it = actor?.items?.get?.(itemId);
        if (it) return it;
      }
    } catch (_e) {}

    // 3) fallback world Item.<id>
    try {
      const s = String(origin);
      const m = s.match(/^Item\.([^.]+)$/);
      if (m && game?.items) return game.items.get(m[1]) ?? null;
    } catch (_e) {}

    return null;
  };

  for (const ef of candidates) {
    const origin = epiEffectOriginUuid(ef);
    if (!origin) continue;

    const item = await resolveItemFromOrigin(origin);
    if (!item || item?.type !== "spell") continue;

    let meta = epiGetBuffMeta(item);
    if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeBuffFromItem(item);
    if (!meta?.radius || !meta?.saveActivityId) continue;

    return { effect: ef, spellItem: item, meta };
  }
  return null;
}

function epiGetCastLevelFromEffect(effect, spellItem) {
  const base = Number(spellItem?.system?.level ?? 0) || 0;
  try {
    const f = effect?.flags ?? {};
    const d5e = f?.dnd5e ?? {};
    const midi = f?.["midi-qol"] ?? {};
    const val = Number(
      d5e?.castLevel ??
      d5e?.spellLevel ??
      midi?.castData?.castLevel ??
      midi?.castLevel ??
      midi?.spellLevel ??
      effect?.castLevel ??
      effect?.spellLevel ??
      NaN
    );
    if (Number.isFinite(val) && val > 0) return val;
  } catch (_e) {}
  return base;
}

async function epiEndConcentrationBestEffort(actor, originItemUuid) {
  // Prefer ending concentration only for the spell that just detonated.
  try {
    if (actor?.effects && originItemUuid) {
      const originStr = String(originItemUuid);
      const matches = (e) => {
        const o = String(e?.origin ?? e?.flags?.dnd5e?.origin ?? e?.flags?.dnd5e?.concentration?.itemUuid ?? "");
        if (o && (o === originStr || o.includes(originStr))) return true;
        const n = foldKey(String(e?.name ?? ""));
        // FR/EN labels for concentration effects
        if ((n.includes("concentr") || n.includes("concentre")) && o && o.includes(originStr)) return true;
        return false;
      };
      const effs = (actor.effects ?? []).filter(matches);
      if (effs.length) {
        await Promise.allSettled(effs.map(e => e?.delete?.()));
        return;
      }
    }
  } catch (_e) {}

  // Generic fallback: end any concentration.
  try {
    if (globalThis?.MidiQOL?.removeConcentration) {
      await globalThis.MidiQOL.removeConcentration(actor);
      return;
    }
  } catch (_e) {}
  try {
    if (actor?.endConcentration) { await actor.endConcentration(); return; }
  } catch (_e) {}
  // Last resort: remove a concentrating status effect
  try {
    const eff = (actor?.effects ?? []).find(e => e?.statuses?.has?.("concentrating") || /concentration/i.test(String(e?.name ?? "")));
    if (eff) await eff.delete();
  } catch (_e) {}
}


async function epiRunBuffOnHitAoeSecondary(workflow) {
  try {
    if (!workflow) return;

    // Skip any workflows created by this module's follow-up.
    if (
      workflow?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.options?.__epiSecondaryOnHitAoe ||
      workflow?.options?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.workflowOptions?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.workflowOptions?.__epiSecondaryBuffOnHitAoe ||
      workflow?.options?.__epiSecondaryBuffOnHitAoe ||
      workflow?.options?.workflowOptions?.__epiSecondaryBuffOnHitAoe ||
      workflow?.workflowOptions?.workflowOptions?.__epiSecondaryBuffOnHitAoe
    ) return;

    // Any workflow created via MidiQOL.completeActivityUse() will have forceCompletion=true.
    if (
      workflow?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.forceCompletion === true
    ) return;

    const item = workflow?.item ?? null;
    const actor = workflow?.actor ?? workflow?.item?.actor ?? null;
    if (!item || !actor) return;

    // Only for ranged weapon attacks
    const actionType = String(
      workflow?.activity?.actionType
      ?? workflow?.activity?.system?.actionType
      ?? item?.system?.actionType
      ?? item?.system?.actionType?.value
      ?? ""
    ).toLowerCase();

    // Fast pre-check: if the attacker has a '(prêt)' marker but we can't detect a ranged weapon action, log once and skip.
    const hasReady = Array.from(actor?.effects ?? []).some(e => {
      const n = String(e?.name ?? "").toLowerCase();
      return n.includes("(prêt)") || n.includes("ready") || !!(e?.getFlag?.(MODULE_ID, "onHitAoeBuffMarker") ?? e?.flags?.[MODULE_ID]?.onHitAoeBuffMarker);
    });

    if (actionType !== "rwak") {
      if (hasReady) console.log(`[${MODULE_ID}] onHitAoeBuff debug: ready marker present but actionType is not rwak`, { item: item?.name, itemType: item?.type, actionType });
      return;
    }

    // Find the buff spell effect on the attacker
    const found = await epiFindFirstBuffSpellEffect(actor);
    if (!found) return;
    const { effect, spellItem, meta } = found;

    // Primary target is the hit target; optionally trigger on miss.
    const hit = (() => {
      try { return Array.from(workflow?.hitTargets ?? [])[0] ?? null; } catch (_e) { return null; }
    })();
    const tgt = (() => {
      try { return Array.from(workflow?.targets ?? [])[0] ?? null; } catch (_e) { return null; }
    })();
    let primary = hit ?? (meta?.triggerOnMiss ? tgt : null);
    // Defensive: some hook timings/modules can yield a "primary" that matches the attacker token.
    // If that happens, fall back to the first selected target that is NOT the attacker.
    const attackerId = String(workflow?.token?.id ?? workflow?.token?.document?.id ?? workflow?.tokenId ?? workflow?.token?.document?._id ?? "");
    const primaryId0 = String(primary?.id ?? primary?._id ?? primary?.document?.id ?? "");
    if (attackerId && primaryId0 && attackerId === primaryId0) {
      const ht = (() => { try { return Array.from(workflow?.hitTargets ?? []); } catch (_e) { return []; } })();
      const tt = (() => { try { return Array.from(workflow?.targets ?? []); } catch (_e) { return []; } })();
      const alt = ht.find(t => String(t?.id ?? t?._id ?? t?.document?.id ?? "") && String(t?.id ?? t?._id ?? t?.document?.id ?? "") !== attackerId)
        ?? tt.find(t => String(t?.id ?? t?._id ?? t?.document?.id ?? "") && String(t?.id ?? t?._id ?? t?.document?.id ?? "") !== attackerId)
        ?? null;
      if (alt) primary = alt;
    }
    if (!primary) {
      if (hasReady) console.log(`[${MODULE_ID}] onHitAoeBuff debug: no primary target (no hitTargets)`, { item: item?.name, actionType, hitTargets: (()=>{try{return workflow?.hitTargets?.size ?? Array.from(workflow?.hitTargets ?? []).length;}catch(_e){return undefined;}})(), targets: (()=>{try{return workflow?.targets?.size ?? Array.from(workflow?.targets ?? []).length;}catch(_e){return undefined;}})() });
      return;
    }

    const doneKey = epiBuffDoneKey(workflow, effect?.id ?? effect?._id ?? "", primary?.id ?? primary?._id ?? "");
    if (epiBuffDoneRecently(doneKey)) return;

    const gridDist = Number(canvas?.scene?.grid?.distance ?? 5) || 5;
    const rScene = epiUnitsToSceneDistance(meta.radius, meta.units);
    if (!rScene) return;

    const steps = Math.max(1, Math.round(rScene / gridDist));
    const tokens = (canvas?.tokens?.placeables ?? []).filter(t => t?.actor);
    let targets = epiTokensInGridBurst(primary, tokens, steps);

    if (!meta?.includePrimaryTarget) {
      const pid = String(primary?.id ?? primary?._id ?? "");
      targets = targets.filter(t => String(t?.id ?? t?._id ?? "") !== pid);
    }

    if (!targets.length) return;

    // --- Detonation WITHOUT using the SAVE activity ---
    // Midi-QOL's activity execution keeps falling back to "self" for these buff spells.
    // We resolve the detonation ourselves:
    // 1) roll DEX saves for each creature in the burst (centered on the HIT target)
    // 2) roll damage ONCE
    // 3) apply full/half damage via MidiQOL.applyTokenDamage

    // Cast level/scaling (best-effort via effect flags)
    const baseLevel = Number(spellItem?.system?.level ?? 0) || 0;
    const castLevel = epiGetCastLevelFromEffect(effect, spellItem) || baseLevel;

    // Resolve Save DC
    const dc = Number(
      (typeof spellItem?.getSaveDC === "function" ? spellItem.getSaveDC() : undefined)
      ?? spellItem?.system?.save?.dc
      ?? spellItem?.system?.save?.value
      ?? actor?.system?.attributes?.spell?.dc
      ?? actor?.system?.attributes?.spelldc
      ?? actor?.system?.attributes?.spellsave
      ?? actor?.system?.attributes?.spellDc
      ?? 0
    ) || 0;
    if (!dc) {
      console.warn(`[${MODULE_ID}] onHitAoeBuff: could not determine spell save DC for`, spellItem?.name);
      return;
    }

    // Damage formula & type from the explosion activity when possible
    const aId0 = String(meta?.saveActivityId ?? "");
    let act0 = null;
    try { act0 = aId0 ? (spellItem?.system?.activities?.get?.(aId0) ?? spellItem?.system?.activities?.[aId0] ?? null) : null; } catch (_e) { act0 = null; }
    const parts = act0?.damage?.parts ?? act0?.system?.damage?.parts ?? spellItem?.system?.damage?.parts ?? [];
    const baseFormula = String(parts?.[0]?.[0] ?? parts?.[0]?.formula ?? "1d10").trim() || "1d10";
    const dmgType = String(parts?.[0]?.[1] ?? parts?.[0]?.type ?? "piercing") || "piercing";

    // Simple scaling: repeat the base formula per slot level above spell level (e.g. Hail of Thorns)
    const extra = Math.max(0, Number(castLevel) - baseLevel);
    const formula = [baseFormula, ...Array.from({ length: extra }, () => baseFormula)].join(" + ");

    // Roll saves
    const saves = new Set();
    for (const t of targets) {
      const a = t?.actor;
      if (!a?.rollAbilitySave) continue;
      try {
        const r = await a.rollAbilitySave("dex", { dc, chatMessage: true, fastForward: true });
        const total = Number(r?.total ?? r?.result ?? 0);
        if (total >= dc) saves.add(t);
      } catch (_e) {
        // treat as failed save
      }
    }

    // Roll damage ONCE
    let dmgRoll;
    try {
      const DR = CONFIG?.Dice?.DamageRoll ?? globalThis?.CONFIG?.Dice?.DamageRoll;
      if (DR) {
        dmgRoll = new DR(formula, {}, { type: dmgType });
        dmgRoll = await dmgRoll.evaluate();
      } else {
        dmgRoll = new Roll(formula);
        dmgRoll = await dmgRoll.evaluate();
      }
    } catch (e) {
      console.warn(`[${MODULE_ID}] onHitAoeBuff: damage roll failed`, e);
      return;
    }
    const totalDamage = Number(dmgRoll?.total ?? 0) || 0;
    const damageDetail = [{ damage: totalDamage, value: totalDamage, type: dmgType, formula: String(dmgRoll?.formula ?? formula) }];

    const _tNames = targets.map(t => String(t?.name ?? t?.id ?? "")).filter(Boolean).join(", ");
    console.log(`[${MODULE_ID}] onHitAoeBuff manual detonate spell="${spellItem?.name}" weapon="${item?.name}" primary="${primary?.name ?? primary?.id}" targets=[${_tNames}] dc=${dc} formula="${formula}" castLevel=${castLevel}`);

    epiMarkBuffDone(doneKey);

    // Apply damage with Midi-QOL if available (handles resistances/immunities + reverse damage card)
    // Some setups can throw during applyTokenDamage (e.g. invalid item types injected by other modules).
    // If that happens, fallback to direct actor damage application.
    if (globalThis?.MidiQOL?.applyTokenDamage) {
      try {
        await globalThis.MidiQOL.applyTokenDamage(damageDetail, totalDamage, targets, spellItem, saves, {
          label: "defaultDamage",
          updateOptions: { awaitDamageApplication: true }
        });
      } catch (e) {
        console.warn(`[${MODULE_ID}] onHitAoeBuff: MidiQOL.applyTokenDamage failed (fallback to actor.applyDamage)`, e);
        for (const t of targets) {
          const a = t?.actor;
          if (!a) continue;
          const mult = saves.has(t) ? 0.5 : 1;
          const amt = Math.floor(totalDamage * mult);
          try { await a.applyDamage(amt); } catch (_e) {}
        }
      }
    } else {
      for (const t of targets) {
        const a = t?.actor;
        if (!a) continue;
        const mult = saves.has(t) ? 0.5 : 1;
        const amt = Math.floor(totalDamage * mult);
        try { await a.applyDamage(amt); } catch (_e) {}
      }
    }

// Consume the buff (single-use) and end concentration (single-use)
try {
  const originStr = String(spellItem?.uuid ?? "");
  const toDelete = (actor?.effects ?? []).filter(e =>
    e?.flags?.[MODULE_ID]?.onHitAoeBuffMarker ||
    e?.flags?.["encounterplus-importer"]?.onHitAoeBuffMarker ||
    (originStr && String(e?.origin ?? "").includes(originStr) && /(pr[eé]t|ready)/i.test(String(e?.name ?? "")))
  );
  if (toDelete.length) await Promise.allSettled(toDelete.map(e => e?.delete?.()));
  else await effect?.delete?.();
} catch (_e) {}

try {
  // Prefer the system API to end concentration on this spell.
  if (typeof actor?.endConcentration === "function") {
    await actor.endConcentration(spellItem);
  } else {
    await epiEndConcentrationBestEffort(actor, spellItem?.uuid);
  }
} catch (_e) {}

  } catch (e) {
    console.warn(`[${MODULE_ID}] onHitAoeBuff hotfix271e failed`, e);
  }
}

async function epiAutoApplyOnHitAoeBuffMarker(workflow) {
  try {
    if (!workflow) return;

    // Avoid recursion / follow-up workflows.
    if (
      workflow?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.workflowOptions?.__epiSecondaryBuffOnHitAoe ||
      workflow?.options?.workflowOptions?.__epiSecondaryOnHitAoe ||
      workflow?.options?.workflowOptions?.__epiSecondaryBuffOnHitAoe
    ) return;

    // Skip workflows created by completeActivityUse (our follow-up save activity).
    if (
      workflow?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.workflowOptions?.forceCompletion === true ||
      workflow?.options?.forceCompletion === true
    ) return;

    const item = workflow?.item ?? null;
    const actor = workflow?.actor ?? item?.actor ?? null;
    if (!item || !actor || item?.type !== "spell") return;

    // Only for spells that are "buff -> AoE on hit"
    let meta = epiGetBuffMeta(item);
    if (!meta?.radius || !meta?.saveActivityId) meta = inferOnHitAoeBuffFromItem(item);
    if (!meta?.radius || !meta?.saveActivityId) return;

    // If this workflow is the SAVE activity itself, do nothing (we only want to apply the buff marker on cast).
    const actId = String(
      workflow?.activity?._id ??
      workflow?.activity?.id ??
      workflow?.currentActivity?._id ??
      workflow?.currentActivity?.id ??
      ""
    );
    if (actId && actId === String(meta.saveActivityId)) return;

    const originUuid = String(item?.uuid ?? "");
    if (!originUuid) return;

    // Find the marker effect definition on the spell item
    const markerEf = Array.from(item?.effects ?? []).find(e =>
      e?.flags?.[MODULE_ID]?.onHitAoeBuffMarker || e?.flags?.["encounterplus-importer"]?.onHitAoeBuffMarker
    );
    if (!markerEf) return;

    const markerName = String(markerEf?.name ?? "").trim();

    // If a marker already exists (or duplicates exist), normalize to a single one.
    const existing = Array.from(actor?.effects ?? [])
      .filter(e => e && !e?.disabled)
      .filter(e => {
        const n = String(e?.name ?? "").trim().toLowerCase();
        if (!markerName) return false;
        if (n !== markerName.toLowerCase()) return false;
        return true;
      });

    // Cast level for scaling (we store it on the marker effect)
    const castLevel = Number(
      workflow?.castData?.castLevel ??
      workflow?.spellLevel ??
      workflow?.itemLevel ??
      workflow?.options?.spellLevel ??
      NaN
    );

    if (existing.length) {
      // Prefer keeping the one that already has the right origin.
      const keep = existing.find(e => epiEffectOriginUuid(e) === originUuid) ?? existing[0];
      for (const ef of existing) {
        if (ef?.id !== keep?.id) {
          try { await ef.delete(); } catch (_e) {}
        }
      }
      // Ensure origin + marker flag + castLevel on the kept effect.
      const upd = { origin: originUuid, disabled: false, transfer: false };
      upd[`flags.${MODULE_ID}.onHitAoeBuffMarker`] = true;
      if (Number.isFinite(castLevel) && castLevel > 0) {
        upd[`flags.dnd5e.castLevel`] = castLevel;
        upd[`flags.midi-qol.castData.castLevel`] = castLevel;
      }
      try { await keep.update(upd); } catch (_e) {}
      return;
    }

    let data = null;
    try { data = markerEf.toObject ? markerEf.toObject() : (foundry?.utils?.deepClone ? foundry.utils.deepClone(markerEf) : null); } catch (_e) { data = null; }
    if (!data) return;
    try { delete data._id; } catch (_e) {}

    // Ensure origin and cast level for scaling
    data.origin = originUuid;
    data.disabled = false;
    data.transfer = false;

    if (Number.isFinite(castLevel) && castLevel > 0) {
      data.flags ??= {};
      data.flags.dnd5e ??= {};
      data.flags.dnd5e.castLevel = castLevel;
      data.flags["midi-qol"] ??= {};
      data.flags["midi-qol"].castData ??= {};
      data.flags["midi-qol"].castData.castLevel = castLevel;
    }

    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    console.log(`[${MODULE_ID}] onHitAoeBuff marker applied`, { actor: actor?.name, spell: item?.name, castLevel: Number.isFinite(castLevel) ? castLevel : undefined });
  } catch (e) {
    console.warn(`[${MODULE_ID}] onHitAoeBuff marker auto-apply failed`, e);
  }
}


// Main trigger
// We intentionally only listen to RollComplete here.
// DamageRollComplete can fire in addition (and sometimes before RollComplete), which led to duplicate
// follow-up AoE executions (double JdS / double dégâts).
// RollComplete is reliable for "spell attack -> secondary save" (e.g. Ice Knife).
// For buff-triggered spells (Hail of Thorns / Lightning Arrow), RollComplete can have hitTargets cleared,
// so we listen to AttackRollComplete for the weapon hit and detonate there.
Hooks.on("midi-qol.RollComplete", (workflow) => {
  void epiAutoApplyOnHitAoeBuffMarker(workflow);
  epiRunOnHitAoeSecondary(workflow);
});

Hooks.on("midi-qol.AttackRollComplete", (workflow) => {
  void epiRunBuffOnHitAoeSecondary(workflow);
});
});


Hooks.once('ready', async () => {
  try {
    if (!game.user?.isGM) return;
    await __epiEnsureWallOfLightBlindMacro();
    let patched = 0;
    const patchItem = async (it) => {
      if (!it || it.type !== 'spell' || !__epiIsWallOfLightItem(it)) return 0;
      const src = it.toObject();
      let changed = false;
      src.effects = Array.isArray(src.effects) ? src.effects.map(e => {
        const isBlind = !!(e?.flags?.[MODULE_ID]?.wallOfLightBlind || e?.flags?.['encounterplus-importer']?.wallOfLightBlind);
        if (!isBlind) return e;
        changed = true;
        const dc = Number(e?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? e?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0;
        return __epiCleanWallOfLightBlindEffectData(e, dc, e?.name ?? it.name ?? 'Mur de lumière');
      }) : [];
      if (changed) await it.update({ effects: src.effects });
      return changed ? 1 : 0;
    };
    for (const it of (game.items ?? [])) patched += await patchItem(it);
    for (const actor of (game.actors ?? [])) {
      for (const it of (actor.items ?? [])) patched += await patchItem(it);
      const blindEffects = Array.from(actor.effects ?? []).filter(__epiIsWallOfLightBlindEffect);
      for (const ae of blindEffects) {
        const dc = Number(ae?.flags?.[MODULE_ID]?.wallOfLightBlindDc ?? ae?.flags?.['encounterplus-importer']?.wallOfLightBlindDc ?? 0) || 0;
        const cleaned = __epiCleanWallOfLightBlindEffectData(ae.toObject ? ae.toObject() : foundry.utils.deepClone(ae), dc, ae?.name ?? 'Mur de lumière');
        await ae.update({
          changes: cleaned.changes,
          'flags.dae': cleaned.flags?.dae ?? {},
          [`flags.${MODULE_ID}.wallOfLightBlind`]: true,
          [`flags.${MODULE_ID}.wallOfLightBlindDc`]: dc,
          [`flags.${MODULE_ID}.wallOfLightBlindEffectMacro`]: true,
          'flags.encounterplus-importer.wallOfLightBlind': true,
          'flags.encounterplus-importer.wallOfLightBlindDc': dc,
          'flags.encounterplus-importer.wallOfLightBlindEffectMacro': true
        }).catch(() => {});
      }
    }
    if (patched > 0) console.log(`[${MODULE_ID}] hotfix271ba normalized ${patched} Wall of Light item(s).`);
  } catch (e) {
    console.warn(`[${MODULE_ID}] hotfix271ba migration failed`, e);
  }
});
