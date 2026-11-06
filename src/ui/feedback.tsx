import { useEffect, useRef } from 'react'
import { create } from 'zustand'

interface ConfirmRequest {
  message: string
  confirmLabel: string
  resolve: (ok: boolean) => void
}

const useFeedback = create<{ toast: string | null; confirm: ConfirmRequest | null }>(() => ({ toast: null, confirm: null }))

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
