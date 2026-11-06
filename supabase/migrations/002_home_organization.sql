-- Folders, labels and pinned boards for the home page.
-- Run once in the Supabase SQL editor, after schema.sql. It only adds things:
-- existing boards and cards are left as they are, and start out unfiled.

begin;

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  updated_client text,
  created_at timestamptz not null default now()
);
create index folders_parent_idx on public.folders (parent_id);

-- Two levels only: product, then batch.
create function public.check_folder_depth() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A folder cannot be inside itself';
    end if;
    if exists (select 1 from public.folders where id = new.parent_id and parent_id is not null) then
      raise exception 'Folders can only be two levels deep';
    end if;
    if exists (select 1 from public.folders where parent_id = new.id) then
      raise exception 'A folder with subfolders cannot go inside another folder';
    end if;
  end if;
  return new;
end;
$$;

create trigger folders_depth before insert or update of parent_id on public.folders
  for each row execute function public.check_folder_depth();

-- Deleting a folder never deletes boards: they become unfiled.
alter table public.boards
  add column folder_id uuid references public.folders (id) on delete set null,
  add column status text check (status in ('draft', 'in_production', 'live', 'done')),
  add column format text check (format in ('video', 'static'));
create index boards_folder_idx on public.boards (folder_id);

-- Filing or labelling a board isn't editing it, so it keeps its place in "last edited".
create function public.touch_board_updated_at() returns trigger
language plpgsql as $$
begin
  if new.title is distinct from old.title then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger boards_touch on public.boards;
create trigger boards_touch before update on public.boards
  for each row execute function public.touch_board_updated_at();

-- Each person's own pinned boards.
create table public.pins (
  email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  board_id uuid not null references public.boards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (email, board_id)
);
create index pins_board_idx on public.pins (board_id);

alter table public.folders enable row level security;
alter table public.pins enable row level security;

create policy folders_all on public.folders for all to authenticated
  using (public.is_member()) with check (public.is_member());

create policy pins_own on public.pins for all to authenticated
  using (public.is_member() and email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.is_member() and email = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on public.folders, public.pins from anon;
grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, delete on public.pins to authenticated;

alter publication supabase_realtime add table public.folders;

-- Lets a deploy confirm this update has run. It reveals nothing but this number.
create function public.briefboard_schema_version() returns integer
language sql immutable as $$ select 2 $$;
grant execute on function public.briefboard_schema_version() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
