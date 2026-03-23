# Implémentation Lot 1 — sorts simples (passe pragmatique)

## Portée implémentée
Cette passe implémente un **fast-path batch** pour les sorts simples du lot 1:
- dégâts simples
- dégâts + jet de sauvegarde simple
- soins simples
- buffs / résistances simples

Le fast-path est volontairement limité aux sorts lot 1 les plus rentables et **exclut explicitement** les mécanismes déjà traités par des systèmes dédiés (régions, murs, auras, etc.).

## Sorts lot 1 maintenant couverts par le batch
- blessure
- chatiment-du-ban
- chatiment-revelateur
- coup-au-but
- dissipation-du-mal-et-du-bien
- duel-force
- ennemis-a-foison
- faveur-divine
- flammes
- fleche-acide-de-melf
- fleches-enflammees
- forme-gazeuse
- foulee-d-ashardalon
- frayeur
- guerison-de-groupe
- image-miroir
- invulnerabilite
- lame-de-feu
- lame-retentissante
- lueurs-feeriques
- mot-de-guerison-de-groupe
- ombre-d-egarement
- orbe-chromatique
- premonition
- priere-de-guerison
- protection-contre-le-mal-et-le-bien
- protection-contre-le-poison
- rayon-de-givre
- regeneration
- resistance
- sauvagerie-primitive
- soins
- trait-de-feu
- vent-protecteur

## Sorts lot 1 explicitement exclus dans cette passe
- aura-de-purete
- cercle-de-pouvoir
- croissance-d-epines
- mur-d-eau
- nuee-de-dagues
- tentacules-noirs-d-evard
- message
- pierre-magique
- sieste
- sommeil
- sphere-resiliente-d-otiluke
- tempete-vengeresse

## Ce qui est automatisé par famille
- **Dégâts simples**: création d'une activité `damage` si dégâts détectés sans attaque/sauvegarde.
- **Dégâts + sauvegarde**: création d'une activité `save` avec DC lanceur (`@attributes.spell.dc`) et première ligne de dégâts.
- **Soins simples**: création d'une activité `heal` (soins ou PV temporaires) à partir des patterns FR standards.
- **Buffs/résistances simples**: ajout d'un effet d'objet (non transféré) quand on détecte:
  - résistance à un type de dégâts courant
  - avantage global aux jets de sauvegarde

## Risques de régression connus
- Le fast-path utilise le **premier bloc de dégâts détecté**: certains sorts hybrides peuvent nécessiter une passe lot 2 pour une granularité parfaite.
- La détection buff est volontairement conservatrice (regex FR): elle privilégie la stabilité plutôt que la couverture exhaustive.
- Les sorts exclus restent gérés par la logique existante (pas de modification des systèmes régions/murs/auras/multi-shot).
