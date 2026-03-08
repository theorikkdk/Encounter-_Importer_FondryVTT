import { MODULE_ID, SETTINGS } from "./module.mjs";
import { runImport, repairJournalImages, repairEncounterLinks, repairActorPortraits, repairSpellDistances } from "./importer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EncounterImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "encounterplus-importer",
    tag: "form",
    window: {
      title: "EPI.App.Title",
      icon: "fas fa-file-import",
      resizable: true
    },
    position: { width: 720, height: "auto" },
    actions: {
      browse: this.#onBrowse,
      import: this.#onImport,
      fixAll: this.#onFixAll,
      fixDistances: this.#onFixDistances
    },
    form: { closeOnSubmit: false, submitOnChange: false, handler: () => {} }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/importer.hbs` }
  };

  async _prepareContext() {
    return {
      sourcePath: game.settings.get(MODULE_ID, SETTINGS.SOURCE_PATH) || "",
      prefix: game.settings.get(MODULE_ID, SETTINGS.PREFIX) || "Encounter+ Import"
    };
  }

  static async #onBrowse(event) {
    event.preventDefault();
    const input = this.element.querySelector("input[name='sourcePath']");
    const current = input?.value || "";
    const FP = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "folder",
      current,
      callback: (path) => input.value = path
    }).render(true);
  }

  static async #onImport(event) {
    event.preventDefault();
    const sourcePath = this.element.querySelector("input[name='sourcePath']")?.value?.trim() || "";
    const prefix = this.element.querySelector("input[name='prefix']")?.value?.trim() || "Encounter+ Import";
    const destination = "world";

    await game.settings.set(MODULE_ID, SETTINGS.SOURCE_PATH, sourcePath);
    await game.settings.set(MODULE_ID, SETTINGS.PREFIX, prefix);
    await runImport({ sourcePath, prefix, destination });
  }

  static async #onFixAll(event) {
    event.preventDefault();
    const sourcePath = this.element.querySelector("input[name='sourcePath']")?.value?.trim() || "";
    const prefix = this.element.querySelector("input[name='prefix']")?.value?.trim() || "Encounter+ Import";
    if (!sourcePath) return ui.notifications.warn("Chemin source vide.");
    await repairJournalImages({ sourcePath, prefix });
    await repairActorPortraits({ prefix });
    await repairEncounterLinks({ prefix });
  }
}
