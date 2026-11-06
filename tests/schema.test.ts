import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

// Runs the real schema on a real Postgres, with Supabase's auth and storage stubbed,
// to prove the access rules hold when acting as the roles the app actually uses.
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

describe('database access rules', () => {
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
    await db.exec(`insert into public.members (email, role) values ('${OWNER}', 'owner'), ('${TEAMMATE}', 'member');`)
    await db.exec(`insert into public.boards (id, title) values ('00000000-0000-0000-0000-000000000001', 'Secret brief');`)
    await db.exec(`
      insert into public.cards (board_id, type, search_text)
      values ('00000000-0000-0000-0000-000000000001', 'note', 'secret');
      insert into storage.objects (bucket_id, name) values ('board-images', 'a.webp');
    `)
  })

  it('lets team members read boards and cards', async () => {
    expect((await as(TEAMMATE, 'select * from public.boards')).rows).toHaveLength(1)
    expect((await as(TEAMMATE, 'select * from public.cards')).rows.length).toBeGreaterThan(0)
  })

  it('shows a logged-in stranger nothing', async () => {
    expect((await as(STRANGER, 'select * from public.boards')).rows).toHaveLength(0)
    expect((await as(STRANGER, 'select * from public.cards')).rows).toHaveLength(0)
    expect((await as(STRANGER, 'select * from public.members')).rows).toHaveLength(0)
    expect((await as(STRANGER, 'select * from storage.objects')).rows).toHaveLength(0)
  })

  it('stops a stranger writing or changing anything', async () => {
    await expect(as(STRANGER, `insert into public.boards (title) values ('x')`)).rejects.toThrow(/row-level security/)
    await expect(as(STRANGER, `insert into public.members (email, role) values ('${STRANGER}', 'owner')`)).rejects.toThrow(/row-level security/)
    await as(STRANGER, `update public.boards set title = 'hacked'`)
    await as(STRANGER, `delete from public.cards`)
    expect((await as<{ title: string }>(TEAMMATE, 'select title from public.boards')).rows[0].title).toBe('Secret brief')
    expect((await as(TEAMMATE, 'select * from public.cards')).rows).toHaveLength(1)
  })

  it('denies signed-out visitors at the permission level', async () => {
    await expect(as(null, 'select * from public.boards', 'anon')).rejects.toThrow(/permission denied/)
    await expect(as(null, 'select * from public.members', 'anon')).rejects.toThrow(/permission denied/)
  })

  it('only lets the owner manage the team', async () => {
    await expect(as(TEAMMATE, `insert into public.members (email) values ('friend@example.com')`)).rejects.toThrow(/row-level security/)
    await as(TEAMMATE, `update public.members set role = 'owner' where email = '${TEAMMATE}'`)
    const row = await as<{ role: string }>(OWNER, `select role from public.members where email = '${TEAMMATE}'`)
    expect(row.rows[0].role).toBe('member')

    await as(OWNER, `insert into public.members (email) values ('new@example.com')`)
    expect((await as('new@example.com', 'select * from public.boards')).rows).toHaveLength(1)
    await as(OWNER, `delete from public.members where email = 'new@example.com'`)
    expect((await as('new@example.com', 'select * from public.boards')).rows).toHaveLength(0)
  })

  describe('comments', () => {
    const board = '00000000-0000-0000-0000-000000000001'
    const card = '00000000-0000-0000-0000-0000000000aa'
    const post = (email: string, id: string) =>
      as(email, `insert into public.comments (id, board_id, card_id, body) values ('${id}', '${board}', '${card}', 'Hook is weak')`)
    const id = (n: number) => `10000000-0000-0000-0000-00000000000${n}`

    it('records the real author, and refuses a forged one', async () => {
      await post(TEAMMATE, id(1))
      const row = await as<{ author_email: string }>(OWNER, `select author_email from public.comments where id = '${id(1)}'`)
      expect(row.rows[0].author_email).toBe(TEAMMATE)
      await expect(
        as(TEAMMATE, `insert into public.comments (board_id, card_id, body, author_email) values ('${board}', '${card}', 'x', '${OWNER}')`),
      ).rejects.toThrow(/row-level security/)
    })

    it('hides comments from strangers and stops them posting', async () => {
      expect((await as(STRANGER, 'select * from public.comments')).rows).toHaveLength(0)
      await expect(post(STRANGER, id(2))).rejects.toThrow(/row-level security/)
    })

    it('lets anyone on the team resolve, but nobody rewrite', async () => {
      await post(TEAMMATE, id(3))
      await as(OWNER, `update public.comments set resolved = true where id = '${id(3)}'`)
      const row = await as<{ resolved: boolean }>(TEAMMATE, `select resolved from public.comments where id = '${id(3)}'`)
      expect(row.rows[0].resolved).toBe(true)
      await expect(as(OWNER, `update public.comments set body = 'rewritten' where id = '${id(3)}'`)).rejects.toThrow(/permission denied/)
    })

    it('lets only the author or the owner delete', async () => {
      await post(OWNER, id(4))
      await as(TEAMMATE, `delete from public.comments where id = '${id(4)}'`)
      expect((await as(OWNER, `select * from public.comments where id = '${id(4)}'`)).rows).toHaveLength(1)
      await post(TEAMMATE, id(5))
      await as(OWNER, `delete from public.comments where id = '${id(5)}'`)
      expect((await as(OWNER, `select * from public.comments where id = '${id(5)}'`)).rows).toHaveLength(0)
    })
  })

  it('accepts the new card types and limits attachments to 50 MB', async () => {
    const board = '00000000-0000-0000-0000-000000000001'
    for (const type of ['table', 'doc', 'file', 'sketch']) {
      await as(TEAMMATE, `insert into public.cards (board_id, type) values ('${board}', '${type}')`)
    }
    await expect(as(TEAMMATE, `insert into public.cards (board_id, type) values ('${board}', 'nonsense')`)).rejects.toThrow(/check constraint/)
    const bucket = await db.query<{ file_size_limit: number; public: boolean }>(`select file_size_limit, public from storage.buckets where id = 'board-files'`)
    expect(Number(bucket.rows[0].file_size_limit)).toBe(52428800)
    expect(bucket.rows[0].public).toBe(false)
  })

  it('counts a card edit as an update to its board', async () => {
    const id = '00000000-0000-0000-0000-000000000003'
    await as(TEAMMATE, `insert into public.boards (id, title, updated_at) values ('${id}', 'Old', '2020-01-01')`)
    await as(TEAMMATE, `update public.boards set title = 'Old' where id = '${id}'`)
    await db.exec(`update public.boards set updated_at = '2020-01-01' where id = '${id}'`)
    await as(TEAMMATE, `insert into public.cards (board_id, type) values ('${id}', 'note')`)
    const board = await as<{ updated_at: Date }>(TEAMMATE, `select updated_at from public.boards where id = '${id}'`)
    expect(new Date(board.rows[0].updated_at).getFullYear()).toBeGreaterThan(2020)
  })

  it('removes cards with their board', async () => {
    const id = '00000000-0000-0000-0000-000000000002'
    await as(TEAMMATE, `insert into public.boards (id, title) values ('${id}', 'Temp')`)
    await as(TEAMMATE, `insert into public.cards (board_id, type) values ('${id}', 'note')`)
    await as(TEAMMATE, `delete from public.boards where id = '${id}'`)
    const cards = await as(TEAMMATE, `select * from public.cards where board_id = '${id}'`)
    expect(cards.rows).toHaveLength(0)
  })
})
