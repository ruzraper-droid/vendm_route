"use client"

import { useState, useEffect } from "react"
import { ClipboardList, MapPin, Users, Package, Images, Settings2 } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type RecentPageId = "route-list" | "deliveries" | "rooster" | "plano-vm" | "gallery-album" | "settings-profile"

interface RecentPageOption {
  id: RecentPageId
  icon: React.ElementType
  label: string
  iconClass?: string
}

const LS_KEY = "fcalendar_recent_pages"
const LIMIT = 1

const PAGE_OPTIONS: Record<RecentPageId, RecentPageOption> = {
  "route-list": { id: "route-list", icon: ClipboardList, label: "Route List", iconClass: "theme-accent-violet" },
  "deliveries": { id: "deliveries", icon: MapPin, label: "Location", iconClass: "theme-accent-emerald" },
  "rooster": { id: "rooster", icon: Users, label: "Rooster", iconClass: "theme-accent-orange" },
  "plano-vm": { id: "plano-vm", icon: Package, label: "Plano VM", iconClass: "theme-accent-blue" },
  "gallery-album": { id: "gallery-album", icon: Images, label: "Album", iconClass: "theme-accent-pink" },
  "settings-profile": { id: "settings-profile", icon: Settings2, label: "Settings", iconClass: "theme-accent-indigo" },
}

function isRecentPageId(value: unknown): value is RecentPageId {
  return typeof value === "string" && value in PAGE_OPTIONS
}

function readFromStorage(): RecentPageId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || "[]")
    if (!Array.isArray(stored)) return []
    return stored.filter(isRecentPageId).slice(0, LIMIT)
  } catch {
    return []
  }
}

function writeToStorage(ids: RecentPageId[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(ids.slice(0, LIMIT)))
}

export function addToRecent(pageId: RecentPageId) {
  if (!isRecentPageId(pageId)) return
  const current = readFromStorage()
  const filtered = current.filter(id => id !== pageId)
  const next = [pageId, ...filtered].slice(0, LIMIT)
  writeToStorage(next)
  window.dispatchEvent(new Event("fcalendar_recent_changed"))
}

export function NavRecent({
  onNavigate,
  searchQuery = "",
}: {
  onNavigate?: (page: string) => void
  searchQuery?: string
}) {
  const [items, setItems] = useState<RecentPageId[]>(readFromStorage)

  // Sync when recent list is updated elsewhere
  useEffect(() => {
    const sync = () => setItems(readFromStorage())
    window.addEventListener("fcalendar_recent_changed", sync)
    return () => window.removeEventListener("fcalendar_recent_changed", sync)
  }, [])

  const isSearching = searchQuery.trim().length > 0
  const q = searchQuery.toLowerCase()

  const visibleItems = isSearching
    ? items.filter(id => PAGE_OPTIONS[id].label.toLowerCase().includes(q))
    : items

  // Hide when searching with no matches
  if (isSearching && visibleItems.length === 0 && !"recently".includes(q)) return null

  // Hide when empty and not searching
  if (!isSearching && items.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        Recently Visited
      </SidebarGroupLabel>

      <SidebarMenu>
        {visibleItems.map(id => {
          const option = PAGE_OPTIONS[id]
          return (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                tooltip={option.label}
                className="font-medium transition-colors duration-150"
                onClick={() => onNavigate?.(id)}
              >
                <option.icon className={`size-[14px] ${option.iconClass ?? "text-muted-foreground"}`} />
                <span>{option.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
