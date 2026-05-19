import { Type, Palette, Database, Lock, ChevronRight, Settings2, User, Bell, LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"

type SettingsItem = {
  icon: React.ReactNode
  title: string
  description: string
  page: string
  accentClass: string
}

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    icon: <Type className="size-5" />,
    title: "Font",
    description: "Customize app font and text size.",
    page: "settings-appearance-font",
    accentClass: "text-violet-400 bg-violet-400/10",
  },
  {
    icon: <Palette className="size-5" />,
    title: "Route Colours",
    description: "Set custom colours for each route.",
    page: "settings-route-colors",
    accentClass: "text-pink-400 bg-pink-400/10",
  },
  {
    icon: <Database className="size-5" />,
    title: "Storage",
    description: "View where your data is stored.",
    page: "settings-storage",
    accentClass: "text-sky-400 bg-sky-400/10",
  },
  {
    icon: <Lock className="size-5" />,
    title: "Security",
    description: "Manage PIN lock and app access.",
    page: "settings-security",
    accentClass: "text-emerald-400 bg-emerald-400/10",
  },
]

const USER_ITEMS = [
  { icon: <User className="size-5" />, title: "Profile", page: "settings-profile", accentClass: "text-blue-400 bg-blue-400/10" },
  { icon: <Bell className="size-5" />, title: "Notifications", page: "settings-notifications", accentClass: "text-orange-400 bg-orange-400/10" },
]

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("")
}

function SettingRow({ icon, title, description, accentClass, onClick }: {
  icon: React.ReactNode; title: string; description?: string; accentClass: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3.5 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors w-full"
    >
      <span className={`flex items-center justify-center size-9 rounded-xl shrink-0 ${accentClass}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground leading-tight">{title}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{description}</p>}
      </div>
      <ChevronRight className="size-4 text-muted-foreground/50 shrink-0" />
    </button>
  )
}

export function SettingsHub({ onNavigate }: { onNavigate: (page: string) => void }) {
  const user = { name: "User", email: "user@example.com", avatar: "/avatars/user.jpg" }
  const initials = getInitials(user.name)

  return (
    <div className="flex flex-col gap-5 px-4 py-6 max-w-lg mx-auto w-full">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-9 rounded-xl bg-primary/10 text-primary shrink-0">
          <Settings2 className="size-5" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground leading-tight">Settings</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage your preferences</p>
        </div>
      </div>

      {/* User card */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4">
          <Avatar className="h-12 w-12 rounded-xl">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="rounded-xl text-sm font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-foreground leading-tight">{user.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{user.email}</p>
          </div>
        </div>
        <Separator />
        {USER_ITEMS.map((item, i) => (
          <div key={item.page}>
            <SettingRow
              icon={item.icon}
              title={item.title}
              accentClass={item.accentClass}
              onClick={() => onNavigate(item.page)}
            />
            {i < USER_ITEMS.length - 1 && <Separator />}
          </div>
        ))}
      </div>

      {/* Settings list */}
      <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card overflow-hidden">
        {SETTINGS_ITEMS.map((item) => (
          <SettingRow
            key={item.page}
            icon={item.icon}
            title={item.title}
            description={item.description}
            accentClass={item.accentClass}
            onClick={() => onNavigate(item.page)}
          />
        ))}
      </div>

      {/* Log out */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <button
          type="button"
          className="flex items-center gap-4 px-4 py-3.5 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors w-full"
        >
          <span className="flex items-center justify-center size-9 rounded-xl shrink-0 text-red-400 bg-red-400/10">
            <LogOut className="size-5" />
          </span>
          <p className="flex-1 text-[13px] font-medium text-red-400 leading-tight">Log Out</p>
        </button>
      </div>

    </div>
  )
}
