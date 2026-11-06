import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncQueue, type SyncStatus } from '../src/data/syncQueue'
import type { Card, CardOp } from '../src/types'

const card = (id: string): Card => ({
  id, boardId: 'b', type: 'note', x: 0, y: 0, w: 100, z: 0, columnId: null, columnOrder: 0, content: {}, searchText: '',
})

describe('SyncQueue', () => {
  let sent: CardOp[][]
  let statuses: SyncStatus[]
  let fail: boolean
  let queue: SyncQueue

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    statuses = []
    fail = false
    queue = new SyncQueue(
      async (ops) => {
        if (fail) throw new Error('offline')
        sent.push(ops)
      },
      (status) => statuses.push(status),
      100,
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('merges rapid updates to one card into one write', async () => {
    queue.enqueue({ kind: 'update', id: 'a', fields: { x: 1 } })
    queue.enqueue({ kind: 'update', id: 'a', fields: { y: 2 } })
    queue.enqueue({ kind: 'update', id: 'a', fields: { x: 3 } })
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toEqual([[{ kind: 'update', id: 'a', fields: { x: 3, y: 2 } }]])
    expect(statuses.at(-1)).toBe('saved')
  })

  it('folds updates into an unsent insert', async () => {
    queue.enqueue({ kind: 'insert', card: card('a') })
    queue.enqueue({ kind: 'update', id: 'a', fields: { x: 9 } })
    await vi.advanceTimersByTimeAsync(100)
    expect(sent[0]).toEqual([{ kind: 'insert', card: { ...card('a'), x: 9 } }])
  })

  it('sends nothing for a card created and deleted before saving', async () => {
    queue.enqueue({ kind: 'insert', card: card('a') })
    queue.enqueue({ kind: 'delete', id: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toEqual([])
  })

  it('undoing a delete before it is sent still saves the card', async () => {
    queue.enqueue({ kind: 'delete', id: 'a' })
    queue.enqueue({ kind: 'insert', card: card('a') })
    await vi.advanceTimersByTimeAsync(100)
    expect(sent[0]).toEqual([{ kind: 'insert', card: card('a') }])
  })

  it('keeps failed writes and retries, with newer edits winning', async () => {
    fail = true
    queue.enqueue({ kind: 'update', id: 'a', fields: { x: 1, y: 1 } })
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses.at(-1)).toBe('retrying')
    expect(queue.hasPending('a')).toBe(true)

    queue.enqueue({ kind: 'update', id: 'a', fields: { x: 2 } })
    fail = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toEqual([[{ kind: 'update', id: 'a', fields: { x: 2, y: 1 } }]])
    expect(queue.idle).toBe(true)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('does not overwrite edits made during an in-flight save', async () => {
    let release!: () => void
    const slow = new SyncQueue(
      (ops) => {
        sent.push(ops)
        return new Promise<void>((resolve) => (release = resolve))
      },
      () => {},
      100,
    )
    slow.enqueue({ kind: 'update', id: 'a', fields: { x: 1 } })
    await vi.advanceTimersByTimeAsync(100)
    slow.enqueue({ kind: 'update', id: 'a', fields: { x: 2 } })
    expect(slow.hasPending('a')).toBe(true)
    release()
    await vi.advanceTimersByTimeAsync(100)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.map((batch) => batch[0])).toEqual([
      { kind: 'update', id: 'a', fields: { x: 1 } },
      { kind: 'update', id: 'a', fields: { x: 2 } },
    ])
    expect(slow.idle).toBe(true)
  })
})
