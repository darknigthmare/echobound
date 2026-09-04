# ECHObound — La Cité des Échos

Édition Codex Professionnelle 2.0.0. ECHObound est un RPG original de recrutement, d’évolution et de reconstruction d’une cité interdimensionnelle. La campagne conserve son identité complète : trois partenaires de départ, douze habitants et services, onze formes, Unisson, boss final en deux phases, conclusions multiples et Nouveau Cycle+.

Production : [echobound.vercel.app](https://echobound.vercel.app)

## Exploration longue

Les quatre régions forment désormais de véritables expéditions de cinq secteurs chacune, soit vingt cartes distinctes autour de Nox Arca. Les passages entre secteurs, détours narratifs, patrouilles, sanctuaires, gardiens et raccourcis persistants donnent à chaque territoire une progression propre. La cité reste le centre vivant de la campagne et s’enrichit grâce aux recrues ramenées des régions.

Le jeu se contrôle au clavier, à la manette ou avec les commandes tactiles. Les options intégrées couvrent notamment le mouvement réduit, le contraste renforcé, l’agrandissement du texte et les réglages audio.

## Architecture

La version web est une PWA statique, sans dépendance d’exécution ni service distant requis pour jouer :

- `src/game.js` orchestre la campagne, les écrans et la boucle de jeu ;
- `src/world-layouts.js` décrit les quatre expéditions et leurs vingt secteurs ;
- `src/combat-rules.js` porte les techniques propres aux formes, la garde, l’Unisson et la seconde phase du boss final ;
- `src/progression-rules.js` porte l’évolution liée aux soins et les lois du Nouveau Cycle+ ;
- `src/save-system.js` gère validation, migrations et sauvegardes de secours ;
- `src/audio-director.js` produit les ambiances procédurales originales ;
- `src/platform.js`, `manifest.webmanifest` et `sw.js` assurent installation, mise à jour et fonctionnement hors ligne.

`ECHObound_standalone.html` reste le standalone professionnel canonique vérifié dans le dépôt. La modularisation PWA est une couche distincte : sa validation refuse toute altération du fichier canonique, tandis que le build public l’exclut de `dist/` et du cache hors ligne.

## Lancer localement

Le jeu doit être servi en HTTP pour activer correctement les modules ES et le service worker. Depuis la racine du dépôt, utilisez le serveur statique de votre choix, puis ouvrez `index.html`. La production Vercel sert directement le contenu généré dans `dist/`.

## Sauvegardes

La campagne est enregistrée localement et accepte les sauvegardes historiques 1.0 et 2.0 grâce aux migrations intégrées. Trois copies de secours rotatives protègent les états précédents.

Le menu permet :

- de copier un code Base64 ;
- de télécharger une sauvegarde JSON ;
- d’importer un fichier JSON ;
- de coller un JSON ou un code Base64.

Chaque import est décodé et validé avant de remplacer la partie active. Le schéma est fermé : compteurs et statistiques sont bornés, les identifiants sont comparés aux contenus connus et les récompenses de contrat sont reconstruites depuis les règles du jeu. L’état précédent reste disponible dans l’historique de secours.

## Vérifier et construire

```bash
npm test
npm run test:pwa
npm run build
```

La commande complète est :

```bash
npm run check
```

Les tests couvrent le combat, la progression, l’audio, les sauvegardes, la sécurité des imports et les vingt secteurs. La validation PWA découvre dynamiquement tous les fichiers dans `src/` et `assets/`, contrôle le graphe des imports, impose leur précache, vérifie la cohérence des versions plateforme/cache et confirme l’empreinte du standalone canonique à la source. Le build recopie uniquement la surface d’exécution modulaire dans `dist/`, puis la valide à nouveau octet par octet.

## Provenance

Le détail vérifiable de la reprise figure dans `SOURCE_PROVENANCE.md`. Tous les visuels, sons procéduraux, noms et contenus ajoutés au projet sont originaux.
