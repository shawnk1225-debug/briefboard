-- Briefboard database setup. Run once in the Supabase SQL editor.
-- Safe by default: nobody can read or write anything unless their login email
-- is listed in public.members.

create table public.members (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  parent_board_id uuid references public.boards (id) on delete cascade,
  title text not null default 'Untitled board',
  is_template boolean not null default false,
  deleted_at timestamptz,
  updated_client text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index boards_parent_idx on public.boards (parent_board_id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  type text not null check (type in ('note', 'image', 'link', 'todo', 'board', 'column', 'arrow', 'table', 'doc', 'file', 'sketch')),
  x double precision not null default 0,
  y double precision not null default 0,
  w double precision not null default 260,
  z double precision not null default 0,
  column_id uuid,
  column_order double precision not null default 0,
  content jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  updated_client text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_board_idx on public.cards (board_id);

-- card_id has no foreign key on purpose: undoing a card's deletion brings back its comments.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  card_id uuid not null,
  author_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  body text not null check (length(body) between 1 and 5000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_board_idx on public.comments (board_id);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger boards_touch before update on public.boards
  for each row execute function public.touch_updated_at();
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();

-- Editing a card counts as updating its board, for the home page's sort order.
create function public.touch_parent_board() returns trigger
language plpgsql as $$
begin
  update public.boards set updated_at = now()
  where id = case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  return null;
end;
$$;

create trigger cards_touch_board after insert or update or delete on public.cards
  for each row execute function public.touch_parent_board();

-- security definer so the policies below can read members without recursing.
create function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'owner'
  );
$$;

alter table public.members enable row level security;
alter table public.boards enable row level security;
alter table public.cards enable row level security;

create policy members_read on public.members for select to authenticated
  using (public.is_member());
create policy members_write on public.members for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy boards_all on public.boards for all to authenticated
  using (public.is_member()) with check (public.is_member());
create policy cards_all on public.cards for all to authenticated
  using (public.is_member()) with check (public.is_member());

alter table public.comments enable row level security;

create policy comments_read on public.comments for select to authenticated
  using (public.is_member());
-- Comments can't be posted under someone else's name.
create policy comments_add on public.comments for insert to authenticated
  with check (public.is_member() and author_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy comments_resolve on public.comments for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy comments_delete on public.comments for delete to authenticated
  using (public.is_owner() or (public.is_member() and author_email = lower(coalesce(auth.jwt() ->> 'email', ''))));

-- Any member can mark a comment resolved, but nobody can rewrite its text or author.
revoke all on public.comments from anon, authenticated;
grant select, insert, delete on public.comments to authenticated;
grant update (resolved) on public.comments to authenticated;

revoke all on public.members, public.boards, public.cards from anon;
grant select, insert, update, delete on public.members, public.boards, public.cards to authenticated;

-- Private image storage: signed URLs only, members only.
insert into storage.buckets (id, name, public) values ('board-images', 'board-images', false);

create policy board_images_read on storage.objects for select to authenticated
  using (bucket_id = 'board-images' and public.is_member());
create policy board_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'board-images' and public.is_member());
create policy board_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board-images' and public.is_member());

-- Attachments: 50 MB each, which is also the limit on Supabase's free plan.
insert into storage.buckets (id, name, public, file_size_limit) values ('board-files', 'board-files', false, 52428800);

create policy board_files_read on storage.objects for select to authenticated
  using (bucket_id = 'board-files' and public.is_member());
create policy board_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'board-files' and public.is_member());
create policy board_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board-files' and public.is_member());

-- Live updates between teammates.
alter publication supabase_realtime add table public.boards, public.cards, public.comments;
