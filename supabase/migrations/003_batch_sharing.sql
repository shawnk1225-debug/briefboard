-- Secret view-and-comment links for batches, one comment list per board, and team-only comments.
-- Run once in the Supabase SQL editor. It only adds things: existing data is left as it is, and no
-- batch is shared until someone turns its link on.

begin;

alter table public.folders
  add column share_token text unique check (share_token is null or length(share_token) >= 32);

alter table public.comments
  alter column card_id drop not null,
  add column internal boolean not null default false,
  add column author_name text check (author_name is null or length(author_name) between 1 and 80);

-- Team comments keep their real author. Only comments from a link have a typed name.
drop policy comments_add on public.comments;
create policy comments_add on public.comments for insert to authenticated
  with check (
    public.is_member()
    and author_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and author_name is null
  );

-- Comments from a link have no account behind them, so anyone on the team can remove them.
drop policy comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (
    public.is_owner()
    or (public.is_member() and (author_email = '' or author_email = lower(coalesce(auth.jwt() ->> 'email', ''))))
  );

-- The folder a link opens, plus its batches if it's a product folder.
create function public.share_folder_ids(p_token text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select f.id from public.folders f
  where p_token is not null and length(p_token) >= 32
    and (f.share_token = p_token
      or f.parent_id in (select id from public.folders where share_token = p_token));
$$;

-- Every board a link reaches: live boards in its folders, and boards nested inside those.
create function public.share_board_ids(p_token text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select b.id from public.boards b
    where b.folder_id in (select public.share_folder_ids(p_token))
      and b.deleted_at is null and not b.is_template and b.parent_board_id is null
    union all
    select child.id from public.boards child
    join tree on child.parent_board_id = tree.id
    where child.deleted_at is null
  )
  select id from tree;
$$;

create function public.share_get_batch(p_token text) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'name', f.name,
    'boards', coalesce((
      select json_agg(json_build_object(
        'id', b.id,
        'parent_board_id', b.parent_board_id,
        'title', b.title,
        'format', b.format,
        'updated_at', b.updated_at
      ) order by b.updated_at desc)
      from public.boards b
      where b.id in (select public.share_board_ids(p_token))
    ), '[]'::json)
  )
  from public.folders f
  where p_token is not null and length(p_token) >= 32 and f.share_token = p_token;
$$;

-- Never returns team-only comments, or anyone's full email address.
create function public.share_get_board(p_token text, p_board_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'board', json_build_object(
      'id', b.id,
      'parent_board_id', b.parent_board_id,
      'title', b.title,
      'format', b.format,
      'updated_at', b.updated_at
    ),
    'cards', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'board_id', c.board_id, 'type', c.type,
        'x', c.x, 'y', c.y, 'w', c.w, 'z', c.z,
        'column_id', c.column_id, 'column_order', c.column_order,
        'content', c.content, 'search_text', c.search_text
      ))
      from public.cards c where c.board_id = b.id
    ), '[]'::json),
    'comments', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'board_id', m.board_id, 'card_id', m.card_id,
        'author_name', coalesce(m.author_name, split_part(m.author_email, '@', 1)),
        'body', m.body, 'resolved', m.resolved, 'created_at', m.created_at
      ) order by m.created_at)
      from public.comments m where m.board_id = b.id and not m.internal
    ), '[]'::json)
  )
  from public.boards b
  where b.id = p_board_id and b.id in (select public.share_board_ids(p_token));
$$;

create function public.share_add_comment(p_token text, p_board_id uuid, p_card_id uuid, p_name text, p_body text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.comments;
begin
  if p_board_id not in (select public.share_board_ids(p_token)) then
    raise exception 'This link is not active' using errcode = 'P0001';
  end if;
  if length(v_name) not between 1 and 80 or length(v_body) not between 1 and 5000 then
    raise exception 'A name and a comment are required' using errcode = 'P0001';
  end if;
  if p_card_id is not null and not exists (
    select 1 from public.cards where id = p_card_id and board_id = p_board_id
  ) then
    raise exception 'That card is not on this board' using errcode = 'P0001';
  end if;
  -- A leaked link shouldn't be able to flood a board or fill the database.
  if (
    select count(*) from public.comments
    where author_email = '' and created_at > now() - interval '10 minutes'
      and board_id in (select public.share_board_ids(p_token))
  ) >= 60 then
    raise exception 'Too many comments right now. Try again in a few minutes.' using errcode = 'P0001';
  end if;

  insert into public.comments (board_id, card_id, author_email, author_name, body, internal)
  values (p_board_id, p_card_id, '', v_name, v_body, false)
  returning * into v_row;

  return json_build_object(
    'id', v_row.id, 'board_id', v_row.board_id, 'card_id', v_row.card_id,
    'author_name', v_row.author_name, 'body', v_row.body,
    'resolved', v_row.resolved, 'created_at', v_row.created_at
  );
end;
$$;

-- Lets storage hand out a file only when the request carries a live link
-- and a card reached by that link uses that exact file.
create function public.share_can_read_file(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_token text;
begin
  begin
    v_token := nullif(current_setting('request.headers', true), '')::json ->> 'x-briefboard-share';
  exception when others then
    return false;
  end;
  if v_token is null then
    return false;
  end if;
  return exists (
    select 1 from public.cards c
    where c.board_id in (select public.share_board_ids(v_token))
      and c.content ->> 'ref' = p_name
      and ((p_bucket = 'board-images' and c.type = 'image') or (p_bucket = 'board-files' and c.type = 'file'))
  );
end;
$$;

create policy shared_files_read on storage.objects for select to anon
  using (bucket_id in ('board-images', 'board-files') and public.share_can_read_file(bucket_id, name));

-- Supabase lets anyone run new functions by default, so each is locked down explicitly.
revoke all on function public.share_folder_ids(text) from public, anon, authenticated;
revoke all on function public.share_board_ids(text) from public, anon, authenticated;
revoke all on function public.share_get_batch(text) from public, anon, authenticated;
revoke all on function public.share_get_board(text, uuid) from public, anon, authenticated;
revoke all on function public.share_add_comment(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.share_can_read_file(text, text) from public, anon, authenticated;
grant execute on function public.share_get_batch(text) to anon, authenticated;
grant execute on function public.share_get_board(text, uuid) to anon, authenticated;
grant execute on function public.share_add_comment(text, uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.share_can_read_file(text, text) to anon, authenticated;

create or replace function public.briefboard_schema_version() returns integer
language sql immutable as $$ select 3 $$;

commit;

notify pgrst, 'reload schema';
