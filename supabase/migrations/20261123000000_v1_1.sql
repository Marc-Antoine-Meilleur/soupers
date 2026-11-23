-- =====================================================================
-- Soupers v1.1 — admin, suivi des coûts IA, avis et favoris
-- =====================================================================

-- ---------- Administrateur ----------
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.app_config add column if not exists admin_email text;
alter table public.app_config add column if not exists credits_usd numeric not null default 0;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Le compte dont le courriel correspond à app_config.admin_email devient admin à sa création
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_admin)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 60),
    lower(new.email) = lower(coalesce((select admin_email from public.app_config), ''))
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- Journal des appels IA (tokens et coût estimé) ----------
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users on delete set null,
  user_name text,
  household_id uuid references public.households on delete set null,
  action text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0
);
create index if not exists ai_calls_created_idx on public.ai_calls (created_at);
alter table public.ai_calls enable row level security;
-- Écriture : uniquement par le serveur (clé secrète). Lecture : admin seulement.
drop policy if exists "couts admin" on public.ai_calls;
create policy "couts admin" on public.ai_calls for select to authenticated using (public.is_admin());
grant select on public.ai_calls to authenticated;

-- ---------- Avis sur les recettes (visibles par tous ceux qui voient la recette) ----------
create table if not exists public.recipe_reviews (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text check (char_length(author_name) <= 60),
  taste int check (taste between 0 and 5),
  minutes int check (minutes between 1 and 1000),
  comment text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);
create index if not exists reviews_recipe_idx on public.recipe_reviews (recipe_id);
alter table public.recipe_reviews enable row level security;
drop policy if exists "avis lecture" on public.recipe_reviews;
create policy "avis lecture" on public.recipe_reviews for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));
drop policy if exists "avis ecriture" on public.recipe_reviews;
create policy "avis ecriture" on public.recipe_reviews for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.recipes r where r.id = recipe_id));
grant select, insert, update, delete on public.recipe_reviews to authenticated;

-- ---------- Préférences personnelles : favori ou bloquée ----------
-- Une recette « bloquée » par un membre du foyer n'est jamais proposée dans le menu de ce foyer.
create table if not exists public.recipe_prefs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id uuid not null references public.recipes on delete cascade,
  kind text not null check (kind in ('favori', 'bloquee')),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
alter table public.recipe_prefs enable row level security;
drop policy if exists "prefs lecture foyer" on public.recipe_prefs;
create policy "prefs lecture foyer" on public.recipe_prefs for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = user_id and p.household_id = public.my_household()));
drop policy if exists "prefs ecriture perso" on public.recipe_prefs;
create policy "prefs ecriture perso" on public.recipe_prefs for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.recipes r where r.id = recipe_id));
grant select, insert, update, delete on public.recipe_prefs to authenticated;

-- ---------- Recettes importées en lot : à vérifier ----------
alter table public.recipes add column if not exists needs_review boolean not null default false;

-- Les anciennes notes (v1.0) deviennent des avis
insert into public.recipe_reviews (recipe_id, user_id, author_name, taste)
select r.id, r.created_by, r.author_name, r.rating from public.recipes r
where r.rating is not null and r.created_by is not null
on conflict (recipe_id, user_id) do nothing;

-- ---------- Réglages admin (crédits prépayés, limite quotidienne) ----------
create or replace function public.admin_get_config()
returns table (credits_usd numeric, ai_daily_limit int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select c.credits_usd, c.ai_daily_limit from public.app_config c;
end $$;

create or replace function public.admin_set_config(p_credits_usd numeric, p_ai_daily_limit int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  update public.app_config set
    credits_usd = greatest(0, coalesce(p_credits_usd, credits_usd)),
    ai_daily_limit = least(500, greatest(1, coalesce(p_ai_daily_limit, ai_daily_limit)));
end $$;

revoke execute on function public.is_admin(), public.admin_get_config(), public.admin_set_config(numeric, int) from public, anon;
grant execute on function public.is_admin(), public.admin_get_config(), public.admin_set_config(numeric, int) to authenticated;

-- Le champ is_admin n'est jamais modifiable par l'API (seulement par SQL ou la clé secrète)
revoke update on public.profiles from authenticated;
grant update (display_name, household_id) on public.profiles to authenticated;

-- La clé secrète du serveur (fonctions admin et journal des coûts) doit pouvoir lire et écrire
-- (le projet n'accorde pas de droits automatiques sur les nouvelles tables)
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
