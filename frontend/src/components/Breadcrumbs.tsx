// NULL design system — breadcrumbs.
// Last item is the current page (aria-current, not a link).

import { Icon } from './Icon'

export type BreadcrumbItem = {
  label: string
  onClick?: () => void
}

type BreadcrumbsProps = {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <Icon name="chevron-right" size={14} className="text-null-muted dark:text-[#8AA0B8]" />}
              {isLast || !item.onClick ? (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-medium text-null-ink dark:text-white' : 'text-null-muted dark:text-[#8AA0B8]'}>
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="text-null-muted hover:text-null-teal dark:text-[#8AA0B8] dark:hover:text-null-teal"
                >
                  {item.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
