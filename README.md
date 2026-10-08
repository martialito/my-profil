# NYC Internship Agent

Assistant personnel pour rechercher des stages à New York (mars → août 2027) et préparer des candidatures, **avec validation humaine**.
Il est construit par phases. Ce README décrit ce qui fonctionne **réellement** aujourd'hui.

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Setup, base de données, profil candidat, import CV, Master CV, Settings | ✅ fait |
| 2 | Recherche d'offres, base d'offres, déduplication | ⏳ à faire |
| 3 | Analyse LLM, scoring, compatibilité des dates | ⏳ à faire |
| 4 | CV personnalisé, lettre de motivation | ⏳ à faire |
| 5 | Dashboard complet, suivi des candidatures, notifications | ⏳ à faire (compteurs du dashboard déjà branchés sur la base) |
| 6 | Navigateur contrôlé, Answer Bank, TEST MODE, `dry-run` | ⏳ à faire |
| 7 | Envoi réel des candidatures | ⏳ à faire |

Les commandes `search`, `analyze`, `generate`, `apply` et `dry-run` existent déjà mais **refusent de s'exécuter**
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
| `npm run test` | tests (53 tests) |
| `npm run lint` | ESLint + vérification TypeScript |
| `npm run status` | résumé : complétude du profil, version du Master CV, mode, test mode |
| `npm run db:migrate` | applique les migrations (fait aussi automatiquement au démarrage) |
| `npm run db:generate` | génère une nouvelle migration après modification de `src/database/schema.ts` |
| `npm run gen:key` | génère une clé de chiffrement |
| `npm run search / analyze / generate / apply / dry-run` | réservées aux phases 2 à 7 (pas encore implémentées) |

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
- Les prompts sont dans `/prompts/*.txt`. Seul `cv-extraction.txt` est utilisé aujourd'hui ; les autres
  (`job-analysis`, `job-ranking`, `resume-customization`, `cover-letter`, `application-question`) sont des brouillons pour les phases 3 à 6.

## Architecture

```
prompts/                  prompts LLM éditables
src/
  config/                 variables d'environnement (validées) et chemins
  database/               schéma Drizzle (15 tables + cv_documents), client, migrations
  models/                 schémas Zod + types partagés backend/frontend
  services/               logique métier (profil, settings, Master CV, import CV)
  cv/                     extraction texte PDF/DOCX, extraction heuristique / LLM, truth-guard
  llm/                    interface LlmProvider, implémentation Anthropic, chargement des prompts
  api/                    application Express + routes
  frontend/               interface React (Vite)
  utils/                  chiffrement, logger, erreurs
  job-search/ job-analysis/ cover-letter/ application/ browser/ notifications/
                          modules des phases suivantes (README de cadrage uniquement)
  server.ts, cli.ts       points d'entrée
tests/                    tests Vitest (+ génération de CV PDF/DOCX fictifs)
```

Tables : `users`, `candidate_profiles`, `education`, `experiences`, `skills`, `cv_documents`, `jobs`, `job_sources`,
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
