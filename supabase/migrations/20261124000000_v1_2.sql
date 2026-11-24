-- =====================================================================
-- AU MENU v1.2 — étiquettes QR, photos de recettes
-- =====================================================================

-- ---------- Étiquettes QR de l'inventaire ----------
alter table public.inventory_items add column if not exists label_code text
  check (label_code is null or label_code ~ '^[A-Z0-9]{4,8}$');
create unique index if not exists inventory_label_unique on public.inventory_items (household_id, label_code)
  where label_code is not null;

-- ---------- Photo de la recette (prise par l'utilisateur) ----------
alter table public.recipes add column if not exists photo_path text;

-- Les photos d'une recette partagée sont visibles par ceux qui voient la recette
drop policy if exists "photos recettes visibles" on storage.objects;
create policy "photos recettes visibles" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-files' and exists (
    select 1 from public.recipes r
    where r.photo_path = name
      and (storage.foldername(name))[1] = r.household_id::text -- la photo doit être dans le dossier du foyer propriétaire
  ));
