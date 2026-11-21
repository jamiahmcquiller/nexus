// NULL design system — toasts.
// ToastProvider renders the stack; useToast exposes success /
// error / info. Toasts auto-dismiss after 4.5s.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type ToastKind = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  kind: ToastKind
  message: string
}

type ToastApi = {
  toast: (kind: ToastKind, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const KIND_STYLE: Record<ToastKind, { icon: IconName; classes: string }> = {
  success: { icon: 'check-circle', classes: 'border-null-success/40 bg-white text-null-ink dark:bg-null-navy2 dark:text-white' },
  error: { icon: 'x-circle', classes: 'border-null-critical/40 bg-white text-null-ink dark:bg-null-navy2 dark:text-white' },
  info: { icon: 'bell', classes: 'border-null-info/40 bg-white text-null-ink dark:bg-null-navy2 dark:text-white' },
}

const KIND_ICON_COLOR: Record<ToastKind, string> = {
  success: 'text-null-success',
  error: 'text-null-critical',
  info: 'text-null-info',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, kind, message }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message: string) => toast('success', message),
      error: (message: string) => toast('error', message),
      info: (message: string) => toast('info', message),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const style = KIND_STYLE[t.kind]
          return (
            <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${style.classes}`}>
              <Icon name={style.icon} size={18} className={`mt-0.5 shrink-0 ${KIND_ICON_COLOR[t.kind]}`} />
              <span className="min-w-0 flex-1">{t.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="shrink-0 text-null-muted hover:text-null-ink dark:text-[#8AA0B8] dark:hover:text-white"
              >
                <Icon name="x-circle" size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider')
  return ctx
}
