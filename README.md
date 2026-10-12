# NYC Internship Agent

Assistant personnel pour rechercher des stages à New York (mars → août 2027) et préparer des candidatures, **avec validation humaine**.
Il est construit par phases. Ce README décrit ce qui fonctionne **réellement** aujourd'hui.

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Setup, base de données, profil candidat, import CV, Master CV, Settings | ✅ fait |
| 2 | Recherche d'offres, base d'offres, déduplication | ✅ fait |
| 3 | Analyse LLM, scoring, compatibilité des dates | ✅ fait |
| 4 | CV personnalisé, lettre de motivation | ✅ fait |
| 5 | Dashboard complet, suivi des candidatures, notifications | ⏳ à faire (compteurs du dashboard déjà branchés sur la base) |
| 6 | Navigateur contrôlé, Answer Bank, TEST MODE, `dry-run` | ⏳ à faire |
| 7 | Envoi réel des candidatures | ⏳ à faire |

Les commandes `apply` et `dry-run` existent déjà mais **refusent de s'exécuter**
(code de sortie 2, message « planned for Phase N ») tant que la phase n'est pas implémentée.

## Stack

- **Node.js 22 + TypeScript** (strict), un seul package.
- **API** : Express 5, validation **Zod** (les mêmes schémas servent au backend et au frontend).
- **Base** : **SQLite** (better-sqlite3) + **Drizzle ORM**, migrations SQL versionnées dans `src/database/migrations/`.
  Le passage à PostgreSQL est possible plus tard (Drizzle supporte les deux).
- **Frontend** : React 19 + Vite + React Router.
- **LLM** : Claude via le SDK officiel `@anthropic-ai/sdk`, derrière une interface `LlmProvider`
  (`src/llm/types.ts`) → on peut ajouter un autre fournisseur sans toucher au reste.
- **Tests** : Vitest + Supertest.

Pas de `docker-compose` : avec SQLite, rien d'autre à lancer. Il sera ajouté si on passe à PostgreSQL.

## Installation

```bash
npm install
cp .env.example .env
npm run gen:key            # copier la valeur dans ENCRYPTION_KEY du .env
# optionnel : ANTHROPIC_API_KEY=... dans .env (nécessaire pour l'extraction CV par Claude, puis Phases 3-4)
npm run dev                # API sur http://127.0.0.1:3001, interface sur http://127.0.0.1:5173
```

> ⚠️ Sauvegardez `ENCRYPTION_KEY` : sans elle, les données personnelles chiffrées de la base sont irrécupérables.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | API (rechargement auto) + interface Vite |
| `npm run build` / `npm run start` | build de production (`dist/`), puis serveur unique sur le port 3001 qui sert aussi l'interface |
| `npm run test` | tests (159 tests) |
| `npm run lint` | ESLint + vérification TypeScript |
| `npm run status` | résumé : complétude du profil, version du Master CV, mode, test mode |
| `npm run db:migrate` | applique les migrations (fait aussi automatiquement au démarrage) |
| `npm run db:generate` | génère une nouvelle migration après modification de `src/database/schema.ts` |
| `npm run gen:key` | génère une clé de chiffrement |
| `npm run search` | lance la recherche sur les boards Greenhouse/Lever configurés |
| `npm run analyze [-- --limit=N]` | analyse avec Claude les offres pas encore analysées (50 max par défaut) |
| `npm run generate [-- --limit=N]` | génère CV + lettre pour les offres GREEN/YELLOW qui n'en ont pas encore |
| `npm run apply / dry-run` | réservées aux phases 6 et 7 (pas encore implémentées) |

## Ce qui fonctionne (Phase 1)

### My Profile
Infos personnelles, autorisation de travail US, formation, expériences (réalisations, technologies, compétences),
compétences (techniques, langues, soft skills, certifications), préférences. Tout est validé (Zod) côté serveur.

**Autorisation de travail / sponsorship** : jamais devinées. Tant que vous ne les avez pas renseignées, elles restent vides
et le futur moteur de candidature devra s'arrêter pour vous demander.

### Import du CV (PDF / DOCX)
- Le fichier original est stocké **intact** dans `data/uploads/cv/<sha256>.<ext>`, en lecture seule ; un bouton
  « Verify original » recalcule le SHA-256 pour prouver qu'il n'a pas été modifié.
- Le type de fichier est vérifié par son contenu (pas seulement l'extension), 10 Mo max.
- Deux méthodes d'extraction :
  - **heuristique** (par défaut, locale, aucune donnée envoyée) : détecte contact, sections, expériences, dates, compétences.
    Approximative sur des mises en page complexes.
  - **Claude** (case à cocher, nécessite `ANTHROPIC_API_KEY`) : envoie le texte du CV à Anthropic ; le prompt
    `prompts/cv-extraction.txt` interdit toute invention, et le code signale toute entreprise / école / compétence
    extraite qui n'apparaît pas mot pour mot dans le CV.
- Le résultat est un **brouillon** : il remplit le formulaire, rien n'est enregistré tant que vous ne cliquez pas sur *Save*.

### Master CV
Snapshot **immuable et versionné** du profil vérifié (v1, v2, …), source de vérité pour toutes les candidatures.
L'interface signale quand le profil a changé depuis la dernière version.

`src/cv/truth-guard.ts` vérifie déjà qu'un CV dérivé respecte les règles : pas d'expérience, diplôme, école ou compétence
absente du Master CV, dates et GPA inchangés, autorisation de travail identique, aucun chiffre/résultat inventé.
Reformuler, réordonner, raccourcir et sélectionner restent autorisés. Il sera appliqué automatiquement aux CV personnalisés en Phase 4.

### Settings
Recherche (zones NYC, disponibilité 2027-03-01 → 2027-08-31, durées, secteurs, intitulés, score minimum, *internships only*),
seuils GREEN ≥ 90 / YELLOW ≥ 75 / RED, automatisation (mode FULL_AUTO / SEMI_AUTO / MANUAL, seuil d'auto-submit,
heure quotidienne, max 20 candidatures/jour, relance à J+7, test mode), LLM (modèle, effort, temperature, max tokens).
Par défaut : **SEMI_AUTO** et **TEST MODE activé**. Tant que `TEST_MODE=true` dans `.env`, le test mode est forcé quel que soit le réglage.

### Dashboard
Cartes branchées sur la base réelle (elles restent à 0 tant que les phases 2+ n'existent pas) et check-list de démarrage.

## Ce qui fonctionne (Phase 2)

### Sources et conditions d'utilisation
| Source | Accès automatique | Méthode |
|---|---|---|
| Greenhouse | ✅ | API publique *Job Board* (`boards-api.greenhouse.io`), prévue pour publier les offres |
| Lever | ✅ | API publique *Postings* (`api.lever.co`), prévue pour publier les offres |
| LinkedIn, Indeed, Glassdoor, Welcome to the Jungle, Workday, sites carrières | ❌ | liens de recherche générés + **import manuel** (URL + texte collé) |

Les pages LinkedIn/Indeed/etc. ne sont **jamais** téléchargées par l'application : vous ouvrez les liens dans votre navigateur
et collez l'offre. Une URL Greenhouse/Lever collée est récupérée via l'API publique.

### Page *Sources*
- **Boards d'entreprises** : collez l'URL `job-boards.greenhouse.io/<nom>` ou `jobs.lever.co/<nom>` d'une entreprise ;
  le board est vérifié avant d'être ajouté. *Run search now* (ou `npm run search`) interroge les boards un par un (1 s de pause).
- **Filtres** : seuls les **stages** (intern, internship, co-op, summer analyst… dans le titre ou le type de contrat) situés à **NYC**
  (Manhattan, Brooklyn, Queens, Bronx, Staten Island, LIC…) sont gardés ; « proche de NYC » (Jersey City, Hoboken…) est gardé et signalé ;
  remote seulement si votre profil accepte le remote. Les postes senior / manager / full-time sont exclus.
- **Import manuel** d'une offre, avec avertissement si elle ne ressemble pas à un stage à NYC.
- **Liens de recherche** générés depuis le profil (intitulés, secteurs, expériences ; à défaut les 7 requêtes du cahier des charges).
- **Historique** des recherches avec statistiques et erreurs par board.

### Données extraites de chaque offre
Entreprise, poste, lieu, description, responsabilités, exigences, salaire, type de contrat, durée, date de début/fin, période
mentionnée (« Summer 2027 », « March - August 2027 »…), date de publication, URL de candidature, source.
Uniquement ce qui est **écrit** dans l'offre (rien n'est déduit). Les compétences et l’interprétation des dates sont produites par l’analyse (Phase 3).
Une offre qui disparaît de son board est marquée *closed*. Une nouvelle recherche met à jour les offres sans toucher à leur statut.

### Déduplication
1. Même URL (après nettoyage : `utm_*`, `gh_src`, `/apply`, `www`, slash final…) ⇒ même offre, mise à jour.
2. Même entreprise (normalisée : « Inc. », « LLC »…) + titre très proche + même zone + description similaire (shingles, Jaccard ≥ 0,5)
   ⇒ regroupées : une seule ligne dans la liste, « +1 other source », et un bouton « Separate it » en cas d'erreur.

### Job Search / Job details
Tableau (entreprise, poste, lieu, salaire, publication, début, durée, source, score, statut) avec filtres (texte, score,
zone, lieu, durée, début, source, statut, offres fermées), actions *View / Shortlist / Skip*. La page d'une offre affiche tous
les détails et les autres sources de la même offre. Le score affiche « — » tant que l’offre n’a pas été analysée.

> Derrière un proxy d'entreprise, Node n'utilise pas `HTTPS_PROXY` par défaut : lancez avec `NODE_USE_ENV_PROXY=1`.

## Ce qui fonctionne (Phase 3)

### Compatibilité des dates — `isDateCompatible(job)` (`src/job-analysis/dates.ts`)
Calcul **sans IA**, au mois près, contre votre disponibilité (Settings, par défaut 2027-03 → 2027-08) :

| Offre | Résultat |
|---|---|
| « March 2027 », « Start date: April 2027 » | COMPATIBLE |
| « Summer 2027 » (juin–août) | COMPATIBLE (précision « saison ») |
| « March-August 2027 », « 6-month internship starting March 2027 » | COMPATIBLE |
| « January-February 2027 », « September 2027 start », « Fall 2027 », « Summer 2026 » | INCOMPATIBLE |
| « 12 months starting June 2027 », « 12-month internship » | INCOMPATIBLE |
| « Spring 2027 » (souvent janvier–mai aux US) | UNKNOWN : à confirmer |
| « 6-month internship » sans date, aucune date, plusieurs périodes contradictoires | UNKNOWN |
| départ avant mars mais « flexible start date » | UNKNOWN |

UNKNOWN n'est jamais deviné et empêche le classement GREEN. Seules des dates précises (mois ou jour) rendent une offre
« sûre » pour une future soumission automatique ; une saison ou des dates lues par l'IA ne le sont jamais.

### Analyse et score (`npm run analyze`, boutons « Analyse » / « Analyse new offers »)
1. **Contrôles déterministes** : dates, zone NYC, règle « stage uniquement » (visibles sans IA dans « Quick check »).
2. **Claude** (prompt `prompts/job-analysis.txt`, sortie structurée validée) évalue compétences, expérience, formation
   et préférences par rapport au **Master CV**, en citant ses preuves. Ne sont envoyés à Claude ni vos coordonnées
   ni votre autorisation de travail. Le Master CV est envoyé en contexte mis en cache (prompt caching).
3. **Vérifications** : une compétence « correspondante » sans preuve dans le Master CV est retirée ; une date ou une
   mention de sponsorship lue par l'IA n'est utilisée que si la citation figure mot pour mot dans l'offre.
4. **Score sur 100** = 30 % compétences + 20 % expérience + 10 % formation + 15 % localisation + 15 % dates
   (UNKNOWN = 50) + 10 % préférences, puis **plafonds** : pas un stage → 30 max ; dates incompatibles → 40 ;
   hors NYC → 40 ; l'offre exclut le sponsorship alors que vous en avez besoin → 40.
5. **Classement** GREEN ≥ 90 / YELLOW ≥ 75 / RED (seuils dans Settings), jamais GREEN si les dates ne sont pas confirmées.

La page de l'offre affiche le score, les barres par critère, les compétences trouvées / manquantes, les raisons,
les points d'attention, les plafonds appliqués, le détail des dates, le modèle et le coût estimé.
Coût indicatif avec `claude-opus-5-5` : environ 3–4 centimes par offre (modifiable dans Settings, ex. `claude-sonnet-5-5`).

## Ce qui fonctionne (Phase 4)

### CV personnalisé (`src/cv/tailor.ts`, prompt `resume-customization.txt`)
- Claude **ne réécrit pas** le CV librement : il choisit des expériences/formations du Master CV **par leur numéro**,
  reformule les puces, écrit le titre et le résumé, et choisit des compétences. Le code recopie entreprises, intitulés,
  lieux, dates, écoles, diplômes et GPA depuis le Master CV : ils ne peuvent pas être modifiés.
- Le **garde-fou de véracité** est appliqué systématiquement : compétence absente du Master CV → retirée ; puce avec un
  chiffre inventé → remplacée par la puce originale ; résumé avec un chiffre inventé → résumé du Master CV.
  S'il reste une violation, aucun fichier n'est produit. Les langues du Master CV sont toujours conservées.
- Détection du *keyword stuffing* (mot-clé répété plus de 4 fois).
- Fichiers : `generated/cv/{job_id}/resume.pdf`, `resume.docx`, `metadata.json` (+ historique `v1/`, `v2/`…).
  Mise en page ATS : une colonne, titres standards, vrai texte (vérifié par relecture automatique du PDF/DOCX).

### Lettre de motivation (`src/cover-letter/`, prompt `cover-letter.txt`)
- Utilise uniquement le Master CV, **vos motivations** (nouveau champ dans *My Profile*) et l'offre.
  Sans motivations écrites, la lettre reste factuelle et n'invente aucun « rêve » ou raison personnelle.
- Chaque affirmation doit citer mot pour mot sa source. Sont signalés : formules toutes faites (« I am writing to express
  my keen interest »…), affirmations sans citation, chiffres absents de vos documents, entreprise non nommée, longueur.
  En cas de problème, Claude réécrit une fois avec ces remarques ; s'il en reste, la lettre est marquée « à relire ».
- Vous pouvez **modifier la lettre** dans l'interface : nouvelle version, re-vérifiée et re-générée en PDF/DOCX/TXT.
- Fichiers : `generated/cover-letters/{job_id}/cover-letter.pdf`, `.docx`, `.txt`, `metadata.json` (+ `v1/`…).

### Règles de déclenchement
GREEN et YELLOW (réglable dans *Settings → Documents*) : génération par « Generate CVs & letters » ou `npm run generate`.
RED ou offre non analysée : rien n'est généré automatiquement ; bouton « Generate anyway » sur l'offre.
Chaque génération crée/avance la candidature correspondante (CV_CREATED → COVER_LETTER_CREATED) avec un historique ;
elle reste une **simulation** tant que rien n'a été envoyé (Phases 6-7).

## Sécurité et données personnelles

- Le serveur écoute uniquement sur `127.0.0.1` par défaut.
- Chiffrement **AES-256-GCM** au repos des champs personnels (nom, email, téléphone, liens, localisation,
  autorisation de travail), du texte extrait des CV, des versions du Master CV et des futures réponses/lettres.
- `.gitignore` exclut : `.env`, `data/` (base + CV), `generated/`, `logs/`, tout `*.pdf` / `*.docx`, profils navigateur, cookies.
- Aucune donnée personnelle n'est écrite dans le code ; les tests utilisent un candidat fictif.

## Claude / LLM

- Modèle par défaut : `claude-opus-5-5` (modifiable dans Settings ou via `ANTHROPIC_MODEL`).
- Sorties structurées validées par Zod (`messages.parse`).
- La *temperature* est ignorée pour les modèles qui ne l'acceptent plus (famille Opus 5.x) ; la profondeur se règle avec *effort*.
- Le *refusal fallback* serveur d'Anthropic (bêta) est activé par défaut pour les modèles compatibles ; désactivable dans Settings.
- Les prompts sont dans `/prompts/*.txt`. `cv-extraction.txt`, `job-analysis.txt`, `resume-customization.txt` et `cover-letter.txt` sont utilisés ;
  `job-ranking.txt` et `application-question.txt` sont des brouillons (Phase 6).
  Le classement des offres se fait par le score calculé (pas d'appel LLM supplémentaire).

## Architecture

```
prompts/                  prompts LLM éditables
src/
  config/                 variables d'environnement (validées) et chemins
  database/               schéma Drizzle (15 tables + cv_documents), client, migrations
  models/                 schémas Zod + types partagés backend/frontend
  services/               logique métier (profil, settings, Master CV, import CV, recherche, analyse, documents)
  cv/                     extraction CV, truth-guard, personnalisation (tailor) et rendu PDF/DOCX du CV
  llm/                    interface LlmProvider, implémentation Anthropic, chargement des prompts
  api/                    application Express + routes
  frontend/               interface React (Vite)
  utils/                  chiffrement, logger, erreurs
  job-search/             connecteurs Greenhouse/Lever, filtres NYC/stage, extraction, déduplication, requêtes
  job-analysis/           isDateCompatible, schéma de sortie LLM, formule de score et plafonds
  cover-letter/           vérification et rendu PDF/DOCX des lettres
  documents/              utilitaires de rendu communs
  application/ browser/ notifications/
                          modules des phases suivantes (README de cadrage uniquement)
  server.ts, cli.ts       points d'entrée
tests/                    tests Vitest (+ génération de CV PDF/DOCX fictifs)
```

Tables : `users`, `candidate_profiles`, `education`, `experiences`, `skills`, `cv_documents`, `jobs`, `job_sources`, `company_boards`, `search_runs`,
`job_analysis`, `resumes`, `cover_letters`, `applications`, `application_answers`, `application_events`, `settings`, `notifications`.

Les logs vont dans la console et `logs/app.log`, au format `[08:02] message` ; les erreurs d'étape au format
`[ERROR] Company / Job / Step / Reason`.

## Principes non négociables

- Ne jamais inventer d'information (CV, lettre, réponse de formulaire).
- Ne jamais contourner CAPTCHA, anti-bot, MFA ou authentification : l'outil s'arrête et vous demande.
- Respecter les conditions d'utilisation des plateformes : sans automatisation autorisée, mode manuel ou semi-automatique.
- Une candidature n'est « APPLIED » que si le site a confirmé la soumission.

## Note

`index.html`, `style.css` et `imageni.jpg` à la racine sont des fichiers antérieurs au projet ; ils n'ont pas été modifiés.
