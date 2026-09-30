# Carnet repas

Mon suivi personnel, en un seul site :

- **Sur le PC** : un calendrier du mois. Chaque case montre la photo du repas, le titre de la recette et, le mardi, le poids de la pesée. Un clic sur une case ouvre le détail de la journée.
- **Sur le téléphone** : le même site, installé comme une application (icône sur l'écran d'accueil). Il s'ouvre sur la journée du jour avec trois blocs :
  - 🍽️ **Repas** : prendre une photo, qui s'enregistre dans la journée.
  - 📖 **Recette** : photographier la fiche (recto et verso si besoin). Gemini la lit automatiquement et la réécrit simplement : titre, liste des ingrédients, étapes. Tu relis et corriges, puis tu enregistres. En secours, tu peux envoyer la photo à ton app IA habituelle (Claude, ChatGPT, Gemini…) et coller sa réponse : la recette se remplit toute seule.
  - ⚖️ **Pesée**, seulement le mardi : photo de la balance et poids saisi à la main.

**Coût : 0 €.** Supabase, GitHub (Pages et Actions) et l'offre gratuite de l'API Gemini ne demandent pas de carte bancaire. Sur l'offre gratuite, Google peut utiliser les photos de fiches recettes pour améliorer ses produits. Tes photos de repas et tes pesées ne lui sont jamais envoyées.

## Comment ça marche

```
Toi (ou Claude) : modification du code ──► git push sur GitHub
                                               │
                        GitHub Actions (automatique, ~2 min)
                          ├─ Supabase : base de données, clé Gemini, fonction « lire-recette »
                          └─ GitHub Pages : site publié avec un nouveau numéro de version
                                               │
Téléphone / PC ◄── l'appli voit la nouvelle version et se recharge toute seule
   │  connexion email + mot de passe
   ▼
Supabase (gratuit)
   ├─ base de données : une ligne par journée (table days)
   ├─ stockage privé : les photos (bucket photos)
   └─ Edge Function « lire-recette » ──► API Gemini, offre gratuite
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Le site (interface calendrier + jour, mises à jour) |
| `api.js` | Tous les échanges avec Supabase |
| `config.js` | Seulement pour tester en local : en ligne, il est généré depuis les secrets GitHub |
| `manifest.webmanifest`, `icons/` | Installation comme application sur le téléphone |
| `supabase/migrations/` | Structure de la base, appliquée automatiquement |
| `supabase/functions/lire-recette/index.ts` | La fonction qui envoie la photo de recette à Gemini |
| `.github/workflows/deploiement.yml` | Le déploiement automatique |

---

## Mise en place guidée (une seule fois, environ 30 minutes)

Au fil des étapes, tu vas récupérer **5 valeurs**, à ranger au même endroit dans GitHub (étape 5). Garde un bloc-notes ouvert pour les noter au fur et à mesure :

| Nom du secret | Où le trouver | Étape |
|---|---|---|
| `SUPABASE_PROJECT_REF` | Identifiant du projet Supabase | 1 |
| `SUPABASE_DB_PASSWORD` | Mot de passe de la base, choisi à la création | 1 |
| `SUPABASE_PUBLISHABLE_KEY` | Clé publique `sb_publishable_…` | 1 |
| `SUPABASE_ACCESS_TOKEN` | Jeton d'accès `sbp_…` | 2 |
| `GEMINI_API_KEY` | Clé Gemini gratuite | 3 |

### Étape 1 · Créer le projet Supabase

1. Va sur <https://supabase.com>, clique **Start your project** et crée un compte (avec GitHub, c'est le plus simple).
2. Clique **New project** :
   - **Name** : `carnet-repas`
   - **Database Password** : clique **Generate a password**, puis **copie-le tout de suite** → c'est `SUPABASE_DB_PASSWORD`.
   - **Region** : une région en Europe (par exemple Paris ou Frankfurt).
   - Clique **Create new project** et attends 1 à 2 minutes.
3. Récupère l'identifiant du projet. Dans l'adresse du navigateur `https://supabase.com/dashboard/project/abcdefghijklmnop`, c'est la suite de lettres après `project/` → `SUPABASE_PROJECT_REF`.
4. Récupère la clé publique : **Project Settings** (roue dentée en bas à gauche) → **API Keys** → copie la **Publishable key** (`sb_publishable_…`) → `SUPABASE_PUBLISHABLE_KEY`.

Tu n'as rien à coller dans l'éditeur SQL : la base sera créée automatiquement au premier déploiement.

### Étape 2 · Jeton d'accès Supabase

Ce jeton permet à GitHub de mettre à jour ton projet Supabase à chaque nouvelle version.

1. Va sur <https://supabase.com/dashboard/account/tokens>.
2. **Generate new token**, nom `github-carnet-repas`, puis **Generate token**.
3. Copie-le (`sbp_…`) → `SUPABASE_ACCESS_TOKEN`. Il ne sera plus affiché ensuite.

### Étape 3 · Clé Gemini gratuite

1. Va sur <https://aistudio.google.com> et connecte-toi avec ton compte Google.
2. **Get API key** → **Create API key**, puis copie la clé → `GEMINI_API_KEY`.
3. **N'active pas la facturation (« billing »)** : sans elle, tu restes sur l'offre gratuite et rien ne peut t'être facturé.

### Étape 4 · Créer le dépôt GitHub

1. Va sur <https://github.com/new>.
2. **Repository name** : `carnet-repas`. Choisis **Public** (nécessaire pour GitHub Pages gratuit). Ne coche rien d'autre, puis **Create repository**.

Aucune donnée personnelle n'est dans le code : les photos et recettes restent dans Supabase, protégées par ta connexion, et les clés sont dans les secrets GitHub, jamais visibles.

### Étape 5 · Ranger les 5 secrets dans GitHub

Dans ton dépôt : **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Recommence pour chacun des 5 secrets du tableau ci-dessus :

- **Name** : le nom exact (par exemple `GEMINI_API_KEY`) ;
- **Secret** : la valeur copiée ;
- puis **Add secret**.

À la fin, la liste **Repository secrets** doit montrer les 5 noms.

### Étape 6 · Activer GitHub Pages

Dans ton dépôt : **Settings** → **Pages** → **Build and deployment** → **Source** : choisis **GitHub Actions**. Il n'y a rien d'autre à enregistrer.

### Étape 7 · Envoyer le code

Le dépôt local est déjà prêt, avec un premier commit. Depuis ce dossier :

```bash
git remote add origin https://github.com/TON-PSEUDO/carnet-repas.git
```

```bash
git push -u origin main
```

Ensuite, dans l'onglet **Actions** du dépôt, le déploiement « Déploiement » démarre. Au bout de 2 à 3 minutes, les deux étapes doivent être vertes ✅. L'adresse du site s'affiche sous l'étape **Site web** : `https://TON-PSEUDO.github.io/carnet-repas/`.

Si une étape est rouge ❌, clique dessus. L'étape « Vérifier les secrets » indique précisément quel secret manque. Corrige-le, puis **Re-run all jobs**.

### Étape 8 · Créer ton compte et fermer les inscriptions

Dans Supabase :

1. **Authentication** → **Users** → **Add user** → **Create new user** : ton email et un mot de passe, et coche **Auto Confirm User**.
2. **Authentication** → **Sign In / Providers** : désactive **Allow new users to sign up**.
   C'est important : sinon, n'importe qui pourrait se créer un compte sur ton site et consommer ton quota Gemini gratuit.

### Étape 9 · Installer l'application sur le téléphone

- **Android (Chrome)** : ouvre l'adresse du site, connecte-toi, puis menu **⋮** → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
- **iPhone (Safari)** : ouvre l'adresse, connecte-toi, puis **Partager** → **Sur l'écran d'accueil**.

L'icône ouvre directement la journée du jour. Tu restes connecté.

---

## Mises à jour automatiques

Chaque `git push` sur `main` redéploie tout, sans rien à faire de plus :

- **Base de données** : les nouveaux fichiers de `supabase/migrations/` sont appliqués (une seule fois chacun).
- **Fonction de lecture de recette** : redéployée avec la clé Gemini à jour.
- **Site** : republié avec un nouveau numéro de version.
- **Appli sur le téléphone et le PC** : elle vérifie s'il existe une nouvelle version à l'ouverture, à chaque retour dessus et toutes les 30 minutes.
  - Si tu n'es pas en train de saisir quelque chose, elle se recharge toute seule et affiche « Application mise à jour ✓ ».
  - Sinon, un bandeau **Nouvelle version disponible → Mettre à jour** apparaît, pour ne rien perdre.

La version installée est affichée tout en bas de l'appli (« Version du 30/09/2026 · a1b2c3d »).

Pour une modification, demande-la à Claude dans ce dossier, puis envoie-la :

```bash
git push
```

Changer une clé (par exemple une nouvelle clé Gemini) : mets à jour le secret dans GitHub, puis **Actions** → **Déploiement** → **Run workflow**.

## Au quotidien

- **Repas** : 📷 *Prendre une photo*. C'est enregistré tout de suite.
- **Recette** : 📷 *Photographier la recette*. Si la liste d'ingrédients est sur l'autre face, ajoute-la avec *Autre page*, puis ✨ *Lire la recette*. Relis le résultat, corrige si besoin, puis *Enregistrer la recette*.
- **Si Gemini ne répond pas** (quota atteint, modèle retiré…) : ↗️ *Envoyer à une app IA*. Le menu de partage du téléphone s'ouvre : choisis Claude, ChatGPT ou Gemini. La photo part avec la consigne, qui est aussi copiée au cas où l'app ne la reprendrait pas. Dans l'app, copie la réponse, reviens sur le site, 📋 *Coller*, puis *Remplir la recette*.
- Tu peux aussi coller une réponse d'IA obtenue autrement (📋 *Coller une réponse d'IA*) ou écrire la recette à la main.
- **Pesée (mardi)** : photo de la balance, saisie du poids, puis *Enregistrer la pesée*.
- Pour remplir un autre jour, change la date avec les flèches ‹ › ou le sélecteur de date.

## Tester sur le PC (facultatif)

Remplis `config.js` avec l'URL (`https://<SUPABASE_PROJECT_REF>.supabase.co`) et la clé publique. Puis, depuis ce dossier :

```bash
python -m http.server 8000
```

Ouvre <http://localhost:8000>. En local, le bas de page affiche « Version locale (non déployée) » et il n'y a pas de mise à jour automatique.

## Dépannage

| Problème | Piste |
|---|---|
| Déploiement rouge à « Vérifier les secrets » | Le message indique le secret manquant : ajoute-le (étape 5), puis **Re-run all jobs**. |
| Déploiement rouge à « Relier le projet » ou « Appliquer les migrations » | Vérifie `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`. Le mot de passe se réinitialise dans Supabase → **Project Settings** → **Database**. |
| Déploiement rouge à « Site web » | Vérifie que **Settings** → **Pages** → **Source** est bien sur **GitHub Actions** (étape 6). |
| « Email ou mot de passe incorrect » | Vérifie que l'utilisateur est bien confirmé (Authentication → Users). |
| « Clé Gemini invalide » | Corrige le secret `GEMINI_API_KEY` dans GitHub, puis **Run workflow**. |
| « Quota gratuit de Gemini atteint » | Réessaie plus tard, ou passe par ↗️ *Envoyer à une app IA*. |
| « Modèle … introuvable » | Google a retiré ce modèle : remplace `MODEL` dans `supabase/functions/lire-recette/index.ts` par un modèle *Flash* gratuit plus récent (liste sur <https://ai.google.dev/gemini-api/docs/pricing>), puis `git push`. En attendant, utilise ↗️ *Envoyer à une app IA*. |
| Le projet Supabase est « paused » | Les projets gratuits se mettent en pause après 7 jours sans utilisation : clique **Restore** dans le tableau de bord. |
