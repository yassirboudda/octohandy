"use client"

import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function FilterMenu<V extends string | number>({
  label,
  options,
  selected,
  onToggle,
  single = false,
}: {
  label: string
  options: { value: V; label: string }[]
  selected: V[]
  onToggle: (v: V) => void
  single?: boolean
}) {
  const active = selected.length > 0
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("group bg-white", active && "bg-butter border-foreground/20 hover:bg-butter")}>
          {label}
          {active && !single ? (
            <span className="grid place-items-center min-w-5 h-5 px-1 rounded-sm bg-primary text-primary-foreground text-[11px] font-semibold">{selected.length}</span>
          ) : null}
          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={String(o.value)}
            checked={selected.includes(o.value)}
            onCheckedChange={() => onToggle(o.value)}
            // multi-select menus stay open while picking
            onSelect={single ? undefined : (e) => e.preventDefault()}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
