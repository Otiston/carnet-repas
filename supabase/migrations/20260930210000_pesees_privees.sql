-- Photos de la balance : stockage privé, visible seulement par le propriétaire connecté.
-- Le poids reste public (colonne weight_kg de days) ; le chemin de la photo aussi,
-- mais le fichier n'est lisible qu'avec la session du propriétaire.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pesees', 'pesees', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "pesees: owner read" on storage.objects;
create policy "pesees: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'pesees' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "pesees: owner insert" on storage.objects;
create policy "pesees: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pesees' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "pesees: owner delete" on storage.objects;
create policy "pesees: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pesees' and (storage.foldername(name))[1] = (select auth.uid())::text);
