# Carnet repas

Mon suivi personnel, en un seul site :

- **Sur le PC** : un calendrier du mois. Chaque case montre la photo du repas, le titre de la recette et, le mardi, le poids de la pesée. Un clic sur une case ouvre le détail de la journée.
- **Sur le téléphone** : le même site, installé comme une application (icône sur l'écran d'accueil). Il s'ouvre sur la journée du jour avec trois blocs :
  - 🍽️ **Repas** : prendre une photo, qui s'enregistre dans la journée.
  - 📖 **Recette** : photographier la fiche (recto et verso si besoin). Gemini la lit automatiquement et la réécrit simplement : titre, liste des ingrédients, étapes. Tu relis et corriges, puis tu enregistres. En secours, tu peux envoyer la photo à ton app IA habituelle (Claude, ChatGPT, Gemini…) et coller sa réponse : la recette se remplit toute seule.
  - ⚖️ **Pesée**, seulement le mardi : photo de la balance et poids saisi à la main.

**Public en lecture, privé en écriture** : n'importe qui peut consulter le site, avec le calendrier, les photos des repas, les recettes et le poids des pesées. Les **photos de la balance** restent privées : elles sont rangées dans un stockage à part, que seul ton compte connecté peut lire. Seul toi, après **Se connecter**, peux ajouter, modifier ou supprimer. Le site n'est pas référencé par les moteurs de recherche : il faut en connaître l'adresse.

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
| `GUIDE.md` | Le guide d'installation pas à pas |
| `index.html`, `styles.css`, `app.js` | Le site (interface calendrier + jour, mises à jour) |
| `api.js` | Tous les échanges avec Supabase |
| `config.js` | Adresse et clé publique du projet Supabase (valeurs publiques) |
| `manifest.webmanifest`, `icons/` | Installation comme application sur le téléphone |
| `supabase/migrations/` | Structure de la base, appliquée automatiquement |
| `supabase/functions/lire-recette/index.ts` | La fonction qui envoie la photo de recette à Gemini |
| `.github/workflows/deploiement.yml` | Le déploiement automatique |

---

## Mise en place

👉 **Suis le guide pas à pas : [GUIDE.md](GUIDE.md)** (environ 45 minutes, une seule fois).

En résumé :

1. **Supabase** : créer le projet (son adresse et sa clé publique vont dans `config.js`), noter le mot de passe de la base, puis créer un jeton d'accès.
2. **Gemini** : créer une clé gratuite sur Google AI Studio, sans activer la facturation.
3. **GitHub** : créer le dépôt `carnet-repas`, y ranger les 3 secrets (mot de passe de la base, jeton Supabase, clé Gemini), régler Pages sur **GitHub Actions**, puis faire `git push`.
4. **Supabase** : créer ton utilisateur. Les inscriptions sont fermées automatiquement par le déploiement.
5. **Téléphone** : ouvrir le site, puis « Ajouter à l'écran d'accueil ».

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
- **Pesée (mardi)** : 📷 *Photo de la balance* (enregistrée tout de suite), puis tape le poids et *Enregistrer le poids*. L'ordre n'a pas d'importance.
- Pour remplir un autre jour, change la date avec les flèches ‹ › ou le sélecteur de date.

## Tester sur le PC (facultatif)

`config.js` pointe déjà vers ton projet Supabase. Depuis ce dossier :

```bash
python -m http.server 8000
```

Ouvre <http://localhost:8000>. En local, le bas de page affiche « Version locale (non déployée) » et il n'y a pas de mise à jour automatique.

## Dépannage

| Problème | Piste |
|---|---|
| Déploiement rouge à « Vérifier les secrets » | Le message indique le secret manquant : ajoute-le (étape 5), puis **Re-run all jobs**. |
| Déploiement rouge à « Relier le projet » ou « Appliquer les migrations » | Vérifie l'adresse dans `config.js` et les secrets `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`. Le mot de passe se réinitialise dans Supabase → **Project Settings** → **Database**. |
| Déploiement rouge à « Site web » | Vérifie que **Settings** → **Pages** → **Source** est bien sur **GitHub Actions** (étape 6). |
| « Email ou mot de passe incorrect » | Vérifie que l'utilisateur est bien confirmé (Authentication → Users). |
| « Clé Gemini invalide » | Corrige le secret `GEMINI_API_KEY` dans GitHub, puis **Run workflow**. |
| « Gemini est surchargé » ou « Quota gratuit de Gemini atteint » | Les 3 modèles gratuits essayés à la suite étaient saturés. Réessaie dans quelques minutes, ou passe par ↗️ *Envoyer à une app IA*. |
| Les erreurs Gemini reviennent tous les jours | Google a peut-être retiré un modèle : demande à Claude de mettre à jour la liste `MODELS` dans `supabase/functions/lire-recette/index.ts` (modèles *Flash* gratuits sur <https://ai.google.dev/gemini-api/docs/pricing>). |
| Le projet Supabase est « paused » | Les projets gratuits se mettent en pause après 7 jours sans utilisation : clique **Restore** dans le tableau de bord. |
