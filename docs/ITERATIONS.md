# Comment faire évoluer l'app

1. **Utilisez l'app** et notez chaque irritant avec le bouton 💬 en haut de l'écran concerné.
2. Quand vous êtes prêt : **Réglages → Commentaires → Copier**, puis collez dans une conversation avec Claude, accompagné de ce dépôt (ou du lien GitHub).
3. Claude modifie le code et le pousse sur la branche `main` de GitHub.
4. **Tout se déploie automatiquement** :
   - modification dans `web/` → l'app est republiée sur GitHub Pages en environ 1 minute ;
   - modification dans `supabase/` → la base de données et la fonction IA sont mises à jour.
5. Sur l'iPhone, fermez et rouvrez l'app pour obtenir la nouvelle version. Le numéro de version est affiché au bas de Réglages.
6. Dans Réglages, touchez « Marquer traités » pour vider la liste de commentaires.

## Règles pour les changements de base de données

- Ne jamais modifier une migration déjà appliquée : en ajouter une nouvelle dans `supabase/migrations/` (ex. `20261201000000_ajout_xyz.sql`).
- Toute nouvelle table doit avoir la RLS activée et une politique basée sur `public.my_household()`.

## Essayer sans compte

Lancer `cd web && npm install && npm run dev` sans fichier `.env` : l'app démarre en **mode démo**, avec des données fictives et une IA simulée.
Sur le site en ligne, ajouter `?demo` à l'adresse a le même effet.

## Numéro de version

Augmenter `version` dans `web/package.json` à chaque livraison (1.0.0 → 1.1.0 pour une nouvelle fonction, 1.0.1 pour une correction).
