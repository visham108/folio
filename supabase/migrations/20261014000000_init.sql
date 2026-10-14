-- Folio schema
-- Shared catalogue (works + editions) readable by every signed-in user;
-- personal data (entries, reads, logs, shelves, profile) private per user.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent() isn't immutable, so wrap it for use in an index expression.
create or replace function public.folio_fold(t text) returns text
language sql immutable parallel safe
set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- ── Catalogue ──────────────────────────────────────────────────────────────

create table public.works (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) > 0),
  subtitle         text,
  authors          text[] not null check (cardinality(authors) > 0),
  series           text,
  series_index     numeric,
  description      text,
  genres           text[] not null default '{}',
  first_published  int,
  original_language text,
  created_by       uuid default auth.uid() references auth.users on delete set null,
  created_at       timestamptz not null default now()
);
create index works_title_trgm on public.works using gin (public.folio_fold(title) extensions.gin_trgm_ops);

create table public.editions (
  id             uuid primary key default gen_random_uuid(),
  work_id        uuid not null references public.works on delete cascade,
  format         text not null check (format in ('hardcover','paperback','ebook','audiobook','other')),
  title          text,
  publisher      text,
  published_date text,
  isbn13         text check (isbn13 ~ '^[0-9]{13}$'),
  isbn10         text check (isbn10 ~ '^[0-9]{9}[0-9X]$'),
  asin           text,
  language       text,
  pages          int check (pages > 0),
  duration_min   int check (duration_min > 0),
  narrators      text[] not null default '{}',
  translators    text[] not null default '{}',
  cover_url      text,
  note           text,
  created_by     uuid default auth.uid() references auth.users on delete set null,
  created_at     timestamptz not null default now()
);
create index editions_work on public.editions (work_id);
create unique index editions_isbn13 on public.editions (isbn13) where isbn13 is not null;
create index editions_isbn10 on public.editions (isbn10) where isbn10 is not null;

-- Similar-title search used by the duplicate detector.
create or replace function public.find_similar_works(q_title text, q_limit int default 8)
returns setof public.works
language sql stable
set search_path = public, extensions as $$
  select w.* from public.works w
  where public.folio_fold(w.title) % public.folio_fold(q_title)
     or public.folio_fold(w.title) ilike '%' || public.folio_fold(q_title) || '%'
  order by similarity(public.folio_fold(w.title), public.folio_fold(q_title)) desc
  limit q_limit
$$;

-- ── Personal ───────────────────────────────────────────────────────────────

create table public.profiles (
  id                   uuid primary key references auth.users on delete cascade,
  display_name         text,
  yearly_goal          int not null default 24 check (yearly_goal between 0 and 1000),
  audio_pages_per_hour int not null default 30 check (audio_pages_per_hour between 1 and 200),
  theme                text not null default 'system' check (theme in ('system','light','dark')),
  updated_at           timestamptz not null default now()
);

create table public.shelves (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  name      text not null check (length(btrim(name)) > 0),
  emoji     text,
  position  int not null default 0
);

create table public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  work_id     uuid not null references public.works on delete cascade,
  edition_id  uuid references public.editions on delete set null,
  status      text not null check (status in ('want','reading','read','dnf','paused')),
  rating      numeric(2,1) check (rating between 0.5 and 5 and rating * 2 = floor(rating * 2)),
  review      text,
  favorite    boolean not null default false,
  owned       boolean not null default false,
  tags        text[] not null default '{}',
  shelf_ids   uuid[] not null default '{}',
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, work_id)
);

-- Dates are text so "2019" or "2019-06" are allowed when the exact day is unknown.
create table public.reads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  entry_id     uuid not null references public.entries on delete cascade,
  edition_id   uuid references public.editions on delete set null,
  state        text not null check (state in ('reading','finished','dnf','paused')),
  started_on   text check (started_on ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  finished_on  text check (finished_on ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  progress     numeric,
  rating       numeric(2,1) check (rating between 0.5 and 5),
  notes        text
);
create index reads_entry on public.reads (entry_id);
create index reads_user on public.reads (user_id);
create index reads_edition on public.reads (edition_id);

create table public.logs (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  read_id  uuid not null references public.reads on delete cascade,
  on_date  date not null,
  amount   numeric not null,
  medium   text not null check (medium in ('print','ebook','audio'))
);
create index logs_user_date on public.logs (user_id, on_date);
create index logs_read on public.logs (read_id);
create index entries_work on public.entries (work_id);
create index entries_edition on public.entries (edition_id);
create index shelves_user on public.shelves (user_id);
create index works_created_by on public.works (created_by);
create index editions_created_by on public.editions (created_by);

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.works    enable row level security;
alter table public.editions enable row level security;
alter table public.profiles enable row level security;
alter table public.shelves  enable row level security;
alter table public.entries  enable row level security;
alter table public.reads    enable row level security;
alter table public.logs     enable row level security;

create policy "catalogue readable" on public.works    for select to authenticated using (true);
create policy "catalogue insert"   on public.works    for insert to authenticated with check (created_by = (select auth.uid()));
create policy "catalogue update"   on public.works    for update to authenticated using (created_by = (select auth.uid()));
create policy "catalogue readable" on public.editions for select to authenticated using (true);
create policy "catalogue insert"   on public.editions for insert to authenticated with check (created_by = (select auth.uid()));
create policy "catalogue update"   on public.editions for update to authenticated using (created_by = (select auth.uid()));

create policy "own profile"  on public.profiles for all to authenticated using (id = (select auth.uid()))      with check (id = (select auth.uid()));
create policy "own shelves"  on public.shelves  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own entries"  on public.entries  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own reads"    on public.reads    for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own logs"     on public.logs     for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Cover images ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('covers', 'covers', true)
on conflict (id) do nothing;

create policy "covers upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
