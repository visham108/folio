-- Personal mood and pace tags (how a book felt to you, so they live on your shelf entry).
alter table public.entries
  add column moods text[] not null default '{}',
  add column pace text check (pace in ('slow','medium','fast')),
  add constraint entries_moods_n check (cardinality(moods) <= 12);
create index if not exists works_series on public.works (series) where series is not null;
