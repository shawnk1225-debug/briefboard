import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

interface ConfirmRequest {
  message: string
  confirmLabel: string
  resolve: (ok: boolean) => void
}

interface InputRequest {
  title: string
  label: string
  value: string
  confirmLabel: string
  // With options the dialog shows a dropdown; without them, a text box.
  options?: { value: string; label: string }[]
  resolve: (value: string | null) => void
}

const useFeedback = create<{ toast: string | null; confirm: ConfirmRequest | null; input: InputRequest | null }>(() => ({
  toast: null,
  confirm: null,
  input: null,
}))

export const askInput = (request: Omit<InputRequest, 'resolve'>) =>
  new Promise<string | null>((resolve) => useFeedback.setState({ input: { ...request, resolve } }))

function InputDialog({ request }: { request: InputRequest }) {
  const [value, setValue] = useState(request.value)
  const finish = (result: string | null) => {
    request.resolve(result)
    useFeedback.setState({ input: null })
  }
  const empty = !request.options && !value.trim()
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && finish(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onSubmit={(e) => {
          e.preventDefault()
          if (!empty) finish(request.options ? value : value.trim())
        }}
      >
        <h2>{request.title}</h2>
        <label>
          {request.label}
          {request.options ? (
            <select autoFocus value={value} onChange={(e) => setValue(e.target.value)}>
              {request.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input autoFocus maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => finish(null)}>Cancel</button>
          <button className="btn primary" disabled={empty}>{request.confirmLabel}</button>
        </div>
      </form>
    </div>
  )
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function showToast(toast: string) {
  useFeedback.setState({ toast })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => useFeedback.setState({ toast: null }), 4500)
}

export const askConfirm = (message: string, confirmLabel: string) =>
  new Promise<boolean>((resolve) => useFeedback.setState({ confirm: { message, confirmLabel, resolve } }))

export function Feedback() {
  const toast = useFeedback((s) => s.toast)
  const confirm = useFeedback((s) => s.confirm)
  const input = useFeedback((s) => s.input)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirm) confirmRef.current?.focus()
  }, [confirm])

  const answer = (ok: boolean) => {
    confirm?.resolve(ok)
    useFeedback.setState({ confirm: null })
  }

  return (
    <>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {input && <InputDialog request={input} />}
      {confirm && (
        <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && answer(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={confirm.message}>
            <p>{confirm.message}</p>
            <div className="dialog-actions">
              <button className="btn" onClick={() => answer(false)}>
                Cancel
              </button>
              <button ref={confirmRef} className="btn danger" onClick={() => answer(true)}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
