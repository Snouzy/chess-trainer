# Chess Trainer — design V1

Date : 2026-09-27. Statut : validé en brainstorming (sections 1 et 2 approuvées, le reste décidé par délégation, voir §12).

## 1. Intention

Apprendre une ouverture par cœur. Je choisis une ouverture (ex. défense française). L'app construit un répertoire à partir des parties réelles, puis joue l'adversaire comme le jouent les humains de mon niveau. Je dois retrouver mon coup à chaque position.

- **Public** : moi d'abord, public ensuite. La V1 n'a pas de compte applicatif. L'architecture permet d'ajouter un serveur plus tard sans réécrire la logique.
- **Plateforme** : web uniquement (PWA installable plus tard). Pas de mobile natif en V1.
- **Licence** : GPL-3.0 (imposée par chessground, chessops, Stockfish).

**Critères de succès V1**

1. Je crée un répertoire « Défense française, Noirs, 1200–1599, rapide ». La génération se termine en moins de 30 min et reprend si je ferme l'onglet.
2. Je m'entraîne en boucle sur ce répertoire sans réseau.
3. Après une session, je vois les positions où je me trompe le plus.
4. Je remplace un de mes coups par un autre. Le sous-arbre se régénère.

## 2. Périmètre

**V1**

- Connexion Lichess (OAuth PKCE, sans serveur).
- Création d'un répertoire depuis une ouverture nommée.
- Génération avec progression et reprise.
- Vue Explorer/Édition : parcourir l'arbre, voir les stats, changer un coup, ajouter ou retirer une branche.
- Mode Entraînement « lignes en boucle ».
- Stats par position.
- Export/import JSON, export PGN.

**Hors V1** : voir §11.

## 3. Sources de données (vérifiées le 2026-09-27)

**Explorateur Lichess** : `https://explorer.lichess.org/lichess`.
- Token OAuth obligatoire depuis le 2026-03-03, sans scope particulier.
- Limite : 25 requêtes/min par utilisateur. Sur une réponse 429, attendre 60 s.
- CORS ouvert (`Access-Control-Allow-Origin: *`, en-tête `Authorization` autorisé), testé.
- Le token ne doit jamais être embarqué dans le bundle : chaque utilisateur se connecte avec son compte.
- Filtres : `speeds`, `ratings` (tranches 0, 1000, 1200 … 2200, 2500), `since`/`until`.
- Réponse : `white/draws/black` par coup, avec `uci`, `san`, `averageRating`, `opening{eco,name}`.

**Moteur** : Stockfish WASM, variante mono-thread, dans un Web Worker. Pas de SharedArrayBuffer, donc pas d'en-têtes COOP/COEP.

**Noms d'ouvertures** : `lichess-org/chess-openings` (CC0, environ 3 815 lignes avec ECO, nom et coups). Le fichier est embarqué au build.

## 4. Architecture

```
chess-trainer/                 pnpm + Turborepo, GPL-3.0
├── apps/web                   Vite + React + TS
│   ├── ui/                    écrans, chessground, panneau de stats
│   ├── engine/                Stockfish WASM en Web Worker (UCI) → implémente Engine
│   └── storage/               IndexedDB (Dexie) : répertoires, nœuds, caches
├── packages/core              TS pur, aucune I/O
│   ├── types                  Repertoire, RepNode, Settings…
│   ├── generate               génération et régénération de sous-arbre
│   ├── drill                  choix de ligne, validation, stats
│   └── ports                  ExplorerSource, Engine, RepertoireStore
└── packages/lichess           OAuth PKCE, client explorer, file 25/min → implémente ExplorerSource
```

**Règle de dépendance** : `core` ne dépend de rien. `lichess` dépend de `core` (types et ports). `web` dépend des deux et câble les implémentations.

```ts
interface ExplorerSource {
  query(fen: string, filters: ExplorerFilters): Promise<ExplorerResult>
}
interface Engine {
  // évals en centipions, du point de vue du camp au trait ; mat = ±(100000 − ply)
  evaluate(fen: string, candidates: Uci[]): Promise<EngineResult>
}
type EngineResult = { best: { uci: Uci; cp: number }; candidates: Record<Uci, number>; depth: number }
interface RepertoireStore {
  putNode(node: RepNode): Promise<void>
  getNode(repertoireId: string, path: string): Promise<RepNode | undefined>
  unexpandedNodes(repertoireId: string): Promise<RepNode[]>
  nodesAt(repertoireId: string, positionKey: PositionKey): Promise<RepNode[]>
  deleteSubtree(repertoireId: string, path: string): Promise<void>  // le nœud et tous ses descendants
  getChoice(repertoireId: string, positionKey: PositionKey): Promise<Choice | undefined>
  putChoice(choice: Choice): Promise<void>
}
```

Le drill reste pur : il reçoit l'arbre et renvoie des événements (`statUpdate`, `lineFinished`). `apps/web` les persiste.

- **Cache de l'explorateur** : un décorateur `CachedExplorerSource` enveloppe la source et persiste dans IndexedDB. La clé vaut `source|filtres|positionKey`. Chaque entrée garde `fetchedAt`, sans expiration en V1.
- **Cache moteur** : clé `positionKey`, avec les évals des candidats et la profondeur.
- **`positionKey`** : FEN sans les compteurs demi-coup et coup (4 premiers champs). La case en passant n'est gardée que si une prise en passant est légale, pour que les transpositions coïncident.

## 5. Modèle de données

```ts
type Uci = string
type PositionKey = string
type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'

interface Settings {
  ratings: number[]          // tranches Lichess, défaut [1200, 1400]
  speeds: Speed[]            // défaut ['rapid']
  minLineProbability: number // défaut 0.01
  engineToleranceCp: number  // défaut 30
  minGames: number           // défaut 50
  maxPly: number             // défaut 30
}

interface Repertoire {
  id: string
  name: string               // nom de l'ouverture choisie
  color: 'white' | 'black'
  rootMoves: Uci[]           // préfixe imposé, ex. ['e2e4', 'e7e6']
  settings: Settings
  status: 'generating' | 'paused' | 'ready' | 'error'
  createdAt: number
  updatedAt: number
}

// Un nœud = une position atteinte par un chemin précis (arbre, pas DAG)
interface RepNode {
  repertoireId: string
  path: string               // coups UCI depuis la position initiale, séparés par un espace ('' = départ)
  positionKey: PositionKey
  ply: number
  probability: number        // probabilité conditionnelle de la ligne après le préfixe
  side: 'mine' | 'theirs'    // qui est au trait
  expanded: boolean
  replies?: { uci: Uci; share: number; forced?: boolean }[] // nœuds 'theirs' seulement
  leafReason?: 'threshold' | 'minGames' | 'maxPly' | 'noMoves'
}

// Mon coup, stocké par position : même position = même réponse (transpositions)
interface Choice { repertoireId: string; positionKey: PositionKey; uci: Uci; source: 'auto' | 'user' | 'prefix' }

// Ma connaissance est attachée à la position, pas au chemin
interface PositionStats {
  repertoireId: string
  positionKey: PositionKey
  attempts: number
  errors: number
  lastResult?: 'ok' | 'ko'
  lastSeenAt?: number
}
```

Tables Dexie :
- `repertoires` [id]
- `nodes` [repertoireId+path], indexées aussi par [repertoireId+positionKey]. Pas d'index sur `expanded` : IndexedDB n'indexe pas les booléens, on filtre en mémoire.
- `choices` [repertoireId+positionKey]
- `stats` [repertoireId+positionKey]
- `explorerCache` [key]
- `engineCache` [positionKey]

Pour un nœud `mine`, l'enfant est `path + ' ' + choices[positionKey]`. On ne stocke pas de liste d'enfants, donc pas de duplication.

## 6. Génération

**Préfixe** : les coups de l'ouverture choisie sont imposés.
- Nœuds `theirs` du préfixe : `replies = [{ uci, share: 1 }]`, sans requête.
- Nœuds `mine` du préfixe : `choice.source = 'prefix'`.
- La probabilité vaut 1 à la fin du préfixe.

**Boucle** : file de priorité en mémoire, triée par `probability` décroissante. Au démarrage et à la reprise, on la reconstruit depuis les nœuds `expanded = false` du répertoire. Chaque nœud traité est persisté immédiatement.

```
pour le nœud le plus probable :
  si aucun coup légal (mat, pat) → feuille 'noMoves'

  side = mine :                                       // pas de condition d'arrêt ici
    si un Choice existe déjà pour positionKey → le réutiliser (transposition)
    sinon :
      stats = explorer.query(positionKey, filtres)    // cache, sinon file 25/min
      candidats = jusqu'à 5 coups les plus joués (peut être vide)
      r = engine.evaluate(fen, candidats)
      coup = premier candidat (ordre de popularité) avec éval >= r.best.cp − toleranceCp
             sinon r.best.uci
      enregistrer Choice(source 'auto')
    créer l'enfant avec la même probabilité

  side = theirs :
    si ply >= maxPly → feuille 'maxPly'
    stats = explorer.query(positionKey, filtres)
    si stats.total < minGames → feuille 'minGames'
    pour chaque coup : p = probability × games(coup) / total
    replies = coups avec p >= minLineProbability (share = games/total)
    si replies est vide → feuille 'threshold'
    créer un enfant par reply
```

Les conditions d'arrêt ne s'appliquent qu'aux nœuds `theirs`. Toute ligne se termine donc juste après mon coup, et chaque ligne entraînée finit sur quelque chose à retenir.

- **Borne** : les feuilles sont des lignes disjointes de probabilité ≥ seuil. Au seuil de 1 %, il y a donc au plus environ 100 lignes, soit quelques centaines de positions.
- **Moteur** : ses évaluations s'exécutent pendant l'attente du créneau réseau.
- **Progression** : nombre de nœuds traités et nombre de nœuds en file. Le temps estimé vaut le nombre de nœuds en file hors cache × 2,4 s.
- **Pause** : si l'onglet se ferme ou si le réseau tombe, `status = 'paused'`. La génération reprend au prochain chargement ou quand on clique « Reprendre ».

**Régénération de sous-arbre**, une seule fonction pour les trois opérations d'édition :

| Opération | Effet |
|---|---|
| `changeChoice(positionKey, uci)` | Met à jour le Choice (`source 'user'`). Pour chaque nœud `mine` de cette position, supprime les descendants, recrée l'enfant non développé, puis relance la génération. |
| `removeReply(path, uci)` | Retire la réponse et supprime le sous-arbre. |
| `addReply(path, uci)` | Ajoute la réponse avec `forced: true` et son vrai `share`. L'enfant reçoit la probabilité du parent : le sous-arbre est généré comme si c'était la réponse principale. |

## 7. Entraînement (« lignes en boucle »)

- **Point de départ** : la racine, ou n'importe quel nœud via « Entraîner depuis ici ». On peut ainsi travailler une variante rare. Les coups jusqu'au point de départ sont rejoués automatiquement.
- **Tour de l'adversaire** : il tire une réponse au hasard, pondérée par `share`, parmi les `replies`, puis la joue après 400 ms. Le hasard passe par une fonction `rng` injectée, pour des tests déterministes.
- **Mon tour** :
  - Coup attendu : on passe au coup suivant.
  - Autre coup légal : la pièce revient, une flèche montre le bon coup, et je dois le jouer pour continuer. Une erreur est comptée une seule fois par position et par ligne.
  - `stats[positionKey]` est mis à jour.
- **Fin de ligne** (feuille) : on affiche un bilan (« Ligne terminée, 2 erreurs »). Une ligne avec erreurs est rejouée une fois tout de suite. Sinon, on tire une nouvelle ligne.
- **Réseau** : l'entraînement n'en utilise pas. Toutes les données sont dans l'arbre.
- **Panneau de droite pendant l'entraînement** :
  - Avant mon coup : nom de l'ouverture (préfixe le plus long trouvé dans chess-openings) et « À toi de jouer ». Les stats restent masquées pour ne pas donner la réponse.
  - Après mon coup : les stats de la position depuis le cache (coups, % de parties, barre victoires/nulles/défaites, éval moteur si connue), avec mon coup de répertoire mis en évidence.

## 8. Interface

**Écrans**

1. **Accueil** : liste des répertoires (nom, couleur, nombre de positions, % de positions dont le dernier essai est réussi, statut), bouton « Nouveau répertoire », état de connexion Lichess.
2. **Nouveau répertoire** : recherche d'ouverture (filtre texte sur chess-openings), couleur (pré-remplie, modifiable), tranches Elo, cadences, réglages avancés repliés, puis « Générer ». La connexion Lichess est exigée à cette étape.
3. **Génération** : progression, temps estimé, Pause/Reprendre, erreurs affichées. On peut quitter l'écran : la génération continue tant qu'un onglet de l'app est ouvert.
4. **Explorer / Éditer** :
   - échiquier, liste des coups de la ligne courante, panneau de stats de la position ;
   - clic sur un coup du panneau : on navigue ;
   - sur un nœud `mine` : « Choisir ce coup » ;
   - sur un nœud `theirs` : « Ajouter cette branche » ou « Retirer » ;
   - « Entraîner depuis ici ».
5. **Entraînement** : échiquier, panneau (§7), compteur de lignes et d'erreurs de la session.
6. **Stats** : positions triées par taux d'erreur, avec un clic pour ouvrir la position dans Explorer.

**Mise en page** : échiquier à gauche et panneau à droite sur desktop. Sur mobile, les deux s'empilent (échiquier en haut). La largeur du téléphone ne doit pas créer de défilement horizontal.

**Langue** : interface en français en V1. Les noms d'ouvertures restent en anglais (dataset Lichess).

## 9. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Pas de token ou 401 | Génération arrêtée, statut conservé à `generating`, bannière « Connecte-toi à Lichess ». Reprise automatique après connexion. |
| 429 | Attente de 60 s. Le statut « Limite Lichess atteinte, reprise dans X s » est visible. |
| Hors ligne ou erreur réseau | Génération en pause, reprise manuelle. L'entraînement fonctionne. |
| Erreur 5xx | 3 tentatives avec backoff (5 s, 15 s, 45 s), puis pause. |
| Moteur non chargé (WASM indisponible) | Génération bloquée avec un message explicite. Pas de repli silencieux vers « le plus joué ». |
| Réponse explorer invalide | Le nœud devient une feuille `noMoves`, l'erreur est journalisée dans la console, la génération continue. |
| Import JSON invalide | Refus avec le message de validation. Aucune écriture partielle (transaction Dexie). |

## 10. Tests

- **`packages/core` (Vitest)**, avec `ExplorerSource` et `Engine` factices :
  - le seuil de probabilité borne l'arbre ;
  - la tolérance choisit le coup populaire, avec repli sur le meilleur coup moteur ;
  - une transposition réutilise le Choice ;
  - le préfixe est respecté ;
  - la reprise après interruption donne le même arbre qu'une génération d'une traite ;
  - `changeChoice`, `addReply` et `removeReply` produisent le bon sous-arbre ;
  - pour le drill : validation du coup, comptage d'erreur unique, rejeu de la ligne ratée, tirage pondéré avec `rng` injecté ;
  - `positionKey` : compteurs retirés, case en passant normalisée.
- **`packages/lichess` (Vitest)** :
  - parsing d'une réponse réelle (fixture) ;
  - file limitée à 25/min avec des timers factices ;
  - attente de 60 s sur 429 ;
  - backoff sur 5xx ;
  - construction de l'URL (filtres) ;
  - PKCE (verifier et challenge S256).
- **`apps/web`** : pas de tests de composants en V1. Un smoke test manuel via Chrome DevTools couvre la connexion, la génération d'un petit répertoire (seuil 5 %), l'entraînement d'une ligne et l'édition d'un coup.

## 11. Évolutions (hors V1)

- Révision espacée (FSRS) par position.
- Source « Maîtres » (`/masters`) : même interface, une autre implémentation d'`ExplorerSource`.
- `apps/api` : synchronisation entre appareils et cache explorer partagé entre utilisateurs.
- Explorateur auto-hébergé (`lila-openingexplorer` sur un sous-ensemble des dumps CC0) si la limite de 25/min devient le goulot.
- i18n (anglais) avant l'ouverture au public.
- PWA hors ligne complète, puis mobile natif.

## 12. Décisions prises par délégation

Décidées sans validation explicite, après « arrête de me demander ». À relire :

- Interface en français. Outils : Biome (lint + format), React Router, Tailwind v4.
- Réglages par défaut de §5 (tranches 1200–1599 et cadence rapide, choisies par l'utilisateur ; seuil 1 %, tolérance 30 cp, 50 parties minimum, 30 demi-coups).
- 5 candidats évalués par position `mine`.
- Arbre par chemin, mais coup et stats par position.
- Branche forcée : générée avec la probabilité du parent, entraînée avec son vrai `share`, accessible via « Entraîner depuis ici ».
- Tirage de l'adversaire pondéré par la fréquence réelle. Une ligne ratée est rejouée une fois.
- Token Lichess dans `localStorage`, `client_id = 'chess-trainer'`. L'OAuth redirige vers la racine de l'app (`?code=`), et le routage se fait par hash (`#/r/:id/drill`) avec `wouter` : aucun réglage de réécriture chez l'hébergeur.
- Génération : une seule à la fois. Les répertoires au statut `generating` passent l'un après l'autre. Une erreur d'authentification laisse le statut à `generating`, pour une reprise automatique après connexion. Une erreur réseau le passe à `paused`.
- Roque : le format interne est `e1g1` (Stockfish, chess-openings). Les `e1h1` de l'explorateur et de chessground sont normalisés à l'entrée.
- Pas d'expiration du cache explorer en V1.
