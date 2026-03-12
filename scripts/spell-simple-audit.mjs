import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "exemple d'import spells - Ne pas modifié.json");
const OUTPUT = path.join(ROOT, "docs", "spell-simple-batch-audit.md");
const OUTPUT_MAP = path.join(ROOT, "docs", "spell-simple-batch-map.json");

const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));

const fold = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const complexRx = [
  /\binvoc|\bconjur|summon|famili(er|ar)|serviteur|compagnon|convocation/, // invocations
  /teleport|teleportation|dimensionnelle|porte dimensionnelle|pas brumeux|misty step/, // téléport
  /creation d'?objet|creez?|creation de|fabriquer|creature de|creation d|mur de|wall of|hutte|hut|dome|forteresse|structure|homoncule/, // création structures
  /antimag|antimagic|champ antimagie/, // anti-magie
  /simulacre|wish|souhait|metamorphose veritable|true polymorph|clone|demiplane|time stop|arret du temps/ // très spéciaux
];

const simpleFamilies = {
  "degats-directs": {
    label: "Dégâts simples (attaque ou dégâts directs)",
    test: (t) => /(\d+d\d+)/.test(t) && /(degats|damage)/.test(t) && !/(a chaque tour|debut de son tour|fin de son tour|zone|aura|nuage|mur|sphere|rayon de \d+ m|concentration).{0,40}(degats|damage)/.test(t)
  },
  "degats-save": {
    label: "Dégâts + jet de sauvegarde simple",
    test: (t) => /(\d+d\d+)/.test(t) && /(degats|damage)/.test(t) && /(jet de sauvegarde|saving throw|js de)/.test(t)
  },
  "soins-simples": {
    label: "Soins simples",
    test: (t) => /(recupere|regagne|gueri|soin|healing|hit points)/.test(t) && !/(a chaque tour|bonus action repet|esprit|aura)/.test(t)
  },
  "buffs-resistances": {
    label: "Buffs / résistances simples",
    test: (t) => /(resistance|resistances?|advantage|avantage|bonus a la ca|classe d'armure|armor class|immunise|immunity)/.test(t)
  }
};

function classifySpell(spell) {
  const text = fold(`${spell.name ?? ""}\n${spell.slug ?? ""}\n${spell.descr ?? ""}`);
  const isComplex = complexRx.some((rx) => rx.test(text));
  if (isComplex) return { lot: "lot-3", reason: "complexe/exclu", families: [] };

  const families = Object.entries(simpleFamilies)
    .filter(([, def]) => def.test(text))
    .map(([k]) => k);

  const hasRecurring = /(a chacun de vos tours|a chaque tour|debut de son tour|fin de son tour|tant que|concentration jusqu|reaction)/.test(text);
  const hasMultiMode = /(choisissez|l'un des effets|ou bien|ou,|at higher levels|par niveau superieur)/.test(text);

  if (!families.length) return { lot: "lot-3", reason: "hors noyau simple", families };
  if (families.length === 1 && !hasRecurring && !hasMultiMode) return { lot: "lot-1", reason: "simple direct", families };
  return { lot: "lot-2", reason: "simple + cas particulier", families };
}

const rows = raw.map((s) => ({ ...s, ...classifySpell(s) }));
const lots = {
  "lot-1": rows.filter((r) => r.lot === "lot-1"),
  "lot-2": rows.filter((r) => r.lot === "lot-2"),
  "lot-3": rows.filter((r) => r.lot === "lot-3")
};

const famCount = Object.fromEntries(Object.keys(simpleFamilies).map((k) => [k, 0]));
for (const r of rows) for (const f of r.families) famCount[f]++;

const list = (arr, limit = 80) => arr.slice(0, limit).map((s) => `- ${s.name}`).join("\n") || "- _(aucun)_";

const md = `# Audit batch des sorts simples (combat)

_Généré automatiquement via \`node scripts/spell-simple-audit.mjs\`._

## Périmètre
- Corpus analysé: **${rows.length} sorts**.
- Exclusions prioritaires appliquées: invocations/convocations, téléportation, création d'objets/structures, anti-magie, logiques très spéciales.

## Familles simples identifiées (réutilisables)
- **Dégâts simples directs**: ${famCount["degats-directs"]} sorts
- **Dégâts + jet de sauvegarde simple**: ${famCount["degats-save"]} sorts
- **Soins simples**: ${famCount["soins-simples"]} sorts
- **Buffs/résistances simples**: ${famCount["buffs-resistances"]} sorts

## Architecture batch proposée (rapide)
1. **Pipeline de tri** (regex + heuristiques légères) pour envoyer automatiquement les sorts vers un lot.
2. **Templates de mécaniques réutilisables**:
   - damageOnly
   - saveThenDamage (moitié sur réussite optionnelle)
   - healOnly
   - simpleBuffResistance
3. **Fallback pragmatique**: si plusieurs mécaniques détectées, route vers lot 2 sans blocage de l'import.
4. **Dépriorisation explicite** des mécaniques lot 3 (coût élevé, faible ROI immédiat).

## Classement rentabilité / facilité
- **Lot 1 (très simple, très rentable)**: ${lots["lot-1"].length} sorts
- **Lot 2 (simple + quelques cas particuliers)**: ${lots["lot-2"].length} sorts
- **Lot 3 (à remettre plus tard / exclu)**: ${lots["lot-3"].length} sorts

### Lot 1 — exemples prioritaires
${list(lots["lot-1"], 60)}

### Lot 2 — exemples (cas particuliers légers)
${list(lots["lot-2"], 60)}

### Lot 3 — exemples (reportés)
${list(lots["lot-3"], 80)}

## Notes pragmatiques
- Le **gain immédiat** se fait en industrialisant les 4 familles simples via templates d'activité Foundry.
- Le lot 2 peut être absorbé ensuite avec des hooks ciblés (multi-cibles, récurrence légère).
- Le lot 3 reste hors scope de ce chantier pour préserver la vitesse de delivery.
`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, md, "utf8");
fs.writeFileSync(
  OUTPUT_MAP,
  JSON.stringify(
    rows
      .map((r) => ({ name: r.name, slug: r.slug, lot: r.lot, reason: r.reason, families: r.families }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr")),
    null,
    2
  ),
  "utf8"
);

console.log(`Audit écrit: ${path.relative(ROOT, OUTPUT)}`);
console.log(`Map écrite: ${path.relative(ROOT, OUTPUT_MAP)}`);
console.log(`Lot1=${lots["lot-1"].length} Lot2=${lots["lot-2"].length} Lot3=${lots["lot-3"].length}`);
