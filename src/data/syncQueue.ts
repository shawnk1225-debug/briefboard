import type { CardOp } from '../types'

export type SyncStatus = 'saved' | 'saving' | 'retrying'

const opId = (op: CardOp) => (op.kind === 'insert' ? op.card.id : op.id)

// Combines an older pending op with a newer one for the same card.
function mergeOps(older: CardOp, newer: CardOp): CardOp | null {
  if (newer.kind === 'insert') return newer
  if (newer.kind === 'delete') return older.kind === 'insert' ? null : newer
  if (older.kind === 'insert') return { kind: 'insert', card: { ...older.card, ...newer.fields } }
  if (older.kind === 'update') return { kind: 'update', id: newer.id, fields: { ...older.fields, ...newer.fields } }
  return older // updating a card that is being deleted stays a delete
}

// Batches card writes, sends one batch at a time, and retries until they land.
export class SyncQueue {
  private pending = new Map<string, CardOp>()
  private inFlight = new Map<string, CardOp>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private readonly send: (ops: CardOp[]) => Promise<void>
  private readonly onStatus: (status: SyncStatus) => void
  private readonly delayMs: number

  constructor(send: (ops: CardOp[]) => Promise<void>, onStatus: (status: SyncStatus) => void, delayMs = 400) {
    this.send = send
    this.onStatus = onStatus
    this.delayMs = delayMs
  }

  enqueue(op: CardOp) {
    this.put(op)
    this.onStatus(this.failures ? 'retrying' : 'saving')
    this.schedule(this.delayMs)
  }

  hasPending(id: string) {
    return this.pending.has(id) || this.inFlight.has(id)
  }

  get idle() {
    return this.pending.size === 0 && this.inFlight.size === 0
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.inFlight.size || this.pending.size === 0) return

    this.inFlight = this.pending
    this.pending = new Map()
    try {
      await this.send([...this.inFlight.values()])
      this.inFlight = new Map()
      this.failures = 0
      if (this.pending.size) this.schedule(this.delayMs)
      else this.onStatus('saved')
    } catch (err) {
      console.error('Save failed, will retry', err)
      // Failed ops go back underneath anything edited while they were in flight.
      const newer = this.pending
      this.pending = this.inFlight
      this.inFlight = new Map()
      for (const op of newer.values()) this.put(op)
      this.failures += 1
      this.onStatus('retrying')
      this.schedule(Math.min(2000 * 2 ** (this.failures - 1), 30000))
    }
  }

  // Waits for everything queued so far to be saved (gives up after timeoutMs).
  async drain(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while (!this.idle && Date.now() < deadline) {
      await this.flush()
      if (!this.idle) await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  private put(op: CardOp) {
    const id = opId(op)
    const older = this.pending.get(id)
    const merged = older ? mergeOps(older, op) : op
    if (merged) this.pending.set(id, merged)
    else this.pending.delete(id)
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), ms)
  }
}
