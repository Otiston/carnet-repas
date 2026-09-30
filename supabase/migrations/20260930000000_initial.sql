-- Carnet repas : tables, stockage des photos et règles d'accès.
-- Appliqué automatiquement par le déploiement (supabase db push) ; ne pas modifier ce fichier :
-- pour changer la base, ajouter une nouvelle migration datée dans ce dossier.

-- Une ligne par journée : photo du repas, recette, pesée du mardi.
create table if not exists public.days (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  food_path   text,           -- photo du repas (taille normale)
  food_thumb  text,           -- miniature pour le calendrier
  recipe      jsonb,          -- { titre, portions, ingredients[], etapes[], note }
  weigh_path  text,           -- photo de la balance
  weigh_thumb text,
  weight_kg   numeric(5, 1),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.days enable row level security;

drop policy if exists "days: owner only" on public.days;
create policy "days: owner only" on public.days
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.days to authenticated;

-- Bucket privé pour les photos (JPEG uniquement, 5 Mo max par fichier).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Chaque fichier est rangé sous <id utilisateur>/<date>/… ; seul son propriétaire y a accès.
drop policy if exists "photos: owner read" on storage.objects;
create policy "photos: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: owner insert" on storage.objects;
create policy "photos: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: owner delete" on storage.objects;
create policy "photos: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
