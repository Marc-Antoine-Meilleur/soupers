\pset format unaligned
\pset tuples_only on
-- v1.2 : étiquettes QR et photos de recettes (après 02_securite_v1_1.sql)
reset role;
select id as ra from public.recipes where title = 'Recette privée A' \gset
select household_id as ha from public.profiles where id = '00000000-0000-0000-0000-00000000000a' \gset
select household_id as hb from public.profiles where id = '00000000-0000-0000-0000-00000000000b' \gset
insert into public.recipes (household_id, title, shared, photo_path) values (:'hb', 'Privée B photo', false, :'hb' || '/privee.jpg');
update public.recipes set shared = true, photo_path = :'ha' || '/plat.jpg' where id = :'ra';
grant select on storage.objects to authenticated; -- (déjà accordé dans Supabase)
insert into storage.objects (bucket_id, name) values ('recipe-files', :'ha' || '/plat.jpg'), ('recipe-files', :'hb' || '/privee.jpg'), ('recipe-files', :'ha' || '/autre.pdf');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
with x as (insert into public.inventory_items (name, quantity, location, label_code) values ('Poulet', 1, 'Congélateur', 'K7M2QX') returning 1) select 'Q1 A crée un article avec étiquette (1):', count(*) from x;
\echo Q2 A réutilise la même étiquette (ERREUR attendue):
insert into public.inventory_items (name, quantity, location, label_code) values ('Bœuf', 1, 'Congélateur', 'K7M2QX');
\echo Q3 code invalide (ERREUR attendue):
insert into public.inventory_items (name, quantity, location, label_code) values ('X', 1, 'Congélateur', 'abc<script>');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'Q4 B ne trouve pas l''étiquette de A (0):', count(*) from public.inventory_items where label_code = 'K7M2QX';
with x as (insert into public.inventory_items (name, quantity, location, label_code) values ('Sauce', 1, 'Congélateur', 'K7M2QX') returning 1) select 'Q5 B peut utiliser le même code dans son foyer (1):', count(*) from x;
select 'Q6 B voit la photo de la recette partagée de A (1):', count(*) from storage.objects where name = :'ha' || '/plat.jpg';
select 'Q7 B ne voit pas les autres fichiers de A (0):', count(*) from storage.objects where name = :'ha' || '/autre.pdf';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'Q8 A ne voit pas la photo de la recette privée de B (0):', count(*) from storage.objects where name = :'hb' || '/privee.jpg';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.recipes set photo_path = :'ha' || '/nouvelle.jpg' where id = :'ra';
select 'Q9 A change la photo de sa recette:', photo_path = :'ha' || '/nouvelle.jpg' from public.recipes where id = :'ra';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.recipes set photo_path = :'ha' || '/autre.pdf', shared = true where title = 'Privée B photo';
select 'Q10 B pointe sa recette vers un fichier de A : toujours illisible (0):', count(*) from storage.objects where name = :'ha' || '/autre.pdf';
reset role;
