// NULL design system — detail drawer.
// Slide-over panel from the right; ESC + backdrop click close it.

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

type DetailDrawerProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function DetailDrawer({ open, onClose, title, children }: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-null-navy2">
        <header className="flex items-center justify-between gap-3 border-b border-null-line px-4 py-3 dark:border-white/10">
          <h2 className="min-w-0 truncate text-base font-semibold text-null-ink dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close panel"
            className="shrink-0 rounded p-1 text-null-muted hover:bg-null-cloud hover:text-null-ink dark:text-[#8AA0B8] dark:hover:bg-null-deepSlate dark:hover:text-white"
          >
            <Icon name="x-circle" size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-null-ink dark:text-white">{children}</div>
      </aside>
    </div>
  )
}
