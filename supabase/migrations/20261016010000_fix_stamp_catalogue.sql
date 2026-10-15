-- Fix: the "only the admin moves editions" check also ran for books, which have no work_id,
-- so every book edit failed. Check the table in its own IF first.
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
    -- Only the admin can move an edition to a different book. (Books have no work_id, so check
    -- the table first in its own IF: plpgsql would otherwise evaluate new.work_id for books too.)
    if tg_table_name = 'editions' then
      if (to_jsonb(new) ->> 'work_id') is distinct from (to_jsonb(old) ->> 'work_id') and not public.is_super_admin() then
        raise exception 'Only the admin can move an edition to a different book' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.stamp_catalogue() from public, anon, authenticated;
