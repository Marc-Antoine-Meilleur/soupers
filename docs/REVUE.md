# Revue — AU MENU · Ateliers du Champ Libre (v1.0.0, 22 novembre 2026)

Revue faite par Claude (IA). Elle ne remplace pas un audit de sécurité professionnel ni un avis juridique.

## 1. Sécurité

Référentiels utilisés : OWASP Top 10 (2021) et OWASP ASVS niveau 1, adaptés à une app privée.

| Risque | Mesure en place |
|---|---|
| Accès aux données d'un autre foyer | Sécurité au niveau des lignes (RLS) sur toutes les tables. Chaque requête est filtrée par le foyer de l'utilisateur connecté. Aucun accès anonyme. |
| N'importe qui crée un compte et utilise l'IA à vos frais | Pour créer un foyer, il faut le **code du groupe**, connu de l'administrateur seulement. Il est stocké dans une table inaccessible par l'API. Sans foyer, on n'a accès ni à l'IA ni aux recettes partagées. |
| Deviner un code d'invitation | Codes de 8 caractères (31⁸, soit ≈ 850 milliards de combinaisons), limités à 10 essais par heure et par compte. Un bouton « Nouveau code » rend l'ancien code invalide. |
| Coûts d'IA imprévus | Quota de 40 appels IA par foyer et par jour, appliqué côté serveur. À ajouter : une limite de dépense mensuelle dans la console Anthropic (étape 3 du guide). |
| Vol de la clé API Claude | La clé reste dans les secrets du serveur Supabase. Elle n'est jamais dans l'app ni dans le code source. |
| Modification de champs protégés | Droits restreints par colonne : un membre peut changer le nom et les réglages du foyer, mais pas son code ni son identifiant. On ne peut ni s'ajouter soi-même à un autre foyer, ni modifier le profil d'autrui. |
| Le serveur sert à sonder des adresses internes (SSRF) via l'import de liens | Liens http(s) seulement. Adresses privées et locales refusées. Redirections vérifiées une à une. Délai maximal de 15 s et taille maximale de 3 Mo. |
| Contenu web malveillant qui tente de manipuler l'IA (injection de prompt) | Le contenu est traité comme une donnée, entre balises. Les réponses de l'IA sont validées (types, longueurs, catégories, identifiants existants) avant d'être enregistrées. |
| XSS et liens piégés | React échappe tout le texte affiché. Seuls les liens `http(s)` sont acceptés. Une politique de sécurité du contenu (CSP) limite les scripts et les connexions au site lui-même et à Supabase. |
| Fichiers téléversés | Stockage privé, réservé au foyer. 10 Mo maximum. PDF et images seulement. Le chemin est vérifié côté serveur. |
| Données trop volumineuses ou invalides | Contraintes de longueur et de format sur toutes les colonnes. Taille maximale des requêtes vers l'IA. |
| Fuite d'information dans les erreurs | Les messages techniques restent dans les journaux du serveur. L'utilisateur voit un message générique. |
| Mots de passe | 8 caractères minimum. Mots de passe stockés de façon chiffrée par Supabase (bcrypt). Confirmation par courriel recommandée. |
| Dépendances vulnérables | `npm audit` : 0 vulnérabilité. L'audit est relancé à chaque déploiement, et Dependabot propose des mises à jour chaque mois. |
| Secrets dans le code public | Aucun. L'URL Supabase et la clé « publishable » sont publiques par conception ; la protection vient de la RLS. Le code du groupe se configure dans Supabase, pas dans le code. |

**Tests automatisés de la sécurité** (`supabase/tests/run.sh`, 21 vérifications, toutes réussies le 22 novembre 2026) : un foyer ne peut ni lire ni modifier les recettes, l'inventaire ou les fichiers d'un autre foyer ; il ne peut ni s'y infiltrer, ni modifier les recettes partagées d'un autre ; sans foyer, on ne voit rien ; un compte anonyme n'a accès à rien ; la 11e tentative de code dans l'heure est bloquée ; le 41e appel IA de la journée est refusé. Le test a corrigé un défaut : la limite de tentatives n'était pas enregistrée.

**Données personnelles** (Loi 25 au Québec) : l'app conserve les courriels, les prénoms, les recettes et l'inventaire. Supabase héberge ces données (région à choisir à la création du projet ; prenez Canada Central si elle est offerte). Anthropic reçoit le contenu des recettes et de l'inventaire seulement au moment des appels IA. Par défaut, Anthropic n'utilise pas les données de l'API pour entraîner ses modèles. Aucune donnée n'est vendue ni partagée. Pour supprimer un compte : tableau de bord Supabase → Authentication.

**Risques résiduels acceptés** (usage privé entre amis) :

- Les membres d'un même foyer ont tous les mêmes droits.
- Les recettes partagées sont visibles par tout le cercle.
- La sauvegarde automatique quotidienne nécessite le plan payant de Supabase. Avec le plan gratuit, il faut exporter les données manuellement si on y tient.

## 2. Propriété intellectuelle et licences

- **Code de l'app** : écrit pour vous. Toutes les dépendances sont sous licences libres permissives : MIT (React, Vite, Supabase JS) et 0BSD. Elles permettent l'usage, y compris commercial, sans frais.
- **Police Marcellus** : licence SIL Open Font License 1.1, libre d'usage. Elle est intégrée à l'app : aucun appel à Google Fonts, donc aucun pistage.
- **Icônes** : dessinées sur mesure en SVG, sans bibliothèque tierce.
- **Logo des Ateliers du Champ Libre** : fourni par vous. Assurez-vous d'en détenir les droits. Si le logo a été généré par IA, sa protection par le droit d'auteur peut être limitée ; un enregistrement de marque protégerait le nom.
- **Recettes importées** : une liste d'ingrédients est généralement considérée comme un fait non protégé, mais le texte rédigé et les photos le sont. Pour limiter le risque :
  - l'IA reformule les étapes dans ses propres mots ;
  - le lien vers la source est conservé ;
  - les photos ne sont pas copiées ;
  - les recettes ne circulent que dans un cercle privé.

  Ne rendez pas l'app publique avec des recettes de tiers.
- **Conditions des services** :
  - Anthropic permet de bâtir des applications avec son API.
  - GitHub Pages interdit l'usage commercial de type boutique ou SaaS ; une app privée et gratuite convient.
  - Le plan gratuit de Supabase vise les projets personnels.

## 3. Coûts et abonnements (en dollars US, vérifiés le 22 novembre 2026)

| Service | Coût | Pièges et mesures prises |
|---|---|---|
| Supabase (plan gratuit) | 0 $, sans carte de crédit | Le projet **se met en pause après 7 jours sans activité**. Une tâche automatique GitHub l'interroge deux fois par semaine pour l'éviter. Limites : 500 Mo de base de données, 1 Go de fichiers, 2 projets. Le plan Pro (25 $/mois) n'est pas nécessaire. |
| Anthropic (API Claude) | Prépayé, minimum 5 $ | Estimation : environ 1–2 $/mois pour 5 foyers. **Les crédits expirent un an après l'achat.** Laissez la recharge automatique désactivée et fixez une limite de dépense (Console → Limits). Avec la recharge désactivée, l'IA s'arrête quand le solde est épuisé : aucun dépassement possible. |
| GitHub (dépôt public + Pages + Actions) | 0 $ | Pages est gratuit seulement si le dépôt est public. Le code est donc visible, sans secret. Un dépôt privé exigerait GitHub Pro (environ 4 $/mois). |
| Apple | 0 $ | La web app installable ne passe ni par l'App Store ni par le programme développeur (99 $/an). |
| Nom de domaine | Optionnel | Environ 15–20 $/an si vous voulez une adresse du type soupers.champlibre.ca. |

**Abonnements actifs : aucun.** Seule dépense : les crédits Anthropic prépayés, plafonnés par vous.

## 4. Interface (revue d'ergonomie)

Changements faits pour réduire les manipulations :

- **Inventaire** : barre d'ajout rapide. Par exemple « 3 poitrines de poulet ; 2 sacs brocoli » ajoute deux articles d'un coup ; la catégorie est devinée.
- **Recettes** : un seul champ pour un lien ou un texte, un bouton « Coller » et une zone pour PDF ou photo.
- **Contraintes** : bouton « Critères » directement dans l'écran Semaine. Un champ « Cette semaine, quelque chose de spécial? » sert aux exceptions.
- **Acceptation** : un bouton « Approuver » crée la liste d'épicerie classée par magasin. Ensuite, toucher « Sorti » sur un aliment met l'inventaire à jour automatiquement.
- **Itérations** : bouton de commentaire 💬 sur chaque écran. Réglages → Commentaires → « Copier » pour me les transmettre.

## 5. Version 1.1 (23 novembre 2026) : ajouts et contrôles

- **Comptes** : seul l'administrateur crée les comptes. Chaque compte reçoit un mot de passe temporaire, à changer obligatoirement à la première connexion. L'inscription libre est désactivée.
- **Rôle admin** : impossible à s'attribuer par l'API. Le champ n'est modifiable que par SQL ou par la clé secrète du serveur. La fonction `admin` vérifie ce rôle à chaque appel.
- **Coûts de l'IA** : chaque appel est journalisé par le serveur (personne, foyer, fonction, modèle, tokens et coût estimé). Le journal est lisible par l'admin seulement.
- **Avis et préférences** :
  - un avis n'est visible que par les personnes qui voient la recette ;
  - les favoris et les blocages sont personnels et visibles seulement par le foyer ;
  - une recette bloquée n'est jamais proposée au foyer.
- **Sauvegarde** : un export JSON complet est réservé à l'admin. Il contient les courriels : conservez-le en lieu sûr.
- **Historique des menus** : conservé 12 mois, puis supprimé automatiquement.
- **Tests de sécurité** : 38 vérifications au total (21 de la v1.0 et 17 nouvelles), toutes réussies.
