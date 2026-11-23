\pset format unaligned
\pset tuples_only on
insert into public.app_config (group_code) values ('GROUPE-SECRET');
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','a@x','{"display_name":"Alice"}'),('00000000-0000-0000-0000-00000000000b','b@x','{}'),('00000000-0000-0000-0000-00000000000c','c@x','{}'),('00000000-0000-0000-0000-00000000000d','d@x','{}');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'A create:', (public.create_household('Foyer A','GROUPE-SECRET')).name;
insert into public.recipes (title) values ('Recette privée A');
insert into public.inventory_items (name) values ('Porc A');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B create:', (public.create_household('Foyer B','GROUPE-SECRET')).name;
reset role;
select id as ha, invite_code as ca from public.households where name='Foyer A' \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'T1 B voit recettes A (0):', count(*) from public.recipes;
select 'T2 B voit inventaire A (0):', count(*) from public.inventory_items;
\echo T3 B insere recette dans foyer A (ERREUR attendue):
insert into public.recipes (title, household_id) values ('pirate', :'ha');
\echo T4 B modifie inventaire A (UPDATE 0 attendu):
update public.inventory_items set quantity = 99 where household_id = :'ha';
\echo T5 B change le code (ERREUR attendue):
update public.households set invite_code = 'AAAAAAAA';
\echo T6 B se déplace dans foyer A via son profil (ERREUR attendue):
update public.profiles set household_id = :'ha' where id = '00000000-0000-0000-0000-00000000000b';
\echo T7 B lit app_config (ERREUR attendue):
select * from public.app_config;
\echo T8 B gonfle ai_usage (ERREUR attendue):
insert into public.ai_usage (household_id, calls) values (:'ha', 999);
\echo T9 B lit fichiers de A (0):
select count(*) from storage.objects where bucket_id='recipe-files';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.recipes set shared = true;
select 'T10 A inventaire intact (1):', quantity from public.inventory_items;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'T11 B voit recette partagée (1):', count(*) from public.recipes;
\echo T12 B modifie recette partagée de A (UPDATE 0 attendu):
update public.recipes set title='vandal' where household_id = :'ha';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'T13 C mauvais code groupe (vide):', (public.create_household('Intrus','mauvais')).id;
select 'T14 C voit partagées sans foyer (0):', count(*) from public.recipes;
select 'T15 C quota IA sans foyer (f):', public.consume_ai_quota();
select 'essai', (public.join_household('XXXXXXX' || g)).id from generate_series(1,8) g;
\echo T16 10e tentative = code correct, accepté (9 échecs avant):
select public.join_household(:'ca');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select 'T17 D rejoint A avec bon code:', (public.join_household(:'ca')).name;
select 'T18 D voit recette A (1):', count(*) from public.recipes where household_id = :'ha';
select 'T19 quota 41e appel (f):', bool_and(x) from (select public.consume_ai_quota() x from generate_series(1,40)) s;
select 'T19b', public.consume_ai_quota();
reset role; set role anon;
\echo T20 anonyme lit recettes (ERREUR attendue):
select count(*) from public.recipes;
select 'T21 anonyme ping:', public.ping();
