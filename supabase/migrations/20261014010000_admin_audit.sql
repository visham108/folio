-- Super admin, change history, and input limits.

-- ── Super admin ────────────────────────────────────────────────────────────
-- Exactly one super admin, identified by the email on their sign-in account.
-- The table has RLS on and no policies, so the API can neither read nor change it.
create table public.super_admin (
  singleton boolean primary key default true check (singleton),
  email     text not null
);
alter table public.super_admin enable row level security;
insert into public.super_admin (email) values ('visham.rawat@gmail.com');

create or replace function public.is_super_admin() returns boolean
language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.super_admin a on lower(u.email) = lower(a.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  )
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- ── Who touched what ───────────────────────────────────────────────────────
-- No foreign keys on these audit columns: history must survive account deletion.
alter table public.works    add column updated_by uuid, add column updated_at timestamptz;
alter table public.editions add column updated_by uuid, add column updated_at timestamptz;

-- Creation fields can't be forged or rewritten; edits are stamped.
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
  end if;
  return new;
end $$;

create trigger works_stamp    before insert or update on public.works    for each row execute function public.stamp_catalogue();
create trigger editions_stamp before insert or update on public.editions for each row execute function public.stamp_catalogue();

-- Append-only history of every catalogue change.
create table public.catalogue_changes (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert','update','delete')),
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  before      jsonb,
  after       jsonb
);
create index catalogue_changes_record on public.catalogue_changes (record_id, changed_at desc);
create index catalogue_changes_by on public.catalogue_changes (changed_by);
alter table public.catalogue_changes enable row level security;
-- Readers see the history of their own changes; the admin sees everything. Nobody can edit it.
create policy "history readable" on public.catalogue_changes for select to authenticated
  using (changed_by = (select auth.uid()) or (select public.is_super_admin()));

create or replace function public.log_catalogue_change() returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.catalogue_changes (table_name, record_id, action, changed_by, before, after)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    (select auth.uid()),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger works_history    after insert or update or delete on public.works    for each row execute function public.log_catalogue_change();
create trigger editions_history after insert or update or delete on public.editions for each row execute function public.log_catalogue_change();

-- Trigger functions are never called directly.
revoke execute on function public.log_catalogue_change() from public, anon, authenticated;
revoke execute on function public.stamp_catalogue() from public, anon, authenticated;

-- ── Permissions: own records, or the super admin ───────────────────────────
alter policy "catalogue update" on public.works
  using (created_by = (select auth.uid()) or (select public.is_super_admin()));
alter policy "catalogue update" on public.editions
  using (created_by = (select auth.uid()) or (select public.is_super_admin()));
-- Only the admin removes catalogue records (other readers may have them on their shelves).
create policy "catalogue delete" on public.works for delete to authenticated
  using ((select public.is_super_admin()));
create policy "catalogue delete" on public.editions for delete to authenticated
  using ((select public.is_super_admin()));

-- ── Input limits (the catalogue is shared, so keep it tidy) ────────────────
alter table public.works
  add constraint works_title_len    check (length(title) <= 300),
  add constraint works_subtitle_len check (subtitle is null or length(subtitle) <= 300),
  add constraint works_series_len   check (series is null or length(series) <= 200),
  add constraint works_desc_len     check (description is null or length(description) <= 10000),
  add constraint works_authors_n    check (cardinality(authors) <= 20),
  add constraint works_genres_n     check (cardinality(genres) <= 20);
alter table public.editions
  add constraint editions_title_len check (title is null or length(title) <= 300),
  add constraint editions_pub_len   check (publisher is null or length(publisher) <= 200),
  add constraint editions_note_len  check (note is null or length(note) <= 500),
  add constraint editions_cover_url check (cover_url is null or (length(cover_url) <= 2000 and cover_url ~ '^https://')),
  add constraint editions_people_n  check (cardinality(narrators) <= 20 and cardinality(translators) <= 20),
  add constraint editions_pages_max check (pages is null or pages <= 20000),
  add constraint editions_dur_max   check (duration_min is null or duration_min <= 20000);
alter table public.entries
  add constraint entries_review_len check (review is null or length(review) <= 20000),
  add constraint entries_tags_n     check (cardinality(tags) <= 50);
alter table public.reads
  add constraint reads_notes_len    check (notes is null or length(notes) <= 5000),
  add constraint reads_dates_order  check (started_on is null or finished_on is null or length(started_on) <> 10 or length(finished_on) <> 10 or finished_on >= started_on);
alter table public.shelves
  add constraint shelves_name_len   check (length(name) <= 80);

-- Covers: images only, at most 2 MB.
update storage.buckets
set file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'covers';
