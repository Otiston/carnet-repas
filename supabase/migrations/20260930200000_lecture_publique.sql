-- Site public en lecture : tout le monde voit le calendrier et les photos,
-- seul le propriétaire connecté peut ajouter, modifier ou supprimer.

drop policy if exists "days: owner only" on public.days;

create policy "days: public read" on public.days
  for select to anon, authenticated
  using (true);

create policy "days: owner insert" on public.days
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "days: owner update" on public.days
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "days: owner delete" on public.days
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.days to anon;

-- Photos lisibles par tous via leur adresse publique ; l'envoi et la suppression
-- restent réservés au propriétaire (règles « photos: owner insert/delete »).
update storage.buckets set public = true where id = 'photos';
