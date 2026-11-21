// NULL design system — empty state.

import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

type EmptyStateProps = {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon = 'search', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-null-cloud text-null-muted dark:bg-null-navy2 dark:text-[#8AA0B8]">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="text-sm font-semibold text-null-ink dark:text-white">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-null-muted dark:text-[#8AA0B8]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
