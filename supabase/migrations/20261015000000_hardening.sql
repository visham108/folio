-- Audit fixes (Oct 2026)

-- Reads must hang off your own shelf entry; progress logs off your own reads.
alter policy "own reads" on public.reads
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = (select auth.uid()))
  );
alter policy "own logs" on public.logs
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.reads r where r.id = read_id and r.user_id = (select auth.uid()))
  );

-- Pin the super admin to the signed-in account itself, not just an email address.
-- (Run after the admin has signed in once, so the account exists.)
alter table public.super_admin add column user_id uuid;
update public.super_admin a set user_id = u.id from auth.users u where lower(u.email) = lower(a.email);
alter table public.super_admin alter column user_id set not null;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer
set search_path = '' as $$
  select exists (select 1 from public.super_admin a where a.user_id = (select auth.uid()))
$$;

-- Batch lookup used by imports and adds: catalogue books whose main title
-- (before any subtitle) matches, ignoring case and accents.
create or replace function public.works_by_titles(q_titles text[])
returns setof public.works
language sql stable
set search_path = public, extensions as $$
  select w.* from public.works w
  where public.folio_fold(btrim(split_part(w.title, ':', 1)))
        = any (select public.folio_fold(btrim(split_part(t, ':', 1))) from unnest(q_titles) t)
  limit 5000
$$;
create index if not exists works_title_main on public.works (public.folio_fold(btrim(split_part(title, ':', 1))));
revoke all on function public.works_by_titles(text[]) from public, anon;
grant execute on function public.works_by_titles(text[]) to authenticated;
