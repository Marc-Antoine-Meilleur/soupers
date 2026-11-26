-- =====================================================================
-- AU MENU v1.4 — recettes de plusieurs pages
-- =====================================================================
-- Toutes les pages (photos) d'une recette importée, dans l'ordre.
-- file_path reste la première page (compatibilité).
alter table public.recipes add column if not exists file_paths text[]
  check (file_paths is null or cardinality(file_paths) <= 20);
