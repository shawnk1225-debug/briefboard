import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

// Applies the update the way it will really happen: on top of the original schema,
// with boards, cards, comments and images already in the database.
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to authenticated;
  create publication supabase_realtime;
`

const OWNER = 'owner@example.com'
const TEAMMATE = 'teammate@example.com'
const STRANGER = 'stranger@example.com'
const BOARD = '00000000-0000-0000-0000-000000000001'
const OLD_DATE = '2021-03-04T05:06:07.000Z'

describe('home organization database update', () => {
  let db: PGlite

  const as = async <T>(email: string | null, sql: string, role = 'authenticated') => {
    await db.exec(`reset role; select set_config('test.email', '${email ?? ''}', false); set role ${role};`)
    try {
      return await db.query<T>(sql)
    } finally {
      await db.exec('reset role;')
    }
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(SUPABASE_STUBS)
    await db.exec(readFileSync('supabase/schema.sql', 'utf8'))
    await db.exec(`
      insert into public.members (email, role) values ('${OWNER}', 'owner'), ('${TEAMMATE}', 'member');
      insert into public.boards (id, title, updated_at) values ('${BOARD}', 'Existing brief', '${OLD_DATE}');
      insert into public.cards (board_id, type, search_text) values ('${BOARD}', 'note', 'existing card');
      insert into public.comments (board_id, card_id, body, author_email)
        values ('${BOARD}', '00000000-0000-0000-0000-0000000000aa', 'existing comment', '${OWNER}');
      alter table public.boards disable trigger boards_touch;
      update public.boards set updated_at = '${OLD_DATE}' where id = '${BOARD}';
      alter table public.boards enable trigger boards_touch;
    `)
    await db.exec(readFileSync('supabase/migrations/002_home_organization.sql', 'utf8'))
  })

  it('leaves existing data untouched, with boards starting unfiled and unlabelled', async () => {
    const boards = await as<Record<string, unknown>>(TEAMMATE, `select * from public.boards where id = '${BOARD}'`)
    expect(boards.rows[0]).toMatchObject({ title: 'Existing brief', folder_id: null, status: null, format: null })
    expect(new Date(boards.rows[0].updated_at as string).toISOString()).toBe(OLD_DATE)
    expect((await as(TEAMMATE, `select * from public.cards where search_text = 'existing card'`)).rows).toHaveLength(1)
    expect((await as(TEAMMATE, `select * from public.comments where body = 'existing comment'`)).rows).toHaveLength(1)
  })

  it('reports its version to anyone, so a deploy can check it has run', async () => {
    const result = await as<{ v: number }>(null, 'select public.briefboard_schema_version() as v', 'anon')
    expect(result.rows[0].v).toBe(2)
  })

  describe('folders', () => {
    const insert = (email: string, id: string, name: string, parent: string | null = null) =>
      as(email, `insert into public.folders (id, name, parent_id) values ('${id}', '${name}', ${parent ? `'${parent}'` : 'null'})`)
    const id = (n: number) => `20000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`

    it('are shared with the team, and hidden from strangers and signed-out visitors', async () => {
      await insert(TEAMMATE, id(1), 'Product A')
      expect((await as(OWNER, `select * from public.folders where id = '${id(1)}'`)).rows).toHaveLength(1)
      expect((await as(STRANGER, 'select * from public.folders')).rows).toHaveLength(0)
      await expect(insert(STRANGER, id(2), 'Nope')).rejects.toThrow(/row-level security/)
      await expect(as(null, 'select * from public.folders', 'anon')).rejects.toThrow(/permission denied/)
    })

    it('stop at two levels', async () => {
      await insert(OWNER, id(3), 'Product B')
      await insert(OWNER, id(4), 'Batch 1', id(3))
      await expect(insert(OWNER, id(5), 'Too deep', id(4))).rejects.toThrow(/two levels/)
      await insert(OWNER, id(6), 'Product C')
      await expect(as(OWNER, `update public.folders set parent_id = '${id(6)}' where id = '${id(3)}'`)).rejects.toThrow(/subfolders/)
      await expect(as(OWNER, `update public.folders set parent_id = '${id(6)}' where id = '${id(6)}'`)).rejects.toThrow(/itself/)
      await as(OWNER, `update public.folders set parent_id = '${id(6)}' where id = '${id(4)}'`)
    })

    it('never take boards with them when deleted, including through a batch', async () => {
      const board = '00000000-0000-0000-0000-000000000011'
      const inBatch = '00000000-0000-0000-0000-000000000012'
      await insert(OWNER, id(7), 'Product D')
      await insert(OWNER, id(8), 'Batch 1', id(7))
      await as(OWNER, `insert into public.boards (id, title, folder_id) values ('${board}', 'In product', '${id(7)}'), ('${inBatch}', 'In batch', '${id(8)}')`)
      await as(OWNER, `insert into public.cards (board_id, type, search_text) values ('${inBatch}', 'note', 'keep me')`)

      await as(OWNER, `delete from public.folders where id = '${id(7)}'`)

      expect((await as(OWNER, `select * from public.folders where id in ('${id(7)}', '${id(8)}')`)).rows).toHaveLength(0)
      const boards = await as<{ folder_id: string | null }>(OWNER, `select folder_id from public.boards where id in ('${board}', '${inBatch}')`)
      expect(boards.rows.map((r) => r.folder_id)).toEqual([null, null])
      expect((await as(OWNER, `select * from public.cards where search_text = 'keep me'`)).rows).toHaveLength(1)
    })
  })

  describe('last edited date', () => {
    const board = '00000000-0000-0000-0000-000000000021'
    const date = async () => {
      const row = await as<{ updated_at: string }>(OWNER, `select updated_at from public.boards where id = '${board}'`)
      return new Date(row.rows[0].updated_at).toISOString()
    }
    const reset = () => db.exec(`update public.boards set updated_at = '${OLD_DATE}' where id = '${board}'`)

    beforeAll(async () => {
      await as(OWNER, `insert into public.boards (id, title) values ('${board}', 'Dates')`)
      await reset()
    })

    it('stays put when a board is filed, labelled, trashed or restored', async () => {
      await as(OWNER, `update public.boards set status = 'live', format = 'video' where id = '${board}'`)
      await as(OWNER, `update public.boards set deleted_at = now() where id = '${board}'`)
      await as(OWNER, `update public.boards set deleted_at = null where id = '${board}'`)
      expect(await date()).toBe(OLD_DATE)
    })

    it('moves when a board is renamed or its cards change', async () => {
      await as(OWNER, `update public.boards set title = 'Renamed' where id = '${board}'`)
      expect(await date()).not.toBe(OLD_DATE)
      await reset()
      expect(await date()).toBe(OLD_DATE)
      await as(OWNER, `insert into public.cards (board_id, type) values ('${board}', 'note')`)
      expect(await date()).not.toBe(OLD_DATE)
    })
  })

  it('only accepts known labels', async () => {
    await expect(as(OWNER, `update public.boards set status = 'nonsense' where id = '${BOARD}'`)).rejects.toThrow(/check constraint/)
    await expect(as(OWNER, `update public.boards set format = 'nonsense' where id = '${BOARD}'`)).rejects.toThrow(/check constraint/)
  })

  describe('pins', () => {
    it('are private to each person, and fill in the email automatically', async () => {
      await as(OWNER, `insert into public.pins (board_id) values ('${BOARD}')`)
      const mine = await as<{ email: string }>(OWNER, 'select email from public.pins')
      expect(mine.rows.map((r) => r.email)).toEqual([OWNER])
      expect((await as(TEAMMATE, 'select * from public.pins')).rows).toHaveLength(0)
      await as(TEAMMATE, 'delete from public.pins')
      expect((await as(OWNER, 'select * from public.pins')).rows).toHaveLength(1)
    })

    it('tolerate pinning twice', async () => {
      await as(OWNER, `insert into public.pins (board_id) values ('${BOARD}') on conflict (email, board_id) do nothing`)
      expect((await as(OWNER, 'select * from public.pins')).rows).toHaveLength(1)
    })

    it('cannot be made in someone else’s name, or by a stranger', async () => {
      await expect(as(TEAMMATE, `insert into public.pins (email, board_id) values ('${OWNER}', '${BOARD}')`)).rejects.toThrow(/row-level security/)
      await expect(as(STRANGER, `insert into public.pins (board_id) values ('${BOARD}')`)).rejects.toThrow(/row-level security/)
      await expect(as(null, 'select * from public.pins', 'anon')).rejects.toThrow(/permission denied/)
    })

    it('disappear with their board', async () => {
      const board = '00000000-0000-0000-0000-000000000031'
      await as(OWNER, `insert into public.boards (id, title) values ('${board}', 'Temp')`)
      await as(OWNER, `insert into public.pins (board_id) values ('${board}')`)
      await as(OWNER, `delete from public.boards where id = '${board}'`)
      expect((await as(OWNER, `select * from public.pins where board_id = '${board}'`)).rows).toHaveLength(0)
    })
  })
})
