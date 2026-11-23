# Mise en ligne — état actuel

| Élément | Où | État |
|---|---|---|
| Base de données et sécurité | Supabase, projet `soupers-champ-libre` (us-east-2) | Installée et vérifiée |
| Fonction IA `ai` | Supabase → Edge Functions | Déployée (vérification du jeton faite dans le code) |
| Secret `ALLOWED_ORIGINS` | Supabase → Edge Functions → Secrets | `https://marc-antoine-meilleur.github.io` |
| Secret `ANTHROPIC_API_KEY` | Supabase → Edge Functions → Secrets | **À ajouter par le propriétaire** |
| Code source | github.com/Marc-Antoine-Meilleur/soupers (public) | Publié |
| App | https://marc-antoine-meilleur.github.io/soupers/ | Publiée par GitHub Actions |
| Code du groupe | Table `app_config` (Supabase) | Configuré — à ne partager qu'avec les amis qui créent un foyer |

## Ajouter la clé Anthropic (une seule fois)
1. console.anthropic.com → Billing : acheter 5 $ de crédits. Laisser la recharge automatique **désactivée**.
2. Limits : fixer une limite de dépense mensuelle (ex. 5 $).
3. API Keys → Create Key « soupers » → copier la clé (affichée une seule fois).
4. Supabase → Edge Functions → Secrets : nom `ANTHROPIC_API_KEY`, valeur = la clé → Save.

## Changer le code du groupe
Supabase → SQL Editor : `update public.app_config set group_code = 'NOUVEAU-CODE';`

## Jeton GitHub « claude-soupers »
Limité au dépôt `soupers`, expire le 20 février 2027. Révocable à tout moment :
GitHub → Settings → Developer settings → Fine-grained tokens.
