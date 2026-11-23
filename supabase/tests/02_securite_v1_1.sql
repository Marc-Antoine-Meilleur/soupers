\pset format unaligned
\pset tuples_only on
-- Préparation (exécuter après 01_securite_rls.sql) : A et D dans le foyer A, B dans le foyer B, C sans foyer
reset role;
update public.app_config set admin_email = 'a@x';
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
insert into public.ai_calls (user_id, action, model, input_tokens, output_tokens, cost_usd) values ('00000000-0000-0000-0000-00000000000b', 'plan_week', 'claude-sonnet-5-5', 1000, 200, 0.004);
select id as ra from public.recipes where title = 'Recette privée A' \gset
insert into public.recipes (household_id, title, shared) select household_id, 'Privée B', false from public.profiles where id = '00000000-0000-0000-0000-00000000000b' returning id as rb \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'V1 B lit coûts IA (0):', count(*) from public.ai_calls;
\echo V2 B se rend admin (ERREUR attendue):
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000b';
\echo V3 B change la config admin (ERREUR attendue):
select public.admin_set_config(1000, 500);
with x as (insert into public.recipe_reviews (recipe_id, author_name, taste, minutes, comment) values (:'ra', 'B', 4, 30, 'Bon!') returning 1) select 'V4 B avis sur recette partagée de A (1):', count(*) from x;
with x as (insert into public.recipe_prefs (recipe_id, kind) values (:'ra', 'favori') returning 1) select 'V5 B favori sur recette partagée (1):', count(*) from x;
\echo V6 B écrit un avis au nom de A (ERREUR attendue):
insert into public.recipe_reviews (recipe_id, user_id, taste) values (:'ra', '00000000-0000-0000-0000-00000000000a', 0);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'V7 A voit l''avis de B (1):', count(*) from public.recipe_reviews where recipe_id = :'ra';
select 'V8 A (autre foyer) ne voit pas les préférences de B (0):', count(*) from public.recipe_prefs;
\echo V9 A avis sur recette privée de B (ERREUR attendue):
insert into public.recipe_reviews (recipe_id, taste) values (:'rb', 1);
select 'V10 A admin lit coûts (1):', count(*) from public.ai_calls;
select 'V11 A admin change config:', public.admin_set_config(20, 60);
select 'V12 config:', credits_usd, ai_daily_limit from public.admin_get_config();
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'V13 C (membre de A depuis T16) voit l''avis (1):', count(*) from public.recipe_reviews;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
with x as (insert into public.recipe_prefs (recipe_id, kind) values (:'ra', 'bloquee') returning 1) select 'V15 D bloque une recette (1):', count(*) from x;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'V16 A voit le blocage de D, même foyer (1):', count(*) from public.recipe_prefs where kind = 'bloquee';
\echo V17 A modifie la préférence de D (UPDATE 0 attendu):
update public.recipe_prefs set kind = 'favori' where user_id = '00000000-0000-0000-0000-00000000000d';
reset role;
insert into auth.users values ('00000000-0000-0000-0000-0000000000ee','A@X','{}') on conflict do nothing;
select 'V14 courriel admin => admin auto (t si admin_email=a@x):', is_admin from public.profiles where id='00000000-0000-0000-0000-0000000000ee';
