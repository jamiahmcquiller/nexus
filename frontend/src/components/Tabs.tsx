// NULL design system — tabs.

export type TabItem = {
  id: string
  label: string
}

type TabsProps = {
  items: TabItem[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-null-line dark:border-white/10" role="tablist">
      {items.map((item) => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              isActive
                ? 'border-null-teal font-semibold text-null-ink dark:text-white'
                : 'border-transparent text-null-muted hover:text-null-ink dark:text-[#8AA0B8] dark:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
