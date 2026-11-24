\pset format unaligned
\pset tuples_only on
-- v1.3 : communautés (après 03). A (+C, D) dans le foyer A, B dans le foyer B, tous dans la communauté de départ.
reset role;
select household_id as ha from public.profiles where id = '00000000-0000-0000-0000-00000000000a' \gset
select household_id as hb from public.profiles where id = '00000000-0000-0000-0000-00000000000b' \gset
select 'C1 foyers existants dans la communauté de départ (2+):', count(*) >= 2 from public.households where community_id is not null;
with x as (insert into public.recipes (household_id, title) values (:'hb', 'Nouvelle recette B') returning shared) select 'C2 partagée par défaut (t):', shared from x;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'C3 A voit la nouvelle recette de B, même communauté (1):', count(*) from public.recipes where title = 'Nouvelle recette B';
\echo C4 A change la communauté de son foyer (ERREUR attendue):
update public.households set community_id = null where id = :'ha';
\echo C5 A crée une communauté (ERREUR attendue):
insert into public.communities (name) values ('Pirates');
reset role;
insert into public.communities (name) values ('Autre cercle') returning id as c2 \gset
update public.households set community_id = :'c2' where id = :'hb';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'C6 A ne voit plus les recettes partagées de B, autre communauté (0):', count(*) from public.recipes where household_id = :'hb';
select 'C7 A (admin) voit toutes les communautés (2):', count(*) from public.communities;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'C8 B ne voit plus les recettes partagées de A (0):', count(*) from public.recipes where household_id = :'ha';
select 'C9 B voit seulement sa communauté (1):', count(*) from public.communities;
select 'C10 B voit toujours ses propres recettes (2+):', count(*) >= 2 from public.recipes where household_id = :'hb';
reset role;
