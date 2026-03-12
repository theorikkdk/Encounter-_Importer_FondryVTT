# Audit batch des sorts simples (combat)

_Généré automatiquement via `node scripts/spell-simple-audit.mjs`._

## Périmètre
- Corpus analysé: **484 sorts**.
- Exclusions prioritaires appliquées: invocations/convocations, téléportation, création d'objets/structures, anti-magie, logiques très spéciales.

## Familles simples identifiées (réutilisables)
- **Dégâts simples directs**: 101 sorts
- **Dégâts + jet de sauvegarde simple**: 70 sorts
- **Soins simples**: 17 sorts
- **Buffs/résistances simples**: 58 sorts

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
- **Lot 1 (très simple, très rentable)**: 47 sorts
- **Lot 2 (simple + quelques cas particuliers)**: 102 sorts
- **Lot 3 (à remettre plus tard / exclu)**: 335 sorts

### Lot 1 — exemples prioritaires
- Croissance d’épines
- Ennemis à foison
- Lame retentissante
- Sphère résiliente d’Otiluke
- Sauvagerie primitive
- Faveur divine
- Protection contre le mal et le bien
- Châtiment du ban
- Flèches enflammées
- Résistance
- Cercle de pouvoir
- Trait de feu
- Sommeil
- Ombre d’égarement
- Orbe chromatique
- Tempête vengeresse
- Lueurs féériques
- Régénération
- Mot de guérison de groupe
- Flammes
- Mur d’eau
- Rayon de givre
- Protection contre le poison
- Lame de feu
- Nuée de dagues
- Prière de guérison
- Message
- Flèche acide de Melf
- Coup au but
- Foulée d’Ashardalon
- Vent protecteur
- Invulnérabilité
- Costume d’outre-monde de Tasha
- Guérison de groupe
- Duel forcé
- Prémonition
- Blessure
- Forme gazeuse
- Frayeur
- Image miroir
- Aura de pureté
- Soins
- Châtiment révélateur
- Tentacules noirs d’Evard
- Pierre Magique
- Dissipation du mal et du bien
- Sieste

### Lot 2 — exemples (cas particuliers légers)
- Nuée de météores
- Lien avec une bête
- Absorption des éléments
- Protection primordiale
- Perturbations synaptiques
- Glas
- Festin des héros
- Domination de personne
- Immolation ardente
- Boule de feu
- Contamination
- Mains brûlantes
- Châtiment tonitruant
- Arme élémentaire
- Soins de groupe
- Embruns prismatiques
- Danse irrésistible d’Otto
- Poigne électrique
- Métal brûlant
- Poigne terreuse de Maximilian
- Châtiment courroucé
- Déluge d’énergie négative
- Fusion dans la pierre
- Flou
- Raz-de-marée
- Eclair
- Transformation de Tenser
- Bouffée de poison
- Croissance végétale
- Infestation
- Caresse du vampire
- Lance psychique de Raulothim
- Contact avec les plans
- Couronne d’étoiles
- Piqûre mentale
- Vague tonnante
- Epine mentale
- Sphère de feu
- Cordon de flèches
- Domination d’animal
- Boule de feu à retardement
- Sphère de vitriol
- Fléau élémentaire
- Colonne de flamme
- Flétrissure épouvantable d’Abi-Dalzim
- Hâte
- Entraves de givre
- Vent divin
- Marque du chasseur
- Prison mentale
- Tourbillon de poussière
- Gelure
- Secousse sismique
- Contact glacial
- Maelström
- Châtiment débilitant
- Moquerie Cruelle
- Trait ensorcelé
- Enervation
- Gardien de la nature

### Lot 3 — exemples (reportés)
- Mauvais oeil
- Thaumaturgie
- Forteresse majestueuse
- Charme-monstre
- Liberté de mouvement
- Lévitation
- Assignation infernale
- Invisibilité suprême
- Tempête de neige
- Flamme sacrée
- Stabilisation
- Hérissement de projectiles
- Arme sacrée
- Rayon de soleil
- Scrutation
- Cage des âmes
- Passe-muraille
- Convocation de Fée
- Terreur
- Bosquet des druides
- Eveil
- Liane avide
- Cage de force
- Injonction
- Cécité / Surdité
- Respiration aquatique
- Création de nourriture et d’eau
- Mot de guérison
- Compréhension des langues
- Coquille antivie
- Forme éthérée
- Dragon illusoire
- Portail
- Coup de tonnerre
- Vague destructrice
- Bagou
- Aversion/Attirance
- Mur de vent
- Détection du poison et des maladies
- Glyphe de garde
- Inversion de la gravité
- Appel de familier
- Image projetée
- Sphère aqueuse
- Corde enchantée
- Résurrection
- Vision dans le noir
- Graisse
- Rayon ardent
- Oeil du mage
- Métamorphose de groupe
- Convocation de Bête
- Simulacre
- Téléportation
- Aura de vie
- Déblocage
- Invocation d’élémentaires mineurs
- Immobilisation de monstre
- Sphère de tempête
- Symbole
- Pyrotechnie
- Convocation d’Élémentaire
- Communication avec les animaux
- Couleurs dansantes
- Nuage nauséabond
- Mot de pouvoir mortel
- Télépathie
- Flétrissement
- Sacre du vent
- Eruption de lames
- Mur de lumière
- Détection des pensées
- Esprit impénétrable
- Grande foulée
- Allié planaire
- Illusion programmée
- Zone de vérité
- Contrôle des flammes
- Rappel à la vie
- Télékinésie

## Notes pragmatiques
- Le **gain immédiat** se fait en industrialisant les 4 familles simples via templates d'activité Foundry.
- Le lot 2 peut être absorbé ensuite avec des hooks ciblés (multi-cibles, récurrence légère).
- Le lot 3 reste hors scope de ce chantier pour préserver la vitesse de delivery.
