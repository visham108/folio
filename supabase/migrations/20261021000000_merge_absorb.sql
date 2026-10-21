-- Merging books: fill the kept book's blank details from the duplicate, and optionally
-- combine the duplicate's editions into the kept edition instead of listing them separately.
--   absorb = false: editions are listed side by side under the kept book (as before).
--   absorb = true:  each of the duplicate's editions folds into the kept book's copy of the
--                   same format (yours if it's that format, otherwise the oldest): it fills that
--                   copy's blanks, everyone's shelves and reads move to it, and it's removed.
--                   A format the kept book doesn't have moves across as its own edition.
drop function if exists public.merge_works(uuid, uuid);

create or replace function public.merge_works(from_id uuid, into_id uuid, absorb boolean default false)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  rank_sql constant text := 'want,dnf,paused,read,reading';
  me uuid := (select auth.uid());
  keep_ed uuid;
  my_keep uuid;
  de public.editions%rowtype;
  dup_isbn13 text;
  dup_isbn10 text;
  dup_asin text;
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

  -- Book details: anything the kept book leaves blank comes from the duplicate.
  update public.works k set
    subtitle          = coalesce(k.subtitle, d.subtitle),
    series            = coalesce(k.series, d.series),
    series_index      = case when k.series is null then d.series_index else k.series_index end,
    description       = coalesce(k.description, d.description),
    genres            = case when coalesce(cardinality(k.genres), 0) = 0 then d.genres else k.genres end,
    first_published   = coalesce(k.first_published, d.first_published),
    original_language = coalesce(k.original_language, d.original_language)
  from public.works d
  where k.id = into_id and d.id = from_id;

  if not absorb then
    -- Keep both: list the duplicate's editions under the kept book.
    update public.editions set work_id = into_id where work_id = from_id;
  else
    -- Your copy of the kept book, which wins when it's the right format.
    select e.edition_id into my_keep from public.entries e
      join public.editions x on x.id = e.edition_id and x.work_id = into_id
      where e.work_id = into_id and e.user_id = me;
    -- Your copy of the duplicate first, so its details win over other printings'.
    for de in
      select x.* from public.editions x
      left join public.entries e on e.edition_id = x.id and e.user_id = me
      where x.work_id = from_id
      order by (e.id is null), x.created_at, x.id
    loop
      -- The kept book's copy in the same format: yours if it is, otherwise the oldest.
      keep_ed := null;
      select x.id into keep_ed from public.editions x
        where x.work_id = into_id and x.format = de.format
        order by coalesce(x.id = my_keep, false) desc, x.created_at, x.id limit 1;
      if keep_ed is null then
        -- No copy in this format yet: it moves across as its own edition.
        update public.editions set work_id = into_id where id = de.id;
        continue;
      end if;
      -- Identifiers are unique: free them on the duplicate before the kept copy takes them.
      dup_isbn13 := de.isbn13; dup_isbn10 := de.isbn10; dup_asin := de.asin;
      update public.editions set isbn13 = null, isbn10 = null, asin = null where id = de.id;
      update public.editions k set
        title          = coalesce(k.title, de.title),
        publisher      = coalesce(k.publisher, de.publisher),
        published_date = coalesce(k.published_date, de.published_date),
        isbn13         = coalesce(k.isbn13, dup_isbn13),
        isbn10         = coalesce(k.isbn10, dup_isbn10),
        asin           = coalesce(k.asin, dup_asin),
        language       = coalesce(k.language, de.language),
        pages          = coalesce(k.pages, de.pages),
        duration_min   = coalesce(k.duration_min, de.duration_min),
        narrators      = case when coalesce(cardinality(k.narrators), 0) = 0 then de.narrators else k.narrators end,
        translators    = case when coalesce(cardinality(k.translators), 0) = 0 then de.translators else k.translators end,
        cover_url      = coalesce(k.cover_url, de.cover_url),
        note           = coalesce(k.note, de.note)
      where k.id = keep_ed;
      update public.entries set edition_id = keep_ed where edition_id = de.id;
      update public.reads set edition_id = keep_ed where edition_id = de.id;
      delete from public.editions where id = de.id;
    end loop;
  end if;

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
end
$function$;

revoke all on function public.merge_works(uuid, uuid, boolean) from public, anon;
grant execute on function public.merge_works(uuid, uuid, boolean) to authenticated;

-- Let the API see the new argument straight away.
notify pgrst, 'reload schema';
