import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import type { ReactNode } from "react"
import {
  User, Bell, Lock, Globe, Mail, Phone, Shield,
  Eye, EyeOff, Check, Type, Copy,
  Navigation, Palette, Database, HardDrive, Clock3, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { useTheme, FONT_OPTIONS, type AppFont } from "@/hooks/use-theme"
import { useEditMode } from "@/contexts/EditModeContext"
import { LS_IMGBB_KEY } from "@/lib/imgbb"
import { DEFAULT_ROUTE_COLORS } from "@/lib/route-colors"

// ─── Types ────────────────────────────────────────────────────────────────────
type SectionId =
  | "profile"
  | "notifications"
  | "appearance-font"
  | "map-defaultview"
  | "route-colors"
  | "storage"
  | "security"

type StorageLocationItem = {
  section: string
  store: string
  purpose: string
}

const DATABASE_STORAGE_ITEMS: StorageLocationItem[] = [
  { section: "Route List", store: "routes", purpose: "Stores routes, shifts, route colors, and delivery points." },
  { section: "Route Notes", store: "route_notes", purpose: "Stores notes and changelog entries for each route." },
  { section: "Rooster", store: "rooster_resources + rooster_shifts", purpose: "Stores resources/team members and shift schedules." },
  { section: "Plano VM", store: "plano_vm", purpose: "Stores VM planogram page layouts." },
  { section: "Location", store: "deliveries", purpose: "Stores delivery records and current statuses." },
  { section: "Calendar", store: "calendar_events", purpose: "Stores calendar events (when used)." },
  { section: "Notes", store: "notes", purpose: "Stores general app notes/changelog content." },
]

const LOCAL_STORAGE_ITEMS: StorageLocationItem[] = [
  { section: "Theme & Display", store: "colorMode, app-font, app-zoom, text-size", purpose: "Stores user theme mode, font, zoom, and text size preference." },
  { section: "Home", store: "fcalendar_home_quick_access, fcalendar_home_archive", purpose: "Stores quick cards and archived panel states on Home." },
  { section: "Pinned Routes", store: "fcalendar_pinned_routes", purpose: "Stores pinned routes for quick display on Home." },
  { section: "Route List Map", store: "fcalendar_map_style", purpose: "Stores map mode selection (streets/satellite/OSM)." },
  { section: "Route List Table", store: "fcalendar_route_columns", purpose: "Stores table column layout per route or globally." },
  { section: "Route List Sorting", store: "fcalendar_my_sorts_<routeId>", purpose: "Stores custom row order/sorting presets per route." },
  { section: "Settings", store: "mapMarkerDefaultView, app_imgbb_api_key", purpose: "Stores default map coordinates and ImgBB API key." },
]

const SESSION_STORAGE_ITEMS: StorageLocationItem[] = [
  { section: "Navigation", store: "fcalendar_open_route", purpose: "Temporarily stores the route to auto-open during page navigation." },
  { section: "PWA Prompt", store: "pwa-prompt-dismissed", purpose: "Stores install prompt dismiss state for the current session." },
]

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_DEFAULT_VIEW = "mapMarkerDefaultView"
const MAP_FALLBACK = { lat: "3.0695500", lng: "101.5469179", zoom: "12" }

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
// ─── Section panels ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="mb-8 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
          {icon}
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground leading-relaxed pl-11">{description}</p>
      )}
      <Separator className="mt-4" />
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function Settings({ section = "profile" }: { section?: SectionId }) {
  const { appFont, setAppFont } = useTheme()
  const { isEditMode, registerSaveHandler, setHasUnsavedChanges } = useEditMode()
  const active = section

  const t = {
    fontTitle: "Font Style",
    fontDescription: "Choose a font for the app.",
    previewLabel: "Preview",
    previewTextPrefix: "This is a text preview using",
    previewTextSuffix: "The quick brown fox jumps over the lazy dog.",
    active: "active",
    reset: "Reset",
    apply: "Apply",
    profileDescription: "Your account information.",
  }

  // Font picker local state — only committed on Apply
  const [selectedFont, setSelectedFont] = useState<AppFont>(appFont)
  const fontDirty = selectedFont !== appFont

  useEffect(() => {
    setSelectedFont(appFont)
  }, [appFont])

  // Profile state
  const [profile, setProfile] = useState({ name: "John Doe", email: "john.doe@speedparcel.com", phone: "+60 12-345 6789", role: "Delivery Manager" })
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = (field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  // Notifications state
  const [notifications, setNotifications] = useState({ email: true, push: true, sms: false, weeklyReport: true })

  // Security state
  const [security, setSecurity] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const [storageTab, setStorageTab] = useState<"database" | "local">("database")

  // ImgBB API key
  const [imgbbKey, setImgbbKey] = useState(() => localStorage.getItem(LS_IMGBB_KEY) ?? "")
  const [showImgbbKey, setShowImgbbKey] = useState(false)
  const imgbbOriginalRef = useRef(imgbbKey)

  const handleSaveImgbbKey = () => {
    localStorage.setItem(LS_IMGBB_KEY, imgbbKey)
    imgbbOriginalRef.current = imgbbKey
  }

  // Map state
  const [mapLat,  setMapLat]  = useState(() => { try { const v = localStorage.getItem(LS_DEFAULT_VIEW); if (v) return String(JSON.parse(v).center[0]) } catch { /**/ } return MAP_FALLBACK.lat })
  const [mapLng,  setMapLng]  = useState(() => { try { const v = localStorage.getItem(LS_DEFAULT_VIEW); if (v) return String(JSON.parse(v).center[1]) } catch { /**/ } return MAP_FALLBACK.lng })
  const [mapZoom, setMapZoom] = useState(() => { try { const v = localStorage.getItem(LS_DEFAULT_VIEW); if (v) return String(JSON.parse(v).zoom)     } catch { /**/ } return MAP_FALLBACK.zoom })
  const mapOriginalRef = useRef({ lat: mapLat, lng: mapLng, zoom: mapZoom })

  // Per-route colors (fetched from API)
  type RouteColorEntry = { id: string; name: string; code: string; color: string }
  const [routesList, setRoutesList] = useState<RouteColorEntry[]>([])
  const [routesListLoading, setRoutesListLoading] = useState(false)
  const [routesListDirty, setRoutesListDirty] = useState(false)
  const [resetRouteColorsConfirm, setResetRouteColorsConfirm] = useState(false)
  const routesListOriginalRef = useRef<RouteColorEntry[]>([])

  useEffect(() => {
    if (active !== 'route-colors') return
    setRoutesListLoading(true)
    setRoutesListDirty(false)
    fetch('/api/routes')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const mapped: RouteColorEntry[] = data.data.map((r: RouteColorEntry & { color?: string }, i: number) => ({
            id: r.id, name: r.name, code: r.code,
            color: r.color || DEFAULT_ROUTE_COLORS[i % DEFAULT_ROUTE_COLORS.length],
          }))
          setRoutesList(mapped)
          routesListOriginalRef.current = mapped.map(r => ({ ...r }))
        }
      })
      .catch(console.error)
      .finally(() => setRoutesListLoading(false))
  }, [active])

  const handleSaveRouteColorsList = async () => {
    const dirty = routesList.filter((r, i) => r.color !== routesListOriginalRef.current[i]?.color)
    await Promise.all(dirty.map(r => fetch('/api/routes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, color: r.color }),
    })))
    routesListOriginalRef.current = routesList.map(r => ({ ...r }))
    setRoutesListDirty(false)
    window.dispatchEvent(new Event('fcalendar_route_colors_changed'))
  }

  const resetRouteColorsToDefaults = useCallback(() => {
    setRoutesList(prev => prev.map((r, i) => ({ ...r, color: DEFAULT_ROUTE_COLORS[i % DEFAULT_ROUTE_COLORS.length] })))
    setRoutesListDirty(true)
  }, [])

  const handleSaveMap = () => {
    const latN = parseFloat(mapLat), lngN = parseFloat(mapLng), zoomN = parseInt(mapZoom, 10)
    if (isNaN(latN) || isNaN(lngN) || isNaN(zoomN)) return
    localStorage.setItem(LS_DEFAULT_VIEW, JSON.stringify({ center: [latN, lngN], zoom: zoomN }))
    mapOriginalRef.current = { lat: mapLat, lng: mapLng, zoom: mapZoom }
  }

  const mapDirty = useMemo(() => (
    mapLat !== mapOriginalRef.current.lat ||
    mapLng !== mapOriginalRef.current.lng ||
    mapZoom !== mapOriginalRef.current.zoom
  ), [mapLat, mapLng, mapZoom])

  const imgbbDirty = useMemo(() => imgbbKey !== imgbbOriginalRef.current, [imgbbKey])

  const settingsDirty = useMemo(() => {
    switch (active) {
      case "map-defaultview":
        return mapDirty
      case "route-colors":
        return routesListDirty
      case "security":
        return imgbbDirty
      default:
        return false
    }
  }, [active, imgbbDirty, mapDirty, routesListDirty])

  const saveActiveSection = useCallback(async () => {
    switch (active) {
      case "map-defaultview":
        if (mapDirty) handleSaveMap()
        break
      case "route-colors":
        if (routesListDirty) await handleSaveRouteColorsList()
        break
      case "security":
        if (imgbbDirty) handleSaveImgbbKey()
        break
      default:
        break
    }
  }, [active, imgbbDirty, mapDirty, routesListDirty, mapLat, mapLng, mapZoom, imgbbKey, routesList])

  useEffect(() => {
    if (!isEditMode || !settingsDirty) return
    const unregister = registerSaveHandler(saveActiveSection)
    return unregister
  }, [isEditMode, settingsDirty, registerSaveHandler, saveActiveSection])

  useEffect(() => {
    if (!isEditMode) {
      setHasUnsavedChanges(false)
      return
    }
    setHasUnsavedChanges(settingsDirty)
  }, [isEditMode, settingsDirty, setHasUnsavedChanges])

  const handleChangePassword = () => {
    if (security.newPassword !== security.confirmPassword) { alert("New passwords do not match!"); return }
    if (security.newPassword.length < 8) { alert("Password must be at least 8 characters!"); return }
    alert("Password changed successfully!")
    setSecurity({ currentPassword: "", newPassword: "", confirmPassword: "" })
  }

  useEffect(() => {
    if (active !== "storage") return
    setStorageTab("database")
  }, [active])

  // ── Render section content ────────────────────────────────────────────────
  const renderContent = () => {
    switch (active) {

      // ── Profile ───────────────────────────────────────────────────────────
      case "profile":
        return (
          <div className="space-y-6">
            <SectionHeader icon={<User className="size-5" />} title="Profile" description={t.profileDescription} />
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {([
                  { key: 'name',  label: 'Full Name',     type: 'text',  icon: null },
                  { key: 'role',  label: 'Role',           type: 'text',  icon: null },
                  { key: 'email', label: 'Email Address',  type: 'email', icon: <Mail className="size-4" /> },
                  { key: 'phone', label: 'Phone Number',   type: 'text',  icon: <Phone className="size-4" /> },
                ] as { key: keyof typeof profile; label: string; type: string; icon: ReactNode }[]).map(({ key, label, type, icon }) => (
                  <div key={key} className="space-y-2.5">
                    <label className="text-sm font-medium flex items-center gap-2">
                      {icon}{label}
                    </label>
                    <div className="relative">
                      {isEditMode ? (
                        <Input
                          type={type}
                          value={profile[key]}
                          onChange={e => setProfile({ ...profile, [key]: e.target.value })}
                          placeholder={label}
                          className="pr-9"
                        />
                      ) : (
                        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 h-9">
                          <span className="text-sm truncate">{profile[key] || <span className="text-muted-foreground italic">—</span>}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(key, profile[key])}
                            className="ml-2 shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Copy"
                          >
                            {copiedField === key ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                          </button>
                        </div>
                      )}
                      {isEditMode && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(key, profile[key])}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Copy"
                        >
                          {copiedField === key ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>
        )

      // ── Notifications ─────────────────────────────────────────────────────
      case "notifications":{
        const NOTIF_ITEMS: { key: keyof typeof notifications; label: string; desc: string; icon: ReactNode }[] = [
          { key: "email",        label: "Email Notifications",  desc: "Receive notifications via email",                   icon: <Mail className="size-4 text-muted-foreground" /> },
          { key: "push",         label: "Push Notifications",   desc: "Receive push notifications on your device",          icon: <Bell className="size-4 text-muted-foreground" /> },
          { key: "sms",          label: "SMS Notifications",    desc: "Receive important alerts via SMS",                   icon: <Phone className="size-4 text-muted-foreground" /> },
          { key: "weeklyReport", label: "Weekly Report",        desc: "Receive weekly delivery summary report",             icon: <Globe className="size-4 text-muted-foreground" /> },
        ]
        return (
          <div className="space-y-6">
            <SectionHeader icon={<Bell className="size-5" />} title="Notifications" description="Manage the notifications you receive." />

            <FieldGroup className="w-full space-y-3">
              {NOTIF_ITEMS.map(({ key, label, desc, icon }) => (
                <Field key={key} orientation="horizontal"
                  className="justify-between rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm hover:bg-accent/30 transition-colors"
                >
                  {/* Left: icon + text */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 rounded-md bg-muted p-1.5">{icon}</span>
                    <div className="min-w-0">
                      <FieldLabel htmlFor={`notif-${key}`} className="text-sm font-medium leading-tight block truncate">
                        {label}
                      </FieldLabel>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{desc}</p>
                    </div>
                  </div>
                  {/* Right: switch */}
                  <Switch
                    id={`notif-${key}`}
                    size="default"
                    checked={notifications[key]}
                    onCheckedChange={v => setNotifications(n => ({ ...n, [key]: v }))}
                    className="shrink-0 ml-4"
                  />
                </Field>
              ))}
            </FieldGroup>


          </div>
        )
      }

      // ── Appearance: Font ──────────────────────────────────────────────────
      case "appearance-font":
        return (
          <div className="space-y-6">
            <SectionHeader icon={<Type className="size-5" />} title={t.fontTitle} description={t.fontDescription} />
            <div className="space-y-6">
              <div className="max-h-[46vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {FONT_OPTIONS.map(opt => {
                  const isSelected = selectedFont === opt.id
                  const isApplied  = appFont === opt.id
                  return (
                    <button key={opt.id} onClick={() => setSelectedFont(opt.id as AppFont)}
                      className={`relative flex flex-col gap-1.5 rounded-lg border-2 px-4 py-3 text-left transition-all hover:scale-[1.02] ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}
                    >
                      <span className="text-2xl font-bold leading-none" style={{ fontFamily: opt.family }}>Aa</span>
                      <span className="text-xs text-muted-foreground truncate">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground/60 truncate" style={{ fontFamily: opt.family }}>Lorem ipsum</span>
                      {isSelected && <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-2.5" /></span>}
                      {isApplied && !isSelected && <span className="absolute bottom-2 right-2 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wide">{t.active}</span>}
                    </button>
                  )
                })}
                </div>
              </div>
              <div className="mt-2 p-4 rounded-lg bg-muted/40 border">
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">{t.previewLabel}</p>
                <p className="text-[15px]" style={{ fontFamily: FONT_OPTIONS.find(f => f.id === selectedFont)?.family }}>
                  {t.previewTextPrefix} <strong>{FONT_OPTIONS.find(f => f.id === selectedFont)?.label}</strong>. {t.previewTextSuffix}
                </p>
              </div>
              {fontDirty && (
                <div className="flex items-center justify-end gap-3">
                  <Button variant="outline" onClick={() => setSelectedFont("system")}>
                    {t.reset}
                  </Button>
                  <Button onClick={() => setAppFont(selectedFont)} className="bg-green-600 text-white hover:bg-green-700">
                    {t.apply}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )

      // ── Map: Default View ─────────────────────────────────────────────────
      case "map-defaultview":
        return (
          <div className="space-y-6">
            <SectionHeader icon={<Navigation className="size-5" />} title="Default Map View" description="Coordinates and zoom shown by default in Map Marker." />
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-2.5">
                  <label className="text-sm font-medium">Latitude</label>
                  <Input value={mapLat} onChange={e => setMapLat(e.target.value)} placeholder="3.0695500" className="font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Longitude</label>
                  <Input value={mapLng} onChange={e => setMapLng(e.target.value)} placeholder="101.5469179" className="font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Zoom (1–18)</label>
                  <Input type="number" min={1} max={18} value={mapZoom} onChange={e => setMapZoom(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center">
                <button onClick={() => { setMapLat(MAP_FALLBACK.lat); setMapLng(MAP_FALLBACK.lng); setMapZoom(MAP_FALLBACK.zoom) }}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >Reset to default (3.0695500, 101.5469179)</button>
              </div>
            </div>
          </div>
        )

      // ── Route Colors ──────────────────────────────────────────────────────
      case "route-colors": {
        const fgFor = (hex: string) => {
          const r = parseInt(hex.slice(1, 3), 16)
          const g = parseInt(hex.slice(3, 5), 16)
          const b = parseInt(hex.slice(5, 7), 16)
          return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#111827' : '#ffffff'
        }

        const canEditRouteColors = isEditMode && !routesListLoading

        return (
          <div className="space-y-6">
            <div className="mb-6 sm:mb-7">
              <div className="mb-2 flex items-center gap-2.5 sm:gap-3">
                <Palette className="size-3.5 shrink-0 text-primary" />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Route Card Colours</h2>
              </div>
              <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground/90 sm:ml-7">
                Set a colour for each route. It applies to the route card, map marker, and rooster schedule.
              </p>
            </div>

            {routesListLoading ? (
              <div className="flex items-center justify-center py-10 sm:py-16">
                <div className="loading-shell flex items-center gap-2.5 text-muted-foreground text-sm">
                  <Loader2 className="loading-spinner size-4 animate-spin" />
                  <span className="loading-text">Loading routes...</span>
                </div>
              </div>
            ) : routesList.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">No routes found.</div>
            ) : (
              <>
                {/* Preview strip */}
                <div className="flex h-8 rounded-lg overflow-hidden border border-border shadow-sm mb-4">
                  {routesList.map(r => (
                    <div key={r.id} className="flex-1" style={{ background: r.color }} title={`${r.name}: ${r.color}`} />
                  ))}
                </div>

                <div className="space-y-2">
                  {routesList.map((entry, idx) => (
                    <div key={entry.id} className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm hover:border-primary/30 transition-colors">
                      {/* Swatch */}
                      <label className="relative cursor-pointer shrink-0" title={canEditRouteColors ? "Click to change colour" : "Enable Edit Mode to change colour"}>
                        <div className="h-10 w-10 rounded-lg shadow-inner ring-2 ring-black/10 transition-transform group-hover:scale-105" style={{ background: entry.color }} />
                        <input type="color" value={entry.color}
                          disabled={!canEditRouteColors}
                          onChange={e => {
                            const c = e.target.value
                            setRoutesList(prev => prev.map((r, i) => i === idx ? { ...r, color: c } : r))
                            setRoutesListDirty(true)
                          }}
                          className="sr-only" />
                      </label>

                      {/* Code pill */}
                      <div className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide" style={{ background: entry.color, color: fgFor(entry.color) }}>
                        {entry.code || entry.name}
                      </div>

                      {/* Route name */}
                      <span className="flex-1 text-sm font-medium text-foreground truncate">{entry.name}</span>

                      {/* Hex */}
                      <input
                        type="text"
                        value={entry.color.toUpperCase()}
                        disabled={!canEditRouteColors}
                        maxLength={7}
                        onChange={e => {
                          const raw = e.target.value.toUpperCase()
                          const next = raw.startsWith('#') ? raw : `#${raw.replace(/^#+/, '')}`
                          if (/^#[0-9A-F]*$/.test(next) && next.length <= 7) {
                            setRoutesList(prev => prev.map((r, i) => i === idx ? { ...r, color: next } : r))
                            setRoutesListDirty(true)
                          }
                        }}
                        className="hidden sm:inline-block w-[86px] rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono tracking-wide text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Route colour hex code"
                      />

                      {/* Edit */}
                      {canEditRouteColors && (
                        <label className="relative flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors"
                          style={{
                            background: 'rgb(243 244 246)',
                            borderColor: 'rgb(209 213 219)',
                            color: 'rgb(55 65 81)',
                            cursor: 'pointer',
                          }}
                          title="Change colour"
                        >
                          <Palette className="size-3.5" />
                          <span className="hidden sm:inline">Edit</span>
                          <input type="color" value={entry.color}
                            onChange={e => {
                              const c = e.target.value
                              setRoutesList(prev => prev.map((r, i) => i === idx ? { ...r, color: c } : r))
                              setRoutesListDirty(true)
                            }}
                            className="sr-only" />
                        </label>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col gap-2">
                  <button
                    disabled={!canEditRouteColors}
                    onClick={() => setResetRouteColorsConfirm(true)}
                    className={`text-xs underline-offset-2 transition-colors ${canEditRouteColors ? 'text-muted-foreground hover:text-foreground hover:underline' : 'text-muted-foreground/60 cursor-not-allowed'}`}
                  >
                    Reset to default
                  </button>
                  {!canEditRouteColors && (
                    <p className="text-xs text-muted-foreground">Enable Edit Mode to update route colours or reset them to defaults.</p>
                  )}
                </div>

                <Dialog open={resetRouteColorsConfirm} onOpenChange={setResetRouteColorsConfirm}>
                  <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden">
                    <DialogHeader className="px-5 pt-5 pb-2">
                      <DialogTitle>Reset route colours?</DialogTitle>
                      <DialogDescription>
                        Restore all route colours to the default palette. You can still change them again after resetting.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-end gap-3 border-t border-border/70 px-5 py-4 bg-background">
                      <Button variant="outline" size="sm" onClick={() => setResetRouteColorsConfirm(false)}>Cancel</Button>
                      <Button size="sm" onClick={() => {
                        resetRouteColorsToDefaults()
                        setResetRouteColorsConfirm(false)
                      }}>
                        Reset
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        )
      }

      // ── Storage ───────────────────────────────────────────────────────────
      case "storage":
        return (
          <div className="space-y-6">
            <SectionHeader
              icon={<Database className="size-5" />}
              title="Storage"
              description="Reference of where app data is stored (Database and Local Storage)."
            />

            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setStorageTab("database")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  storageTab === "database"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Database className="size-3.5" />
                Database
              </button>
              <button
                type="button"
                onClick={() => setStorageTab("local")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  storageTab === "local"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <HardDrive className="size-3.5" />
                Local Storage
              </button>
            </div>

            {storageTab === "database" ? (
              <div className="space-y-2.5">
                {DATABASE_STORAGE_ITEMS.map((item) => (
                  <div key={item.store} className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
                    <p className="text-sm font-semibold text-foreground">{item.section}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{item.purpose}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Local Storage</p>
                  <div className="space-y-2.5">
                    {LOCAL_STORAGE_ITEMS.map((item) => (
                      <div key={item.store} className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
                        <p className="text-sm font-semibold text-foreground">{item.section}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{item.purpose}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock3 className="size-3.5" />Session Storage
                  </p>
                  <div className="space-y-2.5">
                    {SESSION_STORAGE_ITEMS.map((item) => (
                      <div key={item.store} className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
                        <p className="text-sm font-semibold text-foreground">{item.section}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{item.purpose}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )

      // ── Security ──────────────────────────────────────────────────────────
      case "security":
        return (
          <div className="space-y-6">
            <SectionHeader icon={<Lock className="size-5" />} title="Security" description="Tukar kata laluan akaun anda." />
            <div className="space-y-5">
              {/* ImgBB API Key */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Globe className="size-4" />ImgBB API Key
                </label>
                <p className="text-xs text-muted-foreground">Used to upload images to ImgBB. Get your API key at <span className="font-mono text-foreground">api.imgbb.com</span>.</p>
                <div className="relative">
                  <Input
                    type={showImgbbKey ? "text" : "password"}
                    value={imgbbKey}
                    onChange={e => setImgbbKey(e.target.value)}
                    placeholder="Enter ImgBB API key"
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    onClick={() => setShowImgbbKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    type="button"
                  >
                    {showImgbbKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Separator />

                <div className="space-y-2.5">
                <label className="text-sm font-medium flex items-center gap-2"><Shield className="size-4" />Current Password</label>
                <div className="relative">
                  <Input type={showPasswords.current ? "text" : "password"} value={security.currentPassword} onChange={e => setSecurity({ ...security, currentPassword: e.target.value })} placeholder="Enter current password" className="pr-10" />
                  <button onClick={() => setShowPasswords(p => ({ ...p, current: !p.current }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPasswords.current ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2.5">
                  <label className="text-sm font-medium">New Password</label>
                  <div className="relative">
                    <Input type={showPasswords.new ? "text" : "password"} value={security.newPassword} onChange={e => setSecurity({ ...security, newPassword: e.target.value })} placeholder="Enter new password" className="pr-10" />
                    <button onClick={() => setShowPasswords(p => ({ ...p, new: !p.new }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPasswords.new ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <label className="text-sm font-medium">Confirm Password</label>
                  <div className="relative">
                    <Input type={showPasswords.confirm ? "text" : "password"} value={security.confirmPassword} onChange={e => setSecurity({ ...security, confirmPassword: e.target.value })} placeholder="Confirm new password" className="pr-10" />
                    <button onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPasswords.confirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-4 text-sm text-muted-foreground space-y-1">
                <p className="font-medium">Password requirements:</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>At least 8 characters long</li>
                  <li>Contains uppercase and lowercase letters</li>
                  <li>Contains at least one number</li>
                  <li>Contains at least one special character</li>
                </ul>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleChangePassword} disabled={!security.currentPassword || !security.newPassword || !security.confirmPassword}>
                  <Lock className="size-4 mr-2" />Change Password
                </Button>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="relative flex flex-1 flex-col min-h-0 overflow-y-auto p-6 md:p-8 max-w-4xl w-full mx-auto" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
      <div className="space-y-8">
        {renderContent()}
      </div>
    </div>
  )
}

