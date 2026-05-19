"use client"

import { Settings2 } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavProjects({
  settingsOpen: _settingsOpen,
  onSettingsOpenChange: _onSettingsOpenChange,
  currentPage,
  onNavigate,
  searchQuery = "",
}: {
  settingsItems?: { title: string; page: string }[]
  settingsOpen?: boolean
  onSettingsOpenChange?: (open: boolean) => void
  currentPage?: string
  onNavigate?: (page: string) => void
  searchQuery?: string
}) {
  const isSearching = searchQuery.trim().length > 0
  const q = searchQuery.toLowerCase()

  const isSettingsPage = currentPage?.startsWith("settings")

  if (isSearching && !("settings".includes(q) || "font".includes(q) || "colours".includes(q) || "storage".includes(q) || "security".includes(q))) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Settings</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Settings"
            className="font-medium transition-colors duration-150"
            isActive={isSettingsPage}
            onClick={() => onNavigate?.("settings")}
          >
            <Settings2 className="theme-accent-amber" />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
