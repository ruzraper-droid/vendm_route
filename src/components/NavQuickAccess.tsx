"use client"

import { useState, useEffect } from "react"
import { ClipboardList, MapPin, Users, Package, Images, Settings2, Plus, X, Zap } from "lucide-react"
import { createPortal } from "react-dom"
import { useEditMode } from "@/contexts/EditModeContext"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type QuickAccessId = "route-list" | "deliveries" | "rooster" | "plano-vm" | "gallery-album" | "settings-profile"

interface QuickAccessOption {
  id: QuickAccessId
  icon: React.ElementType
  label: string
  description: string
  iconClass?: string
}

const LS_KEY = "fcalendar_home_quick_access"
const LIMIT = 4

const OPTIONS: QuickAccessOption[] = [
  { id: "route-list",       icon: ClipboardList, label: "Route List", description: "Manage vending routes", iconClass: "theme-accent-violet" },
  { id: "deliveries",       icon: MapPin,        label: "Location",   description: "Delivery records",     iconClass: "theme-accent-emerald" },
  { id: "rooster",          icon: Users,         label: "Rooster",    description: "Team schedule",        iconClass: "theme-accent-orange" },
  { id: "plano-vm",         icon: Package,       label: "Plano VM",   description: "Planogram tools",      iconClass: "theme-accent-blue" },
  { id: "gallery-album",    icon: Images,        label: "Album",      description: "Photo gallery",        iconClass: "theme-accent-pink" },
  { id: "settings-profile", icon: Settings2,     label: "Settings",   description: "Profile settings",     iconClass: "theme-accent-indigo" },
]

function isQuickAccessId(value: unknown): value is QuickAccessId {
  return OPTIONS.some(opt => opt.id === value)
}

function readFromStorage(): QuickAccessId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || "[]")
    if (!Array.isArray(stored)) return []
    const normalized = stored.filter(isQuickAccessId)
    const unique = normalized.filter((id: QuickAccessId, i: number) => normalized.indexOf(id) === i)
    return unique.slice(0, LIMIT)
  } catch {
    return []
  }
}

function writeToStorage(ids: QuickAccessId[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(ids.slice(0, LIMIT)))
}

export function NavQuickAccess({
  onNavigate,
  searchQuery = "",
}: {
  onNavigate?: (page: string) => void
  searchQuery?: string
}) {
  const [items, setItems] = useState<QuickAccessId[]>(readFromStorage)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { isEditMode } = useEditMode()

  // Close picker if edit mode turns off
  useEffect(() => {
    if (!isEditMode) setPickerOpen(false)
  }, [isEditMode])

  // Sync when home page or another source updates the list
  useEffect(() => {
    const sync = () => setItems(readFromStorage())
    window.addEventListener("fcalendar_quick_access_changed", sync)
    return () => window.removeEventListener("fcalendar_quick_access_changed", sync)
  }, [])

  const isSearching = searchQuery.trim().length > 0
  const q = searchQuery.toLowerCase()

  const visibleItems = isSearching
    ? OPTIONS.filter(opt => items.includes(opt.id) && opt.label.toLowerCase().includes(q))
    : OPTIONS.filter(opt => items.includes(opt.id))

  // Hide entire group when searching with no matches
  if (isSearching && visibleItems.length === 0 && !"quick access".includes(q)) return null

  const addItem = (id: QuickAccessId) => {
    if (items.includes(id) || items.length >= LIMIT) return
    const next = [...items, id]
    setItems(next)
    writeToStorage(next)
    // Sync home page
    window.dispatchEvent(new Event("fcalendar_quick_access_changed"))
    setPickerOpen(false)
  }

  const available = OPTIONS.filter(opt => !items.includes(opt.id))

  const picker =
    pickerOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close picker"
              className="absolute inset-0 bg-black/45 backdrop-blur-sm"
              onClick={() => setPickerOpen(false)}
            />
            <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">Add Quick Access</p>
                  <p className="text-xs text-muted-foreground">Choose a shortcut to pin.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground">All shortcuts are already added.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5">
                  {available.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => addItem(opt.id)}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      <opt.icon className={`size-4 shrink-0 ${opt.iconClass ?? "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{opt.label}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{opt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel className="flex items-center gap-1.5">
          <Zap className="size-[10px] theme-accent-amber" />
          Quick Access
        </SidebarGroupLabel>

        <SidebarMenu>
          {visibleItems.length === 0 && !isSearching ? (
            /* ── Empty state ── */
            <li className="flex flex-col items-start gap-2 px-2 py-1">
              <p className="text-[11px] text-muted-foreground/70 leading-snug">
                No shortcuts yet. Pin pages here for faster navigation.
              </p>
              {isEditMode && items.length < LIMIT && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 hover:border-primary/70 transition-colors"
                >
                  <Plus className="size-3" />
                  Add Card
                </button>
              )}
            </li>
          ) : (
            <>
              {visibleItems.map(opt => (
                <SidebarMenuItem key={opt.id}>
                  <SidebarMenuButton
                    tooltip={opt.label}
                    className="font-medium transition-colors duration-150"
                    onClick={() => onNavigate?.(opt.id)}
                  >
                    <opt.icon
                      className={`size-[14px] ${opt.iconClass ?? "text-muted-foreground"}`}
                    />
                    <span>{opt.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Add more slot (only in edit mode, not when searching) */}
              {!isSearching && isEditMode && items.length < LIMIT && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Add shortcut"
                    className="text-muted-foreground/70 hover:text-foreground transition-colors duration-150"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Plus className="size-[14px]" />
                    <span>Add Card</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </>
          )}
        </SidebarMenu>
      </SidebarGroup>

      {picker}
    </>
  )
}
