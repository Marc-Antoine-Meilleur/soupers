# Mise en ligne (une seule fois, environ 30 minutes)

## 1. GitHub (gratuit)
1. Créer un compte sur github.com avec un courriel personnel.
2. Créer un dépôt **public** nommé `soupers` et y téléverser ce code.

## 2. Supabase (gratuit)
1. Se connecter sur supabase.com avec « Continue with GitHub ».
2. Créer un projet `soupers-champ-libre`, région **Canada (Central)** si elle est offerte, avec un mot de passe de base de données fort, conservé dans un gestionnaire de mots de passe.
3. **SQL Editor** : exécuter `supabase/migrations/20261122000000_init.sql`, puis cette ligne, avec votre propre code :
   ```sql
   insert into public.app_config (group_code) values ('CHOISIR-UN-CODE-SECRET');
   ```
4. **Authentication → Sign In / Providers → Email** :
   - garder « Confirm email » activé ;
   - fixer la longueur minimale du mot de passe à 8.
5. **Authentication → URL Configuration** : Site URL = l'adresse GitHub Pages (ex. `https://moncompte.github.io/soupers/`).
6. **Edge Functions** : créer la fonction `ai` avec le contenu de `supabase/functions/ai/index.ts`. Cette étape peut aussi se faire automatiquement avec l'action GitHub de l'étape 4.
7. **Edge Functions → Secrets** : ajouter
   - `ANTHROPIC_API_KEY` (étape 3) ;
   - `ALLOWED_ORIGINS` = `https://moncompte.github.io`.
8. **Project Settings → API** : noter l'URL du projet et la clé « publishable ».

## 3. Anthropic
1. Créer un compte sur console.anthropic.com avec un courriel personnel.
2. Billing : acheter 5 $ de crédits. **Laisser la recharge automatique désactivée.**
3. Limits : fixer une limite de dépense mensuelle, par exemple 5 $.
4. API Keys : créer une clé nommée « soupers ». Elle ne s'affiche qu'une fois : la coller directement dans le secret Supabase.

## 4. Secrets GitHub (Settings → Secrets and variables → Actions)
- `VITE_SUPABASE_URL` et `VITE_SUPABASE_KEY` : valeurs de l'étape 2.8.
- Pour le déploiement automatique de Supabase (facultatif) :
  - `SUPABASE_ACCESS_TOKEN` : supabase.com → Account → Access Tokens ;
  - `SUPABASE_PROJECT_REF` ;
  - `SUPABASE_DB_PASSWORD`.

Ensuite : Settings → Pages → Source = **GitHub Actions**, puis lancer l'action « Déployer l'app ».

## 5. Premier usage
1. Ouvrir l'adresse dans Safari sur l'iPhone, puis Partager → Sur l'écran d'accueil.
2. Créer son compte, puis son foyer avec le **code du groupe**.
3. Partager le code du groupe seulement avec les amis qui créeront leur propre foyer. Les membres de votre foyer utilisent plutôt le code d'invitation (Réglages).
