import { useState } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({
  items,
  onItemClick,
  onSubItemClick,
  searchQuery = "",
  currentPage,
  openItem: controlledOpenItem,
  onOpenItemChange,
}: {
  items: {
    title: string
    url: string
    icon: LucideIcon
    color?: string
    page?: string
    isActive?: boolean
    items?: {
      title: string
      url: string
      page?: string
    }[]
  }[]
  onItemClick?: (title: string) => void
  onSubItemClick?: (page: string) => void
  searchQuery?: string
  currentPage?: string
  openItem?: string | null
  onOpenItemChange?: (item: string | null) => void
}) {
  const initialOpen = items.find((i) => i.isActive && i.items?.length)?.title ?? null
  const [localOpenItem, setLocalOpenItem] = useState<string | null>(initialOpen)

  const isControlled = controlledOpenItem !== undefined
  const openItem = isControlled ? controlledOpenItem : localOpenItem
  const setOpenItem = (val: string | null) => {
    if (isControlled) onOpenItemChange?.(val)
    else setLocalOpenItem(val)
  }

  // Auto-expand all groups when searching
  const isSearching = searchQuery.trim().length > 0

  const handleToggle = (title: string, hasChildren: boolean, page?: string) => {
    if (!hasChildren) {
      if (page) onSubItemClick?.(page)
      else onItemClick?.(title)
      return
    }
    setOpenItem(openItem === title ? null : title)
    onItemClick?.(title)
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Main</SidebarGroupLabel>
      <SidebarMenu>
        {isSearching && items.length === 0 ? null : (
        items.map((item) => {
          const hasChildren = !!item.items?.length
          const isOpen = isSearching ? true : openItem === item.title

          return (
            <Collapsible
              key={item.title}
              asChild
              open={hasChildren ? isOpen : undefined}
              onOpenChange={hasChildren ? (open) => { if (!isSearching) setOpenItem(open ? item.title : null) } : undefined}
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={item.title}
                  className="font-medium transition-colors duration-150"
                  onClick={() => handleToggle(item.title, hasChildren, item.page)}
                >
                  <item.icon
                      className="size-[14px]"
                      style={item.color ? { color: item.color } : { color: "hsl(var(--sidebar-primary))" }}
                    />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                {hasChildren ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction
                        className="transition-transform duration-300 data-[state=open]:rotate-90"
                      >
                        <ChevronRight />
                        <span className="sr-only">Toggle</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <div
                      aria-hidden={!isOpen}
                      style={{
                        display: "grid",
                        gridTemplateRows: isOpen ? "1fr" : "0fr",
                        transition:
                          "grid-template-rows 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
                        opacity: isOpen ? 1 : 0,
                      }}
                    >
                      <div className="overflow-hidden">
                        <SidebarMenuSub className={`transition-all duration-300 ${!isOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}>
                          {item.items?.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton
                                className="font-medium transition-colors duration-150"
                                isActive={currentPage === subItem.page}
                                onClick={() => {
                                  if (subItem.page) onSubItemClick?.(subItem.page)
                                }}
                              >
                                <span>{subItem.title}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </div>
                    </div>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          )
        })
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

