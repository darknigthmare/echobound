---
name: codegraph
description: Prioriser l'exploration du graphe local de symboles, appels, dépendances et impact avec CodeGraph (MCP/CLI) avant les tâches de maintenance, en complément des autres skills.
---

# CodeGraph — exploration structurée du code

Source : https://github.com/colbymchenry/codegraph (MIT).

CodeGraph est un **outil local d'indexation et un serveur MCP**, pas un simple
texte d'instructions. Ce skill guide son utilisation sans prétendre l'installer.

## Activation sur la machine de travail

1. Installer le CLI CodeGraph selon la documentation officielle (par exemple,
   `npm install -g @colbymchenry/codegraph`, ou l'installeur pour votre OS).
   Vérifier `codegraph --help` avant la suite.
2. Exécuter **une seule fois** `codegraph install` pour relier les agents
   compatibles (Codex CLI, Claude Code, Cursor, GitHub Copilot, etc.).
   Préserver leurs configurations et skills existants.
3. Depuis la racine **de chaque dépôt cloné**, lancer `codegraph init`.
   Vérifier ensuite avec `codegraph status`. L'index reste local dans
   `.codegraph/` (ou `.codegraph-wsl/` sous WSL selon le contexte).

Pour les dépôts privés, la télémétrie anonyme peut être désactivée via
`codegraph telemetry off` ou `CODEGRAPH_TELEMETRY=0`.
Aucun graphe local n'est à versionner. La simple présence de ce skill ne
déclenche pas automatiquement l'installation ou l'indexation sur une machine.

## Usage conjoint aux autres skills

- Lire `AGENTS.md`, les consignes de sous-dossier et les skills existants.
- Pour une tâche d'architecture, d'appel de fonction, de dépendance ou
  d'analyse d'impact, utiliser prioritairement `codegraph_explore` via MCP
  **si disponible et indexé**, sinon `codegraph explore "question"`
  depuis le dépôt (suivant les commandes disponibles dans cette version).
- Réutiliser le résultat pour cibler les fichiers à changer. Si l'index est
  absent et que le CLI est installé, lancer `codegraph init` avant l'analyse.
  Après une mise à jour du CLI, reconstruire au besoin via `codegraph index`.
- Combiner CodeGraph avec Spec Kit pour la planification, Superpowers pour
  l'implémentation/QA, 3Dviz Pro Max pour la 3D et les autres skills adaptés.
  **Ne pas substituer** CodeGraph aux builds, tests ou revues visuelles.
- Si CodeGraph n'est pas disponible, poursuivre avec la lecture du code,
  la recherche et les outils habituels ; ne jamais inventer de résultat MCP.
- Les index sont auto-synchronisés pendant une session d'agent active ;
  pour un diagnostic utiliser `codegraph status` et au besoin `codegraph sync`.

Les instructions et exigences de confidentialité du dépôt restent prioritaires.
