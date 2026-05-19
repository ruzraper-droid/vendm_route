import { useState, useMemo, useEffect, useCallback } from "react"
import { useRegisterRefresh } from "@/contexts/RefreshContext"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Users,
  Clock,
  Loader2,
  Settings2,
  Search,
  CalendarDays,
  X,
  Zap,
  ChevronUp,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingState } from "@/components/ui/loading"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { useEditMode } from "@/contexts/EditModeContext"
import { getRouteColorPalette } from "@/lib/route-colors"

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Resource {
  id: string
  name: string
  role: string
  color: string
}

interface Shift {
  id: string
  resourceId: string
  title: string
  date: string   // "YYYY-MM-DD"
  startHour: number  // 0-23, supports .5 for :30; -1 = no time set
  endHour: number    // 1-24.5; -1 = no time set
  color: string
  hasTime?: boolean  // false when user didn't set a time
}

interface RouteRef {
  id: string
  name: string
  code: string
  shift: string  // "AM" | "PM" | etc
  color?: string
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

// Half-hour options for shift time selects
const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => {
  const h = i * 0.5
  const hInt = Math.floor(h)
  const mins = h % 1 !== 0 ? "30" : "00"
  if (h === 0)    return { value: 0,    label: "12:00 AM" }
  if (h === 0.5)  return { value: 0.5,  label: "12:30 AM" }
  if (h < 12)     return { value: h,    label: `${hInt}:${mins} AM` }
  if (h === 12)   return { value: 12,   label: "12:00 PM" }
  if (h === 12.5) return { value: 12.5, label: "12:30 PM" }
  if (h < 24)     return { value: h,    label: `${hInt - 12}:${mins} PM` }
  if (h === 24)   return { value: 24,   label: "12:00 AM (+1)" }
  return { value: 24.5, label: "12:30 AM (+1)" }
})

// Returns {startHour, endHour} preset based on route shift type
function getShiftPreset(shiftType: string): { startHour: number; endHour: number } {
  if (shiftType?.toUpperCase() === "AM") return { startHour: 4, endHour: 12.5 }
  if (shiftType?.toUpperCase() === "PM") return { startHour: 16, endHour: 24.5 }
  return { startHour: 8, endHour: 16 }
}

const RESOURCE_COLORS = [
  "#3B82F6", "#F97316", "#22C55E", "#A855F7",
  "#EC4899", "#EAB308", "#14B8A6", "#EF4444",
]

const OFF_SUB_TYPES = [
  { id: "off",     label: "Off",            color: "#6B7280" },
  { id: "absent",  label: "Absent",         color: "#6B7280" },
  { id: "public",  label: "PH", color: "#6B7280" },
  { id: "mc",      label: "MC",             color: "#6B7280" },
] as const
type OffSubTypeId = typeof OFF_SUB_TYPES[number]["id"]
type ShiftTypeId = "route" | "off"
const OFF_LABELS: ReadonlySet<string> = new Set(OFF_SUB_TYPES.map(t => t.label))

function detectShiftType(title: string): ShiftTypeId {
  return OFF_LABELS.has(title) ? "off" : "route"
}

function detectOffSubType(title: string): OffSubTypeId {
  return (OFF_SUB_TYPES.find(t => t.label === title)?.id ?? "off") as OffSubTypeId
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate)
  const day = d.getDay() // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // go to Monday
  return Array.from({ length: 7 }, (_, i) => {
    const nd = new Date(d)
    nd.setDate(d.getDate() + i)
    return nd
  })
}

/** Return the Monday of the week containing `date` */
function getMondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

/** Rotate the cycle so that `startRouteId` is at index 0 */
function rotateCycle(cycle: string[], startRouteId: string): string[] {
  if (!startRouteId || !cycle.length) return cycle
  const idx = cycle.indexOf(startRouteId)
  if (idx <= 0) return cycle
  return [...cycle.slice(idx), ...cycle.slice(0, idx)]
}

function toDateKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatHour(h: number) {
  const mins = h % 1 !== 0 ? "30" : "00"
  if (h === 0)    return `12:${mins} AM`
  if (h < 12)     return `${Math.floor(h)}:${mins} AM`
  if (h === 12)   return `12:${mins} PM`
  if (h < 24)     return `${Math.floor(h) - 12}:${mins} PM`
  return `12:${mins} AM`  // 24 / 24.5 = next day
}

function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  const d = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateKey
  d.setDate(d.getDate() + daysToAdd)
  return toDateKey(d)
}

function getInclusiveDurationDays(startDateKey: string, endDateKey: string): number {
  const start = new Date(`${startDateKey}T00:00:00`)
  const end = new Date(`${endDateKey}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function getDateKeysInRange(startDateKey: string, endDateKey: string): string[] {
  const start = new Date(`${startDateKey}T00:00:00`)
  const end = new Date(`${endDateKey}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [startDateKey]

  const out: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    out.push(toDateKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * Reorder a route-ID cycle so that AM and PM routes alternate:
 *   AM[0], PM[0], AM[1], PM[1], …  then any routes with no AM/PM label appended.
 * Existing relative order within AM and PM groups is preserved.
 */
function interleaveCycle(cycle: string[], routes: RouteRef[]): string[] {
  const am: string[] = [], pm: string[] = [], other: string[] = []
  for (const id of cycle) {
    const shift = routes.find(r => r.id === id)?.shift?.toUpperCase() ?? ""
    if (shift === "AM")       am.push(id)
    else if (shift === "PM")  pm.push(id)
    else                      other.push(id)
  }
  const maxLen = Math.max(am.length, pm.length)
  const result: string[] = []
  for (let i = 0; i < maxLen; i++) {
    if (i < am.length) result.push(am[i])
    if (i < pm.length) result.push(pm[i])
  }
  return [...result, ...other]
}

// ─── CYCLE CONTEXT DETECTION ──────────────────────────────────────────────────

/**
 * Look at a staff member's existing shifts and determine the correct
 * patternStart + effectiveCycle so that auto-generated shifts:
 *   1. Continue from the last known route (not restart from route[0])
 *   2. Keep the Off day pinned to the same weekday as any historical Off day
 *      (e.g. if Off was on Friday, all future Off days also fall on Friday)
 *
 * Strategy: find the most recent Off shift and use it as a fixed weekday
 * anchor.  patternStart = anchorOff + 1 day → day-6 of every 7-day block
 * lands exactly 7 days after anchorOff (same weekday, forever).
 *
 * Returns null when no prior shifts exist → caller falls back to defaults.
 */
function detectCycleContext(
  staffId: string,
  genFrom: string,
  allShifts: Shift[],
  allRoutes: RouteRef[],
  cycle: string[],
): { patternStart: string; effectiveCycle: string[] } | null {
  if (cycle.length === 0) return null

  // All shifts for this staff that start BEFORE genFrom, newest first
  const prior = allShifts
    .filter(s => s.resourceId === staffId && s.date < genFrom)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (prior.length === 0) return null

  const byDate   = new Map(prior.map(s => [s.date, s]))
  const cycleLen = cycle.length

  // ── Find the most recent Off shift (our reliable weekday anchor) ──────────
  const anchorOff = prior.find(s => OFF_LABELS.has(s.title))

  if (!anchorOff) {
    // No off day recorded yet → backward-walk from last route shift
    const lastRoute = prior.find(s => !OFF_LABELS.has(s.title))
    if (!lastRoute) return null
    let blockStart = lastRoute.date
    for (let i = 1; i <= 5; i++) {
      const key = addDaysToDateKey(lastRoute.date, -i)
      const s   = byDate.get(key)
      if (!s || OFF_LABELS.has(s.title)) break
      blockStart = key
    }
    const rRef = allRoutes.find(r => r.name === lastRoute.title)
    const rId  = rRef?.id ?? lastRoute.title
    const pos  = cycle.indexOf(rId)
    if (pos === -1) return { patternStart: blockStart, effectiveCycle: cycle }
    return {
      patternStart: blockStart,
      effectiveCycle: [...cycle.slice(pos), ...cycle.slice(0, pos)],
    }
  }

  // ── Anchor-based approach ─────────────────────────────────────────────────
  // patternStart = day after anchorOff.
  // This pins off days to the same weekday: day 6 of block 0 = anchorOff + 7,
  // day 6 of block N = anchorOff + 7*(N+1) → always the same weekday.
  const patternStart = addDaysToDateKey(anchorOff.date, 1)
  const baseDate     = new Date(patternStart + "T00:00:00")

  // Most recent route shift before genFrom
  const lastRoute = prior.find(s => !OFF_LABELS.has(s.title))
  if (!lastRoute) {
    // Only off shifts in history → start fresh with default cycle order
    return { patternStart, effectiveCycle: cycle }
  }

  const lastRouteDate = new Date(lastRoute.date + "T00:00:00")
  const diff          = Math.round((lastRouteDate.getTime() - baseDate.getTime()) / 86400000)

  if (diff < 0) {
    // lastRoute is before the anchor off day (an older block).
    // Find the route worked just before the anchor off; next block starts with
    // the route that follows it in the cycle.
    let routeBeforeOff: Shift | undefined
    for (let i = 1; i <= 6; i++) {
      const s = byDate.get(addDaysToDateKey(anchorOff.date, -i))
      if (s && !OFF_LABELS.has(s.title)) { routeBeforeOff = s; break }
    }
    const ref  = routeBeforeOff ?? lastRoute
    const rRef = allRoutes.find(r => r.name === ref.title)
    const rId  = rRef?.id ?? ref.title
    const rPos = cycle.indexOf(rId)
    if (rPos === -1) return { patternStart, effectiveCycle: cycle }
    const next = (rPos + 1) % cycleLen
    return {
      patternStart,
      effectiveCycle: [...cycle.slice(next), ...cycle.slice(0, next)],
    }
  }

  // lastRoute is after the anchor off day → compute which block it falls in
  // and rotate the cycle so that block maps to the correct route.
  const blockIdxOfLastRoute = Math.floor(diff / 7)
  const rRef    = allRoutes.find(r => r.name === lastRoute.title)
  const rId     = rRef?.id ?? lastRoute.title
  const routePos = cycle.indexOf(rId)
  if (routePos === -1) return { patternStart, effectiveCycle: cycle }

  // effectiveCycle[blockIdxOfLastRoute % cycleLen] must equal rId
  // → rotate by: rot = (routePos − blockIdx % cycleLen + cycleLen) % cycleLen
  const rot = ((routePos - (blockIdxOfLastRoute % cycleLen)) % cycleLen + cycleLen) % cycleLen
  return {
    patternStart,
    effectiveCycle: [...cycle.slice(rot), ...cycle.slice(0, rot)],
  }
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────

async function apiFetchAll(): Promise<{ resources: Resource[]; shifts: Shift[] }> {
  try {
    const res = await fetch("/api/rooster")
    const json = await res.json()
    if (!json.success) return { resources: [], shifts: [] }
    const resources: Resource[] = json.resources.map((r: Record<string, string>) => ({
      id: r.id, name: r.name, role: r.role, color: r.color,
    }))
    const shifts: Shift[] = json.shifts.map((s: Record<string, string | number>) => ({
      id: String(s.id),
      resourceId: String(s.resource_id),
      title: String(s.title),
      date: String(s.shift_date).slice(0, 10),
      startHour: Number(s.start_hour),
      endHour: Number(s.end_hour),
      color: String(s.color),
      hasTime: Number(s.start_hour) >= 0,
    }))
    return { resources, shifts }
  } catch {
    return { resources: [], shifts: [] }
  }
}

async function apiSaveResource(r: Resource): Promise<boolean> {
  try {
    const res = await fetch("/api/rooster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "resource", id: r.id, name: r.name, role: r.role, color: r.color }),
    })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiDeleteResource(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooster?type=resource&id=${encodeURIComponent(id)}`, { method: "DELETE" })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiSaveShift(s: Shift): Promise<boolean> {
  try {
    const res = await fetch("/api/rooster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift",
        id: s.id,
        resource_id: s.resourceId,
        title: s.title,
        shift_date: s.date,
        start_hour: s.startHour,
        end_hour: s.endHour,
        color: s.color,
      }),
    })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

async function apiDeleteShift(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooster?type=shift&id=${encodeURIComponent(id)}`, { method: "DELETE" })
    const json = await res.json()
    return json.success === true
  } catch { return false }
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────

const SEED_RESOURCES: Resource[] = [
  { id: "r1", name: "Ahmad Faris",    role: "Driver",    color: RESOURCE_COLORS[0] },
  { id: "r2", name: "Siti Aminah",    role: "Operator",  color: RESOURCE_COLORS[1] },
  { id: "r3", name: "Mohd Hazwan",    role: "Driver",    color: RESOURCE_COLORS[2] },
  { id: "r4", name: "Nurul Izzati",   role: "Supervisor",color: RESOURCE_COLORS[3] },
  { id: "r5", name: "Khairul Azman",  role: "Operator",  color: RESOURCE_COLORS[4] },
]

function makeSeedShifts(resources: Resource[]): Shift[] {
  const today = new Date()
  const week = getWeekDates(today)
  const shifts: Shift[] = []
  let sid = 1
  const shiftTemplates = [
    { title: "Morning",   startHour: 7,  endHour: 15, color: "#3B82F6" },
    { title: "Afternoon", startHour: 12, endHour: 20, color: "#F97316" },
    { title: "Night",     startHour: 20, endHour: 24, color: "#A855F7" },
    { title: "Morning",   startHour: 6,  endHour: 14, color: "#22C55E" },
  ]
  resources.forEach((res, ri) => {
    ;[1, 2, 3, 4, 5].forEach((dayOffset) => {
      const date = toDateKey(week[dayOffset])
      const tmpl = shiftTemplates[ri % shiftTemplates.length]
      shifts.push({
        id: `seed_s${sid++}`,
        resourceId: res.id,
        title: tmpl.title,
        date,
        startHour: tmpl.startHour,
        endHour: tmpl.endHour,
        color: tmpl.color,
      })
    })
  })
  return shifts
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

type ViewMode = "month" | "week"

function getMonthDates(baseDate: Date): Date[] {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))
}

export function Rooster({ viewMode: viewModeProp = "week" }: { viewMode?: ViewMode }) {
  const today = new Date()
  const { isEditMode } = useEditMode()

  const [viewMode, setViewMode] = useState<ViewMode>(viewModeProp)
  const [viewModeTransition, setViewModeTransition] = useState<"idle" | "out" | "in">("idle")

  useEffect(() => { setViewMode(viewModeProp) }, [viewModeProp])
  useEffect(() => {
    if (viewModeTransition === "out") {
      const timeout = window.setTimeout(() => {
        setViewMode((value) => (value === "month" ? "week" : "month"))
        setViewModeTransition("in")
      }, 140)
      return () => window.clearTimeout(timeout)
    }

    if (viewModeTransition === "in") {
      const timeout = window.setTimeout(() => setViewModeTransition("idle"), 180)
      return () => window.clearTimeout(timeout)
    }

    return undefined
  }, [viewModeTransition])

  const [currentDate, setCurrentDate] = useState(new Date())
  const [resources, setResources] = useState<Resource[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [routes, setRoutes] = useState<RouteRef[]>([])
  const [loading, setLoading] = useState(true)
  const [routeColorPalette, setRouteColorPalette] = useState<string[]>(getRouteColorPalette)

  // Maps route name → effective colour (route.color overrides palette fallback)
  const routeEffectiveColorMap = useMemo(() => {
    const map = new Map<string, string>()
    routes.forEach((r, i) => {
      const c = r.color || routeColorPalette[i % routeColorPalette.length]
      map.set(r.id, c)
      map.set(r.name, c)
    })
    return map
  }, [routes, routeColorPalette])

  // Dialogs
  const [shiftDialog, setShiftDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    shift?: Shift
    resourceId?: string
    date?: string
  }>({ open: false, mode: "add" })

  const [resourceDialog, setResourceDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    resource?: Resource
  }>({ open: false, mode: "add" })

  // Manage modal
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<"staff" | "shift" | "route">("staff")

  // Route pattern tab state (persisted in localStorage)
  const routePatternStart = useState<string>(
    () => localStorage.getItem("rooster_route_pattern_start")
      ?? getMondayOf(new Date()).toISOString().split("T")[0]
  )[0]
  // Ordered cycle of route names, e.g. ["KL 7", "KL 3", "KL 6", "KL 4"]
  const [routeCycle, setRouteCycle] = useState<string[]>(
    () => { try { return JSON.parse(localStorage.getItem("rooster_route_cycle") ?? "[]") as string[] } catch { return [] } }
  )

  // Resource row order (IDs in display order)
  const [resourceOrder, setResourceOrder] = useState<string[]>(
    () => { try { return JSON.parse(localStorage.getItem("rooster_resource_order") ?? "[]") as string[] } catch { return [] } }
  )

  // Per-staff route pattern start dates: { [resourceId]: "YYYY-MM-DD" }
  const staffRouteStarts = useState<Record<string, string>>(
    () => { try { return JSON.parse(localStorage.getItem("rooster_staff_route_starts") ?? "{}") as Record<string, string> } catch { return {} } }
  )[0]
  // Per-staff: which routeId to start from (cycle offset)
  const staffCycleOffset = useState<Record<string, string>>(
    () => { try { return JSON.parse(localStorage.getItem("rooster_staff_cycle_offset") ?? "{}") as Record<string, string> } catch { return {} } }
  )[0]
  // Selected staff in Route tab viewer
  const [routeStaffId, setRouteStaffId] = useState<string>("")

  // Auto-generate range for cycle shifts
  const todayKey = new Date().toISOString().split("T")[0]
  const in8Weeks = new Date(); in8Weeks.setDate(in8Weeks.getDate() + 55)
  const [genFrom, setGenFrom] = useState(todayKey)
  const [genTo, setGenTo] = useState(in8Weeks.toISOString().split("T")[0])
  const [isGenerating, setIsGenerating] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")

  // Selected shifts for bulk actions
  const [selectedShifts, setSelectedShifts] = useState<string[]>([])

  // Bulk action dialogs
  const [changeStaffDialog, setChangeStaffDialog] = useState<{
    open: boolean
    selectedResourceId?: string
  }>({ open: false })
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false)
  const [deleteShiftConfirmOpen, setDeleteShiftConfirmOpen] = useState(false)
  const [deleteDateDialog, setDeleteDateDialog] = useState<{ open: boolean; dateFrom: string; dateTo: string; staffId: string }>({ open: false, dateFrom: "", dateTo: "", staffId: "" })
  const [deleteStaffConfirmDialog, setDeleteStaffConfirmDialog] = useState<{
    open: boolean
    resourceId?: string
    resourceName?: string
  }>({ open: false })

  // ── Load from DB on mount ──────────────────────────────────────────────────

  // ── Load from DB on mount ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const { resources: dbRes, shifts: dbShifts } = await apiFetchAll()
    // Also fetch routes for shift type select
    try {
      const rr = await fetch("/api/routes")
      const rd = await rr.json()
      if (rd.success) setRoutes(rd.data as RouteRef[])
    } catch { /* ignore */ }
    if (dbRes.length === 0) {
      // Seed default data on first launch
      for (const r of SEED_RESOURCES) await apiSaveResource(r)
      const seedShifts = makeSeedShifts(SEED_RESOURCES)
      for (const s of seedShifts) await apiSaveShift(s)
      setResources(SEED_RESOURCES)
      setShifts(seedShifts)
    } else {
      setResources(dbRes)
      setShifts(dbShifts)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useRegisterRefresh(loadData)

  // Clear selection when edit mode is turned off
  useEffect(() => {
    if (!isEditMode) {
      setSelectedShifts([])
    }
  }, [isEditMode])

  // Sync palette whenever Settings saves new route colours
  useEffect(() => {
    const handler = () => setRouteColorPalette(getRouteColorPalette())
    window.addEventListener('fcalendar_route_colors_changed', handler)
    return () => window.removeEventListener('fcalendar_route_colors_changed', handler)
  }, [])

  // Persist route pattern settings
  useEffect(() => { localStorage.setItem("rooster_route_pattern_start", routePatternStart) }, [routePatternStart])
  useEffect(() => { localStorage.setItem("rooster_route_cycle", JSON.stringify(routeCycle)) }, [routeCycle])
  useEffect(() => { localStorage.setItem("rooster_staff_route_starts", JSON.stringify(staffRouteStarts)) }, [staffRouteStarts])
  useEffect(() => { localStorage.setItem("rooster_staff_cycle_offset", JSON.stringify(staffCycleOffset)) }, [staffCycleOffset])
  useEffect(() => { localStorage.setItem("rooster_resource_order", JSON.stringify(resourceOrder)) }, [resourceOrder])

  // Auto-sync resourceOrder when resources are added/removed
  useEffect(() => {
    const ids = resources.map(r => r.id)
    setResourceOrder(prev => {
      const kept = prev.filter(id => ids.includes(id))
      const missing = ids.filter(id => !kept.includes(id))
      const next = [...kept, ...missing]
      return next.length === prev.length && next.every((n, i) => n === prev[i]) ? prev : next
    })
  }, [resources])

  // Auto-sync routeCycle with routes list (by ID): add new, remove deleted,
  // then re-interleave so AM and PM routes always alternate (AM→PM→AM→PM…).
  useEffect(() => {
    const routeIds = routes.map(r => r.id)
    setRouteCycle(prev => {
      // migrate: if any entry is not a known ID, try match by name → replace with ID
      const migrated = prev.map(entry => {
        if (routeIds.includes(entry)) return entry              // already an ID
        const byName = routes.find(r => r.name === entry)       // old name-based entry
        return byName ? byName.id : entry                        // migrate or keep
      })
      const kept    = migrated.filter(id => routeIds.includes(id))  // remove deleted
      const missing = routeIds.filter(id => !kept.includes(id))     // add new
      const next    = interleaveCycle([...kept, ...missing], routes) // AM↔PM interleave
      return next.length === prev.length && next.every((n, i) => n === prev[i]) ? prev : next
    })
  }, [routes])

  // Shift type selector state (dialog UI only)
  const [shiftType, setShiftType] = useState<ShiftTypeId>("route")
  const [offSubType, setOffSubType] = useState<OffSubTypeId>("off")
  const [manageTimeEnabled, setManageTimeEnabled] = useState(false)
  const [dialogTimeEnabled, setDialogTimeEnabled] = useState(false)
  const [shiftEndDate, setShiftEndDate] = useState(toDateKey(today))
  const [shiftDurationDays, setShiftDurationDays] = useState("1")
  const [endDateMode, setEndDateMode] = useState<"date" | "duration">("date")

  const resourceById = useMemo(() => {
    const map = new Map<string, Resource>()
    resources.forEach((resource) => map.set(resource.id, resource))
    return map
  }, [resources])

  const routeByName = useMemo(() => {
    const map = new Map<string, RouteRef>()
    routes.forEach((route) => map.set(route.name, route))
    return map
  }, [routes])

  // Resources sorted by custom drag-reorder
  const orderedResources = useMemo(() => {
    if (resourceOrder.length === 0) return resources
    const orderMap = new Map(resourceOrder.map((id, i) => [id, i]))
    return [...resources].sort((a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999))
  }, [resources, resourceOrder])

  const historyResults = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return []

    return [...shifts]
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.startHour - a.startHour
      })
      .filter((shift) => {
        const resource = resourceById.get(shift.resourceId)
        const route = routeByName.get(shift.title)
        const haystack = [
          shift.title,
          shift.date,
          String(shift.startHour),
          String(shift.endHour),
          resource?.name ?? "",
          resource?.role ?? "",
          route?.code ?? "",
          route?.shift ?? "",
        ]
          .join(" ")
          .toLowerCase()

        return haystack.includes(q)
      })
      .slice(0, 30)
  }, [historyQuery, shifts, resourceById, routeByName])

  // Shift form state
  const [shiftForm, setShiftForm] = useState({
    title: "Morning",
    resourceId: resources[0]?.id ?? "",
    date: toDateKey(today),
    startHour: 8,
    endHour: 16,
    color: "#3B82F6",
  })

  const isManageShiftReady = useMemo(() => {
    if (!shiftForm.resourceId || !shiftForm.date) return false
    if (shiftType === "route") return shiftForm.title.trim().length > 0
    return true
  }, [shiftForm, shiftType, offSubType])

  // Resource form state
  const [resForm, setResForm] = useState({
    name: "",
    role: "",
    color: RESOURCE_COLORS[0],
  })

  // Derived week dates
  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])

  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    }
    const start = weekDates[0]
    const end = weekDates[6]
    const sameMo = start.getMonth() === end.getMonth()
    if (sameMo) {
      return `${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
    }
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
  }, [viewMode, currentDate, weekDates])

  // Navigation
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate)
    if (viewMode === "month") d.setMonth(d.getMonth() + dir)
    else d.setDate(d.getDate() + dir * 7)
    setCurrentDate(d)
  }

  const goToday = () => setCurrentDate(new Date())

  // Column dates for current view
  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate])
  const colDates: Date[] = viewMode === "month" ? monthDates : weekDates
  const staffColWidth = 82
  const dayColWidth = 70  // same width for both week and month; month scrolls horizontally

  // ── Shift CRUD ────────────────────────────────────────────────────────────

  const openAddShift = (resourceId?: string, date?: string) => {
    if (resourceId && date) {
      const existing = shifts.filter(s => s.resourceId === resourceId && s.date === date)
      if (existing.length >= 1) { toast.error("Maximum 1 shift per day"); return }
    }
    setShiftType("route")
    setOffSubType("off")
    setDialogTimeEnabled(false)
    setEndDateMode("date")
    const startDate = date ?? toDateKey(currentDate)
    setShiftEndDate(startDate)
    setShiftDurationDays("1")
    setShiftForm({
      title: "",
      resourceId: resourceId ?? resources[0]?.id ?? "",
      date: startDate,
      startHour: 8,
      endHour: 16,
      color: "#3B82F6",
    })
    setShiftDialog({ open: true, mode: "add", resourceId, date })
  }

  const openEditShift = (shift: Shift) => {
    const detected = detectShiftType(shift.title)
    setShiftType(detected)
    setOffSubType(detected === "off" ? detectOffSubType(shift.title) : "off")
    setDialogTimeEnabled(shift.hasTime !== false)
    setEndDateMode("date")
    setShiftEndDate(shift.date)
    setShiftDurationDays("1")
    setShiftForm({
      title: shift.title,
      resourceId: shift.resourceId,
      date: shift.date,
      startHour: shift.startHour,
      endHour: shift.endHour,
      color: shift.color,
    })
    setShiftDialog({ open: true, mode: "edit", shift })
  }

  const saveShift = async () => {
    if (shiftType === "route" && !shiftForm.title.trim()) { toast.error("Please select a route"); return }
    if (shiftType === "route" && dialogTimeEnabled && shiftForm.endHour <= shiftForm.startHour) { toast.error("End time must be after start time"); return }
    const finalTitle = shiftType === "off"
      ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.label ?? "Off")
      : shiftForm.title.trim()
    const finalColor = shiftType === "off"
      ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.color ?? "#6B7280")
      : shiftForm.color
    if (shiftDialog.mode === "add") {
      const durationNum = Number(shiftDurationDays)
      const resolvedEndDate = Number.isFinite(durationNum) && durationNum > 0
        ? addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1)
        : shiftEndDate
      const dateKeys = getDateKeysInRange(shiftForm.date, resolvedEndDate)

      const blockedDate = dateKeys.find(dateKey =>
        shifts.filter(s => s.resourceId === shiftForm.resourceId && s.date === dateKey).length >= 1
      )
      if (blockedDate) { toast.error(`Maximum 1 shift per day (${blockedDate})`); return }

      const batchId = Date.now()
      const timeEnabled = shiftType === "route" && dialogTimeEnabled
      const newShifts: Shift[] = dateKeys.map((dateKey, idx) => ({
        id: `s${batchId}_${idx}`,
        ...shiftForm,
        date: dateKey,
        title: finalTitle,
        color: finalColor,
        startHour: timeEnabled ? shiftForm.startHour : -1,
        endHour:   timeEnabled ? shiftForm.endHour   : -1,
        hasTime: timeEnabled,
      }))

      const results = await Promise.all(newShifts.map(s => apiSaveShift(s)))
      if (results.every(Boolean)) {
        setShifts(prev => [...prev, ...newShifts])
        toast.success(newShifts.length > 1 ? `${newShifts.length} shifts added` : "Shift added")
      } else toast.error("Failed to save shift")
    } else {
      const timeEnabled = shiftType === "route" && dialogTimeEnabled
      const updated: Shift = {
        ...shiftDialog.shift!, ...shiftForm, title: finalTitle, color: finalColor,
        startHour: timeEnabled ? shiftForm.startHour : -1,
        endHour:   timeEnabled ? shiftForm.endHour   : -1,
        hasTime: timeEnabled,
      }
      const ok = await apiSaveShift(updated)
      if (ok) {
        setShifts(prev => prev.map(s => s.id === updated.id ? updated : s))
        toast.success("Shift updated")
      } else toast.error("Failed to update shift")
    }
    setShiftDialog({ open: false, mode: "add" })
  }

  const deleteShift = async (id: string) => {
    const ok = await apiDeleteShift(id)
    if (ok) { setShifts(prev => prev.filter(s => s.id !== id)); toast.success("Shift removed") }
    else toast.error("Failed to delete shift")
  }

  // ── Resource CRUD ─────────────────────────────────────────────────────────

  const openAddResource = () => {
    setResForm({ name: "", role: "", color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] })
    setResourceDialog({ open: true, mode: "add" })
  }

  const openEditResource = (r: Resource) => {
    setResForm({ name: r.name, role: r.role, color: r.color })
    setResourceDialog({ open: true, mode: "edit", resource: r })
  }

  const saveResource = async () => {
    if (!resForm.name.trim()) { toast.error("Please enter a name"); return }
    if (resourceDialog.mode === "add") {
      const nr: Resource = { id: `r${Date.now()}`, name: resForm.name.trim(), role: resForm.role.trim(), color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] }
      const ok = await apiSaveResource(nr)
      if (ok) { setResources(prev => [...prev, nr]); toast.success("Staff added") }
      else toast.error("Failed to save staff")
    } else {
      const updated: Resource = { ...resourceDialog.resource!, ...resForm, name: resForm.name.trim(), role: resForm.role.trim() }
      const ok = await apiSaveResource(updated)
      if (ok) {
        setResources(prev => prev.map(r => r.id === updated.id ? updated : r))
        toast.success("Staff updated")
      } else toast.error("Failed to update staff")
    }
    setResourceDialog({ open: false, mode: "add" })
  }

  const deleteResource = async (id: string) => {
    const ok = await apiDeleteResource(id)
    if (ok) {
      setResources(prev => prev.filter(r => r.id !== id))
      setShifts(prev => prev.filter(s => s.resourceId !== id))
      toast.success("Staff removed")
    } else toast.error("Failed to delete staff")
  }

  // ── Bulk Actions ──────────────────────────────────────────────────────────

  const toggleShiftSelection = (shiftId: string) => {
    setSelectedShifts(prev => 
      prev.includes(shiftId) 
        ? prev.filter(id => id !== shiftId)
        : [...prev, shiftId]
    )
  }

  const clearSelection = () => setSelectedShifts([])

  // Auto-generate shifts from route cycle for a specific staff member
  const generateCycleShifts = async (staffId: string, staffPatternStart: string, smartDetect = false) => {
    if (!routeCycle.length || !staffId || !genFrom || !genTo) return
    setIsGenerating(true)
    try {
      // Smart detection: continue from last existing shift instead of restarting
      let effectiveCycle = rotateCycle(routeCycle, staffCycleOffset[staffId] ?? "")
      let patternStart   = new Date(staffPatternStart + "T00:00:00")

      if (smartDetect) {
        const ctx = detectCycleContext(staffId, genFrom, shifts, routes, routeCycle)
        if (ctx) {
          effectiveCycle = ctx.effectiveCycle
          patternStart   = new Date(ctx.patternStart + "T00:00:00")
        }
      }

      const cycleLen = effectiveCycle.length
      const fromDate = new Date(genFrom + "T00:00:00")
      const toDate   = new Date(genTo + "T00:00:00")
      const offType  = OFF_SUB_TYPES.find(t => t.id === "off")!

      const batchId = Date.now()
      const newShifts: Shift[] = []
      const cursor = new Date(fromDate)
      let idx = 0

      while (cursor <= toDate) {
        // Use local-time date key (toDateKey) instead of toISOString which returns
        // UTC and gives the WRONG date for UTC+8 timezones (e.g. Malaysia).
        const dateKey  = toDateKey(cursor)
        // Math.round guards against sub-millisecond float drift
        const diffDays = Math.round((cursor.getTime() - patternStart.getTime()) / 86400000)
        const blockIdx = Math.floor(diffDays / 7)
        const dayInBlock = diffDays - blockIdx * 7  // 0-6 (0-5 work, 6 off)

        // Skip if already 1 shift on this day for this staff
        const existing = shifts.filter(s => s.resourceId === staffId && s.date === dateKey)
        if (existing.length < 1) {
          if (dayInBlock === 6) {
            // OFF day
            newShifts.push({
              id: `gen${batchId}_${idx}`,
              resourceId: staffId,
              date: dateKey,
              title: offType.label,
              startHour: 0,
              endHour: 24,
              color: offType.color,
            })
          } else {
            // Work day — pick route from cycle (by ID)
            const cyclePos  = ((blockIdx % cycleLen) + cycleLen) % cycleLen
            const routeId   = effectiveCycle[cyclePos] ?? ""
            const routeRef  = routes.find(r => r.id === routeId)
            const routeName = routeRef?.name ?? routeId
            const preset    = getShiftPreset(routeRef?.shift ?? "")
            const color     = routeRef?.color ?? routeEffectiveColorMap.get(routeName) ?? "#3B82F6"
            newShifts.push({
              id: `gen${batchId}_${idx}`,
              resourceId: staffId,
              date: dateKey,
              title: routeName,
              startHour: preset.startHour,
              endHour: preset.endHour,
              color,
            })
          }
          idx++
        }
        cursor.setDate(cursor.getDate() + 1)
      }

      if (newShifts.length === 0) { toast.success("Tiada shift baru untuk dijana."); return }
      const results = await Promise.all(newShifts.map(s => apiSaveShift(s)))
      const saved = newShifts.filter((_, i) => results[i])
      if (saved.length > 0) {
        setShifts(prev => [...prev, ...saved])
        toast.success(`${saved.length} shift dijana untuk ${resources.find(r => r.id === staffId)?.name ?? staffId}`)
      } else toast.error("Gagal simpan shift")
    } finally {
      setIsGenerating(false)
    }
  }

  const bulkChangeStaff = async (newResourceId: string) => {
    const selectedShiftObjects = shifts.filter(s => selectedShifts.includes(s.id))
    
    // Check if any target dates already have 2 shifts for the new staff
    const conflicts = selectedShiftObjects.filter(shift => {
      const existingShifts = shifts.filter(s => 
        s.resourceId === newResourceId && 
        s.date === shift.date &&
        !selectedShifts.includes(s.id) // Don't count shifts being moved
      )
      return existingShifts.length >= 1
    })
    
    if (conflicts.length > 0) {
      toast.error(`Tidak boleh alih: ${conflicts[0].date} sudah ada shift`)
      return
    }

    const results = await Promise.all(
      selectedShiftObjects.map(shift => 
        apiSaveShift({ ...shift, resourceId: newResourceId })
      )
    )
    if (results.every(Boolean)) {
      setShifts(prev => prev.map(s => 
        selectedShifts.includes(s.id) 
          ? { ...s, resourceId: newResourceId }
          : s
      ))
      toast.success(`${selectedShifts.length} shift${selectedShifts.length > 1 ? 's' : ''} moved to ${resources.find(r => r.id === newResourceId)?.name}`)
      clearSelection()
    } else {
      toast.error("Failed to update some shifts")
    }
  }

  const bulkDeleteShifts = async () => {
    const results = await Promise.all(
      selectedShifts.map(id => apiDeleteShift(id))
    )
    if (results.every(Boolean)) {
      setShifts(prev => prev.filter(s => !selectedShifts.includes(s.id)))
      toast.success(`${selectedShifts.length} shift${selectedShifts.length > 1 ? 's' : ''} deleted`)
      clearSelection()
    } else {
      toast.error("Failed to delete some shifts")
    }
  }

  const deleteShiftsByDateRange = async (dateFrom: string, dateTo: string, staffId: string) => {
    const from = new Date(dateFrom)
    const to   = new Date(dateTo)
    const toDelete = shifts.filter(s => {
      const d = new Date(s.date)
      const inRange = d >= from && d <= to
      const matchesStaff = staffId ? s.resourceId === staffId : true
      return inRange && matchesStaff
    })
    if (toDelete.length === 0) { toast("No shifts found in this period."); return }
    const results = await Promise.all(toDelete.map(s => apiDeleteShift(s.id)))
    if (results.every(Boolean)) {
      setShifts(prev => prev.filter(s => !toDelete.find(d => d.id === s.id)))
      toast.success(`${toDelete.length} shift(s) deleted (${dateFrom} – ${dateTo})`)
    } else {
      toast.error("Failed to delete some shifts")
    }
  }

  // ── Row reorder (arrow buttons) ───────────────────────────────────────────

  const moveResource = useCallback((id: string, dir: -1 | 1) => {
    setResourceOrder(prev => {
      const ids = prev.length > 0 ? [...prev] : orderedResources.map(r => r.id)
      const idx = ids.indexOf(id)
      if (idx === -1) return prev
      const next = idx + dir
      if (next < 0 || next >= ids.length) return prev
      const arr = [...ids]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }, [orderedResources])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <LoadingState
          message="Loading rooster…"
          description="Fetching schedule and resource assignments."
          className="max-w-md"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Page heading ────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 lg:px-6 pt-4 sm:pt-5 pb-2 shrink-0">
        <div className="mb-2 flex items-center gap-2.5 sm:gap-3">
          <Users className="size-3.5 text-primary" />
          <h1 className="text-[13px] font-semibold tracking-tight text-foreground">Rooster</h1>
        </div>
        <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground/90 sm:ml-7">Staff scheduling &amp; shift overview</p>
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 sm:px-5 lg:px-6 py-3 border-b border-border shrink-0 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => navigate(-1)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            onClick={goToday}
            className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg transition-colors ${
              (viewMode === "month"
                ? currentDate.getFullYear() === today.getFullYear() && currentDate.getMonth() === today.getMonth()
                : isSameDay(weekDates[0], getWeekDates(today)[0]))
                ? "text-muted-foreground/40 cursor-default"
                : "text-foreground hover:text-primary"
            }`}
          >
            Today
          </button>
          <button onClick={() => navigate(1)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <h2 className="text-[13px] font-bold flex-1 truncate">{headerLabel}</h2>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => { if (viewModeTransition === "idle") setViewModeTransition("out") }}
            disabled={viewModeTransition !== "idle"}
            className={`h-7 px-3 text-xs font-semibold rounded-lg border border-border bg-card transition-colors shrink-0 ${viewModeTransition !== "idle" ? "opacity-60 cursor-not-allowed" : "hover:bg-muted"}`}
          >
            {viewMode === "month" ? "Month" : "Week"}
          </button>

          {isEditMode && (
            <button
              onClick={() => { setManageOpen(true); setManageTab("staff") }}
              className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold transition-colors shrink-0"
            >
              <Settings2 className="size-3" />Manage
            </button>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-5 lg:px-6 py-3 border-b border-border/70 bg-background/70">
        <div className="flex items-center gap-2">
          {/* ── Search bar ── */}
          <div className="relative flex-1 max-w-2xl group">
            <Search className={`absolute left-3 top-1/2 size-3.5 -translate-y-1/2 transition-colors ${historyQuery.trim() ? "text-primary" : "text-muted-foreground/50 group-focus-within:text-primary/70"}`} />
            <Input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search staff, route, code, date…"
              className="h-8 pl-9 pr-24 text-xs rounded-lg border-border/60 bg-muted/40 placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:bg-background transition-colors"
            />
            {/* result count badge */}
            {historyQuery.trim() && (
              <span className="absolute right-[72px] top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground/70 tabular-nums select-none">
                {historyResults.length}{historyResults.length === 30 ? "+" : ""}
              </span>
            )}
            {/* clear button */}
            {historyQuery.trim() && (
              <button
                type="button"
                onClick={() => setHistoryQuery("")}
                className="absolute right-10 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* date picker */}
            <label
              title="Pilih tarikh"
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <input
                type="date"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.value) setHistoryQuery(e.target.value)
                  e.target.value = ""
                }}
              />
            </label>
          </div>

          {isEditMode && (
            <button
              onClick={() => {
                const today = new Date().toISOString().split("T")[0]
                setDeleteDateDialog({ open: true, dateFrom: today, dateTo: today, staffId: "" })
              }}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 text-destructive text-[11px] font-semibold transition-colors shrink-0"
              title="Delete shifts by date"
            >
              <Trash2 className="size-3" />Delete
            </button>
          )}

          {isEditMode && selectedShifts.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold transition-colors shrink-0">
                  <Settings2 className="size-3" />
                  Action ({selectedShifts.length})
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setChangeStaffDialog({ open: true })}>
                  <Users className="size-4 mr-2" />
                  Change Staff
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteConfirmDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  Delete Shifts
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

        </div>

        {historyQuery.trim() && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-card shadow-md shadow-black/[0.06]">
            {/* header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/30">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Search results
              </span>
              {historyResults.length > 0 && (
                <span className="text-[10px] font-semibold text-primary/80 tabular-nums">
                  {historyResults.length}{historyResults.length === 30 ? "+" : ""} results
                </span>
              )}
            </div>
            {/* body */}
            <div className="max-h-52 overflow-auto">
              {historyResults.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                  <Search className="size-4 text-muted-foreground/30" />
                  <p className="text-[11px] text-muted-foreground/60">No records found</p>
                </div>
              ) : (
                historyResults.map((shift) => {
                  const resource = resourceById.get(shift.resourceId)
                  const route = routeByName.get(shift.title)
                  const shiftColor = routeEffectiveColorMap.get(shift.title) ?? shift.color
                  const initials = (resource?.name ?? "?")
                    .split(" ")
                    .map((w: string) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                  return (
                    <button
                      key={shift.id}
                      type="button"
                      className="flex w-full items-center gap-3 border-b border-border/40 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/40 transition-colors group/row"
                      onClick={() => { setCurrentDate(new Date(`${shift.date}T12:00:00`)); setHistoryQuery("") }}
                    >
                      {/* color stripe */}
                      <div className="shrink-0 w-1 self-stretch rounded-full opacity-90" style={{ backgroundColor: shiftColor }} />
                      {/* staff initials */}
                      <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: shiftColor }}>
                        {initials}
                      </div>
                      {/* info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-foreground leading-tight">{shift.title}</p>
                        <p className="truncate text-[10px] text-muted-foreground leading-tight mt-0.5">
                          {resource?.name ?? "Unknown"}
                          {route?.code ? <span className="text-muted-foreground/60"> · {route.code}</span> : null}
                          {route?.shift ? <span className="text-muted-foreground/60"> · {route.shift}</span> : null}
                        </p>
                      </div>
                      {/* date + time */}
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-semibold text-foreground tabular-nums">{shift.date}</p>
                        <p className="text-[10px] text-muted-foreground/70 tabular-nums">{formatHour(shift.startHour)}–{formatHour(shift.endHour)}</p>
                      </div>
                      {/* jump arrow */}
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30 group-hover/row:text-primary/60 transition-colors" />
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-auto transition-all duration-200 ease-out ${viewModeTransition === "out" ? "opacity-0 scale-[0.98]" : "opacity-100 scale-100"}`}>
        {resources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 h-full text-muted-foreground py-20">
            <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
              <Users className="size-7 opacity-30" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">No staff yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add staff to start building the roster</p>
            </div>
            {isEditMode && (
              <button
                onClick={openAddResource}
                className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Plus className="size-3.5" />Add Staff
              </button>
            )}
          </div>
        ) : (
          <table className="border-collapse text-center w-full" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: `${staffColWidth}px`, minWidth: `${staffColWidth}px` }} />
              {colDates.map(d => (
                <col key={toDateKey(d)} style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 border-b border-border px-1.5 py-1.5 text-center bg-background" style={{ width: `${staffColWidth}px`, minWidth: `${staffColWidth}px`, boxShadow: '2px 0 0 0 hsl(var(--border))' }}>
                  <span className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-widest text-foreground/80">
                    <Users className="size-3" />Staff
                  </span>
                </th>
                {colDates.map(date => {
                  const isToday = isSameDay(date, today)
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6
                  return (
                    <th
                      key={toDateKey(date)}
                      className={`sticky top-0 z-20 border-b border-r border-border px-1 py-1.5 text-center font-normal ${
                        isToday ? "bg-primary/20 dark:bg-primary/15" : "bg-card"
                      }`}
                      style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` }}
                    >
                      <div className={`text-[8px] font-bold uppercase tracking-widest mb-1 ${
                        isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-muted-foreground"
                      }`}>
                        {DAYS_SHORT[date.getDay()]}
                      </div>
                      <div className={`text-[10px] font-bold ${
                        isToday ? "text-primary" : isWeekend ? "text-red-500" : "text-foreground/80"
                      }`}>
                        {date.getDate()}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {orderedResources.map((resource, ri) => {
                const rowShifts = shifts.filter(s => s.resourceId === resource.id)
                return (
                  <tr
                    key={resource.id}
                    className={ri % 2 !== 0 ? "bg-muted/[0.025]" : ""}
                  >

                    {/* ── Staff cell ── */}
                    <td className="sticky left-0 z-10 border-b border-border p-1.5 align-top bg-background" style={{ boxShadow: '2px 0 0 0 hsl(var(--border))' }}>
                      <div className="flex flex-col items-center text-center">
                        <p className="text-[11px] font-semibold text-foreground leading-tight whitespace-nowrap">{resource.name}</p>
                        {resource.role && (
                          <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 whitespace-nowrap">{resource.role}</p>
                        )}
                      </div>
                      {isEditMode && (
                        <div className="flex items-center justify-center gap-0.5 mt-2">
                          <button
                            onClick={e => { e.stopPropagation(); moveResource(resource.id, -1) }}
                            disabled={ri === 0}
                            className="h-5 w-5 flex items-center justify-center rounded border-0 bg-transparent text-muted-foreground/50 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move up"
                          >
                            <ChevronUp className="size-3" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); moveResource(resource.id, 1) }}
                            disabled={ri === orderedResources.length - 1}
                            className="h-5 w-5 flex items-center justify-center rounded border-0 bg-transparent text-muted-foreground/50 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move down"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); openEditResource(resource) }}
                            className="h-5 px-1 flex items-center gap-0.5 rounded border-0 bg-transparent text-[9px] font-medium text-red-600 hover:text-red-700 transition-colors"
                          >
                            <Pencil className="size-2.5" />Edit
                          </button>
                        </div>
                      )}
                    </td>

                    {/* ── Day cells — merged when consecutive days share the same shift pattern ── */}
                    {(() => {
                      const mkBlock = (shift: Shift) => (
                        <ShiftBlock
                          key={shift.id}
                          shift={shift}
                          shiftType={routes.find(r => r.name === shift.title)?.shift ?? ""}
                          routeColor={routeEffectiveColorMap.get(shift.title)}
                          isEditMode={isEditMode}
                          onEdit={() => openEditShift(shift)}
                          isSelected={selectedShifts.includes(shift.id)}
                          onToggleSelect={() => toggleShiftSelection(shift.id)}
                        />
                      )

                      type DayInfo = {
                        date: Date; dateKey: string
                        amShift?: Shift; pmShift?: Shift; offShift?: Shift
                        isToday: boolean; pattern: string
                      }
                      const dayInfos: DayInfo[] = colDates.map(date => {
                        const dateKey  = toDateKey(date)
                        const dayShifts = rowShifts.filter(s => s.date === dateKey)
                        const amShift  = dayShifts.find(s => getShiftSlot(s, routes) === "am")
                        const pmShift  = dayShifts.find(s => getShiftSlot(s, routes) === "pm")
                        const offShift = dayShifts.find(s => getShiftSlot(s, routes) === "off")
                        const isToday  = isSameDay(date, today)
                        const hasShift = !!(amShift || pmShift || offShift)
                        const pattern  = hasShift
                          ? `${amShift?.title ?? ""}|${pmShift?.title ?? ""}|${offShift?.title ?? ""}`
                          : `__empty__${dateKey}`          // empty days never merge
                        return { date, dateKey, amShift, pmShift, offShift, isToday, pattern }
                      })

                      // Edit mode — each day is its own clickable cell, no merging
                      if (isEditMode) {
                        return dayInfos.map(({ dateKey, amShift, pmShift, offShift, isToday }) => (
                          <td
                            key={dateKey}
                            className={`border-b border-r border-border align-middle transition-colors cursor-pointer hover:bg-muted/20 ${isToday ? "bg-primary/[0.04]" : ""}`}
                            style={{ width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` }}
                            onClick={() => openAddShift(resource.id, dateKey)}
                          >
                            <div className="flex items-center justify-center gap-0.5 flex-wrap px-0.5 py-1" style={{ minHeight: 32 }}>
                              {amShift && mkBlock(amShift)}
                              {pmShift && mkBlock(pmShift)}
                              {offShift && mkBlock(offShift)}
                            </div>
                          </td>
                        ))
                      }

                      // View mode — group consecutive days with the same non-empty pattern
                      const groups: DayInfo[][] = []
                      for (const info of dayInfos) {
                        const last = groups[groups.length - 1]
                        if (last && last[0].pattern === info.pattern && !info.pattern.startsWith("__empty__")) {
                          last.push(info)
                        } else {
                          groups.push([info])
                        }
                      }

                      return groups.map(group => {
                        const first   = group[0]
                        const colspan = group.length
                        const todayInGroup = group.some(d => d.isToday)
                        return (
                          <td
                            key={first.dateKey}
                            colSpan={colspan > 1 ? colspan : undefined}
                            className={`border-b border-r border-border align-middle transition-colors ${todayInGroup ? "bg-primary/[0.04]" : ""}`}
                            style={colspan === 1 ? { width: `${dayColWidth}px`, minWidth: `${dayColWidth}px` } : undefined}
                          >
                            <div className="flex items-center justify-center gap-0.5 flex-wrap px-0.5 py-1" style={{ minHeight: 30 }}>
                              {first.amShift  && mkBlock(first.amShift)}
                              {first.pmShift  && mkBlock(first.pmShift)}
                              {first.offShift && mkBlock(first.offShift)}
                            </div>
                          </td>
                        )
                      })
                    })()}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Manage Modal ─────────────────────────────────────────────────────── */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Settings2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">Manage</DialogTitle>
            </div>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border px-5">
            {(["staff", "shift", "route"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setManageTab(tab)}
                className={`h-9 px-4 text-xs font-semibold border-b-2 transition-colors ${
                  manageTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "staff"
                  ? <span className="flex items-center gap-1.5"><Users className="size-3" />Staff</span>
                  : tab === "shift"
                  ? <span className="flex items-center gap-1.5"><Clock className="size-3" />Shift</span>
                  : <span className="flex items-center gap-1.5"><CalendarDays className="size-3" />Route</span>}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[65vh]">
            {/* ── Staff Tab ── */}
            {manageTab === "staff" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input placeholder="e.g. Ahmad Faris" value={resForm.name} onChange={e => setResForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Input placeholder="e.g. Driver, Operator" value={resForm.role} onChange={e => setResForm(p => ({ ...p, role: e.target.value }))} />
                </div>
                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={async () => {
                    if (!resForm.name.trim()) { toast.error("Please enter a name"); return }
                    const nr: Resource = { id: `r${Date.now()}`, name: resForm.name.trim(), role: resForm.role.trim(), color: RESOURCE_COLORS[resources.length % RESOURCE_COLORS.length] }
                    const ok = await apiSaveResource(nr)
                    if (ok) {
                      setResources(prev => [...prev, nr])
                      setResForm({ name: "", role: "", color: "" })
                      toast.success("Staff added")
                    } else toast.error("Failed to save staff")
                  }}><Plus className="size-3.5 mr-1" />Add Staff</Button>
                </div>
              </>
            )}

            {/* ── Shift Tab ── */}
            {manageTab === "shift" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["route", "off"] as ShiftTypeId[]).map(tid => (
                      <button
                        key={tid}
                        type="button"
                        onClick={() => {
                          setShiftType(tid)
                          if (tid === "off") {
                            const offDefault = OFF_SUB_TYPES.find(t => t.id === "off")!
                            setOffSubType("off")
                            setManageTimeEnabled(false)
                            setShiftForm(p => ({ ...p, title: offDefault.label, color: offDefault.color }))
                          } else {
                            setShiftForm(p => ({ ...p, title: "", color: "#3B82F6" }))
                          }
                        }}
                        className={`py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                          shiftType === tid
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40"
                        }`}
                      >
                        {tid === "route" ? "Route" : "Off"}
                      </button>
                    ))}
                  </div>
                </div>

                {shiftType === "route" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Route</label>
                    <select
                      value={shiftForm.title}
                      onChange={e => {
                        const selected = routes.find(r => r.name === e.target.value)
                        const preset = getShiftPreset(selected?.shift ?? "")
                        const effectiveColor = selected ? (routeEffectiveColorMap.get(selected.name) ?? "#3B82F6") : shiftForm.color
                        setShiftForm(p => ({ ...p, title: e.target.value, color: effectiveColor, ...preset }))
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        <option value="">-- Select Route --</option>
                      {routes.map(r => (
                        <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ""} — {r.shift}</option>
                      ))}
                    </select>
                  </div>
                )}

                {shiftType === "off" && (
                  <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Subtype</label>
                    <select
                      value={offSubType}
                      onChange={e => {
                        const selected = OFF_SUB_TYPES.find(st => st.id === e.target.value)
                        if (!selected) return
                        setOffSubType(selected.id as OffSubTypeId)
                        setShiftForm(p => ({ ...p, title: selected.label, color: selected.color }))
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {OFF_SUB_TYPES.map(st => (
                        <option key={st.id} value={st.id}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Staff</label>
                  <select value={shiftForm.resourceId} onChange={e => setShiftForm(p => ({ ...p, resourceId: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Start Date</label>
                  <div className="relative w-fit">
                    <input
                      type="date"
                      value={shiftForm.date}
                      onChange={e => {
                        const nextStart = e.target.value
                        setShiftForm(p => ({ ...p, date: nextStart }))
                        const durationNum = Number(shiftDurationDays)
                        if (Number.isFinite(durationNum) && durationNum > 0) {
                          setShiftEndDate(addDaysToDateKey(nextStart, Math.floor(durationNum) - 1))
                        } else if (shiftEndDate < nextStart) {
                          setShiftEndDate(nextStart)
                        }
                      }}
                      className="h-9 rounded-md border border-input bg-background pl-3 pr-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">End Date</label>
                  <div className="flex border border-border rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEndDateMode("date")}
                      className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                        endDateMode === "date"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pick Date
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndDateMode("duration")}
                      className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                        endDateMode === "duration"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Set Duration
                    </button>
                  </div>
                  {endDateMode === "date" ? (
                    <input
                      type="date"
                      value={shiftEndDate}
                      min={shiftForm.date}
                      onChange={e => {
                        const nextEnd = e.target.value
                        setShiftEndDate(nextEnd)
                        setShiftDurationDays(String(getInclusiveDurationDays(shiftForm.date, nextEnd)))
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium">End Date</label>
                        <input
                          type="date"
                          value={shiftEndDate}
                          readOnly
                          className="h-9 rounded-md border border-input bg-muted/50 px-3 text-[11px] md:text-[11px] cursor-not-allowed [color-scheme:light] dark:[color-scheme:dark]"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium">Duration (days)</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={shiftDurationDays}
                          onChange={e => {
                            const next = e.target.value
                            setShiftDurationDays(next)
                            const durationNum = Number(next)
                            if (Number.isFinite(durationNum) && durationNum > 0) {
                              setShiftEndDate(addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1))
                            }
                          }}
                          className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="e.g. 5"
                        />
                      </div>
                    </div>
                  )}
                </div>
                {shiftType === "route" && (
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setManageTimeEnabled(prev => !prev)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                        manageTimeEnabled
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Clock className="size-3.5" />
                      {manageTimeEnabled ? "Hide Time" : "Set Time (Optional)"}
                    </button>
                  </div>
                )}
                {shiftType === "route" && manageTimeEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Start</label>
                      <select value={shiftForm.startHour} onChange={e => setShiftForm(p => ({ ...p, startHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                        {HOUR_OPTIONS.slice(0, 48).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">End</label>
                      <select value={shiftForm.endHour} onChange={e => setShiftForm(p => ({ ...p, endHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                        {HOUR_OPTIONS.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-1">
                  {isManageShiftReady && (
                    <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={async () => {
                      if (!shiftForm.resourceId) { toast.error("Please select staff"); return }
                      if (!shiftForm.date) { toast.error("Please pick a date"); return }
                      const finalTitle = shiftType === "off"
                        ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.label ?? "Off")
                        : shiftForm.title.trim()
                      const finalColor = shiftType === "off"
                        ? (OFF_SUB_TYPES.find(t => t.id === offSubType)?.color ?? "#6B7280")
                        : shiftForm.color
                      if (shiftType === "route" && !finalTitle) { toast.error("Please select a route"); return }
                      if (shiftType === "route" && manageTimeEnabled && shiftForm.endHour <= shiftForm.startHour) { toast.error("End time must be after start time"); return }
                      const durationNum = Number(shiftDurationDays)
                      const resolvedEndDate = Number.isFinite(durationNum) && durationNum > 0
                        ? addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1)
                        : shiftEndDate
                      const dateKeys = getDateKeysInRange(shiftForm.date, resolvedEndDate)
                      const blockedDate = dateKeys.find(dateKey =>
                        shifts.filter(s => s.resourceId === shiftForm.resourceId && s.date === dateKey).length >= 1
                      )
                      if (blockedDate) { toast.error(`Maximum 1 shift per day (${blockedDate})`); return }

                      const batchId = Date.now()
                      const timeEnabled = shiftType === "route" && manageTimeEnabled
                      const newShifts: Shift[] = dateKeys.map((dateKey, idx) => ({
                        id: `s${batchId}_${idx}`,
                        ...shiftForm,
                        date: dateKey,
                        title: finalTitle,
                        color: finalColor,
                        startHour: timeEnabled ? shiftForm.startHour : -1,
                        endHour:   timeEnabled ? shiftForm.endHour   : -1,
                        hasTime: timeEnabled,
                      }))

                      const results = await Promise.all(newShifts.map(s => apiSaveShift(s)))
                      if (results.every(Boolean)) {
                        setShifts(prev => [...prev, ...newShifts])
                        if (shiftType === "route") {
                          setShiftForm(p => ({ ...p, title: "" }))
                        }
                        toast.success(newShifts.length > 1 ? `${newShifts.length} shifts added` : "Shift added")
                      } else toast.error("Failed to save shift")
                    }}><Plus className="size-3.5 mr-1" />Add Shift</Button>
                  )}
                </div>
              </>
            )}

            {/* ── Route Tab ── */}
            {manageTab === "route" && (() => {
              // Show routes in the ACTUAL routeCycle order so the numbering
              // displayed here exactly matches what Auto Generate will produce.
              const cycleList = routeCycle
                .map(id => routes.find(r => r.id === id))
                .filter((r): r is RouteRef => !!r)

              return (
                <div className="flex flex-col gap-3">
                  {/* Route list */}
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      Route cycle order — 6 work days per route, then 1 off day.
                    </p>
                    <div className="rounded-xl border border-border divide-y divide-border/40 overflow-y-auto max-h-40">
                      {cycleList.length === 0 && (
                        <div className="px-4 py-6 text-center text-[11px] text-muted-foreground italic">
                          No routes. Add routes in Route List first.
                        </div>
                      )}
                      {cycleList.map((r, pos) => {
                        const shift = r.shift?.toUpperCase() ?? ""
                        const isAm  = shift === "AM"
                        return (
                          <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                            <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                              {pos + 1}
                            </span>
                            <span className="flex-1 text-[11px] font-medium truncate">{r.name}</span>
                            {shift && (
                              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isAm
                                  ? "bg-blue-500 text-white dark:bg-blue-600"
                                  : "bg-orange-500 text-white dark:bg-orange-600"
                              }`}>{shift}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* ── Auto Shift Generator ── */}
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary shrink-0">
                        <Zap className="size-3.5" />
                      </div>
                      <p className="text-[12px] font-semibold text-foreground">Auto Generate Shifts</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground -mt-1">
                      Pattern 6 work + 1 off, cycling through routes above. Skips dates that already have a shift.
                    </p>

                    {/* Staff */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-foreground">Staff</label>
                      <select
                        value={routeStaffId}
                        onChange={e => setRouteStaffId(e.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">-- Select Staff --</option>
                        {orderedResources.map(r => (
                          <option key={r.id} value={r.id}>{r.name}{r.role ? ` (${r.role})` : ""}</option>
                        ))}
                      </select>
                    </div>

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-foreground">From</label>
                        <input
                          type="date"
                          value={genFrom}
                          onChange={e => {
                            setGenFrom(e.target.value)
                            setGenTo(addDaysToDateKey(e.target.value, 27))
                          }}
                          className="h-8 rounded-md border border-input bg-background px-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-foreground">To</label>
                        <input
                          type="date"
                          value={genTo}
                          min={genFrom}
                          onChange={e => setGenTo(e.target.value)}
                          className="h-8 rounded-md border border-input bg-background px-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                        />
                      </div>
                    </div>

                    <Button
                      size="sm"
                      disabled={!routeStaffId || routes.length === 0 || isGenerating}
                      onClick={() => generateCycleShifts(routeStaffId, genFrom, true)}
                      className="w-full"
                    >
                      {isGenerating
                        ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Generating…</>
                        : <><Zap className="size-3.5 mr-1.5" />Auto Generate (~{getInclusiveDurationDays(genFrom, genTo)} days)</>
                      }
                    </Button>
                  </div>
                </div>
              )
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Shift Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={shiftDialog.open} onOpenChange={o => !o && setShiftDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Clock className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                {shiftDialog.mode === "add" ? "Add Shift" : "Edit Shift"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[60vh]">

            {/* ── Type: Route / Off ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["route", "off"] as ShiftTypeId[]).map(tid => (
                  <button
                    key={tid}
                    type="button"
                    onClick={() => {
                      setShiftType(tid)
                      if (tid === "off") {
                        setOffSubType("off")
                        setDialogTimeEnabled(false)
                        setShiftForm(p => ({ ...p, title: "Off", color: "#6B7280" }))
                      } else {
                        setShiftForm(p => ({ ...p, title: "", color: "#3B82F6" }))
                      }
                    }}
                    className={`py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      shiftType === tid
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    {tid === "route" ? "Route" : "Off"}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Route dropdown grouped by AM/PM ── */}
            {shiftType === "route" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Route</label>
                <select
                  value={shiftForm.title}
                  onChange={e => {
                    const selected = routes.find(r => r.name === e.target.value)
                    if (!selected) {
                      setShiftForm(p => ({ ...p, title: "" }))
                      return
                    }
                    const preset = getShiftPreset(selected.shift ?? "")
                    const effectiveColor = routeEffectiveColorMap.get(selected.name) ?? "#3B82F6"
                    setShiftForm(p => ({ ...p, title: selected.name, color: effectiveColor, ...preset }))
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">-- Select Route --</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.name}>{r.name}{r.code ? ` (${r.code})` : ""} — {r.shift}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Off sub-types ── */}
            {shiftType === "off" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Subtype</label>
                <select
                  value={offSubType}
                  onChange={e => {
                    const selected = OFF_SUB_TYPES.find(st => st.id === e.target.value)
                    if (!selected) return
                    setOffSubType(selected.id as OffSubTypeId)
                    setShiftForm(p => ({ ...p, title: selected.label, color: selected.color }))
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {OFF_SUB_TYPES.map(st => (
                    <option key={st.id} value={st.id}>{st.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Staff ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Staff</label>
              <select value={shiftForm.resourceId} onChange={e => setShiftForm(p => ({ ...p, resourceId: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            {/* ── Date Range ── */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <div className="relative w-fit">
                <input
                  type="date"
                  value={shiftForm.date}
                  onChange={e => {
                    const nextStart = e.target.value
                    setShiftForm(p => ({ ...p, date: nextStart }))
                    const durationNum = Number(shiftDurationDays)
                    if (Number.isFinite(durationNum) && durationNum > 0) {
                      setShiftEndDate(addDaysToDateKey(nextStart, Math.floor(durationNum) - 1))
                    } else if (shiftEndDate < nextStart) {
                      setShiftEndDate(nextStart)
                    }
                  }}
                  className="h-9 rounded-md border border-input bg-background pl-3 pr-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">End Date</label>
              <div className="flex border border-border rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEndDateMode("date")}
                  className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                    endDateMode === "date"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Pick Date
                </button>
                <button
                  type="button"
                  onClick={() => setEndDateMode("duration")}
                  className={`flex-1 h-7 text-[10px] font-medium transition-colors ${
                    endDateMode === "duration"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Set Duration
                </button>
              </div>
              {endDateMode === "date" ? (
                <input
                  type="date"
                  value={shiftEndDate}
                  min={shiftForm.date}
                  onChange={e => {
                    const nextEnd = e.target.value
                    setShiftEndDate(nextEnd)
                    setShiftDurationDays(String(getInclusiveDurationDays(shiftForm.date, nextEnd)))
                  }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">End Date</label>
                    <input
                      type="date"
                      value={shiftEndDate}
                      readOnly
                      className="h-9 rounded-md border border-input bg-muted/50 px-3 text-[11px] md:text-[11px] cursor-not-allowed [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Duration (days)</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={shiftDurationDays}
                      onChange={e => {
                        const next = e.target.value
                        setShiftDurationDays(next)
                        const durationNum = Number(next)
                        if (Number.isFinite(durationNum) && durationNum > 0) {
                          setShiftEndDate(addDaysToDateKey(shiftForm.date, Math.floor(durationNum) - 1))
                        }
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Time — only for Route ── */}
            {shiftType === "route" && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setDialogTimeEnabled(prev => !prev)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                    dialogTimeEnabled
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Clock className="size-3.5" />
                  {dialogTimeEnabled ? "Hide Time" : "Set Time (Optional)"}
                </button>
              </div>
            )}

            {shiftType === "route" && dialogTimeEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Start</label>
                  <select value={shiftForm.startHour} onChange={e => setShiftForm(p => ({ ...p, startHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {HOUR_OPTIONS.slice(0, 48).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">End</label>
                  <select value={shiftForm.endHour} onChange={e => setShiftForm(p => ({ ...p, endHour: Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] md:text-[11px] focus:outline-none focus:ring-2 focus:ring-ring">
                    {HOUR_OPTIONS.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <div>
              {shiftDialog.mode === "edit" && shiftDialog.shift && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteShiftConfirmOpen(true)} className="gap-1.5">
                  <Trash2 className="size-3.5" />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShiftDialog(p => ({ ...p, open: false }))}>Cancel</Button>
              <Button
                size="sm"
                className={shiftDialog.mode === "add" ? "bg-emerald-600 text-white hover:bg-emerald-700" : undefined}
                onClick={saveShift}
              >
                {shiftDialog.mode === "add" ? "Add Shift" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Resource Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={deleteShiftConfirmOpen} onOpenChange={setDeleteShiftConfirmOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Shift
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this shift?
              {shiftDialog.shift && (
                <><br /><strong>{shiftDialog.shift.title}</strong> on <strong>{shiftDialog.shift.date}</strong></>
              )}
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteShiftConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (shiftDialog.shift) {
                  await deleteShift(shiftDialog.shift.id)
                }
                setDeleteShiftConfirmOpen(false)
                setShiftDialog({ open: false, mode: "add" })
              }}
            >
              Delete Shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resourceDialog.open} onOpenChange={o => !o && setResourceDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Users className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                {resourceDialog.mode === "add" ? "Add Staff" : "Edit Staff"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input placeholder="e.g. Ahmad Faris" value={resForm.name} onChange={e => setResForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Role</label>
              <Input placeholder="e.g. Driver, Operator" value={resForm.role} onChange={e => setResForm(p => ({ ...p, role: e.target.value }))} />
            </div>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <div>
              {resourceDialog.mode === "edit" && resourceDialog.resource && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteStaffConfirmDialog({ open: true, resourceId: resourceDialog.resource!.id, resourceName: resourceDialog.resource!.name })} className="gap-1.5">
                  <Trash2 className="size-3.5" />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setResourceDialog(p => ({ ...p, open: false }))}>Cancel</Button>
              <Button size="sm" onClick={saveResource}>{resourceDialog.mode === "add" ? "Add" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Change Staff Dialog ───────────────────────────────────────────────── */}
      <Dialog open={changeStaffDialog.open} onOpenChange={o => !o && setChangeStaffDialog({ open: false })}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-primary/10 rounded-lg text-primary">
                <Users className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Change Staff
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Move {selectedShifts.length} selected shift{selectedShifts.length > 1 ? 's' : ''} to another staff member.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Select Staff</label>
              <select
                value={changeStaffDialog.selectedResourceId || ""}
                onChange={e => setChangeStaffDialog(prev => ({ ...prev, selectedResourceId: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">-- Select Staff --</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                ))}
              </select>
            </div>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setChangeStaffDialog({ open: false })}>
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={async () => {
                if (!changeStaffDialog.selectedResourceId) {
                  toast.error("Please select a staff member")
                  return
                }
                await bulkChangeStaff(changeStaffDialog.selectedResourceId)
                setChangeStaffDialog({ open: false })
              }}
            >
              Change Staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ────────────────────────────────────────── */}
      <Dialog open={deleteConfirmDialog} onOpenChange={setDeleteConfirmDialog}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Events
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete {selectedShifts.length} selected shift{selectedShifts.length > 1 ? 's' : ''}? 
              This action cannot be undone.
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={async () => {
                await bulkDeleteShifts()
                setDeleteConfirmDialog(false)
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Staff Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={deleteStaffConfirmDialog.open} onOpenChange={o => !o && setDeleteStaffConfirmDialog({ open: false })}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Delete Staff
              </DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deleteStaffConfirmDialog.resourceName}</strong>? 
              This will also remove all their assigned shifts. This action cannot be undone.
            </p>
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteStaffConfirmDialog({ open: false })}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={async () => {
                if (deleteStaffConfirmDialog.resourceId) {
                  await deleteResource(deleteStaffConfirmDialog.resourceId)
                  setDeleteStaffConfirmDialog({ open: false })
                  setResourceDialog({ open: false, mode: "add" })
                }
              }}
            >
              Delete Staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Shifts by Date Dialog ──────────────────────────────────────── */}
      <Dialog open={deleteDateDialog.open} onOpenChange={o => !o && setDeleteDateDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center p-2 bg-red-500/10 rounded-lg text-red-500">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">Delete Shifts by Date</DialogTitle>
            </div>
          </DialogHeader>
          <Separator />
          <div className="px-5 py-4 flex flex-col gap-4">
            <p className="text-[12px] text-muted-foreground">Select a date range. All shifts within this period will be permanently deleted.</p>
            <div className="flex flex-col gap-3">
              {/* Staff filter */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">Staff (optional)</label>
                <select
                  value={deleteDateDialog.staffId}
                  onChange={e => setDeleteDateDialog(p => ({ ...p, staffId: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">All Staff</option>
                  {resources.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">From Date</label>
                <input
                  type="date"
                  value={deleteDateDialog.dateFrom}
                  onChange={e => setDeleteDateDialog(p => ({ ...p, dateFrom: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">To Date</label>
                <input
                  type="date"
                  value={deleteDateDialog.dateTo}
                  min={deleteDateDialog.dateFrom}
                  onChange={e => setDeleteDateDialog(p => ({ ...p, dateTo: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            {/* Preview count */}
            {deleteDateDialog.dateFrom && deleteDateDialog.dateTo && (() => {
              const from = new Date(deleteDateDialog.dateFrom)
              const to   = new Date(deleteDateDialog.dateTo)
              const count = shifts.filter(s => {
                const d = new Date(s.date)
                const inRange = d >= from && d <= to
                const matchesStaff = deleteDateDialog.staffId ? s.resourceId === deleteDateDialog.staffId : true
                return inRange && matchesStaff
              }).length
              return (
                <p className={`text-[11px] font-medium ${count > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                  {count > 0 ? `${count} shift(s) will be deleted` : "No shifts found in this period"}
                </p>
              )
            })()}
          </div>
          <Separator />
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteDateDialog(p => ({ ...p, open: false }))}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!deleteDateDialog.dateFrom || !deleteDateDialog.dateTo || deleteDateDialog.dateTo < deleteDateDialog.dateFrom}
              onClick={async () => {
                await deleteShiftsByDateRange(deleteDateDialog.dateFrom, deleteDateDialog.dateTo, deleteDateDialog.staffId)
                setDeleteDateDialog(p => ({ ...p, open: false }))
              }}
            >
              <Trash2 className="size-3.5 mr-1.5" />Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// ─── SHIFT BLOCK ──────────────────────────────────────────────────────────────

/** Strip trailing shift suffix e.g. "KL 6 - Pm" → "KL 6", "KL 6 - Am" → "KL 6" */
function stripShiftSuffix(title: string): string {
  return title
    .replace(/\s*[-–]\s*(am|pm)\s*$/i, "")   // strip AM/PM suffix
    .replace(/\s*[-–]\s*/g, " ")              // "KL - 6" → "KL 6"
    .trim()
}

function ShiftBlock({
  shift,
  shiftType,
  routeColor,
  isEditMode,
  onEdit,
  isSelected,
  onToggleSelect,
}: {
  shift: Shift
  shiftType: string
  routeColor?: string
  isEditMode: boolean
  onEdit: () => void
  isSelected?: boolean
  onToggleSelect?: () => void
}) {
  // Use live route colour from Settings palette; fall back to the colour saved on the shift
  const displayColor = routeColor || shift.color
  const startLabel = formatHour(shift.startHour)
  const endLabel = formatHour(shift.endHour)
  const duration = shift.endHour - shift.startHour
  const textColor = getEventTextColor(displayColor)
  const displayTitle = stripShiftSuffix(shift.title)

  return (
    <div
      className={`select-none rounded-[4px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-all overflow-hidden ${
        isEditMode ? "w-full cursor-pointer hover:brightness-95 active:scale-[0.98]" : "cursor-default flex-1"
      }`}
      style={{
        backgroundColor: displayColor,
        borderColor: "rgba(0, 0, 0, 0.16)",
      }}
      onClick={e => { 
        e.stopPropagation(); 
        if (isEditMode) onEdit()
      }}
      title={shift.hasTime !== false ? `${shift.title}${shiftType ? ` — ${shiftType}` : ""}: ${startLabel} – ${endLabel} (${duration}h)` : `${shift.title}${shiftType ? ` — ${shiftType}` : ""}`}
    >
      {isEditMode ? (
        /* Edit mode: checkbox inline left, text truncated beside it */
        <div className="px-1.5 py-1.5 flex items-start gap-1.5 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              onClick={e => e.stopPropagation()}
              className="mt-[1px] shrink-0 w-3.5 h-3.5 rounded border-2 border-white/70 bg-white/90 checked:bg-primary checked:border-primary hover:border-white focus:outline-none focus:ring-1 focus:ring-white/60 cursor-pointer"
            />
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="truncate text-[10px] font-semibold leading-tight tracking-[0.01em]" style={{ color: textColor }}>
              {shift.title}{shiftType ? ` — ${shiftType}` : ""}
            </div>
            {shift.hasTime !== false && (
              <div className="truncate text-[9px] leading-tight mt-0.5" style={{ color: textColor, opacity: 0.88 }}>
                {startLabel} – {endLabel}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* View mode: compact pill — stripped title only */
        <div className="px-1.5 py-[3px] flex items-center justify-center min-w-0">
          <div className="truncate text-[9px] font-semibold leading-tight tracking-[0.01em]" style={{ color: textColor }}>
            {displayTitle}
          </div>
        </div>
      )}
    </div>
  )
}

/** Returns which slot a shift belongs to: "am" | "pm" | "off" */
function getShiftSlot(shift: Shift, routes: RouteRef[]): "am" | "pm" | "off" {
  if (OFF_LABELS.has(shift.title)) return "off"
  const ref = routes.find(r => r.name === shift.title)
  return ref?.shift?.toUpperCase() === "PM" ? "pm" : "am"
}

function getEventTextColor(color: string): string {
  const normalized = color.trim().replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#FFFFFF"

  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

  return luminance > 0.62 ? "#111827" : "#FFFFFF"
}

export default Rooster
