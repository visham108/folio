-- Fixes from the October 2026 sweep: data safety, merging, and tighter catalogue rules.

-- ── Moods: the app offers 14 ───────────────────────────────────────────────
alter table public.entries drop constraint entries_moods_n;
alter table public.entries add constraint entries_moods_n check (cardinality(moods) <= 20);

-- ── Removing a book never silently deletes readers' shelves and history ──────
-- (Duplicates are merged instead, which moves everyone's entries across first.)
alter table public.entries drop constraint entries_work_id_fkey;
alter table public.entries add constraint entries_work_id_fkey
  foreign key (work_id) references public.works on delete restrict;

-- ── Merged books: remember where they went ─────────────────────────────────
-- A device that was offline during a merge may still send changes for the old book;
-- they're redirected to the book it was merged into rather than failing or reviving it.
create table public.merged_works (
  old_work  uuid primary key,
  new_work  uuid not null references public.works on delete cascade,
  merged_at timestamptz not null default now()
);
alter table public.merged_works enable row level security;
create policy "merged readable" on public.merged_works for select to authenticated using (true);

create or replace function public.redirect_merged_work() returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  new.work_id := coalesce((select m.new_work from public.merged_works m where m.old_work = new.work_id), new.work_id);
  return new;
end $$;
create trigger entries_redirect_merged  before insert or update of work_id on public.entries  for each row execute function public.redirect_merged_work();
create trigger editions_redirect_merged before insert or update of work_id on public.editions for each row execute function public.redirect_merged_work();

create or replace function public.refuse_merged_work() returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  if exists (select 1 from public.merged_works m where m.old_work = new.id) then
    raise exception 'This book was merged into another one' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger works_refuse_merged before insert on public.works for each row execute function public.refuse_merged_work();
revoke execute on function public.redirect_merged_work() from public, anon, authenticated;
revoke execute on function public.refuse_merged_work() from public, anon, authenticated;

-- ── Merging keeps what every reader recorded on the duplicate ──────────────
create or replace function public.merge_works(from_id uuid, into_id uuid) returns void
language plpgsql security definer
set search_path = '' as $$
declare
  rank_sql constant text := 'want,dnf,paused,read,reading';
begin
  if not public.is_super_admin() then
    raise exception 'Only the admin can merge books' using errcode = '42501';
  end if;
  if from_id = into_id then
    raise exception 'Choose a different book to merge into';
  end if;
  -- Lock both books so nobody adds to the duplicate halfway through.
  perform 1 from public.works where id in (from_id, into_id) for update;
  if not exists (select 1 from public.works where id = from_id) then
    raise exception 'The duplicate book no longer exists';
  end if;
  if not exists (select 1 from public.works where id = into_id) then
    raise exception 'The book to merge into no longer exists';
  end if;

  update public.editions set work_id = into_id where work_id = from_id;

  -- Readers who have both books keep one entry, combining everything either recorded.
  update public.entries keep set
    status     = case when array_position(string_to_array(rank_sql, ','), dup.status)
                         > array_position(string_to_array(rank_sql, ','), keep.status) then dup.status else keep.status end,
    rating     = coalesce(keep.rating, dup.rating),
    review     = nullif(concat_ws(E'\n\n', nullif(btrim(keep.review), ''), nullif(btrim(dup.review), '')), ''),
    edition_id = coalesce(keep.edition_id, dup.edition_id),
    favorite   = keep.favorite or dup.favorite,
    owned      = keep.owned or dup.owned,
    tags       = array(select distinct unnest(keep.tags || dup.tags)),
    shelf_ids  = array(select distinct unnest(keep.shelf_ids || dup.shelf_ids)),
    moods      = array(select distinct unnest(keep.moods || dup.moods)),
    pace       = coalesce(keep.pace, dup.pace),
    added_at   = least(keep.added_at, dup.added_at),
    updated_at = now()
  from public.entries dup
  where keep.work_id = into_id and dup.work_id = from_id and dup.user_id = keep.user_id;

  update public.reads r set entry_id = keep.id
    from public.entries dup
    join public.entries keep on keep.user_id = dup.user_id and keep.work_id = into_id
   where dup.work_id = from_id and r.entry_id = dup.id;
  delete from public.entries dup
   using public.entries keep
   where dup.work_id = from_id and keep.work_id = into_id and keep.user_id = dup.user_id;
  update public.entries set work_id = into_id where work_id = from_id;

  -- Earlier merges into the duplicate now point at the surviving book too.
  update public.merged_works m set new_work = into_id where m.new_work = from_id;
  insert into public.merged_works (old_work, new_work) values (from_id, into_id)
    on conflict (old_work) do update set new_work = excluded.new_work, merged_at = now();

  delete from public.works where id = from_id;
end $$;
revoke all on function public.merge_works(uuid, uuid) from public, anon;
grant execute on function public.merge_works(uuid, uuid) to authenticated;

-- ── Catalogue edits: no moving editions between books, no editing books others rely on ──
create or replace function public.stamp_catalogue() returns trigger
language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_by := null;
    new.updated_at := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
    -- Only the admin can move an edition to a different book.
    if tg_table_name = 'editions' and new.work_id is distinct from old.work_id and not public.is_super_admin() then
      raise exception 'Only the admin can move an edition to a different book' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.stamp_catalogue() from public, anon, authenticated;

-- Whether readers other than you have this book on their shelves.
create or replace function public.others_have_work(w uuid) returns boolean
language sql stable security definer
set search_path = '' as $$
  select exists (select 1 from public.entries e where e.work_id = w and e.user_id <> (select auth.uid()))
$$;
revoke all on function public.others_have_work(uuid) from public, anon;
grant execute on function public.others_have_work(uuid) to authenticated;

-- Which of these books you can no longer edit because others rely on them (for the UI).
create or replace function public.shared_works(ids uuid[]) returns setof uuid
language sql stable security definer
set search_path = '' as $$
  select distinct e.work_id from public.entries e
  where e.work_id = any(ids) and e.user_id <> (select auth.uid())
$$;
revoke all on function public.shared_works(uuid[]) from public, anon;
grant execute on function public.shared_works(uuid[]) to authenticated;

-- Creators may edit their own books and editions until other readers have them; then only the admin.
alter policy "catalogue update" on public.works
  using ((created_by = (select auth.uid()) and not public.others_have_work(id)) or (select public.is_super_admin()));
alter policy "catalogue update" on public.editions
  using ((created_by = (select auth.uid()) and not public.others_have_work(work_id)) or (select public.is_super_admin()));

-- A generous cap on new catalogue records per account per hour (a big import is a few thousand).
create or replace function public.limit_catalogue_inserts() returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  if (select count(*) from public.catalogue_changes c
       where c.changed_by = (select auth.uid()) and c.action = 'insert' and c.changed_at > now() - interval '1 hour') > 6000
     and not public.is_super_admin() then
    raise exception 'Too many new books in a short time. Please try again in an hour.' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger works_insert_limit    before insert on public.works    for each row execute function public.limit_catalogue_inserts();
create trigger editions_insert_limit before insert on public.editions for each row execute function public.limit_catalogue_inserts();
revoke execute on function public.limit_catalogue_inserts() from public, anon, authenticated;

-- ── Covers only from known image hosts (no tracking pixels) ────────────────
alter table public.editions drop constraint editions_cover_url;
alter table public.editions add constraint editions_cover_url check (
  cover_url is null or (
    length(cover_url) <= 2000 and cover_url ~ ('^https://(' ||
      'pnasmqyhyssekknsjqdk\.supabase\.co/storage/v1/object/public/covers/' ||
      '|books\.google\.com/books/' ||
      '|books\.googleusercontent\.com/' ||
      '|covers\.openlibrary\.org/)')
  )
);

-- ── Length limits on the remaining text fields ─────────────────────────────
alter table public.works
  add constraint works_people_len  check (length(array_to_string(authors, '')) <= 2000 and length(array_to_string(genres, '')) <= 2000),
  add constraint works_lang_len    check (original_language is null or length(original_language) <= 60),
  add constraint works_year_range  check (first_published is null or first_published between -3000 and 3000);
alter table public.editions
  add constraint editions_people_len check (length(array_to_string(narrators, '')) <= 2000 and length(array_to_string(translators, '')) <= 2000),
  add constraint editions_small_len  check (
    (asin is null or length(asin) <= 20) and (language is null or length(language) <= 60) and (published_date is null or length(published_date) <= 20)
  );
alter table public.entries
  add constraint entries_tags_len   check (length(array_to_string(tags, '')) <= 2000 and length(array_to_string(moods, '')) <= 400);
alter table public.profiles
  add constraint profiles_name_len  check (display_name is null or length(display_name) <= 80);
alter table public.shelves
  add constraint shelves_emoji_len  check (emoji is null or length(emoji) <= 16);
alter table public.reads
  add constraint reads_progress_range check (progress is null or progress between 0 and 100000);
alter table public.logs
  add constraint logs_amount_range  check (amount between -100000 and 100000);

-- ── Cover uploads: your own folder, at most 500 images each ─────────────────
alter policy "covers upload own folder" on storage.objects
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select count(*) from storage.objects o where o.bucket_id = 'covers' and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 500
  );
create policy "covers delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
