import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

// Attacks the sharing rules on a real Postgres, acting as the signed-out role a link visitor has.
const STUBS = `
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
  grant select, insert, delete on storage.objects to anon, authenticated;
  create publication supabase_realtime;
`

const OWNER = 'owner@example.com'
const TEAMMATE = 'teammate@example.com'
const STRANGER = 'stranger@example.com'
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const TOKEN = 'a'.repeat(64)
const OTHER_TOKEN = 'b'.repeat(64)
const PRODUCT_TOKEN = 'c'.repeat(64)

const BATCH = id(1)
const OTHER_BATCH = id(2)
const UNSHARED_BATCH = id(3)
const PRODUCT = id(4)
const BOARD = id(10)
const NESTED = id(11)
const OTHER_BOARD = id(12)
const UNSHARED_BOARD = id(13)
const TRASHED_BOARD = id(14)
const TEMPLATE_BOARD = id(15)
const NESTED_TRASHED = id(16)
const CARD = id(20)
const OTHER_CARD = id(21)

interface BatchResult {
  name: string
  boards: { id: string; title: string }[]
}
interface BoardResult {
  board: { id: string }
  cards: { id: string; content: { ref?: string } }[]
  comments: { body: string; author_name: string; email?: string; author_email?: string }[]
}

describe('secret batch links', () => {
  let db: PGlite

  const as = async <T>(role: 'anon' | 'authenticated', email: string | null, sql: string) => {
    await db.exec(`reset role; select set_config('test.email', '${email ?? ''}', false); set role ${role};`)
    try {
      return await db.query<T>(sql)
    } finally {
      await db.exec('reset role;')
    }
  }
  const visitor = <T>(sql: string) => as<T>('anon', null, sql)

  const getBatch = async (token: string) =>
    (await visitor<{ v: BatchResult | null }>(`select public.share_get_batch('${token}') as v`)).rows[0].v
  const getBoard = async (token: string, board: string) =>
    (await visitor<{ v: BoardResult | null }>(`select public.share_get_board('${token}', '${board}') as v`)).rows[0].v
  const addComment = (token: string, board: string, card: string | null, name: string, body: string) =>
    visitor(`select public.share_add_comment('${token}', '${board}', ${card ? `'${card}'` : 'null'}, '${name}', '${body}')`)

  // How many files a visitor could see, with a given link in the request headers.
  const filesSeen = async (token: string | null) => {
    await db.exec(`select set_config('request.headers', '${token === null ? '{}' : JSON.stringify({ 'x-briefboard-share': token })}', false)`)
    const result = await visitor<{ name: string }>('select name from storage.objects order by name')
    await db.exec(`select set_config('request.headers', '', false)`)
    return result.rows.map((r) => r.name)
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(STUBS)
    await db.exec(readFileSync('supabase/schema.sql', 'utf8'))
    await db.exec(readFileSync('supabase/migrations/002_home_organization.sql', 'utf8'))
    await db.exec(`
      insert into public.members (email, role) values ('${OWNER}', 'owner'), ('${TEAMMATE}', 'member');
    `)
    // An existing comment from before this update must survive it.
    await db.exec(`
      insert into public.boards (id, title) values ('${id(50)}', 'Before update');
      insert into public.comments (board_id, card_id, body, author_email) values ('${id(50)}', '${id(51)}', 'Old comment', '${OWNER}');
    `)
    await db.exec(readFileSync('supabase/migrations/003_batch_sharing.sql', 'utf8'))
    await db.exec(`
      insert into public.folders (id, name, parent_id, share_token) values
        ('${PRODUCT}', 'Product', null, null),
        ('${BATCH}', 'Batch 1', '${PRODUCT}', '${TOKEN}'),
        ('${OTHER_BATCH}', 'Batch 2', '${PRODUCT}', '${OTHER_TOKEN}'),
        ('${UNSHARED_BATCH}', 'Batch 3', '${PRODUCT}', null);
      insert into public.boards (id, title, folder_id, parent_board_id, deleted_at, is_template) values
        ('${BOARD}', 'Shared brief', '${BATCH}', null, null, false),
        ('${NESTED}', 'Nested', null, '${BOARD}', null, false),
        ('${NESTED_TRASHED}', 'Nested trashed', null, '${BOARD}', now(), false),
        ('${TRASHED_BOARD}', 'Trashed', '${BATCH}', null, now(), false),
        ('${TEMPLATE_BOARD}', 'Template', '${BATCH}', null, null, true),
        ('${OTHER_BOARD}', 'Other batch', '${OTHER_BATCH}', null, null, false),
        ('${UNSHARED_BOARD}', 'Not shared', '${UNSHARED_BATCH}', null, null, false);
      insert into public.cards (id, board_id, type, content) values
        ('${CARD}', '${BOARD}', 'image', '{"ref": "shared.webp"}'),
        ('${id(22)}', '${NESTED}', 'file', '{"ref": "nested.pdf"}'),
        ('${OTHER_CARD}', '${OTHER_BOARD}', 'image', '{"ref": "other.webp"}'),
        ('${id(23)}', '${UNSHARED_BOARD}', 'image', '{"ref": "private.webp"}');
      insert into storage.objects (bucket_id, name) values
        ('board-images', 'shared.webp'), ('board-files', 'nested.pdf'),
        ('board-images', 'other.webp'), ('board-images', 'private.webp'),
        ('board-files', 'shared.webp');
      insert into public.comments (board_id, card_id, body, author_email, internal) values
        ('${BOARD}', '${CARD}', 'Editor should see this', '${OWNER}', false),
        ('${BOARD}', null, 'Margin on this is thin', '${OWNER}', true);
    `)
  })

  it('leaves existing comments as they were', async () => {
    const result = await as<{ body: string; internal: boolean; author_name: string | null }>('authenticated', OWNER, `select body, internal, author_name from public.comments where board_id = '${id(50)}'`)
    expect(result.rows[0]).toEqual({ body: 'Old comment', internal: false, author_name: null })
  })

  describe('what a link opens', () => {
    it('shows the batch and its boards, including nested ones', async () => {
      const batch = (await getBatch(TOKEN))!
      expect(batch.name).toBe('Batch 1')
      expect(batch.boards.map((b) => b.title).sort()).toEqual(['Nested', 'Shared brief'])
    })

    it('leaves out trashed boards, trashed nested boards and templates', async () => {
      const titles = (await getBatch(TOKEN))!.boards.map((b) => b.title)
      for (const hidden of ['Trashed', 'Nested trashed', 'Template']) expect(titles).not.toContain(hidden)
      expect(await getBoard(TOKEN, TRASHED_BOARD)).toBeNull()
      expect(await getBoard(TOKEN, TEMPLATE_BOARD)).toBeNull()
      expect(await getBoard(TOKEN, NESTED_TRASHED)).toBeNull()
    })

    it('opens boards in the batch, with their cards', async () => {
      const board = (await getBoard(TOKEN, BOARD))!
      expect(board.cards.map((c) => c.id)).toEqual([CARD])
      expect(await getBoard(TOKEN, NESTED)).not.toBeNull()
    })

    it('includes batches when a whole product is shared', async () => {
      await db.exec(`update public.folders set share_token = '${PRODUCT_TOKEN}' where id = '${PRODUCT}'`)
      const titles = (await getBatch(PRODUCT_TOKEN))!.boards.map((b) => b.title)
      expect(titles).toContain('Shared brief')
      expect(titles).toContain('Not shared')
      await db.exec(`update public.folders set share_token = null where id = '${PRODUCT}'`)
    })
  })

  describe('what a link must not reach', () => {
    it('gets nothing with a wrong, short, empty or missing token', async () => {
      for (const bad of ['z'.repeat(64), 'a', '', TOKEN.slice(0, 31)]) expect(await getBatch(bad)).toBeNull()
      const nullToken = await visitor<{ v: unknown }>('select public.share_get_batch(null) as v')
      expect(nullToken.rows[0].v).toBeNull()
    })

    it('cannot match unshared folders with an empty token', async () => {
      expect(await getBoard('', UNSHARED_BOARD)).toBeNull()
    })

    it('cannot open a board from another batch with its own link', async () => {
      expect(await getBoard(TOKEN, OTHER_BOARD)).toBeNull()
      expect(await getBoard(TOKEN, UNSHARED_BOARD)).toBeNull()
      expect(await getBoard(TOKEN, id(50))).toBeNull()
    })

    it('cannot read tables directly, or run the internal helpers', async () => {
      for (const table of ['boards', 'cards', 'comments', 'folders', 'members', 'pins']) {
        await expect(visitor(`select * from public.${table}`)).rejects.toThrow(/permission denied/)
      }
      await expect(visitor(`select public.share_board_ids('${TOKEN}')`)).rejects.toThrow(/permission denied/)
      await expect(visitor(`select public.share_folder_ids('${TOKEN}')`)).rejects.toThrow(/permission denied/)
    })

    it('stops working as soon as the link is turned off, and a new link replaces it', async () => {
      const fresh = 'd'.repeat(64)
      await db.exec(`update public.folders set share_token = null where id = '${BATCH}'`)
      expect(await getBatch(TOKEN)).toBeNull()
      expect(await getBoard(TOKEN, BOARD)).toBeNull()
      await expect(addComment(TOKEN, BOARD, null, 'Ed', 'Hello')).rejects.toThrow(/not active/)
      expect(await filesSeen(TOKEN)).toEqual([])
      await db.exec(`update public.folders set share_token = '${fresh}' where id = '${BATCH}'`)
      expect(await getBatch(TOKEN)).toBeNull()
      expect((await getBatch(fresh))!.name).toBe('Batch 1')
      await db.exec(`update public.folders set share_token = '${TOKEN}' where id = '${BATCH}'`)
    })

    it('stops reaching a board moved out of the batch', async () => {
      await db.exec(`update public.boards set folder_id = '${UNSHARED_BATCH}' where id = '${BOARD}'`)
      expect(await getBoard(TOKEN, BOARD)).toBeNull()
      expect(await getBoard(TOKEN, NESTED)).toBeNull()
      await db.exec(`update public.boards set folder_id = '${BATCH}' where id = '${BOARD}'`)
    })
  })

  describe('private files', () => {
    it('are hidden from anyone with no link', async () => {
      expect(await filesSeen(null)).toEqual([])
      await db.exec(`select set_config('request.headers', '', false)`)
      expect((await visitor('select * from storage.objects')).rows).toHaveLength(0)
    })

    it('are hidden when the headers are garbage', async () => {
      await db.exec(`select set_config('request.headers', 'not json', false)`)
      expect((await visitor('select * from storage.objects')).rows).toHaveLength(0)
      await db.exec(`select set_config('request.headers', '', false)`)
    })

    it('open only for the batch the link belongs to', async () => {
      expect(await filesSeen(TOKEN)).toEqual(['nested.pdf', 'shared.webp'])
      expect(await filesSeen(OTHER_TOKEN)).toEqual(['other.webp'])
      expect(await filesSeen('z'.repeat(64))).toEqual([])
    })

    it('match on the right bucket for the card type', async () => {
      const rows = await (async () => {
        await db.exec(`select set_config('request.headers', '${JSON.stringify({ 'x-briefboard-share': TOKEN })}', false)`)
        const result = await visitor<{ bucket_id: string; name: string }>(`select bucket_id, name from storage.objects where name = 'shared.webp'`)
        await db.exec(`select set_config('request.headers', '', false)`)
        return result.rows
      })()
      expect(rows).toEqual([{ bucket_id: 'board-images', name: 'shared.webp' }])
    })

    it('cannot be changed or removed through a link', async () => {
      await db.exec(`select set_config('request.headers', '${JSON.stringify({ 'x-briefboard-share': TOKEN })}', false)`)
      await expect(visitor(`insert into storage.objects (bucket_id, name) values ('board-images', 'evil.webp')`)).rejects.toThrow(/row-level security/)
      await visitor(`delete from storage.objects where name = 'shared.webp'`)
      await db.exec(`select set_config('request.headers', '', false)`)
      expect((await db.query(`select * from storage.objects where name = 'shared.webp'`)).rows.length).toBeGreaterThan(0)
    })
  })

  describe('comments through a link', () => {
    it('hides team-only comments and full email addresses', async () => {
      const board = (await getBoard(TOKEN, BOARD))!
      const text = JSON.stringify(board)
      expect(board.comments.map((c) => c.body)).toContain('Editor should see this')
      expect(text).not.toContain('Margin on this is thin')
      expect(text).not.toContain('@example.com')
      expect(board.comments.find((c) => c.body === 'Editor should see this')!.author_name).toBe('owner')
    })

    it('adds a comment under the typed name, general or on a card, which the team can see', async () => {
      await addComment(TOKEN, BOARD, CARD, 'Sam Editor', 'Hook 2 is strong')
      await addComment(TOKEN, BOARD, null, 'Sam Editor', 'General note')
      const team = await as<{ body: string; author_name: string; card_id: string | null; internal: boolean }>('authenticated', TEAMMATE, `select body, author_name, card_id, internal from public.comments where author_name = 'Sam Editor' order by body`)
      expect(team.rows).toEqual([
        { body: 'General note', author_name: 'Sam Editor', card_id: null, internal: false },
        { body: 'Hook 2 is strong', author_name: 'Sam Editor', card_id: CARD, internal: false },
      ])
    })

    it('treats script text as plain text, and escapes nothing into SQL', async () => {
      await visitor(`select public.share_add_comment('${TOKEN}', '${BOARD}', null, 'Bad''); drop table public.cards; --', '<script>alert(1)</script>')`)
      expect((await db.query('select count(*)::int as c from public.cards')).rows.length).toBe(1)
      const board = (await getBoard(TOKEN, BOARD))!
      expect(board.comments.some((c) => c.body === '<script>alert(1)</script>')).toBe(true)
    })

    it('refuses blank names or comments, oversized ones, and cards from other boards', async () => {
      await expect(addComment(TOKEN, BOARD, null, '   ', 'Hi')).rejects.toThrow(/required/)
      await expect(addComment(TOKEN, BOARD, null, 'Ed', '   ')).rejects.toThrow(/required/)
      await expect(addComment(TOKEN, BOARD, null, 'x'.repeat(81), 'Hi')).rejects.toThrow(/required/)
      await expect(addComment(TOKEN, BOARD, null, 'Ed', 'x'.repeat(5001))).rejects.toThrow(/required/)
      await expect(addComment(TOKEN, BOARD, OTHER_CARD, 'Ed', 'Hi')).rejects.toThrow(/not on this board/)
      await expect(addComment(TOKEN, OTHER_BOARD, null, 'Ed', 'Hi')).rejects.toThrow(/not active/)
    })

    it('cannot edit, resolve or delete anything through a link', async () => {
      await expect(visitor(`update public.comments set body = 'x'`)).rejects.toThrow(/permission denied/)
      await expect(visitor('delete from public.comments')).rejects.toThrow(/permission denied/)
      await expect(visitor(`insert into public.cards (board_id, type) values ('${BOARD}', 'note')`)).rejects.toThrow(/permission denied/)
      await expect(visitor(`update public.boards set title = 'x'`)).rejects.toThrow(/permission denied/)
    })

    it('slows a flood of comments from a leaked link', async () => {
      await db.exec(`delete from public.comments where author_email = ''`)
      for (let i = 0; i < 60; i += 1) await addComment(TOKEN, BOARD, null, 'Ed', `Comment ${i}`)
      await expect(addComment(TOKEN, BOARD, null, 'Ed', 'One too many')).rejects.toThrow(/Too many/)
      await db.exec(`delete from public.comments where author_email = ''`)
    })
  })

  describe('team rules', () => {
    it('lets team members post team-only comments, but not under a typed name', async () => {
      await as('authenticated', TEAMMATE, `insert into public.comments (board_id, body, internal) values ('${BOARD}', 'Internal', true)`)
      await expect(as('authenticated', TEAMMATE, `insert into public.comments (board_id, body, author_name) values ('${BOARD}', 'Fake', 'Someone else')`)).rejects.toThrow(/row-level security/)
    })

    it('lets anyone on the team remove link comments, but not each other’s', async () => {
      await addComment(TOKEN, BOARD, null, 'Ed', 'Remove me')
      await as('authenticated', TEAMMATE, `delete from public.comments where body = 'Remove me'`)
      expect((await db.query(`select * from public.comments where body = 'Remove me'`)).rows).toHaveLength(0)
      await as('authenticated', TEAMMATE, `delete from public.comments where body = 'Editor should see this'`)
      expect((await db.query(`select * from public.comments where body = 'Editor should see this'`)).rows).toHaveLength(1)
    })

    it('keeps tokens away from strangers who have a login', async () => {
      expect((await as('authenticated', STRANGER, 'select * from public.folders')).rows).toHaveLength(0)
    })

    it('reports the new version', async () => {
      const result = await visitor<{ v: number }>('select public.briefboard_schema_version() as v')
      expect(result.rows[0].v).toBe(3)
    })
  })
})
