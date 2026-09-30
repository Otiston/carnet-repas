# Guide d'installation pas à pas

Ce guide te fait mettre en ligne **Carnet repas** en suivant chaque clic. Compte **45 minutes environ**, à faire **une seule fois**, sur ton **PC**. À la fin :

- le site est en ligne à l'adresse `https://otiston.github.io/carnet-repas/`, **consultable par tout le monde**, mais **modifiable par toi seul** une fois connecté ;
- l'application est installée sur ton téléphone ;
- chaque future modification se met en ligne toute seule.

Tout est **gratuit**, sans carte bancaire. Tu vas utiliser trois services :

| Service | À quoi il sert |
|---|---|
| **Supabase** | Garde tes photos, tes recettes, tes pesées et ton mot de passe |
| **Google AI Studio (Gemini)** | Lit les photos de fiches recettes |
| **GitHub** | Garde le code, publie le site et fait les mises à jour automatiques |

Les sites de ces services sont en anglais. Dans ce guide, les boutons et menus sont écrits **en gras, exactement comme à l'écran**.

---

## Avant de commencer

**1. Prépare un bloc-notes pour tes 3 valeurs secrètes.**

Appuie sur la touche Windows, tape `Bloc-notes`, puis Entrée. Colle ce modèle dedans :

```
SUPABASE_DB_PASSWORD  =
SUPABASE_ACCESS_TOKEN =
GEMINI_API_KEY        =
```

Tu le rempliras au fur et à mesure. Deux autres valeurs, l'identifiant du projet et la clé publique, ne sont pas secrètes : elles vont dans le fichier `config.js` du code (étapes A4 et A5).

> ⚠️ **N'enregistre pas ce bloc-notes dans le dossier `daily food tracker`**, sinon il risquerait d'être publié avec le code. Garde-le ouvert sans l'enregistrer, et ferme-le à la fin (partie F).

**2. Coche les étapes au fur et à mesure** pour savoir où tu en es :

- [ ] A. Supabase (15 min)
- [ ] B. Clé Gemini (5 min)
- [ ] C. GitHub et mise en ligne (15 min)
- [ ] D. Ton compte utilisateur (3 min)
- [ ] E. Premier essai et installation sur le téléphone (5 min)
- [ ] F. Nettoyage (1 min)

---

## Partie A — Supabase

### A1. Créer ton compte Supabase

1. Ouvre <https://supabase.com>.
2. Clique **Start your project** (en haut à droite), ou **Sign in** si tu as déjà un compte.
3. Choisis **Continue with GitHub**. C'est le plus simple : tu utilises ton compte GitHub **Otiston**.
4. GitHub demande d'autoriser Supabase : clique **Authorize supabase**.

✅ **Tu dois voir** le tableau de bord Supabase, ou une page qui te demande de créer une « organization ».

### A2. Créer l'organisation (seulement la première fois)

Une organisation est un simple dossier qui regroupe tes projets.

1. Si Supabase te le demande, remplis :
   - **Name** : ce que tu veux, par exemple `Perso` ;
   - **Type** : **Personal** ;
   - **Plan** : **Free** (0 $/mois).
2. Clique **Create organization**.

⚠️ **Si on te demande une carte bancaire**, tu n'as pas choisi le plan **Free**. Reviens en arrière et sélectionne-le.

### A3. Créer le projet

1. Clique **New project**. Si le bouton n'est pas visible, va dans **Projects** puis **New project**.
2. Remplis le formulaire :
   - **Organization** : celle de l'étape A2.
   - **Project name** : `carnet-repas`
   - **Database Password** : clique **Generate a password**, puis l'icône **Copy** à côté du champ. **Colle-le tout de suite dans ton bloc-notes**, sur la ligne `SUPABASE_DB_PASSWORD`. Supabase ne te le remontrera plus.
   - **Region** : choisis une région européenne, par exemple **West EU (Paris)** ou **Central EU (Frankfurt)**.
   - Laisse les options avancées (**Security options**, **Advanced configuration**) telles quelles. L'accès par API (**Data API**) doit rester activé, ce qui est le réglage par défaut.
3. Clique **Create new project**.
4. Attends 1 à 2 minutes, le temps que le projet se prépare (« Setting up project »).

✅ **Tu dois voir** la page d'accueil du projet `carnet-repas`, avec un menu d'icônes sur la gauche.

### A4. Noter l'identifiant du projet

Regarde l'adresse dans la barre du navigateur. Elle ressemble à :

```
https://supabase.com/dashboard/project/abcdefghijklmnopqrst
```

La suite de lettres après `project/` (ici `abcdefghijklmnopqrst`, environ 20 lettres minuscules) est l'identifiant. Il n'est pas secret : donne-le à Claude, ou écris-le toi-même dans `config.js`, dans l'adresse `https://<identifiant>.supabase.co`.

💡 Tu le retrouves aussi dans **Project Settings** (roue dentée ⚙️ en bas du menu de gauche) → **General** → **Project ID**.

### A5. Noter la clé publique

1. Clique **Project Settings** (roue dentée ⚙️ en bas du menu de gauche).
2. Dans le sous-menu, clique **API Keys**.
3. Repère la **Publishable key**. Elle commence par `sb_publishable_`. Clique l'icône **Copy** à côté.
4. Elle n'est pas secrète non plus (elle est visible dans le site) : donne-la à Claude, ou colle-la dans `config.js` à la place de `sb_publishable_...`.

⚠️ **Si tu ne vois que des clés « anon » et « service_role »** (anciennes clés) : cherche un onglet ou un bouton pour créer les nouvelles clés (**Create new API keys** ou similaire), puis copie la **Publishable key**.

⚠️ **Ne copie pas la « Secret key »** (`sb_secret_…`) : elle ne sert pas ici et ne doit jamais être partagée.

### A6. Créer le jeton d'accès

Ce jeton permet à GitHub de mettre à jour ton projet Supabase tout seul, à chaque nouvelle version.

1. Ouvre <https://supabase.com/dashboard/account/tokens>. Tu peux aussi passer par ton avatar en haut à droite → **Account preferences** → **Access Tokens**.
2. Clique **Generate new token**.
3. **Name** : `github-carnet-repas`. Si une date d'expiration est demandée, choisis la plus longue ou **Never**.
4. Clique **Generate token**.
5. **Copie le jeton tout de suite** (il commence par `sbp_`) et colle-le dans le bloc-notes sur la ligne `SUPABASE_ACCESS_TOKEN`. Il ne sera plus jamais affiché.

✅ **Ton bloc-notes a maintenant 2 lignes remplies sur 3.**

---

## Partie B — Clé Gemini (gratuite)

### B1. Créer la clé

1. Ouvre <https://aistudio.google.com/apikey>.
2. Connecte-toi avec ton compte Google.
3. La première fois, accepte les conditions d'utilisation. Google AI Studio crée alors automatiquement un projet Google Cloud par défaut : tu n'as rien à configurer.
4. Clique **Create API key**. Si on te demande un projet, choisis celui proposé par défaut.
5. Copie la clé affichée et colle-la dans le bloc-notes sur la ligne `GEMINI_API_KEY`.

> ⚠️ **Ne clique pas sur « Set up billing » / « Activer la facturation ».** Sans facturation, tu restes sur l'offre gratuite et rien ne peut t'être facturé. Une recette par jour est très loin des limites gratuites.

✅ **Ton bloc-notes a maintenant ses 3 lignes remplies.**

---

## Partie C — GitHub et mise en ligne

### C1. Créer le dépôt

Un « dépôt » est l'espace de ton compte GitHub qui contient le code du site.

1. Ouvre <https://github.com/new> (connecté avec le compte **Otiston**).
2. Remplis :
   - **Owner** : `Otiston`
   - **Repository name** : `carnet-repas`
   - **Description** : facultatif
   - Coche **Public**. C'est obligatoire pour que GitHub Pages soit gratuit. Le code sera visible, mais **aucune donnée personnelle ni clé** n'y figure.
   - Ne coche **pas** **Add a README file**, et laisse **.gitignore** et **license** sur **None**. Le dépôt doit être vide.
3. Clique **Create repository**.

✅ **Tu dois voir** une page « Quick setup » avec des lignes de commandes. Ne les utilise pas : les bonnes commandes sont à l'étape C4.

### C2. Ajouter les 3 secrets

Les secrets sont des coffres-forts : GitHub les utilise pendant le déploiement mais ne les affiche jamais, même à toi.

1. Dans ton dépôt `carnet-repas`, clique l'onglet **Settings** (roue dentée ⚙️, tout à droite des onglets).
2. Dans le menu de gauche, section **Security**, clique **Secrets and variables**, puis **Actions**.
3. Vérifie que tu es sur l'onglet **Secrets** (et non **Variables**).
4. Clique le bouton vert **New repository secret**.
5. Remplis :
   - **Name** : `SUPABASE_DB_PASSWORD`. Copie ce nom depuis ton bloc-notes : il doit être **exactement** identique, en majuscules, avec les `_`.
   - **Secret** : la valeur correspondante de ton bloc-notes, sans espace avant ni après.
6. Clique **Add secret**.
7. **Recommence les points 4 à 6** pour les 2 autres secrets :
   - `SUPABASE_ACCESS_TOKEN`
   - `GEMINI_API_KEY`

✅ **Tu dois voir** 3 noms dans la liste **Repository secrets**.

⚠️ **Faute de frappe dans un nom ?** Supprime le secret (icône 🗑️) et recrée-le. Pour corriger une valeur, clique l'icône ✏️ du secret.

### C3. Activer GitHub Pages

1. Toujours dans **Settings**, clique **Pages** dans le menu de gauche (section **Code and automation**).
2. Sous **Build and deployment**, dans la liste **Source**, choisis **GitHub Actions** à la place de « Deploy from a branch ».
3. C'est enregistré tout de suite, sans bouton à cliquer. Si GitHub propose des modèles de workflow (« Static HTML », « Jekyll »…), **ignore-les**.

### C4. Envoyer le code (push)

Le code est déjà prêt sur ton PC, dans un dépôt Git local. Il reste à l'envoyer sur GitHub.

1. **Ouvre un terminal dans le dossier du projet**, au choix :
   - dans l'app Claude, le panneau **Terminal** ;
   - ou dans l'Explorateur Windows : ouvre `F:\daily food tracker`, fais un clic droit dans le vide, puis **Ouvrir dans le Terminal**.
2. Tape cette commande, puis Entrée. Elle indique où envoyer le code :

```bash
git remote add origin https://github.com/Otiston/carnet-repas.git
```

3. Puis celle-ci, et Entrée. Elle envoie le code :

```bash
git push -u origin main
```

4. **La première fois**, une fenêtre de connexion GitHub peut s'ouvrir (« Connect to GitHub »). Clique **Sign in with your browser**, puis **Authorize** dans le navigateur. Le terminal continue tout seul.

✅ **Tu dois voir** dans le terminal quelques lignes se terminant par `branch 'main' set up to track 'origin/main'`.

⚠️ **« remote origin already exists »** : la commande du point 2 a déjà été faite. Passe directement au point 3.

⚠️ **« Repository not found »** : vérifie que le dépôt de l'étape C1 s'appelle exactement `carnet-repas` et appartient bien à `Otiston`.

### C5. Suivre le déploiement

1. Sur GitHub, dans ton dépôt, clique l'onglet **Actions**.
2. Une ligne apparaît avec le message du commit (« Carnet repas : calendrier… ») et un rond jaune 🟡 qui tourne. Clique dessus.
3. Tu vois deux cases reliées par une flèche : **Base de données et fonction** → **Site web**. Attends 2 à 3 minutes.

✅ **Quand tout est bon**, les deux cases ont une coche verte ✅. Sous la case **Site web**, un lien apparaît : `https://otiston.github.io/carnet-repas/`. C'est l'adresse de ton site.

⚠️ **Si une case est rouge ❌**, clique dessus, puis sur l'étape en rouge pour lire le message :

| Étape en rouge | Ce que ça veut dire | Quoi faire |
|---|---|---|
| **Vérifier les secrets** | Le message dit « Secret manquant : NOM » | Ajoute ou corrige ce secret (C2) |
| **Lire l'identifiant du projet** / **Relier le projet Supabase** | Adresse du projet ou jeton faux | Vérifie l'adresse dans `config.js` et le secret `SUPABASE_ACCESS_TOKEN` |
| **Appliquer les migrations de la base** | Mot de passe de la base faux | Corrige `SUPABASE_DB_PASSWORD`. Tu peux le réinitialiser dans Supabase → **Project Settings** → **Database** → **Reset database password** |
| **Site web** / **deploy-pages** | GitHub Pages n'est pas activé | Refais l'étape C3 |

Après une correction, reviens sur la page du déploiement et clique **Re-run jobs** (en haut à droite) → **Re-run all jobs**.

### C6. Vérifier dans Supabase

Retourne dans ton projet Supabase et vérifie que le déploiement a bien tout créé :

1. **Table Editor** (icône de tableau dans le menu de gauche) : une table **days** existe. Elle est vide, c'est normal.
2. **Storage** : un compartiment (bucket) **photos** existe.
3. **Edge Functions** : une fonction **lire-recette** existe.

✅ **Si les trois sont là**, la partie C est terminée.

---

## Partie D — Ton compte utilisateur

### D1. Créer ton utilisateur

C'est le compte avec lequel tu te connecteras sur le site et sur le téléphone.

1. Dans Supabase, clique **Authentication** (icône de personnes dans le menu de gauche).
2. Clique **Users**, puis le bouton **Add user** → **Create new user**.
3. Remplis :
   - **Email** : ton adresse email ;
   - **Password** : un mot de passe **que tu retiendras** (au moins 8 caractères). Celui-ci n'a rien à voir avec celui de la base (A3) ;
   - **Coche** **Auto Confirm User**, pour ne pas avoir à valider d'email.
4. Clique **Create user**.

✅ **Tu dois voir** ton email dans la liste des utilisateurs.

### D2. Inscriptions fermées (automatique)

Sans cette protection, n'importe qui trouvant l'adresse de ton site pourrait s'y créer un compte et consommer ton quota Gemini gratuit. **Le déploiement ferme les inscriptions tout seul**, à chaque mise à jour : seuls les comptes créés dans Supabase (étape D1) peuvent se connecter.

Pour vérifier, si tu veux : dans **Authentication**, ouvre la page des réglages de connexion (**Sign In / Providers** ou **General configuration**, selon la version). L'interrupteur **Allow new users to sign up** doit être **désactivé**.

---

## Partie E — Premier essai

### E1. Sur le PC

1. Ouvre `https://otiston.github.io/carnet-repas/`.
2. Tu arrives sur le **Calendrier**, en consultation : c'est ce que voit n'importe quel visiteur, sans bouton pour modifier. Tout en bas de la page, tu dois lire « Version du … · » suivi d'un code de 7 caractères.
3. Clique **Se connecter** en haut à droite, puis entre l'email et le mot de passe de l'étape D1. Le message « Connecté : tu peux modifier ✓ » s'affiche, et les boutons d'ajout apparaissent dans la vue **Jour**.

### E2. Installer l'application sur le téléphone

**Android (Chrome)**

1. Ouvre **Chrome** et va sur `https://otiston.github.io/carnet-repas/`.
2. Touche **Se connecter** en haut à droite, puis entre l'email et le mot de passe de D1.
3. Touche le menu **⋮** (en haut à droite), puis **Ajouter à l'écran d'accueil** (ou **Installer l'application**), puis **Installer**.
4. L'icône verte **Carnet repas** apparaît sur ton écran d'accueil.

**iPhone (Safari)**

1. Ouvre **Safari** et va sur `https://otiston.github.io/carnet-repas/`.
2. Touche **Se connecter** en haut à droite, puis entre l'email et le mot de passe de D1.
3. Touche le bouton **Partager** (le carré avec une flèche vers le haut), puis **Sur l'écran d'accueil**, puis **Ajouter**.

✅ **En ouvrant l'icône**, l'appli s'affiche en plein écran, sur la journée du jour. Tu restes connecté : pas besoin de retaper ton mot de passe.

### E3. Tester les trois blocs

Depuis l'appli sur le téléphone :

1. **🍽️ Repas** : touche **📷 Prendre une photo**, prends n'importe quoi en photo et valide. Le message « Photo du repas enregistrée ✓ » s'affiche.
2. **📖 Recette** : touche **📷 Photographier la recette**, prends une fiche recette en photo (ajoute le verso avec **Autre page** si besoin), puis **✨ Lire la recette**. Après 10 à 30 secondes, le formulaire se remplit : relis-le, puis **Enregistrer la recette**.
3. **⚖️ Pesée** : ce bloc n'apparaît que le **mardi**. Pour tester un autre jour, touche la date sous le titre et choisis un mardi. Prends la photo de la balance, tape le poids (par exemple `72,4`), puis **Enregistrer la pesée**.
4. Sur le PC, recharge le **Calendrier** : la case du jour montre la photo, le titre de la recette, et le poids le mardi.

⚠️ **Si « Lire la recette » affiche une erreur**, lis le message :

- **« Clé Gemini invalide »** : corrige le secret `GEMINI_API_KEY` (C2), puis sur GitHub : **Actions** → **Déploiement** (à gauche) → **Run workflow** → **Run workflow**.
- **Autre erreur** : utilise **↗️ Envoyer à une app IA** en attendant, et envoie-moi le message affiché.

---

## Partie F — Nettoyage

Tes 3 valeurs secrètes sont maintenant rangées en sécurité dans GitHub. **Ferme le bloc-notes sans l'enregistrer.**

Si un jour tu as besoin d'une de ces valeurs, tu peux la régénérer : nouveau jeton Supabase (A6), nouvelle clé Gemini (B1) ou nouveau mot de passe de base (tableau de C5). Mets ensuite à jour le secret correspondant (C2).

🎉 **C'est terminé !**

---

## Et ensuite : les mises à jour

Tu n'as plus rien à configurer. Pour faire évoluer l'appli :

1. Demande la modification à Claude dans ce dossier. Il la fait, la teste et l'enregistre (commit).
2. Envoie-la en ligne depuis le terminal du dossier :

```bash
git push
```

3. En 2 à 3 minutes, GitHub met tout à jour : base de données, fonction de lecture, site.
4. Ton téléphone et ton PC détectent la nouvelle version à l'ouverture de l'appli, à chaque retour dessus et toutes les 30 minutes :
   - si tu n'es pas en train de saisir quelque chose, l'appli se recharge seule et affiche « Application mise à jour ✓ » ;
   - sinon, un bandeau **Nouvelle version disponible → Mettre à jour** apparaît en haut, pour ne rien perdre.

Pour vérifier la version installée, regarde tout en bas de l'appli : le code après « Version du … · » correspond au dernier déploiement, visible dans l'onglet **Actions** de GitHub.

---

## Petit lexique

| Mot | Ce que ça veut dire |
|---|---|
| **Dépôt** (repository) | L'espace GitHub qui contient le code du site |
| **Commit** | Une version enregistrée du code, avec un message qui dit ce qui a changé |
| **Push** | Envoyer les commits de ton PC vers GitHub |
| **GitHub Actions** / **workflow** | Le robot de GitHub qui met tout en ligne après chaque push |
| **GitHub Pages** | L'hébergement gratuit du site par GitHub |
| **Secret** | Une valeur cachée (clé, mot de passe) utilisée par le robot, jamais affichée |
| **Migration** | Un fichier qui décrit un changement de la base de données, appliqué une seule fois |
| **Edge Function** | Un petit programme qui tourne chez Supabase ; ici, celui qui envoie la photo de recette à Gemini |
