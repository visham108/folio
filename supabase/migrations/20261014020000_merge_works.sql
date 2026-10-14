-- Admin-only: fold a duplicate book into another. Editions move across, and
-- readers' shelf entries and reading history follow them.
create or replace function public.merge_works(from_id uuid, into_id uuid) returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the admin can merge books' using errcode = '42501';
  end if;
  if from_id = into_id then
    raise exception 'Choose a different book to merge into';
  end if;
  if not exists (select 1 from public.works where id = into_id) then
    raise exception 'The book to merge into no longer exists';
  end if;

  update public.editions set work_id = into_id where work_id = from_id;

  -- Readers who have both books keep one entry; their reads move across.
  update public.reads r set entry_id = keep.id
    from public.entries dup
    join public.entries keep on keep.user_id = dup.user_id and keep.work_id = into_id
   where dup.work_id = from_id and r.entry_id = dup.id;
  delete from public.entries dup
   using public.entries keep
   where dup.work_id = from_id and keep.work_id = into_id and keep.user_id = dup.user_id;
  update public.entries set work_id = into_id where work_id = from_id;

  delete from public.works where id = from_id;
end $$;
revoke all on function public.merge_works(uuid, uuid) from public, anon;
grant execute on function public.merge_works(uuid, uuid) to authenticated;
