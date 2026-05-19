import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useRoadDistances } from "@/hooks/use-road-distances"
import { useRegisterRefresh } from "@/contexts/RefreshContext"
import { ClipboardList, List, Info, Plus, Check, X, Edit2, Trash2, Search, Save, ArrowUp, ArrowDown, Truck, Loader2, Cog, CheckCircle2, MapPin, Route, AlertCircle, History, MapPinned, TableProperties, Shrink, Expand, ChevronUp, ChevronDown, ChevronsUpDown, Filter, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { RowInfoModal } from "./RowInfoModal"
import { DeliveryMap } from "@/components/DeliveryMap"
import { LoadingState } from "@/components/ui/loading"
import { useEditMode } from "@/contexts/EditModeContext"
import { getRouteColorPalette } from "@/lib/route-colors"
import { parseSmartQuery } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface RouteChangelog {
  id: string
  text: string
  created_at: string
}

const normalizeChangelogEntries = (value: unknown): RouteChangelog[] => {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      if (!text) return null

      const createdAtRaw = typeof record.created_at === 'string' ? record.created_at : ''
      const createdAtMs = Date.parse(createdAtRaw)
      const created_at = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : new Date(0).toISOString()
      const id = typeof record.id === 'string' && record.id.trim() !== ''
        ? record.id
        : `log-${index}-${created_at}`

      return { id, text, created_at }
    })
    .filter((entry): entry is RouteChangelog => Boolean(entry))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
}

async function appendChangelog(routeId: string, description: string): Promise<void> {
  try {
    await fetch('/api/route-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        routeId,
        type: 'changelog',
        text: description,
      }),
    })
  } catch {
    // silently fail
  }
}

const formatRowCode = (code: string) => `[ ${code} ]`

const formatRouteLabel = (routeName?: string | null) => {
  const normalized = typeof routeName === 'string' ? routeName.trim() : ''
  if (!normalized) return 'Route'
  return /^route\b/i.test(normalized) ? normalized : `Route ${normalized}`
}

const sortByCode = <T extends { code: string }>(items: T[]): T[] => (
  [...items].sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: "base" }))
)

const normalizeDescriptions = (descriptions?: { key: string; value: string }[]) => (
  (descriptions ?? [])
    .filter(item => item.key.trim() !== "")
    .map(item => ({ key: item.key.trim(), value: item.value.trim() }))
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { sensitivity: "base" }))
)

const getPointImageUrls = (point: DeliveryPoint): string[] => {
  const avatarUrls = point.avatarImages?.length
    ? point.avatarImages
    : point.avatarImageUrl
      ? [point.avatarImageUrl]
      : []

  const urls = [...avatarUrls, point.qrCodeImageUrl].filter((url): url is string => Boolean(url))
  return urls.filter((url, index) => urls.indexOf(url) === index)
}

const getPointImageCount = (point: DeliveryPoint) => getPointImageUrls(point).length

interface DeliveryPoint {
  code: string
  name: string
  delivery: string
  latitude: number
  longitude: number
  descriptions: { key: string; value: string }[]
  markerColor?: string
  qrCodeImageUrl?: string
  qrCodeDestinationUrl?: string
  avatarImageUrl?: string
  avatarImages?: string[]
}

interface Route {
  id: string
  name: string
  code: string
  shift: string
  color?: string
  deliveryPoints: DeliveryPoint[]
  labels?: string[]
  updatedAt?: string
}

interface RouteListProps {
  variant?: 'route-list' | 'playground'
}

interface RouteListHeaderItem {
  id: string
  term: string
  definition: string
}

interface ExistingLocationOption {
  code: string
  name: string
  delivery: string
  latitude: number
  longitude: number
  routeName: string
}

type EditableField = 'code' | 'name' | 'latitude' | 'longitude'
type RouteRegionFilter = 'all' | 'KL' | 'Sel'
type RouteShiftFilter = 'all' | 'AM' | 'PM'
type RouteCombinedFilter =
  | 'all'
  | 'region:KL'
  | 'region:Sel'
  | 'shift:AM'
  | 'shift:PM'
  | 'combo:KL:AM'
  | 'combo:KL:PM'
  | 'combo:Sel:AM'
  | 'combo:Sel:PM'

function toRouteCombinedFilter(region: RouteRegionFilter, shift: RouteShiftFilter): RouteCombinedFilter {
  if (region === 'all' && shift === 'all') return 'all'
  if (region !== 'all' && shift === 'all') return region === 'KL' ? 'region:KL' : 'region:Sel'
  if (region === 'all' && shift !== 'all') return shift === 'AM' ? 'shift:AM' : 'shift:PM'
  if (region === 'KL' && shift === 'AM') return 'combo:KL:AM'
  if (region === 'KL' && shift === 'PM') return 'combo:KL:PM'
  if (region === 'Sel' && shift === 'AM') return 'combo:Sel:AM'
  return 'combo:Sel:PM'
}

function parseRouteCombinedFilter(value: RouteCombinedFilter): { region: RouteRegionFilter; shift: RouteShiftFilter } {
  switch (value) {
    case 'region:KL':
      return { region: 'KL', shift: 'all' }
    case 'region:Sel':
      return { region: 'Sel', shift: 'all' }
    case 'shift:AM':
      return { region: 'all', shift: 'AM' }
    case 'shift:PM':
      return { region: 'all', shift: 'PM' }
    case 'combo:KL:AM':
      return { region: 'KL', shift: 'AM' }
    case 'combo:KL:PM':
      return { region: 'KL', shift: 'PM' }
    case 'combo:Sel:AM':
      return { region: 'Sel', shift: 'AM' }
    case 'combo:Sel:PM':
      return { region: 'Sel', shift: 'PM' }
    default:
      return { region: 'all', shift: 'all' }
  }
}

// Returns true if the delivery point is active on the given date
function isDeliveryActive(delivery: string, date: Date = new Date()): boolean {
  const dayOfWeek = date.getDay()   // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  // Epoch day: stable across month/year boundaries (use local noon to avoid DST issues)
  const localNoon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)
  const epochDay  = Math.floor(localNoon.getTime() / 86400000)
  switch (delivery) {
    case 'Daily':     return true
    case 'Alt 1':     return epochDay % 2 !== 0                         // truly alternating day 1
    case 'Alt 2':     return epochDay % 2 === 0                         // truly alternating day 2
    case 'Weekday':   return dayOfWeek >= 0 && dayOfWeek <= 4           // Sun–Thu
    case 'Weekday 2': return dayOfWeek >= 1 && dayOfWeek <= 5           // Mon–Fri
    case 'Weekday 3': return [0, 2, 4].includes(dayOfWeek)             // Sun, Tue, Thu
    default:          return true
  }
}

// ── Distance helpers ──────────────────────────────────────────────
const DEFAULT_MAP_CENTER = { lat: 3.0695500, lng: 101.5469179 }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} Km`
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function arePointsEqual(left: { lat: number; lng: number }, right: { lat: number; lng: number }): boolean {
  return left.lat === right.lat && left.lng === right.lng
}

function formatCoordinateInput(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : ''
}

const DEFAULT_ROUTES: Route[] = [
  {
    id: "route-1",
    name: "Route KL 7",
    code: "3PVK04",
    shift: "PM",
    deliveryPoints: [
      {
        code: "32",
        name: "KPJ Klang",
        delivery: "Daily",
        latitude: 3.0333,
        longitude: 101.4500,
        descriptions: [
          { key: "Bank", value: "CIMB" },
          { key: "Fuel", value: "Petrol" }
        ]
      },
      {
        code: "45",
        name: "Sunway Medical Centre",
        delivery: "Weekday",
        latitude: 3.0738,
        longitude: 101.6057,
        descriptions: []
      },
      {
        code: "78",
        name: "Gleneagles KL",
        delivery: "Alt 1",
        latitude: 3.1493,
        longitude: 101.7055,
        descriptions: [
          { key: "Contact", value: "03-42571300" }
        ]
      },
    ]
  },
  {
    id: "route-2",
    name: "Route KL 3",
    code: "3PVK08",
    shift: "AM",
    deliveryPoints: [
      {
        code: "11",
        name: "Hospital Kuala Lumpur",
        delivery: "Daily",
        latitude: 3.1691,
        longitude: 101.6974,
        descriptions: []
      },
      {
        code: "22",
        name: "Pantai Hospital KL",
        delivery: "Alt 2",
        latitude: 3.1102,
        longitude: 101.6629,
        descriptions: []
      },
    ]
  },
  {
    id: "route-3",
    name: "Route Sel 1",
    code: "3PVS02",
    shift: "AM",
    deliveryPoints: [
      {
        code: "51",
        name: "Hospital Shah Alam",
        delivery: "Daily",
        latitude: 3.0733,
        longitude: 101.5185,
        descriptions: []
      },
      {
        code: "52",
        name: "KPJ Shah Alam",
        delivery: "Weekday",
        latitude: 3.0888,
        longitude: 101.5326,
        descriptions: []
      },
    ]
  },
  {
    id: "route-4",
    name: "Route Sel 4",
    code: "3PVS09",
    shift: "PM",
    deliveryPoints: [
      {
        code: "61",
        name: "Hospital Klang",
        delivery: "Daily",
        latitude: 3.0449,
        longitude: 101.4456,
        descriptions: []
      },
    ]
  },
  {
    id: "route-5",
    name: "Route KL 11",
    code: "3PVK15",
    shift: "PM",
    deliveryPoints: [
      {
        code: "91",
        name: "Damansara Specialist",
        delivery: "Alt 1",
        latitude: 3.1500,
        longitude: 101.6200,
        descriptions: []
      },
    ]
  },
]

// ── Delivery type definitions ─────────────────────────────────────────────────
const DELIVERY_ITEMS = [
  { value: 'Daily',     label: 'Daily',     description: 'Delivery every day',          bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', dot: '#10b981' },
  { value: 'Alt 1',    label: 'Alt 1',     description: 'Odd dates (1, 3, 5…)',         bg: 'bg-violet-100 dark:bg-violet-900/40',  text: 'text-violet-700 dark:text-violet-300',  dot: '#8b5cf6' },
  { value: 'Alt 2',    label: 'Alt 2',     description: 'Even dates (2, 4, 6…)',        bg: 'bg-fuchsia-100 dark:bg-fuchsia-900/40',text: 'text-fuchsia-700 dark:text-fuchsia-300',dot: '#d946ef' },
  { value: 'Weekday',   label: 'Weekday',   description: 'Sun – Thu',                    bg: 'bg-sky-100 dark:bg-sky-900/40',        text: 'text-sky-700 dark:text-sky-300',        dot: '#0ea5e9' },
  { value: 'Weekday 2', label: 'Weekday',   description: 'Mon – Fri',                    bg: 'bg-blue-100 dark:bg-blue-900/40',      text: 'text-blue-700 dark:text-blue-300',      dot: '#3b82f6' },
  { value: 'Weekday 3', label: 'WA',        description: 'Sun, Tue & Thu',               bg: 'bg-indigo-100 dark:bg-indigo-900/40',  text: 'text-indigo-700 dark:text-indigo-300',  dot: '#6366f1' },
] as const
const DELIVERY_MAP = new Map<string, typeof DELIVERY_ITEMS[number]>(DELIVERY_ITEMS.map(d => [d.value, d]))
const getDeliveryLabel = (value: string) => DELIVERY_MAP.get(value)?.label ?? value
const AUTO_DELIVERY_LABELS = DELIVERY_ITEMS.map(d => d.value)
const AUTO_DELIVERY_LABEL_SET = new Set<string>(AUTO_DELIVERY_LABELS)

const toCustomLabels = (labels?: string[]) => {
  if (!labels) return []
  return labels.filter(lbl => !AUTO_DELIVERY_LABEL_SET.has(lbl))
}

const getAutoDeliveryLabelsFromRoute = (route: Route): string[] => {
  const labels = getRouteDeliveryPoints(route)
    .map(point => point.delivery)
    .filter((label, idx, arr) => arr.indexOf(label) === idx)
    .filter(label => AUTO_DELIVERY_LABEL_SET.has(label))
  return labels.length > 0 ? labels : AUTO_DELIVERY_LABELS
}

const getRouteDeliveryPoints = (route?: Route | null): DeliveryPoint[] => (
  Array.isArray(route?.deliveryPoints) ? route.deliveryPoints : []
)

const getAvailableDeliveryLabels = (route?: Route): string[] => {
  if (!route) return AUTO_DELIVERY_LABELS
  const custom = toCustomLabels(route.labels)
  const merged = [...AUTO_DELIVERY_LABELS, ...custom]
  return merged.filter((label, idx) => merged.indexOf(label) === idx)
}

// ── Route card color palette (from Settings → Route Colours, stored in localStorage) ──
const LS_MAP_STYLE = 'fcalendar_map_style'

const getMapStyle = (): 'google-streets' | 'google-satellite' | 'osm' => {
  try {
    const v = localStorage.getItem(LS_MAP_STYLE)
    if (v === 'google-streets' || v === 'google-satellite' || v === 'osm') return v
  } catch {
    /**/
  }
  return 'google-streets'
}

const SINGLE_ROUTE_MARKER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
]

const LS_ROUTE_LIST_HEADER = 'fcalendar_route_list_header'
const LS_PLAYGROUND_ROUTES = 'fcalendar_custom_route_cards'

const DEFAULT_ROUTE_LIST_HEADER_ITEMS: RouteListHeaderItem[] = [
  {
    id: 'header-desc',
    term: 'Description',
    definition: 'A compact summary panel for route list operations.',
  },
  {
    id: 'header-scope',
    term: 'Scope',
    definition: 'Use this page to search, filter, inspect, and update route records.',
  },
  {
    id: 'header-edit',
    term: 'Edit Mode',
    definition: 'Enable Edit Mode to manage this header content and route data together.',
  },
]

const loadRouteListHeaderItems = (): RouteListHeaderItem[] => {
  try {
    const raw = localStorage.getItem(LS_ROUTE_LIST_HEADER)
    if (!raw) return DEFAULT_ROUTE_LIST_HEADER_ITEMS

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_ROUTE_LIST_HEADER_ITEMS

    const normalized = parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const term = typeof item.term === 'string' ? item.term : ''
        const definition = typeof item.definition === 'string' ? item.definition : ''
        if (term.trim() === '' && definition.trim() === '') return null
        const id = typeof item.id === 'string' && item.id.trim() !== ''
          ? item.id
          : `header-item-${index + 1}`
        return { id, term, definition }
      })
      .filter((item): item is RouteListHeaderItem => Boolean(item))

    return normalized.length > 0 ? normalized : DEFAULT_ROUTE_LIST_HEADER_ITEMS
  } catch {
    return DEFAULT_ROUTE_LIST_HEADER_ITEMS
  }
}

const loadPlaygroundRoutes = (): Route[] => {
  try {
    const raw = localStorage.getItem(LS_PLAYGROUND_ROUTES)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const record = item as Record<string, unknown>
        const id = typeof record.id === 'string' && record.id.trim() !== ''
          ? record.id
          : `playground-route-${index + 1}`
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        const code = typeof record.code === 'string' ? record.code.trim() : ''
        const shift = record.shift === 'PM' ? 'PM' : 'AM'
        const color = typeof record.color === 'string' && record.color.trim() !== '' ? record.color : undefined
        const labels = Array.isArray(record.labels)
          ? record.labels.filter((label): label is string => typeof label === 'string' && label.trim() !== '')
          : undefined
        const deliveryPoints = Array.isArray(record.deliveryPoints)
          ? record.deliveryPoints
              .map((point) => {
                if (!point || typeof point !== 'object') return null
                const pointRecord = point as Record<string, unknown>
                const pointCode = typeof pointRecord.code === 'string' ? pointRecord.code.trim() : ''
                const pointName = typeof pointRecord.name === 'string' ? pointRecord.name.trim() : ''
                if (!pointCode || !pointName) return null
                const rawDescriptions = Array.isArray(pointRecord.descriptions) ? pointRecord.descriptions : []
                return {
                  code: pointCode,
                  name: pointName,
                  delivery: typeof pointRecord.delivery === 'string' && pointRecord.delivery.trim() !== '' ? pointRecord.delivery : 'Daily',
                  latitude: Number(pointRecord.latitude) || 0,
                  longitude: Number(pointRecord.longitude) || 0,
                  descriptions: rawDescriptions
                    .map((description) => {
                      if (!description || typeof description !== 'object') return null
                      const descriptionRecord = description as Record<string, unknown>
                      const key = typeof descriptionRecord.key === 'string' ? descriptionRecord.key : ''
                      const value = typeof descriptionRecord.value === 'string' ? descriptionRecord.value : ''
                      return { key, value }
                    })
                    .filter((description): description is { key: string; value: string } => Boolean(description)),
                  markerColor: typeof pointRecord.markerColor === 'string' ? pointRecord.markerColor : undefined,
                  qrCodeImageUrl: typeof pointRecord.qrCodeImageUrl === 'string' ? pointRecord.qrCodeImageUrl : undefined,
                  qrCodeDestinationUrl: typeof pointRecord.qrCodeDestinationUrl === 'string' ? pointRecord.qrCodeDestinationUrl : undefined,
                  avatarImageUrl: typeof pointRecord.avatarImageUrl === 'string' ? pointRecord.avatarImageUrl : undefined,
                  avatarImages: Array.isArray(pointRecord.avatarImages)
                    ? pointRecord.avatarImages.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
                    : undefined,
                } as DeliveryPoint
              })
              .filter((point): point is DeliveryPoint => Boolean(point))
          : []

        if (!name || !code) return null
        return { id, name, code, shift, color, deliveryPoints, labels } as Route
      })
      .filter((route): route is Route => Boolean(route))
  } catch {
    return []
  }
}

export function RouteList({ variant = 'route-list' }: RouteListProps) {
  const isPlaygroundMode = variant === 'playground'
  const duplicateCheckScope: 'global' | 'current' = isPlaygroundMode ? 'current' : 'global'
  const pageTitle = isPlaygroundMode ? 'Custom' : 'Route List'
  const addDialogTitle = isPlaygroundMode ? 'Add Existing Location' : 'Add New Delivery Point'
  const addDialogDescription = isPlaygroundMode
    ? 'Choose a location from existing Location records'
    : 'Enter details for the new delivery location'
  const addRouteCardTitle = isPlaygroundMode ? 'Add Card Route' : 'Add New Route'
  const addRouteCardDescription = isPlaygroundMode ? 'Click to create a card route' : 'Click to create a route'
  const createRouteDialogTitle = isPlaygroundMode ? 'Create Card Route' : 'Create New Route'
  const createRouteDialogDescription = isPlaygroundMode
    ? 'Create a new card route, then add locations from existing Location records'
    : 'Add a new delivery route with details'
  const createRouteButtonLabel = isPlaygroundMode ? 'Create Card Route' : 'Create Route'
  const clearLogText = {
    noEntriesToClear: "No log entries to clear",
    clearAllEntries: "Clear all log entries",
    title: "Clear All Log Entries",
    description: "All log entries for this route will be permanently deleted. This action cannot be undone.",
    cancel: "Cancel",
    clearAll: "Clear All",
  }
  const { isEditMode, setHasUnsavedChanges, registerSaveHandler, registerDiscardHandler } = useEditMode()
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")))
    obs.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  const [routes, setRoutes] = useState<Route[]>(DEFAULT_ROUTES)
  const [playgroundSourceRoutes, setPlaygroundSourceRoutes] = useState<Route[]>([])
  const routesSnapshotRef = useRef<Route[]>([])
  const [routeColorPalette, setRouteColorPalette] = useState<string[]>(getRouteColorPalette)
  const [isLoading, setIsLoading] = useState(true)
  const [currentRouteId, setCurrentRouteId] = useState<string>("route-1")
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<DeliveryPoint | null>(null)
  const [addRouteDialogOpen, setAddRouteDialogOpen] = useState(false)
  const [editRouteDialogOpen, setEditRouteDialogOpen] = useState(false)
  const [deleteRouteConfirmOpen, setDeleteRouteConfirmOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<Route | null>(null)
  const [editRouteErrors, setEditRouteErrors] = useState<{ code?: string; name?: string }>({})
  const [routeToDelete, setRouteToDelete] = useState<Route | null>(null)
  const [newRoute, setNewRoute] = useState({ name: "", code: "", shift: "AM" })
  const [searchQuery, setSearchQuery] = useState("")
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [filterModalTab, setFilterModalTab] = useState<'shift' | 'region'>('shift')
  const [combinedFilter, setCombinedFilter] = useState<RouteCombinedFilter>('all')
  const { region: filterRegion, shift: filterShift } = useMemo(
    () => parseRouteCombinedFilter(combinedFilter),
    [combinedFilter]
  )
  const setRegionFilter = useCallback((nextRegion: RouteRegionFilter) => {
    setCombinedFilter(prev => {
      const { shift } = parseRouteCombinedFilter(prev)
      return toRouteCombinedFilter(nextRegion, shift)
    })
  }, [])
  const setShiftFilter = useCallback((nextShift: RouteShiftFilter) => {
    setCombinedFilter(prev => {
      const { region } = parseRouteCombinedFilter(prev)
      return toRouteCombinedFilter(region, nextShift)
    })
  }, [])
  const [headerItems, setHeaderItems] = useState<RouteListHeaderItem[]>(loadRouteListHeaderItems)
  const headerSnapshotRef = useRef<RouteListHeaderItem[]>([])

  // ── Per-card sliding panel state { info, edit } ───────────────────
  const [cardPanels, setCardPanels] = useState<Record<string, { info: boolean; edit: boolean }>>({})
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null)
  // ── Per-card changelog cache ───────────────────────────────────────
  const [cardChangelogs, setCardChangelogs] = useState<Record<string, { loading: boolean; entries: RouteChangelog[] }>>({})
  const [clearLogConfirm, setClearLogConfirm] = useState<string | null>(null) // routeId
  // ── Per-card edit form state ───────────────────────────────────────
  const [editPanelState, setEditPanelState] = useState<Record<string, { name: string; code: string; shift: string; color: string; labels: string[] }>>({})
  const [editPanelErrors, setEditPanelErrors] = useState<Record<string, { name?: string; code?: string }>>({})
  const getCardPanel = (id: string) => cardPanels[id] ?? { info: false, edit: false }
  const openExclusiveCardPanel = useCallback((routeId: string, panel: 'info' | 'edit') => {
    setCardPanels(prev => {
      const resetPanels: Record<string, { info: boolean; edit: boolean }> = {}
      for (const id of Object.keys(prev)) {
        resetPanels[id] = { info: false, edit: false }
      }
      resetPanels[routeId] = { info: panel === 'info', edit: panel === 'edit' }
      return resetPanels
    })
  }, [])

  const loadCardChangelog = useCallback(async (routeId: string) => {
    setCardChangelogs(prev => {
      const previousEntries = prev[routeId]?.entries ?? []
      return { ...prev, [routeId]: { loading: true, entries: previousEntries } }
    })

    try {
      const response = await fetch(`/api/route-notes?routeId=${encodeURIComponent(routeId)}`)
      const payload = await response.json()
      const entries = payload?.success ? normalizeChangelogEntries(payload.changelog) : []

      setCardChangelogs(prev => ({
        ...prev,
        [routeId]: { loading: false, entries },
      }))
    } catch {
      setCardChangelogs(prev => ({
        ...prev,
        [routeId]: { loading: false, entries: prev[routeId]?.entries ?? [] },
      }))
    }
  }, [])

  // Close edit panels when edit mode turns off
  useEffect(() => {
    if (!isEditMode) {
      setCardPanels(prev => {
        const updated: typeof prev = {}
        for (const id in prev) { updated[id] = { info: prev[id].info, edit: false } }
        return updated
      })
      setEditPanelState({})
      setEditPanelErrors({})
    }
  }, [isEditMode])

  // Sync route colour palette when Settings saves new colours
  useEffect(() => {
    const handler = () => setRouteColorPalette(getRouteColorPalette())
    window.addEventListener('fcalendar_route_colors_changed', handler)
    return () => window.removeEventListener('fcalendar_route_colors_changed', handler)
  }, [])

  // Fetch changelog whenever an info panel opens so data stays fresh.
  useEffect(() => {
    for (const [id, panel] of Object.entries(cardPanels)) {
      if (panel.info) {
        void loadCardChangelog(id)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPanels, loadCardChangelog])

  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [detailFullscreen, setDetailFullscreen] = useState(false)
  const [dialogView, setDialogView] = useState<'table' | 'map'>('table')
  const [detailSearchQuery, setDetailSearchQuery] = useState("")
  // ── Playground: add-location-from-dialog state ─────────────────────
  const [pgAddLocOpen, setPgAddLocOpen] = useState(false)
  const [pgAddLocSearch, setPgAddLocSearch] = useState("")
  const [pgAddLocSelected, setPgAddLocSelected] = useState<Set<string>>(new Set())

  // Responsive card dimensions — measure the actual container so CSS zoom is handled correctly
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardCarouselRef = useRef<HTMLDivElement>(null)
  const [cardContainerWidth, setCardContainerWidth] = useState(0)
  const [cardW, setCardW] = useState(300)
  const [cardH, setCardH] = useState(460)
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0)
  const CAROUSEL_GAP = 20
  useEffect(() => {
    const el = cardContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const containerWidth = entries[0].contentRect.width
      setCardContainerWidth(containerWidth)
      const viewportWidth = window.innerWidth
      const mobileInset = viewportWidth < 640 ? 32 : viewportWidth < 1024 ? 48 : 72
      const columns = viewportWidth >= 1280 ? 3 : viewportWidth >= 900 ? 2 : 1
      const targetWidth = (containerWidth - CAROUSEL_GAP * (columns - 1)) / columns
      const nextCardWidth = Math.min(420, Math.max(280, Math.min(targetWidth, viewportWidth - mobileInset)))
      setCardW(nextCardWidth)
      setCardH(Math.min(580, Math.max(400, window.innerHeight / 1.2 - (viewportWidth < 640 ? 180 : 220))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [CAROUSEL_GAP])


  // Pinned routes stored in localStorage
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("fcalendar_pinned_routes") || "[]").map((r: { id: string }) => r.id)) }
    catch { return new Set() }
  })

  const togglePin = useCallback((route: Route) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(route.id)) {
        next.delete(route.id)
      } else {
        next.add(route.id)
      }
      // Persist full route objects so HomePage can display them
      const allPinned = routes
        .filter(r => next.has(r.id))
        .map(r => ({ id: r.id, name: r.name, code: r.code, shift: r.shift }))
      localStorage.setItem("fcalendar_pinned_routes", JSON.stringify(allPinned))
      window.dispatchEvent(new Event("fcalendar_pins_changed"))
      return next
    })
  }, [routes])

  useEffect(() => {
    const syncPinnedFromStorage = () => {
      try {
        const stored = JSON.parse(localStorage.getItem("fcalendar_pinned_routes") || "[]") as { id?: string }[]
        const ids = new Set(stored.map(item => item.id).filter((id): id is string => Boolean(id)))
        setPinnedIds(ids)
      } catch {
        setPinnedIds(new Set())
      }
    }

    window.addEventListener("fcalendar_pins_changed", syncPinnedFromStorage)
    window.addEventListener("storage", syncPinnedFromStorage)
    return () => {
      window.removeEventListener("fcalendar_pins_changed", syncPinnedFromStorage)
      window.removeEventListener("storage", syncPinnedFromStorage)
    }
  }, [])

  // Fetch routes from database
  const fetchRoutes = useCallback(async (preserveCurrentId?: string) => {
    if (isPlaygroundMode) {
      const storedRoutes = loadPlaygroundRoutes()
      setRoutes(storedRoutes)
      const nextCurrentRouteId = storedRoutes.find((route) => route.id === preserveCurrentId)?.id
        ?? storedRoutes[0]?.id
        ?? ''
      setCurrentRouteId(nextCurrentRouteId)
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch('/api/routes')
      const data = await res.json()
      if (data.success && data.data.length > 0) {
        setRoutes(data.data.map((r: Route) => ({
          ...r,
          color: r.color ?? null,
          deliveryPoints: Array.isArray(r.deliveryPoints) ? r.deliveryPoints : [],
        })))
        // Keep current route if it still exists, else go to first
        const stillExists = preserveCurrentId && data.data.some((r: Route) => r.id === preserveCurrentId)
        setCurrentRouteId(stillExists ? preserveCurrentId! : data.data[0].id)
      }
    } catch {
      /* fallback to default routes */
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isPlaygroundMode) return

    const fetchPlaygroundLocationSources = async () => {
      try {
        const res = await fetch('/api/routes')
        const data = await res.json()
        if (data.success && Array.isArray(data.data)) {
          setPlaygroundSourceRoutes(data.data.map((route: Route) => ({ ...route, color: route.color ?? null })))
        } else {
          setPlaygroundSourceRoutes([])
        }
      } catch {
        setPlaygroundSourceRoutes([])
      }
    }

    fetchPlaygroundLocationSources()
  }, [isPlaygroundMode])

  // Fetch routes from database on mount
  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  // Register pull-to-refresh / refresh button handler
  const fetchRoutesRef = useRef(fetchRoutes)
  useEffect(() => { fetchRoutesRef.current = fetchRoutes }, [fetchRoutes])
  const currentRouteIdRef = useRef(currentRouteId)
  useEffect(() => { currentRouteIdRef.current = currentRouteId }, [currentRouteId])
  useRegisterRefresh(useCallback(async () => {
    await fetchRoutesRef.current(currentRouteIdRef.current)
  }, []))

  // Listen for external open-route events (e.g. from pinned route on home page)
  // Check after routes finish loading so the dialog can find the route
  useEffect(() => {
    if (isLoading) return
    const pending = sessionStorage.getItem('fcalendar_open_route')
    const pendingView = sessionStorage.getItem('fcalendar_open_route_view')
    if (pending) {
      sessionStorage.removeItem('fcalendar_open_route')
      sessionStorage.removeItem('fcalendar_open_route_view')
      setCurrentRouteId(pending)
      setDetailDialogOpen(true)
      setDetailFullscreen(false)
      setDialogView(pendingView === 'map' ? 'map' : 'table')
      setSelectedRows([])
      setCombinedRouteIds(new Set([pending]))
      setShowPolyline(false)
      setMapRefitToken(0)
      setMapResizeToken(0)
    }
  }, [isLoading])


  const currentRoute = routes.find(r => r.id === currentRouteId)
  const deliveryPoints = currentRoute?.deliveryPoints || []

  useEffect(() => {
    if (routes.length === 0) return
    if (routes.some(route => route.id === currentRouteId)) return

    const fallbackRouteId = routes[0].id
    setCurrentRouteId(fallbackRouteId)
    setCombinedRouteIds(new Set([fallbackRouteId]))
  }, [routes, currentRouteId])

  const [combinedRouteIds, setCombinedRouteIds] = useState<Set<string>>(() => new Set([currentRouteId]))

  const routeIndexById = useMemo(() => {
    const indexMap = new Map<string, number>()
    routes.forEach((route, index) => {
      indexMap.set(route.id, index)
    })
    return indexMap
  }, [routes])

  // Combined delivery points for map (all selected routes merged)
  const combinedDeliveryPoints = useMemo(() => {
    const selectedRoutes = routes.filter(r => combinedRouteIds.has(r.id))
    const isCombinedView = selectedRoutes.length > 1
    const result: (DeliveryPoint & { routeLabel?: string; routeId?: string })[] = []

    selectedRoutes.forEach(r => {
      const routeIndex = routeIndexById.get(r.id) ?? 0
      const routeMarkerColor = r.color ?? routeColorPalette[routeIndex % routeColorPalette.length] ?? '#6b7280'

      getRouteDeliveryPoints(r).forEach((p, pointIdx) => {
        const singleRouteMarkerColor = SINGLE_ROUTE_MARKER_COLORS[pointIdx % SINGLE_ROUTE_MARKER_COLORS.length]
        const markerColor = isCombinedView ? routeMarkerColor : (p.markerColor ?? singleRouteMarkerColor)

        result.push({
          ...p,
          markerColor,
          routeLabel: isCombinedView ? r.name : undefined,
          routeId: r.id,
        })
      })
    })

    return result
  }, [routes, combinedRouteIds, routeColorPalette, routeIndexById])

  const setDeliveryPoints = (updater: (prev: DeliveryPoint[]) => DeliveryPoint[]) => {
    setHasUnsavedChanges(true)
    setRoutes(prev => prev.map(route => 
      route.id === currentRouteId 
        ? { ...route, deliveryPoints: updater(getRouteDeliveryPoints(route)) }
        : route
    ))
  }
  // Filter routes based on search query + region, then sort A-Z / 1-10 by name
  const filteredRoutes = useMemo(() => {
    const { nameQuery, shiftFilter: queryShift } = parseSmartQuery(searchQuery)
    const q = nameQuery.toLowerCase()
    const effectiveShift = queryShift ?? (filterShift !== "all" ? filterShift : null)

    const list = routes.filter(route => {
      if (q) {
        const matchSearch =
          route.name.toLowerCase().includes(q) ||
          route.code.toLowerCase().includes(q) ||
          getRouteDeliveryPoints(route).some(point =>
            point.name.toLowerCase().includes(q) ||
            point.code.toLowerCase().includes(q)
          )
        if (!matchSearch) return false
      }
      if (filterRegion !== "all") {
        const hay = (route.name + " " + route.code).toLowerCase()
        const needle = filterRegion.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (effectiveShift && route.shift !== effectiveShift) return false
      return true
    })
    return [...list].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true, sensitivity: 'base' })
    )
  }, [routes, searchQuery, filterRegion, filterShift])

  const displayedRoutes = filteredRoutes
  const totalCardItems = displayedRoutes.length + ((isEditMode || isPlaygroundMode) ? 1 : 0)
  const cardTrackWidth = totalCardItems > 0 ? (totalCardItems * cardW) + ((totalCardItems - 1) * CAROUSEL_GAP) : 0
  const shouldCenterCardTrack = cardContainerWidth > 0 && cardTrackWidth <= cardContainerWidth

  const scrollToCarouselIndex = useCallback((index: number) => {
    const scroller = cardCarouselRef.current
    if (!scroller) return
    const cards = scroller.querySelectorAll<HTMLElement>('[data-route-carousel-item="true"]')
    if (!cards.length) return
    const boundedIndex = Math.max(0, Math.min(index, cards.length - 1))
    cards[boundedIndex]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }, [])

  useEffect(() => {
    const scroller = cardCarouselRef.current
    if (!scroller) return

    const updateActiveIndex = () => {
      const cards = Array.from(scroller.querySelectorAll<HTMLElement>('[data-route-carousel-item="true"]'))
      if (!cards.length) {
        setActiveCarouselIndex(0)
        return
      }

      const scrollLeft = scroller.scrollLeft
      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY

      cards.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft - scrollLeft)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      })

      setActiveCarouselIndex(nearestIndex)
    }

    updateActiveIndex()
    scroller.addEventListener('scroll', updateActiveIndex, { passive: true })
    window.addEventListener('resize', updateActiveIndex)

    return () => {
      scroller.removeEventListener('scroll', updateActiveIndex)
      window.removeEventListener('resize', updateActiveIndex)
    }
  }, [displayedRoutes.length, cardW])

  useEffect(() => {
    setActiveCarouselIndex(0)
    const scroller = cardCarouselRef.current
    if (scroller) scroller.scrollTo({ left: 0, behavior: 'auto' })
  }, [searchQuery, combinedFilter])


  const [editingCell, setEditingCell] = useState<{ rowCode: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState<string>("")
  const [editError, setEditError] = useState<string>("")
  const [popoverOpen, setPopoverOpen] = useState<{ [key: string]: boolean }>({})
  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [addPointDialogOpen, setAddPointDialogOpen] = useState(false)
  const [newPoint, setNewPoint] = useState({
    code: "",
    name: "",
    delivery: "Daily" as string,
    latitude: 0,
    longitude: 0,
    descriptions: [] as { key: string; value: string }[]
  })
  const [selectedExistingLocationCode, setSelectedExistingLocationCode] = useState("")
  const [codeError, setCodeError] = useState<string>("")
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [selectedTargetRoute, setSelectedTargetRoute] = useState("")
  const [pendingSelectedRows, setPendingSelectedRows] = useState<string[]>([])
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false)
  const [deliveryModalCode, setDeliveryModalCode] = useState<string | null>(null)
  const [deliveryModalDraft, setDeliveryModalDraft] = useState<string | null>(null)
  const [openKmTooltip, setOpenKmTooltip] = useState<string | null>(null)
  const [badgePopover, setBadgePopover] = useState<string | null>(null)
  // tracks locally-edited cells that haven't been pushed to DB yet
  const [pendingCellEdits, setPendingCellEdits] = useState<Set<string>>(new Set())

  const existingLocationOptions = useMemo<ExistingLocationOption[]>(() => {
    const byCode = new Map<string, ExistingLocationOption>()
    const sourceRoutes = isPlaygroundMode ? playgroundSourceRoutes : routes
    sourceRoutes.forEach(route => {
      getRouteDeliveryPoints(route).forEach(point => {
        if (!byCode.has(point.code)) {
          byCode.set(point.code, {
            code: point.code,
            name: point.name,
            delivery: point.delivery,
            latitude: point.latitude,
            longitude: point.longitude,
            routeName: route.name,
          })
        }
      })
    })

    return Array.from(byCode.values()).sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })
    )
  }, [isPlaygroundMode, playgroundSourceRoutes, routes])

  // Playground: locations available to add to current route (not yet in current route)
  const pgAddLocAvailable = useMemo(() => {
    if (!isPlaygroundMode) return []
    const usedCodes = new Set(deliveryPoints.map(p => p.code))
    return existingLocationOptions.filter(opt => !usedCodes.has(opt.code))
  }, [isPlaygroundMode, existingLocationOptions, deliveryPoints])

  useEffect(() => {
    if (addPointDialogOpen) return
    setSelectedExistingLocationCode("")
    setNewPoint({
      code: "",
      name: "",
      delivery: "Daily",
      latitude: 0,
      longitude: 0,
      descriptions: []
    })
    setCodeError("")
  }, [addPointDialogOpen])

  const normalizePointCode = (value: string) => value.replace(/\D/g, "").slice(0, 4)
  const isPointCodeValid = (code: string) => /^\d{1,4}$/.test(code)

  // ── Settings Modal ────────────────────────────────────────────────
  type ColumnKey = 'no' | 'code' | 'name' | 'delivery' | 'km' | 'action'

  interface ColumnDef {
    key: ColumnKey
    label: string
    visible: boolean
  }

  const DEFAULT_COLUMNS: ColumnDef[] = [
    { key: 'no',       label: 'No',        visible: true  },
    { key: 'code',     label: 'Code',      visible: true  },
    { key: 'name',     label: 'Name',      visible: true  },
    { key: 'delivery', label: 'Delivery',  visible: true  },
    { key: 'km',       label: 'KM',        visible: false },
    { key: 'action',   label: 'Action',    visible: true  },
  ]

  interface SavedRowOrder {
    id: string
    label: string
    order: string[]   // array of point.code in order
  }

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMenu, setSettingsMenu] = useState<'column' | 'row' | 'sorting'>('column')
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false)
  const [mapSettingsTab, setMapSettingsTab] = useState<'route' | 'markerpoly' | 'coordinate'>('route')
  const [mapRefitToken, setMapRefitToken] = useState(0)
  const [mapResizeToken, setMapResizeToken] = useState(0)
  const [showPolyline, setShowPolyline] = useState(false)
  const [markerStyle, setMarkerStyle] = useState<'pin' | 'dot' | 'ring'>('pin')
  const [mapStyle, setMapStyle] = useState<'google-streets' | 'google-satellite' | 'osm'>(getMapStyle)
  const [kmMode, setKmMode] = useState<'direct' | 'step'>('direct')
  const [kmStartPoint, setKmStartPoint] = useState<{ lat: number; lng: number }>(DEFAULT_MAP_CENTER)
  const [draftCombinedRouteIds, setDraftCombinedRouteIds] = useState<Set<string>>(new Set([currentRouteId]))
  const [routeSettingsBaseline, setRouteSettingsBaseline] = useState<Set<string>>(new Set([currentRouteId]))
  const [draftShowPolyline, setDraftShowPolyline] = useState(false)
  const [draftMarkerStyle, setDraftMarkerStyle] = useState<'pin' | 'dot' | 'ring'>('pin')
  const [draftMapStyle, setDraftMapStyle] = useState<'google-streets' | 'google-satellite' | 'osm'>(getMapStyle)
  const [draftKmMode, setDraftKmMode] = useState<'direct' | 'step'>('direct')
  const [draftKmStartPoint, setDraftKmStartPoint] = useState<{ lat: number; lng: number }>(DEFAULT_MAP_CENTER)
  const [markerPolyBaseline, setMarkerPolyBaseline] = useState<{
    showPolyline: boolean
    markerStyle: 'pin' | 'dot' | 'ring'
    mapStyle: 'google-streets' | 'google-satellite' | 'osm'
    kmMode: 'direct' | 'step'
    kmStartPoint: { lat: number; lng: number }
  }>({
    showPolyline: false,
    markerStyle: 'pin',
    mapStyle: getMapStyle(),
    kmMode: 'direct',
    kmStartPoint: DEFAULT_MAP_CENTER,
  })
  const [draftCoordinates, setDraftCoordinates] = useState<Record<string, { lat: string; lng: string }>>({})
  const [coordinateBaseline, setCoordinateBaseline] = useState<Record<string, { lat: string; lng: string }>>({})
  const [sortConflictPending, setSortConflictPending] = useState<SortType | null>(null)

  const openRouteDetail = useCallback((routeId: string) => {
    setCurrentRouteId(routeId)
    setDetailDialogOpen(true)
    setDetailFullscreen(false)
    setDialogView('table')
    setDetailSearchQuery("")
    setSelectedRows([])
    setCombinedRouteIds(new Set([routeId]))
    setShowPolyline(false)
    setMapRefitToken(0)
    setMapResizeToken(0)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(LS_MAP_STYLE, mapStyle) } catch { /**/ }
  }, [mapStyle])

  useEffect(() => {
    if (!mapSettingsOpen) return

    const nextRouteIds = new Set(combinedRouteIds)
    const nextMarkerPolyBaseline = {
      showPolyline,
      markerStyle,
      mapStyle,
      kmMode,
      kmStartPoint: { ...kmStartPoint },
    }
    const nextCoordinates = Object.fromEntries(
      deliveryPoints.map((point) => [
        point.code,
        {
          lat: formatCoordinateInput(point.latitude),
          lng: formatCoordinateInput(point.longitude),
        },
      ])
    )

    setDraftCombinedRouteIds(nextRouteIds)
    setRouteSettingsBaseline(new Set(nextRouteIds))
    setDraftShowPolyline(showPolyline)
    setDraftMarkerStyle(markerStyle)
    setDraftMapStyle(mapStyle)
    setDraftKmMode(kmMode)
    setDraftKmStartPoint({ ...kmStartPoint })
    setMarkerPolyBaseline(nextMarkerPolyBaseline)
    setDraftCoordinates(nextCoordinates)
    setCoordinateBaseline(nextCoordinates)
  }, [mapSettingsOpen, combinedRouteIds, showPolyline, markerStyle, mapStyle, kmMode, kmStartPoint, deliveryPoints])

  // Column Customize
  const [columns, setColumns] = useState<ColumnDef[]>(DEFAULT_COLUMNS)
  const [draftColumns, setDraftColumns] = useState<ColumnDef[]>(DEFAULT_COLUMNS)

  const [columnApplyScopeOpen, setColumnApplyScopeOpen] = useState(false)
  const [routeColumnOverrides, setRouteColumnOverrides] = useState<Record<string, ColumnDef[]>>(() => {
    try {
      const s = localStorage.getItem('fcalendar_route_columns')
      if (!s) return {}
      const parsed = JSON.parse(s) as Record<string, Array<{ key: string; label: string; visible: boolean }>>
      // Strip any stale lat/lng columns that may be cached from a previous version
      const cleaned: Record<string, ColumnDef[]> = {}
      for (const [key, cols] of Object.entries(parsed)) {
        cleaned[key] = cols
          .filter((c) => c.key !== 'lat' && c.key !== 'lng')
          .filter((c): c is ColumnDef => ['no', 'code', 'name', 'delivery', 'km', 'action'].includes(c.key))
      }
      return cleaned
    } catch { return {} }
  })
  const columnsDirty = useMemo(
    () => JSON.stringify(draftColumns) !== JSON.stringify(routeColumnOverrides[currentRouteId] ?? columns),
    [draftColumns, columns, routeColumnOverrides, currentRouteId]
  )
  const columnsCanReset = useMemo(
    () => JSON.stringify(routeColumnOverrides[currentRouteId] ?? columns) !== JSON.stringify(DEFAULT_COLUMNS),
    [routeColumnOverrides, currentRouteId, columns]
  )

  // Row Customize
  type RowOrderEntry = { code: string; position: string; name: string; delivery: string }
  const buildRowEntries = (pts: typeof deliveryPoints): RowOrderEntry[] =>
    pts.map((p) => ({ code: p.code, position: '', name: p.name, delivery: p.delivery }))
  const [draftRowOrder, setDraftRowOrder] = useState<RowOrderEntry[]>([])
  const [savedRowOrders, setSavedRowOrders] = useState<SavedRowOrder[]>([])
  const [draftRowOrderName, setDraftRowOrderName] = useState<string>("")
  const [editingSavedOrderId, setEditingSavedOrderId] = useState<string | null>(null)
  const [editingSavedOrderName, setEditingSavedOrderName] = useState<string>("")
  const [rowOrderError, setRowOrderError] = useState<string>("")
  const [rowSaving, setRowSaving] = useState(false)
  const [rowSaved, setRowSaved] = useState(false)

  // Sorting
  type SortType = { type: 'column'; key: ColumnKey; dir: 'asc' | 'desc' } | { type: 'saved'; id: string } | null
  const [activeSortConfig, setActiveSortConfig] = useState<SortType>(null)
  const [draftSort, setDraftSort] = useState<SortType>(null)

  const openSettings = (routeId: string) => {
    setCurrentRouteId(routeId)
    setDraftColumns([...(routeColumnOverrides[routeId] ?? columns)])
    setDraftRowOrder(buildRowEntries(routes.find(r => r.id === routeId)?.deliveryPoints || []))
    setDraftSort(activeSortConfig)
    setSettingsMenu('column')
    try {
      const stored = localStorage.getItem(`fcalendar_my_sorts_${routeId}`)
      const parsed = stored ? JSON.parse(stored) : []
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .filter((entry): entry is SavedRowOrder => Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string' && Array.isArray(entry.order)))
          .map((entry, index) => ({
            ...entry,
            label: typeof entry.label === 'string' && entry.label.trim() !== ''
              ? entry.label.trim()
              : `Order ${index + 1}`,
          }))
        setSavedRowOrders(normalized)
      } else {
        setSavedRowOrders([])
      }
    } catch { setSavedRowOrders([]) }
    setDraftRowOrderName("")
    setEditingSavedOrderId(null)
    setEditingSavedOrderName("")
    setSettingsOpen(true)
  }

  const persistSavedRowOrders = useCallback((updated: SavedRowOrder[], routeId: string) => {
    try { localStorage.setItem(`fcalendar_my_sorts_${routeId}`, JSON.stringify(updated)) } catch {}
  }, [])

  // Column helpers
  const moveDraftCol = (idx: number, dir: -1 | 1) => {
    const next = [...draftColumns]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setDraftColumns(next)
  }

  // Row helpers
  const handleRowPositionChange = (code: string, val: string) => {
    if (val !== '' && !/^\d+$/.test(val)) return
    const isDup = val !== '' && draftRowOrder.some(r => r.code !== code && r.position !== '' && r.position === val)
    setDraftRowOrder(prev => prev.map(r => r.code === code ? { ...r, position: val } : r))
    setRowOrderError(isDup ? `Position ${val} is already used` : '')
  }

  const saveRowOrder = async () => {
    const filled = draftRowOrder.filter(r => r.position !== '')
    const positions = filled.map(r => parseInt(r.position))
    const hasDup = positions.length !== new Set(positions).size
    if (hasDup) { setRowOrderError('Duplicate position numbers'); return }
    setRowSaving(true)
    setRowSaved(false)
    await new Promise(r => setTimeout(r, 700))
    // Sort the filled rows by their position input
    const filledSorted = [...filled].sort((a, b) => parseInt(a.position) - parseInt(b.position))
    // Sort the unfilled rows by code (natural sort)
    const unfilled = draftRowOrder
      .filter(r => r.position === '')
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }))
    // Merge: filled positions first, then unfilled appended at the end
    const merged = [...filledSorted, ...unfilled].map((r, i) => ({ ...r, position: String(i + 1) }))
    setDraftRowOrder(merged)
    setRowSaving(false)
    setRowSaved(true)
    setTimeout(() => setRowSaved(false), 1500)
    const id = `roworder-${Date.now()}`
    const customName = draftRowOrderName.trim()
    const label = customName !== ''
      ? customName
      : `Order ${savedRowOrders.length + 1} (${new Date().toLocaleTimeString()})`
    const newEntry = { id, label, order: merged.map(r => r.code) }
    setSavedRowOrders(prev => {
      const updated = [...prev, newEntry]
      persistSavedRowOrders(updated, currentRouteId)
      return updated
    })
    setDraftRowOrderName("")
    setRowOrderError('')
  }

  const startRenameSavedOrder = (id: string, currentLabel: string) => {
    setEditingSavedOrderId(id)
    setEditingSavedOrderName(currentLabel)
  }

  const cancelRenameSavedOrder = () => {
    setEditingSavedOrderId(null)
    setEditingSavedOrderName("")
  }

  const saveRenameSavedOrder = (id: string) => {
    const nextName = editingSavedOrderName.trim()
    if (nextName === "") {
      setRowOrderError("Order name cannot be empty")
      return
    }

    setSavedRowOrders(prev => {
      const updated = prev.map(order => order.id === id ? { ...order, label: nextName } : order)
      persistSavedRowOrders(updated, currentRouteId)
      return updated
    })
    setRowOrderError("")
    cancelRenameSavedOrder()
  }

  // Apply sort to deliveryPoints
  const sortedDeliveryPoints = useMemo(() => {
    const today = new Date()
    const sortByActive = (pts: DeliveryPoint[]) => {
      // Active rows first, disabled rows last (stable within each group)
      const active   = pts.filter(p =>  isDeliveryActive(p.delivery, today))
      const inactive = pts.filter(p => !isDeliveryActive(p.delivery, today))
      return [...active, ...inactive]
    }

    if (!activeSortConfig) {
      const byCode = [...deliveryPoints].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }))
      return sortByActive(byCode)
    }
    if (activeSortConfig.type === 'column') {
      const { key, dir } = activeSortConfig
      const fieldMap: Partial<Record<ColumnKey, keyof DeliveryPoint>> = {
        code: 'code', name: 'name', delivery: 'delivery'
      }
      const field = fieldMap[key]
      if (!field) return sortByActive(deliveryPoints)
      const sorted = [...deliveryPoints].sort((a, b) => {
        const av = a[field!] ?? ''
        const bv = b[field!] ?? ''
        if (av < bv) return dir === 'asc' ? -1 : 1
        if (av > bv) return dir === 'asc' ? 1 : -1
        return 0
      })
      return sortByActive(sorted)
    }
    if (activeSortConfig.type === 'saved') {
      const saved = savedRowOrders.find(s => s.id === activeSortConfig.id)
      if (!saved) return sortByActive(deliveryPoints)
      const sorted = [...deliveryPoints].sort((a, b) => {
        const ai = saved.order.indexOf(a.code)
        const bi = saved.order.indexOf(b.code)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
      return sortByActive(sorted)
    }
    return sortByActive(deliveryPoints)
  }, [deliveryPoints, activeSortConfig, savedRowOrders])

  const mapDeliveryPoints = useMemo(() => {
    // For single-route view, follow the table/list order currently shown to user.
    const isSingleRouteView = combinedRouteIds.size <= 1
      && currentRouteId !== ""
      && combinedRouteIds.has(currentRouteId)

    if (isSingleRouteView) {
      return sortedDeliveryPoints.map((point) => ({
        ...point,
        routeId: currentRouteId,
      }))
    }

    return combinedDeliveryPoints
  }, [combinedRouteIds, currentRouteId, sortedDeliveryPoints, combinedDeliveryPoints])

  const routeDraftChanged = useMemo(
    () => !areSetsEqual(draftCombinedRouteIds, combinedRouteIds),
    [draftCombinedRouteIds, combinedRouteIds]
  )

  const routeCanReset = useMemo(
    () => !areSetsEqual(combinedRouteIds, routeSettingsBaseline),
    [combinedRouteIds, routeSettingsBaseline]
  )

  const markerPolyDraftChanged = useMemo(
    () => (
      draftShowPolyline !== showPolyline
      || draftMarkerStyle !== markerStyle
      || draftMapStyle !== mapStyle
      || draftKmMode !== kmMode
      || !arePointsEqual(draftKmStartPoint, kmStartPoint)
    ),
    [draftShowPolyline, showPolyline, draftMarkerStyle, markerStyle, draftMapStyle, mapStyle, draftKmMode, kmMode, draftKmStartPoint, kmStartPoint]
  )

  const markerPolyCanReset = useMemo(
    () => (
      showPolyline !== markerPolyBaseline.showPolyline
      || markerStyle !== markerPolyBaseline.markerStyle
      || mapStyle !== markerPolyBaseline.mapStyle
      || kmMode !== markerPolyBaseline.kmMode
      || !arePointsEqual(kmStartPoint, markerPolyBaseline.kmStartPoint)
    ),
    [showPolyline, markerStyle, mapStyle, kmMode, kmStartPoint, markerPolyBaseline]
  )

  const coordinateDraftChanged = useMemo(() => {
    const keys = new Set([...Object.keys(draftCoordinates), ...Object.keys(coordinateBaseline)])
    for (const key of keys) {
      const draft = draftCoordinates[key]
      const baseline = coordinateBaseline[key]
      if (!draft || !baseline) return true
      if (draft.lat !== baseline.lat || draft.lng !== baseline.lng) return true
    }
    return false
  }, [draftCoordinates, coordinateBaseline])

  const applyRouteSettings = () => {
    const next = new Set(draftCombinedRouteIds)
    setCombinedRouteIds(next)
    setMapRefitToken((value) => value + 1)
  }

  const resetRouteSettings = () => {
    const next = new Set(routeSettingsBaseline)
    setCombinedRouteIds(next)
    setDraftCombinedRouteIds(new Set(next))
    setMapRefitToken((value) => value + 1)
  }

  const applyMarkerPolySettings = () => {
    setShowPolyline(draftShowPolyline)
    setMarkerStyle(draftMarkerStyle)
    setMapStyle(draftMapStyle)
    setKmMode(draftKmMode)
    setKmStartPoint({ ...draftKmStartPoint })
    setMapRefitToken((value) => value + 1)
    setMapResizeToken((value) => value + 1)
  }

  const resetMarkerPolySettings = () => {
    setShowPolyline(markerPolyBaseline.showPolyline)
    setMarkerStyle(markerPolyBaseline.markerStyle)
    setMapStyle(markerPolyBaseline.mapStyle)
    setKmMode(markerPolyBaseline.kmMode)
    setKmStartPoint({ ...markerPolyBaseline.kmStartPoint })
    setDraftShowPolyline(markerPolyBaseline.showPolyline)
    setDraftMarkerStyle(markerPolyBaseline.markerStyle)
    setDraftMapStyle(markerPolyBaseline.mapStyle)
    setDraftKmMode(markerPolyBaseline.kmMode)
    setDraftKmStartPoint({ ...markerPolyBaseline.kmStartPoint })
    setMapRefitToken((value) => value + 1)
    setMapResizeToken((value) => value + 1)
  }

  const saveCoordinateSettings = () => {
    if (!isEditMode || !currentRoute) return

    const changedKeys = new Set<string>()
    const nextDeliveryPoints = getRouteDeliveryPoints(currentRoute).map((point) => {
      const draft = draftCoordinates[point.code]
      if (!draft) return point

      const parsedLat = Number.parseFloat(draft.lat)
      const parsedLng = Number.parseFloat(draft.lng)
      const nextLatitude = Number.isFinite(parsedLat) ? parsedLat : point.latitude
      const nextLongitude = Number.isFinite(parsedLng) ? parsedLng : point.longitude

      if (nextLatitude !== point.latitude) changedKeys.add(`${point.code}-latitude`)
      if (nextLongitude !== point.longitude) changedKeys.add(`${point.code}-longitude`)

      if (nextLatitude === point.latitude && nextLongitude === point.longitude) return point

      return {
        ...point,
        latitude: nextLatitude,
        longitude: nextLongitude,
      }
    })

    if (changedKeys.size === 0) return

    setHasUnsavedChanges(true)
    setRoutes((prev) => prev.map((route) => (
      route.id === currentRouteId
        ? { ...route, deliveryPoints: nextDeliveryPoints }
        : route
    )))
    setPendingCellEdits((prev) => {
      const next = new Set(prev)
      changedKeys.forEach((key) => next.add(key))
      return next
    })
    const normalizedCoordinates = Object.fromEntries(
      nextDeliveryPoints.map((point) => [
        point.code,
        {
          lat: formatCoordinateInput(point.latitude),
          lng: formatCoordinateInput(point.longitude),
        },
      ])
    )
    setDraftCoordinates(normalizedCoordinates)
    setCoordinateBaseline(normalizedCoordinates)
    setMapRefitToken((value) => value + 1)
  }

  // Effective columns – per-route override wins, falls back to global columns
  const effectiveColumns = routeColumnOverrides[currentRouteId] ?? columns

  const visibleDataColumns = useMemo(
    () => effectiveColumns.filter(c => c.visible && c.key !== 'action'),
    [effectiveColumns]
  )

  const isActionColumnVisible = useMemo(
    () => effectiveColumns.some(c => c.key === 'action' && c.visible),
    [effectiveColumns]
  )

  // Compute distances for Km column following actual road routes (with haversine fallback)
  // direct → road distance from start point to each row
  // step   → cumulative chain: start point → Row1 → Row2 → Row3 …
  const isStepMode = kmMode === 'step'
  const roadDistances = useRoadDistances(
    kmStartPoint,
    sortedDeliveryPoints,
    isStepMode ? 'step' : 'direct',
  )
  const pointDistances = useMemo(() => {
    return sortedDeliveryPoints.map((_, i) => {
      const segment = roadDistances.segments[i] ?? 0
      const display = isStepMode
        ? roadDistances.cumulative[i] ?? 0
        : segment
      return { display, segment }
    })
  }, [sortedDeliveryPoints, roadDistances, isStepMode])

  const tableRows = useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase()
    if (!q) {
      return sortedDeliveryPoints.map((point, index) => ({ point, index }))
    }

    return sortedDeliveryPoints
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => {
        const lat = point.latitude.toFixed(4)
        const lng = point.longitude.toFixed(4)
        return (
          point.code.toLowerCase().includes(q)
          || point.name.toLowerCase().includes(q)
          || point.delivery.toLowerCase().includes(q)
          || lat.includes(q)
          || lng.includes(q)
        )
      })
  }, [sortedDeliveryPoints, detailSearchQuery])

  const visibleRowCodes = useMemo(() => tableRows.map(({ point }) => point.code), [tableRows])
  const areAllVisibleRowsSelected = useMemo(
    () => visibleRowCodes.length > 0 && visibleRowCodes.every(code => selectedRows.includes(code)),
    [visibleRowCodes, selectedRows]
  )

  const startEdit = (rowCode: string, field: EditableField, currentValue: string | number) => {
    if (!isEditMode) return
    const key = `${rowCode}-${field}`
    setEditingCell({ rowCode, field })
    if (field === 'code') {
      setEditValue(normalizePointCode(String(currentValue)))
    } else {
      setEditValue(String(currentValue))
    }
    setEditError("")
    setPopoverOpen({ [key]: true })
  }

  const saveEdit = () => {
    if (!editingCell) return

    const nextValue = editingCell.field === 'code' ? normalizePointCode(editValue) : editValue

    const currentPoint = deliveryPoints.find(point => point.code === editingCell.rowCode)
    if (!currentPoint) return

    const hasChanged = (() => {
      if (editingCell.field === 'code') return nextValue !== currentPoint.code
      if (editingCell.field === 'name') return nextValue !== currentPoint.name
      if (editingCell.field === 'latitude') {
        const numValue = parseFloat(editValue)
        return !isNaN(numValue) && numValue !== currentPoint.latitude
      }
      if (editingCell.field === 'longitude') {
        const numValue = parseFloat(editValue)
        return !isNaN(numValue) && numValue !== currentPoint.longitude
      }
      return false
    })()

    if (!hasChanged) {
      cancelEdit()
      return
    }

    if (editingCell.field === 'code' && !isPointCodeValid(nextValue)) {
      setEditError("Code must be numeric and up to 4 digits")
      return
    }

    // Cross-route duplicate check when editing code
    if (editingCell.field === 'code' && nextValue !== editingCell.rowCode) {
      const dupMsg = findDuplicateRoute(nextValue, duplicateCheckScope)
      if (dupMsg) {
        setEditError(dupMsg)
        return
      }
    }
    setEditError("")
    
    const { rowCode, field } = editingCell
    setDeliveryPoints(prev => prev.map(point => {
      if (point.code === rowCode) {
        if (field === 'latitude' || field === 'longitude') {
          const numValue = parseFloat(editValue)
          if (!isNaN(numValue)) {
            return { ...point, [field]: numValue }
          }
        } else {
          return { ...point, [field]: nextValue }
        }
      }
      return point
    }))
    // mark this cell as pending (locally edited, not yet saved to DB)
    setPendingCellEdits(prev => { const n = new Set(prev); n.add(`${rowCode}-${field}`); return n })
    cancelEdit()
  }

  const cancelEdit = () => {
    setEditingCell(null)
    setEditValue("")
    setEditError("")
    setPopoverOpen({})
  }

  const closeDeliveryTypeModal = () => {
    setDeliveryModalOpen(false)
    setDeliveryModalCode(null)
    setDeliveryModalDraft(null)
  }

  const openDeliveryTypeModal = (point: DeliveryPoint) => {
    setDeliveryModalCode(point.code)
    setDeliveryModalDraft(point.delivery)
    setDeliveryModalOpen(true)
  }

  const applyDeliveryTypeChange = () => {
    if (!deliveryModalCode || !deliveryModalDraft) return
    const currentPoint = deliveryPoints.find(point => point.code === deliveryModalCode)
    if (!currentPoint || currentPoint.delivery === deliveryModalDraft) {
      closeDeliveryTypeModal()
      return
    }

    setDeliveryPoints(prev => prev.map(point =>
      point.code === deliveryModalCode ? { ...point, delivery: deliveryModalDraft } : point
    ))
    setPendingCellEdits(prev => {
      const next = new Set(prev)
      next.add(`${deliveryModalCode}-delivery`)
      return next
    })
    closeDeliveryTypeModal()
  }

  const toggleRowSelection = (code: string) => {
    setSelectedRows(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  const toggleSelectAll = (codes: string[]) => {
    if (codes.length === 0) {
      setSelectedRows([])
      return
    }

    const isAllSelected = codes.every(code => selectedRows.includes(code))
    if (isAllSelected) {
      setSelectedRows(prev => prev.filter(code => !codes.includes(code)))
    } else {
      setSelectedRows(prev => {
        const next = new Set(prev)
        codes.forEach(code => next.add(code))
        return Array.from(next)
      })
    }
  }

  const findDuplicateRoute = (code: string, scope: 'global' | 'current' = 'global'): string | null => {
    if (scope === 'current') {
      const existsInCurrent = deliveryPoints.some(point => point.code === code)
      return existsInCurrent ? "Code already exists in this route" : null
    }

    for (const route of routes) {
      const exists = getRouteDeliveryPoints(route).some(p => p.code === code)
      if (exists) {
        if (route.id === currentRouteId) return "Code already exists in this route"
        return `Code already exists in "${route.name}"`
      }
    }
    return null
  }

  const handleAddNewPoint = () => {
    if (isPlaygroundMode && !selectedExistingLocationCode) {
      setCodeError("Please select an existing location")
      return
    }

    if (!isPointCodeValid(newPoint.code)) {
      setCodeError("Code must be numeric and up to 4 digits")
      return
    }

    const dupMsg = findDuplicateRoute(newPoint.code, duplicateCheckScope)
    if (dupMsg) {
      setCodeError(dupMsg)
      return
    }
    
    if (newPoint.code) {
      setDeliveryPoints(prev => [...prev, newPoint])
      const label = newPoint.name ? `"${newPoint.name}" (${newPoint.code})` : newPoint.code
      setNewPoint({
        code: "",
        name: "",
        delivery: "Daily",
        latitude: 0,
        longitude: 0,
        descriptions: []
      })
      setCodeError("")
      setAddPointDialogOpen(false)
      toast.success("Location added", {
        description: `${label} · ${newPoint.delivery} · remember to save`,
        icon: <MapPin className="size-3.5 text-primary" />,
        duration: 3000,
      })
    }
  }

  const handleCodeChange = (value: string) => {
    const masked = normalizePointCode(value)
    setNewPoint({ ...newPoint, code: masked })

    if (!masked) {
      setCodeError("")
      return
    }

    if (!isPointCodeValid(masked)) {
      setCodeError("Code must be numeric and up to 4 digits")
      return
    }

    const dupMsg = findDuplicateRoute(masked, duplicateCheckScope)
    setCodeError(dupMsg ?? "")
  }

  const handleExistingLocationSelect = (code: string) => {
    setSelectedExistingLocationCode(code)
    const selected = existingLocationOptions.find(option => option.code === code)

    if (!selected) {
      setNewPoint({
        code: "",
        name: "",
        delivery: "Daily",
        latitude: 0,
        longitude: 0,
        descriptions: []
      })
      setCodeError("")
      return
    }

    setNewPoint({
      code: selected.code,
      name: selected.name,
      delivery: selected.delivery || 'Daily',
      latitude: selected.latitude,
      longitude: selected.longitude,
      descriptions: []
    })

    const dupMsg = findDuplicateRoute(selected.code, duplicateCheckScope)
    setCodeError(dupMsg ?? "")
  }

  const handleEditCodeChange = (value: string) => {
    const masked = normalizePointCode(value)
    setEditValue(masked)

    if (!masked) {
      setEditError("")
      return
    }

    if (!isPointCodeValid(masked)) {
      setEditError("Code must be numeric and up to 4 digits")
      return
    }

    if (masked !== editingCell?.rowCode) {
      const msg = findDuplicateRoute(masked, duplicateCheckScope)
      setEditError(msg ?? "")
    } else {
      setEditError("")
    }
  }

  const handleDoneClick = () => {
    setPendingSelectedRows(selectedRows)
    setActionModalOpen(true)
  }

  const handleDeleteRows = () => {
    const count = pendingSelectedRows.length
    setDeliveryPoints(prev => prev.filter(point => !pendingSelectedRows.includes(point.code)))
    setDeleteConfirmOpen(false)
    setActionModalOpen(false)
    setPendingSelectedRows([])
    setSelectedRows([])
    toast.success(`${count} location${count !== 1 ? 's' : ''} removed`, {
      description: "Remember to save your changes.",
      icon: <Trash2 className="size-4 text-primary" />,
      duration: 3000,
    })
  }

  const handleMoveRows = () => {
    if (selectedTargetRoute) {
      // Get the points to move
      const pointsToMove = deliveryPoints.filter(point => pendingSelectedRows.includes(point.code))
      
      setHasUnsavedChanges(true)
      // Move points to target route
      setRoutes(prev => prev.map(route => {
        if (route.id === selectedTargetRoute) {
          return { ...route, deliveryPoints: [...getRouteDeliveryPoints(route), ...pointsToMove] }
        }
        if (route.id === currentRouteId) {
          return { ...route, deliveryPoints: getRouteDeliveryPoints(route).filter(point => !pendingSelectedRows.includes(point.code)) }
        }
        return route
      }))
      
      const count = pendingSelectedRows.length
      const destName = routes.find(r => r.id === selectedTargetRoute)?.name ?? "another route"
      setMoveDialogOpen(false)
      setActionModalOpen(false)
      setPendingSelectedRows([])
      setSelectedRows([])
      setSelectedTargetRoute("")
      toast.success(`${count} location${count !== 1 ? 's' : ''} moved`, {
        description: `Moved to "${destName}" · remember to save.`,
        icon: <Route className="size-4 text-primary" />,
        duration: 3000,
      })
    }
  }

  const handleSaveRoute = () => {
    if (!editingRoute) return

    const errors: { code?: string; name?: string } = {}

    if (!editingRoute.name.trim()) {
      errors.name = "Route name is required"
    } else {
      const nameDup = routes.find(r => r.id !== editingRoute.id && r.name.trim().toLowerCase() === editingRoute.name.trim().toLowerCase() && r.shift === editingRoute.shift)
      if (nameDup) errors.name = `Name already used by "${nameDup.code}" (${nameDup.shift})`
    }

    if (!editingRoute.code.trim()) {
      errors.code = "Route code is required"
    } else {
      const codeDup = routes.find(r => r.id !== editingRoute.id && r.code.trim().toLowerCase() === editingRoute.code.trim().toLowerCase())
      if (codeDup) errors.code = `Code already used by "${codeDup.name}"`
    }

    if (Object.keys(errors).length > 0) {
      setEditRouteErrors(errors)
      return
    }

    setEditRouteErrors({})
    setHasUnsavedChanges(true)
    setRoutes(prev => prev.map(r => 
      r.id === editingRoute.id ? editingRoute : r
    ))
    setEditRouteDialogOpen(false)
    const saved = editingRoute
    setEditingRoute(null)
    toast.success("Route updated", {
      description: `"${saved.name}" (${saved.code}) · remember to save.`,
      icon: <CheckCircle2 className="size-4 text-primary" />,
      duration: 3000,
    })
  }

  const doSave = useCallback(async () => {
    if (isPlaygroundMode) {
      localStorage.setItem(LS_PLAYGROUND_ROUTES, JSON.stringify(routes))
      routesSnapshotRef.current = JSON.parse(JSON.stringify(routes))
      headerSnapshotRef.current = JSON.parse(JSON.stringify(headerItems))
      setPendingCellEdits(new Set())
      setCardChangelogs({})
      toast.success("Changes saved", {
        description: `Custom route data saved to this device.`,
        icon: <Save className="size-4 text-primary" />,
        duration: 3000,
      })
      return
    }

    // Snapshot before state for changelog
    const before = routesSnapshotRef.current
    const beforeHeaderItems = headerSnapshotRef.current

    // Determine which routes actually changed so the API only updates their updated_at
    const changedRouteIds: string[] = []
    routes.forEach(route => {
      const old = before.find(r => r.id === route.id)
      if (!old) { changedRouteIds.push(route.id); return }
      const hasMetaChange = old.name !== route.name || old.code !== route.code ||
                            old.shift !== route.shift || (old.color ?? null) !== (route.color ?? null)
      const hasPtsChange  = JSON.stringify(getRouteDeliveryPoints(old)) !== JSON.stringify(getRouteDeliveryPoints(route))
      const hasLabelChange = JSON.stringify(toCustomLabels(old.labels).slice().sort()) !==
                             JSON.stringify(toCustomLabels(route.labels).slice().sort())
      if (hasMetaChange || hasPtsChange || hasLabelChange) changedRouteIds.push(route.id)
    })
    const headerChanged = JSON.stringify(beforeHeaderItems) !== JSON.stringify(headerItems)

    const res = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes, changedRouteIds }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Save failed')

    if (headerChanged) {
      localStorage.setItem(LS_ROUTE_LIST_HEADER, JSON.stringify(headerItems))
    }

    type ChangelogEntry = { text: string; sortKey: string }
    const buildRowEntry = (code: string, text: string): ChangelogEntry => ({
      text,
      sortKey: code,
    })

    const sortEntries = (entries: ChangelogEntry[]) => (
      [...entries].sort((left, right) => left.sortKey.localeCompare(right.sortKey, undefined, { numeric: true, sensitivity: 'base' }))
    )

    // Record changelog entries per changed route
    // First pass: detect cross-route moves
    type MoveInfo = { code: string; name: string; fromId: string; fromName: string; toId: string; toName: string }
    const moves: MoveInfo[] = []
    routes.forEach(route => {
      const old = before.find(r => r.id === route.id)
      if (!old) return
      getRouteDeliveryPoints(route).forEach(p => {
        if (!getRouteDeliveryPoints(old).find(o => o.code === p.code)) {
          // This point is new in this route — check if it was removed from another route
          before.forEach(oldRoute => {
            if (oldRoute.id === route.id) return
            if (getRouteDeliveryPoints(oldRoute).find(o => o.code === p.code)) {
              const newFrom = routes.find(r => r.id === oldRoute.id)
              if (newFrom && !getRouteDeliveryPoints(newFrom).find(x => x.code === p.code)) {
                // Confirmed move: was in oldRoute, now in route
                moves.push({ code: p.code, name: p.name || p.code, fromId: oldRoute.id, fromName: oldRoute.name, toId: route.id, toName: route.name })
              }
            }
          })
        }
      })
    })
    const movedCodes = new Set(moves.map(m => m.code))

    routes.forEach(route => {
      const old = before.find(r => r.id === route.id)
      const routeChanges: string[] = []
      const rowChanges: ChangelogEntry[] = []
      if (!old) {
        routeChanges.push(`${formatRouteLabel(route.name)} created`)
      } else {
        // ── Route-level metadata changes ──────────────────────────────
        if (old.name !== route.name)   routeChanges.push(`Route name changed from "${old.name}" to "${route.name}"`)
        if (old.code !== route.code)   routeChanges.push(`Route code changed from ${old.code} to ${route.code}`)
        if (old.shift !== route.shift) routeChanges.push(`Route shift changed from ${old.shift} to ${route.shift}`)
        if ((old.color ?? '') !== (route.color ?? ''))
          routeChanges.push(`Route color changed from ${old.color ?? 'none'} to ${route.color ?? 'none'}`)

        // Labels
        const oldLabels = toCustomLabels(old.labels).slice().sort()
        const newLabels = toCustomLabels(route.labels).slice().sort()
        if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
          const addedL  = newLabels.filter(l => !oldLabels.includes(l))
          const removedL = oldLabels.filter(l => !newLabels.includes(l))
          if (addedL.length)   routeChanges.push(`Custom badges added: ${addedL.join(", ")}`)
          if (removedL.length) routeChanges.push(`Custom badges removed: ${removedL.join(", ")}`)
        }

        // ── Cross-route moves ─────────────────────────────────────────
        sortByCode(moves.filter(m => m.fromId === route.id)).forEach(move => {
          rowChanges.push(buildRowEntry(move.code, `${formatRowCode(move.code)} moved to ${formatRouteLabel(move.toName)}`))
        })

        sortByCode(moves.filter(m => m.toId === route.id)).forEach(move => {
          rowChanges.push(buildRowEntry(move.code, `${formatRowCode(move.code)} moved from ${formatRouteLabel(move.fromName)} to ${formatRouteLabel(move.toName)}`))
        })

        // ── Per-point add / remove / edit ─────────────────────────────
        const addedPts   = sortByCode(getRouteDeliveryPoints(route).filter(p => !getRouteDeliveryPoints(old).find(o => o.code === p.code) && !movedCodes.has(p.code)))
        const removedPts = sortByCode(getRouteDeliveryPoints(old).filter(o => !getRouteDeliveryPoints(route).find(p => p.code === o.code) && !movedCodes.has(o.code)))
        const editedPts  = sortByCode(getRouteDeliveryPoints(route).filter(p => {
          const o = getRouteDeliveryPoints(old).find(x => x.code === p.code)
          if (!o) return false
          const descChanged = JSON.stringify(normalizeDescriptions(o.descriptions))
                           !== JSON.stringify(normalizeDescriptions(p.descriptions))
          const imageChanged = JSON.stringify(getPointImageUrls(o)) !== JSON.stringify(getPointImageUrls(p))
          return o.name !== p.name || o.delivery !== p.delivery ||
                 o.latitude !== p.latitude || o.longitude !== p.longitude || descChanged || imageChanged ||
                 (o.qrCodeDestinationUrl ?? '') !== (p.qrCodeDestinationUrl ?? '')
        }))

        addedPts.forEach(point => {
          const extras: string[] = []
          const imageCount = getPointImageCount(point)
          const infoFieldCount = normalizeDescriptions(point.descriptions).length
          if (imageCount > 0) extras.push(`with ${imageCount} image${imageCount !== 1 ? 's' : ''}`)
          if (infoFieldCount > 0) extras.push(`with ${infoFieldCount} info field${infoFieldCount !== 1 ? 's' : ''}`)
          rowChanges.push(buildRowEntry(
            point.code,
            `${formatRowCode(point.code)} added${extras.length ? ` ${extras.join(' and ')}` : ''}`
          ))
        })

        removedPts.forEach(point => {
          rowChanges.push(buildRowEntry(point.code, `${formatRowCode(point.code)} removed from ${formatRouteLabel(route.name)}`))
        })

        // Edited — per-field detail for each point
        editedPts.forEach(p => {
          const o = getRouteDeliveryPoints(old).find(x => x.code === p.code)!
          const oldDescriptions = normalizeDescriptions(o.descriptions)
          const newDescriptions = normalizeDescriptions(p.descriptions)
          const oldImageCount = getPointImageCount(o)
          const newImageCount = getPointImageCount(p)

          if (o.name !== p.name)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} renamed from "${o.name}" to "${p.name}"`))
          if (o.delivery !== p.delivery)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} changed ${o.delivery} to ${p.delivery}`))
          if (o.latitude !== p.latitude || o.longitude !== p.longitude)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} updated coordinates`))

          if (newImageCount > oldImageCount)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} added ${newImageCount - oldImageCount} image${newImageCount - oldImageCount !== 1 ? 's' : ''}`))
          else if (newImageCount < oldImageCount)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} removed ${oldImageCount - newImageCount} image${oldImageCount - newImageCount !== 1 ? 's' : ''}`))
          else if (JSON.stringify(getPointImageUrls(o)) !== JSON.stringify(getPointImageUrls(p)) && newImageCount > 0)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} updated image set`))

          if (newDescriptions.length > oldDescriptions.length)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} added ${newDescriptions.length - oldDescriptions.length} info field${newDescriptions.length - oldDescriptions.length !== 1 ? 's' : ''}`))
          else if (newDescriptions.length < oldDescriptions.length)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} removed ${oldDescriptions.length - newDescriptions.length} info field${oldDescriptions.length - newDescriptions.length !== 1 ? 's' : ''}`))
          else if (JSON.stringify(oldDescriptions) !== JSON.stringify(newDescriptions) && newDescriptions.length > 0)
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} updated info fields`))

          if ((o.qrCodeDestinationUrl ?? '') !== (p.qrCodeDestinationUrl ?? ''))
            rowChanges.push(buildRowEntry(p.code, `${formatRowCode(p.code)} updated QR destination`))
        })

        // ── Reorder detection ────────────────────────────────────────
        const commonOldOrder = getRouteDeliveryPoints(old).filter(o => getRouteDeliveryPoints(route).find(p => p.code === o.code) && !movedCodes.has(o.code)).map(o => o.code)
        const commonNewOrder = getRouteDeliveryPoints(route).filter(p => getRouteDeliveryPoints(old).find(o => o.code === p.code) && !movedCodes.has(p.code)).map(p => p.code)
        if (commonOldOrder.join(',') !== commonNewOrder.join(','))
          routeChanges.push(`Row order updated by Code (${commonNewOrder.length} row${commonNewOrder.length !== 1 ? 's' : ''})`)
      }

      const orderedChanges = [
        ...routeChanges,
        ...sortEntries(rowChanges).map(entry => entry.text),
      ]

      orderedChanges.forEach(desc => { appendChangelog(route.id, desc) })
    })
    // Refresh local snapshots so next save compares against latest persisted state.
    routesSnapshotRef.current = JSON.parse(JSON.stringify(routes))
    headerSnapshotRef.current = JSON.parse(JSON.stringify(headerItems))

    // Invalidate card changelog cache so each panel reflects latest server entries.
    setCardChangelogs({})
    for (const [id, panel] of Object.entries(cardPanels)) {
      if (panel.info) void loadCardChangelog(id)
    }

    // Clear pending-edit markers once successfully persisted
    setPendingCellEdits(new Set())
    // Re-fetch from server so UI mirrors exactly what was persisted
    await fetchRoutes(currentRouteId)
    toast.success("Changes saved", {
      description: `All route data has been saved successfully.`,
      icon: <Save className="size-4 text-primary" />,
      duration: 3000,
    })
  }, [routes, headerItems, fetchRoutes, currentRouteId, isPlaygroundMode, cardPanels, loadCardChangelog])

  useEffect(() => {
    const unregister = registerSaveHandler(doSave)
    return unregister
  }, [doSave, registerSaveHandler])

  // Snapshot routes when edit mode turns ON for instant discard
  useEffect(() => {
    if (isEditMode) {
      routesSnapshotRef.current = JSON.parse(JSON.stringify(routes))
      headerSnapshotRef.current = JSON.parse(JSON.stringify(headerItems))
    }
  }, [isEditMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Register discard handler — restore snapshot instantly, clear ALL edit-related state
  useEffect(() => {
    registerDiscardHandler(() => {
      // Restore data
      setRoutes(routesSnapshotRef.current)
      setHeaderItems(headerSnapshotRef.current)
      // Clear card panels
      setCardPanels({})
      setEditPanelState({})
      setEditPanelErrors({})
      // Clear all cell-editing state
      setPendingCellEdits(new Set())
      setEditingCell(null)
      setEditValue("")
      setEditError("")
      setPopoverOpen({})
      // Clear row selection
      setSelectedRows([])
      // Close any open edit dialogs
      setAddPointDialogOpen(false)
      setDeliveryModalOpen(false)
      setDeliveryModalCode(null)
      setDeleteRouteConfirmOpen(false)
      setDetailDialogOpen(false)
      setEditingRoute(null)
      setSettingsOpen(false)
    })
  }, [registerDiscardHandler])

  const handleDeleteRoute = () => {
    if (!routeToDelete) return
    
    if (!isPlaygroundMode && routes.length <= 1) {
      toast.error("Cannot delete the last route", {
        description: "At least one route must remain.",
        icon: <AlertCircle className="size-4" />,
        duration: 4000,
      })
      return
    }

    const deleted = routeToDelete
    setHasUnsavedChanges(true)
    setRoutes(prev => prev.filter(r => r.id !== routeToDelete.id))
    setDeleteRouteConfirmOpen(false)
    setRouteToDelete(null)
    
    // Switch to first available route if current route is deleted
    if (currentRouteId === routeToDelete.id) {
      const remainingRoutes = routes.filter(r => r.id !== routeToDelete.id)
      if (remainingRoutes.length > 0) {
        setCurrentRouteId(remainingRoutes[0].id)
      }
    }
    toast.success("Route removed", {
      description: `"${deleted.name}" (${deleted.code}) · remember to save.`,
      icon: <Trash2 className="size-4 text-primary" />,
      duration: 3000,
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <LoadingState
          message="Loading routes…"
          description="Preparing route data and delivery points."
          className="max-w-md"
        />
      </div>
    )
  }

  // Responsive scale helpers derived from card dimensions
  const scale      = Math.min(1, cardW / 340)
  const cardPad    = `${(1.25 * scale).toFixed(2)}rem`
  const cardPadV   = `${(1.0  * scale).toFixed(2)}rem`
  const cardFontLg = `${(1.1  * scale).toFixed(2)}rem`
  const cardFontSm = `${(0.81 * scale).toFixed(2)}rem`
  const cardFontXs = `${(0.71 * scale).toFixed(2)}rem`
  const rowPadH    = `${(0.65 * scale).toFixed(2)}rem`
  const rowPadV    = `${(0.46 * scale).toFixed(2)}rem`
  const rowGap     = `${(0.62 * scale).toFixed(2)}rem`
  const iconSz     = Math.round(20 * scale)
  const iconFs     = `${(0.75 * scale).toFixed(2)}rem`
  const badgeFs    = `${(0.72 * scale).toFixed(2)}rem`
  const btnFs      = `${(0.82 * scale).toFixed(2)}rem`
  const btnPad     = `${(0.6  * scale).toFixed(2)}rem`
  const bodyGap    = `${(0.45 * scale).toFixed(2)}rem`
  const editTitleFs = cardFontLg
  const editMetaFs = cardFontXs
  const editLabelFs = cardFontXs
  const editInputFs = '11px'
  const editActionFs = btnFs
  const editChipFs = badgeFs
  const previewRows = cardH >= 520 ? 5 : cardH >= 460 ? 4 : 3
  const hasActiveSearchOrFilter = !!searchQuery.trim() || combinedFilter !== 'all'

  return (
    <div className="relative font-light flex-1 min-h-0 h-full overflow-y-auto overscroll-contain">
      {/* Backdrop overlay when badge popover is open */}
      {badgePopover && (
        <button
          type="button"
          aria-label="Close popover"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-[2px]"
          onClick={() => setBadgePopover(null)}
        />
      )}
      {/* Route List */}
      <div className="relative z-20 isolate mx-auto min-h-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        <div className="pointer-events-none absolute inset-0 -z-10" />
        {/* Page header */}
        <div className="mb-6 sm:mb-7">
          <div className="mb-2 flex items-center gap-2.5 sm:gap-3">
            <ClipboardList className="size-3.5 shrink-0 text-primary" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{pageTitle}</h2>
          </div>
          <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground/90 sm:ml-7">
            Manage route planning, stops, and delivery updates in one place.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 sm:mt-4">
          <div className="relative z-30 min-w-0 flex-1 sm:flex-none sm:w-[340px] lg:w-[400px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50 pointer-events-none" />
            <input
              type="text"
              placeholder="Search routes… (e.g. KL am, Sel 3 pm)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={`w-full h-11 sm:h-12 pl-11 pr-10 bg-background border rounded-lg text-[12px] md:text-[12px] text-foreground font-[inherit] placeholder:text-muted-foreground/50 outline-none transition-all duration-200 ${
                searchQuery.trim()
                  ? "border-primary/50 ring-2 ring-primary/20"
                  : "border-input focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            )}

          </div>

          <button
            type="button"
            onClick={() => setFilterModalOpen(true)}
            className={cn(
              "relative flex items-center gap-1.5 h-10 px-3.5 rounded-lg border text-xs font-medium transition-colors shrink-0",
              combinedFilter !== 'all'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
            aria-label="Open route filters"
          >
            <Filter className="size-3.5" />
            Filter
            {combinedFilter !== 'all' && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                1
              </span>
            )}
          </button>

          {hasActiveSearchOrFilter && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("")
                setCombinedFilter('all')
              }}
              className="flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-input bg-background text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/40 animate-in fade-in zoom-in-95 shrink-0"
            >
              <X className="size-3.5" />
              Reset
            </button>
          )}
          </div>

          <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Filter Routes</DialogTitle>
              </DialogHeader>

              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-1.5">
                <button
                  type="button"
                  onClick={() => setFilterModalTab('shift')}
                  className={`flex-1 rounded-md px-3 py-2.5 text-xs font-semibold transition-colors ${
                    filterModalTab === 'shift'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Filter by Shift
                </button>
                <button
                  type="button"
                  onClick={() => setFilterModalTab('region')}
                  className={`flex-1 rounded-md px-3 py-2.5 text-xs font-semibold transition-colors ${
                    filterModalTab === 'region'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Filter by Region
                </button>
              </div>

              {filterModalTab === 'shift' ? (
                <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                  {([
                    { value: 'all', label: 'All' },
                    { value: 'AM', label: 'AM' },
                    { value: 'PM', label: 'PM' },
                  ] as const).map(opt => {
                    const active = filterShift === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setShiftFilter(opt.value)}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                          active
                            ? 'border-primary/45 bg-primary/10 text-primary'
                            : 'border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                  {([
                    { value: 'all', label: 'All' },
                    { value: 'KL', label: 'KL' },
                    { value: 'Sel', label: 'Sel' },
                  ] as const).map(opt => {
                    const active = filterRegion === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRegionFilter(opt.value)}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                          active
                            ? 'border-primary/45 bg-primary/10 text-primary'
                            : 'border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">Current: {filterRegion} . {filterShift}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCombinedFilter('all')}
                    className="h-8 px-3 text-[11px]"
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setFilterModalOpen(false)}
                    className="h-8 px-3 text-[11px]"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* ── Card list (carousel) ── */}
        <div ref={cardContainerRef} style={{ width: '100%' }}>
        {displayedRoutes.length > 1 && !shouldCenterCardTrack && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium text-muted-foreground">
              Route {Math.min(activeCarouselIndex + 1, displayedRoutes.length)} / {displayedRoutes.length}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => scrollToCarouselIndex(0)}
                className="inline-flex h-9 w-9 items-center justify-center text-foreground/75 transition-colors hover:text-foreground"
                aria-label="Jump to first card"
                title="Jump to first card"
              >
                <ChevronLeft className="size-5" strokeWidth={2.75} />
              </button>
              <button
                type="button"
                onClick={() => scrollToCarouselIndex(displayedRoutes.length - 1)}
                className="inline-flex h-9 w-9 items-center justify-center text-foreground/75 transition-colors hover:text-foreground"
                aria-label="Jump to last card"
                title="Jump to last card"
              >
                <ChevronRight className="size-5" strokeWidth={2.75} />
              </button>
            </div>
          </div>
        )}
        <div
          ref={cardCarouselRef}
          style={{
            display: 'flex',
            gap: `${CAROUSEL_GAP}px`,
            justifyContent: shouldCenterCardTrack ? 'center' : 'flex-start',
            overflowX: 'auto',
            overflowY: 'hidden',
            alignItems: 'start',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: '0.6rem',
            scrollbarWidth: 'thin',
          }}
        >
        {(isEditMode || isPlaygroundMode) && displayedRoutes.length > 0 && (
          <div
            key="add-route-card"
            style={{ display: 'flex', justifyContent: 'center', minWidth: cardW, maxWidth: cardW, scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
          >
            <div
              onClick={() => setAddRouteDialogOpen(true)}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#6366f108' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'hsl(var(--border))'; e.currentTarget.style.background = 'transparent' }}
              style={{ width: '100%', maxWidth: cardW, height: cardH, borderRadius: 16, border: '2.5px dashed hsl(var(--border))', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.1rem', cursor: 'pointer', background: 'transparent', transition: 'border-color 0.25s, background 0.25s' }}
            >
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'hsl(var(--muted))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus style={{ width: 28, height: 28, color: 'hsl(var(--muted-foreground))' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{addRouteCardTitle}</div>
                <div style={{ fontSize: '0.72rem', fontWeight: 500, color: 'hsl(var(--muted-foreground))', marginTop: 4, opacity: 0.7 }}>{addRouteCardDescription}</div>
              </div>
            </div>
          </div>
        )}
        {displayedRoutes.map((route, routeIndex) => {
          const markerColor = route.color || routeColorPalette[routeIndex % routeColorPalette.length]
          const cardPanel = getCardPanel(route.id)
          const isPinnedCard = pinnedIds.has(route.id)
          const isCardHovered = hoveredRouteId === route.id
          const isPanelOpen = cardPanel.info || cardPanel.edit
          const isCardEmphasized = isPinnedCard || isPanelOpen
          const cardBorderColor = isCardEmphasized
            ? `${markerColor}${isDark ? 'c7' : 'b5'}`
            : isCardHovered
            ? `${markerColor}${isDark ? 'a8' : '94'}`
            : `${markerColor}${isDark ? '88' : '74'}`
          const cardBorderWidth = isCardEmphasized ? 2 : isCardHovered ? 1.75 : 1.5
          const cardShadow = isCardEmphasized
            ? `0 10px 26px ${markerColor}${isDark ? '2a' : '24'}, 0 0 0 1px ${markerColor}${isDark ? '56' : '48'}`
            : isCardHovered
            ? `0 7px 20px ${markerColor}${isDark ? '20' : '1b'}, 0 0 0 1px ${markerColor}${isDark ? '42' : '36'}`
            : `0 2px 10px ${markerColor}12, 0 0 0 1px ${markerColor}${isDark ? '26' : '1a'}`
          const autoLabels = getAutoDeliveryLabelsFromRoute(route)
          const savedCustomLabels = toCustomLabels(route.labels)
          const ep = editPanelState[route.id] ?? { name: route.name, code: route.code, shift: route.shift, color: route.color || markerColor, labels: savedCustomLabels }
          return (
          <div
            key={route.id}
            data-route-carousel-item="true"
            style={{ display: 'flex', justifyContent: 'center', minWidth: cardW, maxWidth: cardW, scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
          >
            {/* ── Route Card ── */}
            <div
              onMouseEnter={() => setHoveredRouteId(route.id)}
              onMouseLeave={() => setHoveredRouteId(prev => (prev === route.id ? null : prev))}
              style={{ width: '100%', maxWidth: cardW, height: cardH, borderRadius: 20, overflow: 'hidden', position: 'relative', background: 'hsl(var(--card) / 0.58)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: `${cardBorderWidth}px solid ${cardBorderColor}`, boxShadow: cardShadow, transition: 'border-color 180ms ease, box-shadow 180ms ease, border-width 180ms ease, transform 300ms ease, opacity 300ms ease', animation: `route-card-slide-in 0.4s ease-out ${routeIndex * 0.1}s both`, transform: isCardHovered ? 'scale(1.02)' : 'scale(1)' }}
            >
              {/* Sliding wrapper */}
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', width: cardW * 3, height: '100%', transform: cardPanel.edit ? `translateX(-${cardW * 2}px)` : cardPanel.info ? `translateX(-${cardW}px)` : 'translateX(0)', transition: 'transform 0.38s cubic-bezier(0.4,0,0.2,1)' }}>

                {/* ── Panel 1: Main card ── */}
                <div style={{ width: cardW, flexShrink: 0, display: 'flex', flexDirection: 'column', height: cardH }}>

                  {/* ── Colored header band ── */}
                  <div
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      flexShrink: 0,
                      padding: `${cardPadV} ${cardPad} calc(${cardPadV} * 0.9)`,
                      background: isDark
                        ? `linear-gradient(180deg, ${markerColor}22 0%, rgba(15, 23, 42, 0.12) 68%, transparent 100%)`
                        : `linear-gradient(180deg, ${markerColor}1c 0%, rgba(255, 255, 255, 0.46) 68%, transparent 100%)`,
                      borderBottom: `1px solid ${markerColor}2e`,
                    }}
                  >
                    {/* Header content */}
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {/* Route name */}
                      <h3 style={{ margin: 0, marginTop: '0.5rem', fontSize: cardFontLg, fontWeight: 800, color: 'hsl(var(--foreground))', lineHeight: 1.25, wordBreak: 'break-word', textAlign: 'center' }}>{formatRouteLabel(route.name)}</h3>
                      {/* Code + shift — tight under name */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: cardFontSm, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{route.code}</span>
                        <span style={{ fontSize: cardFontSm, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>.</span>
                        <span style={{ fontSize: cardFontSm, fontWeight: 800, color: route.shift === 'AM' ? '#16a34a' : route.shift === 'PM' ? '#c2410c' : 'hsl(var(--muted-foreground))' }}>{route.shift}</span>
                      </div>
                    </div>

                    {/* Header content only (without pin and stops) */}
                  </div>

                  {/* ── Body ── */}
                  <div style={{ flex: 1, padding: `${rowGap} ${cardPad} 0`, display: 'flex', flexDirection: 'column', gap: bodyGap, overflow: 'hidden' }}>

                    {/* Pin + stop count moved outside header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.9rem', marginTop: '0.6rem', marginBottom: '0.6rem' }}>
                      <button
                        onClick={e => { e.stopPropagation(); togglePin(route) }}
                        title={isPinnedCard ? "Unpin from Home" : "Pin to Home"}
                        style={{
                          background: isPinnedCard ? `${markerColor}18` : 'hsl(var(--muted)/0.5)',
                          border: `1px solid ${isPinnedCard ? markerColor + '55' : 'hsl(var(--border)/0.6)'}`,
                          borderRadius: 10,
                          padding: `${rowPadV} ${rowPadH}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1,
                          transition: 'all 0.18s', gap: '0.3rem',
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>{isPinnedCard ? '📌' : '📍'}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem' }}>
                          <span style={{ fontSize: `calc(${(0.73 * Math.min(1, cardW / 340)).toFixed(2)}rem + 1px)`, fontWeight: 700, color: isPinnedCard ? markerColor : 'hsl(var(--muted-foreground))', letterSpacing: '0.03em', lineHeight: 1 }}>
                            {isPinnedCard ? 'Pinned' : 'Pin'}
                          </span>
                          <span style={{ fontSize: `calc(${(0.57 * Math.min(1, cardW / 340)).toFixed(2)}rem + 1px)`, color: 'hsl(var(--muted-foreground))', opacity: 0.75, lineHeight: 1, whiteSpace: 'nowrap' }}>
                            {isPinnedCard ? 'Tap to unpin' : 'Show on Home'}
                          </span>
                        </div>
                      </button>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                        <span style={{ fontSize: `${(1.0 * Math.min(1, cardW / 340)).toFixed(2)}rem`, fontWeight: 900, color: isDark ? '#c0c7d0' : markerColor, lineHeight: 1 }}>{getRouteDeliveryPoints(route).length}</span>
                        <span style={{ fontSize: `${(0.63 * Math.min(1, cardW / 340)).toFixed(2)}rem`, fontWeight: 700, color: isDark ? '#c0c7d0' : markerColor, opacity: isDark ? 0.85 : 0.6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>stops</span>
                      </div>
                    </div>

                    {/* Stops list — responsive row count */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap }}>
                      {getRouteDeliveryPoints(route).slice(0, previewRows).map((pt, i) => {
                        const hasCoords = pt.latitude !== 0 || pt.longitude !== 0
                        const km = hasCoords ? haversineKm(kmStartPoint.lat, kmStartPoint.lng, pt.latitude, pt.longitude) : null
                        return (
                          <div key={pt.code} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: `calc(${cardFontSm} - 1px)`, background: 'hsl(var(--muted)/0.5)', borderRadius: 10, padding: `${rowPadV} ${rowPadH}`, border: '1px solid hsl(var(--border)/0.6)' }}>
                            <span style={{ width: iconSz, height: iconSz, borderRadius: 6, background: `linear-gradient(135deg, ${markerColor}dd, ${markerColor}88)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: iconFs, fontWeight: 800, flexShrink: 0, boxShadow: `0 1px 3px ${markerColor}22` }}>{i + 1}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'hsl(var(--foreground))', fontWeight: 600, minWidth: 0 }}>{pt.name}</span>
                            {km !== null && (
                              <span style={{ fontSize: `${cardFontSm}`, fontWeight: 600, color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>
                                {formatKm(km)}
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {getRouteDeliveryPoints(route).length === 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1.5rem 0', color: 'hsl(var(--muted-foreground))' }}>
                          <MapPin style={{ width: 13, height: 13, opacity: 0.4 }} />
                          <span style={{ fontSize: '0.75rem', fontStyle: 'italic' }}>No delivery points yet</span>
                        </div>
                      )}
                    </div>

                    {/* +N more locations button */}
                    {getRouteDeliveryPoints(route).length > previewRows && (
                      <>
                        <button
                          onClick={() => openRouteDetail(route.id)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontSize: `calc(${badgeFs} + 1px)`, fontWeight: 700, color: isDark ? '#a0aab4' : markerColor, background: 'transparent', border: 'none', borderRadius: 0, padding: 0, cursor: 'pointer', transition: 'color 0.15s', width: '100%' }}
                          onMouseEnter={e => (e.currentTarget.style.color = isDark ? '#c0c7d0' : markerColor)}
                          onMouseLeave={e => (e.currentTarget.style.color = isDark ? '#a0aab4' : markerColor)}
                        >
                          +{getRouteDeliveryPoints(route).length - previewRows} more locations &nbsp;&rsaquo; view all
                        </button>
                      </>
                    )}

                    {/* Divider + delivery type badges */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.55rem' }}>
                    {getRouteDeliveryPoints(route).length > 0 && (
                      <div style={{ height: 1, background: 'hsl(var(--border)/0.5)' }} />
                    )}

                    {/* Delivery type badges — centered + interactive */}
                    {(() => {
                      const grouped = getRouteDeliveryPoints(route).reduce<Record<string, DeliveryPoint[]>>((acc, p) => {
                        if (!acc[p.delivery]) acc[p.delivery] = []
                        acc[p.delivery].push(p)
                        return acc
                      }, {})
                      return (
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center', paddingBottom: '0.2rem' }}>
                          {Object.entries(grouped).map(([type, pts]) => {
                            const popKey = `${route.id}-badge-${type}`
                            const isOpen = badgePopover === popKey
                            const badgeTextColor = '#ffffff'
                            const badgeCountColor = '#ffffff'
                            const badgeBackground = `linear-gradient(135deg, ${markerColor}, ${markerColor}cc)`
                            const badgeBorder = markerColor
                            const badgeTextShadow = `0 1px 2px ${markerColor}40`
                            return (
                              <Popover key={type} open={isOpen} onOpenChange={open => setBadgePopover(open ? popKey : null)}>
                                <PopoverTrigger asChild>
                                  <span onClick={() => setBadgePopover(isOpen ? null : popKey)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: badgeFs, fontWeight: 700, color: badgeTextColor, background: badgeBackground, padding: '4px 11px', borderRadius: '6px', border: `1px solid ${badgeBorder}`, boxShadow: `0 4px 16px ${markerColor}30, 0 1px 0 #ffffff1f inset`, flexShrink: 0, letterSpacing: '0.03em', textShadow: badgeTextShadow, cursor: 'pointer', opacity: isOpen ? 0.75 : 1, transition: 'opacity 0.15s, transform 0.15s' }}>
                                    {getDeliveryLabel(type)}&nbsp;<span style={{ opacity: 0.5, fontWeight: 500 }}>&bull;</span>&nbsp;<span style={{ color: badgeCountColor, fontWeight: 700 }}>{pts.length}</span>
                                  </span>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-0 z-50 backdrop-blur-xl bg-background/90 dark:bg-card/90 shadow-2xl rounded-xl overflow-hidden" style={{ border: `1px solid ${cardBorderColor}` }} align="center" side="top">
                                  {/* Header */}
                                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60" style={{ background: `${markerColor}14` }}>
                                    <span className="size-2.5 rounded-full shrink-0" style={{ background: markerColor }} />
                                    <span className="text-xs font-bold tracking-wide" style={{ color: markerColor }}>{getDeliveryLabel(type)}</span>
                                    <span className="ml-auto text-[10px] font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">{pts.length}</span>
                                  </div>
                                  {/* Point list */}
                                  <div className="divide-y divide-border/30 max-h-48 overflow-y-auto">
                                    {pts.map(pt => (
                                      <div key={pt.code} className="flex items-center gap-2.5 px-3 py-2 group hover:bg-muted/60 transition-colors duration-100">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-semibold truncate text-foreground leading-tight">{pt.name || pt.code}</p>
                                          <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{pt.code}</p>
                                        </div>
                                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                          <button
                                            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                                            title="Edit in table"
                                            onClick={() => { setBadgePopover(null); openRouteDetail(route.id) }}
                                          >
                                            <Edit2 className="size-3" />
                                          </button>
                                          <button
                                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                            title="Delete"
                                            onClick={() => {
                                              setBadgePopover(null)
                                              setRoutes(prev => prev.map(r => r.id !== route.id ? r : {
                                                ...r,
                                                deliveryPoints: r.deliveryPoints.filter(p => p.code !== pt.code),
                                                updatedAt: new Date().toISOString()
                                              }))
                                              setHasUnsavedChanges(true)
                                            }}
                                          >
                                            <Trash2 className="size-3" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )
                          })}

                        </div>
                      )
                    })()}

                    {/* Custom badges from route.labels */}
                    {savedCustomLabels.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center', paddingTop: '0.15rem' }}>
                        {savedCustomLabels.map(lbl => {
                          const badgeTextColor = '#ffffff'
                          const badgeBg = `linear-gradient(135deg, ${markerColor}, ${markerColor}cc)`
                          const badgeBorder = markerColor
                          const badgeTextShadow = `0 1px 2px ${markerColor}40`
                          return (
                          <span
                            key={lbl}
                            style={{
                              display: 'inline-flex', alignItems: 'center',
                              fontSize: badgeFs, fontWeight: 700,
                              color: badgeTextColor,
                              background: badgeBg,
                              padding: '4px 11px', borderRadius: '5px',
                              border: `1px solid ${badgeBorder}`,
                              boxShadow: `0 2px 8px ${markerColor}35, 0 1px 0 #ffffff1f inset`,
                              letterSpacing: '0.03em',
                              textShadow: badgeTextShadow,
                            }}
                          >
                            {lbl}
                          </span>
                          )
                        })}
                      </div>
                    )}
                    </div>{/* end divider+badges wrapper */}
                  </div>{/* end Body */}

                  {/* Footer */}
                  <div style={{ padding: `${rowGap} ${cardPad} ${cardPadV}`, display: 'flex', gap: '0.45rem', borderTop: `1.5px solid ${markerColor}60`, background: isDark ? 'rgba(148, 163, 184, 0.04)' : 'rgba(255, 255, 255, 0.38)' }}>
                    {isEditMode && (
                      <button onClick={() => openExclusiveCardPanel(route.id, 'edit')} style={{ flex: 1, borderRadius: 11, fontSize: btnFs, fontWeight: 700, padding: `${btnPad} 0`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: markerColor, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: `0 3px 10px ${markerColor}44` }}>
                        <Edit2 style={{ width: iconSz * 0.6, height: iconSz * 0.6 }} /> Edit
                      </button>
                    )}
                    <button onClick={() => openExclusiveCardPanel(route.id, 'info')} style={{ flex: 1, borderRadius: 11, fontSize: btnFs, fontWeight: 700, padding: `${btnPad} 0`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: markerColor, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: `0 2px 6px ${markerColor}2e` }}>
                      <History style={{ width: iconSz * 0.6, height: iconSz * 0.6 }} /> Log
                    </button>
                    <button
                      onClick={() => openRouteDetail(route.id)}
                      style={{ flex: 1, borderRadius: 11, fontSize: btnFs, fontWeight: 800, padding: `${btnPad} 0`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: `linear-gradient(135deg, ${markerColor} 0%, ${markerColor}cc 100%)`, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: `0 2px 7px ${markerColor}30`, letterSpacing: '0.02em' }}
                    >
                      <List style={{ width: iconSz * 0.65, height: iconSz * 0.65 }} /> View
                    </button>
                  </div>
                </div>

                {/* ── Panel 2: Changelog ── */}
                {(() => {
                  const cl = cardChangelogs[route.id]
                  const formatRelative = (iso: string) => {
                    const diff = Date.now() - new Date(iso).getTime()
                    const m = Math.floor(diff / 60000)
                    if (m < 1)  return 'Just now'
                    if (m < 60) return `${m}m ago`
                    const h = Math.floor(m / 60)
                    if (h < 24) return `${h}h ago`
                    const d = Math.floor(h / 24)
                    if (d < 30) return `${d}d ago`
                    return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
                  }
                  const formatExact = (iso: string) => new Date(iso).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  return (
                  <div style={{ width: cardW, flexShrink: 0, height: cardH, display: 'flex', flexDirection: 'column', background: 'transparent', borderRadius: 14, overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ padding: '0.9rem 1.1rem 0.7rem', background: `linear-gradient(135deg, ${markerColor}22, ${markerColor}0a)`, borderBottom: `1.5px solid ${markerColor}30`, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${markerColor}, ${markerColor}bb)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 8px ${markerColor}44` }}>
                          <History style={{ color: '#fff', width: 13, height: 13 }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'hsl(var(--foreground))' }}>Log</span>
                            {cl && !cl.loading && cl.entries.length > 0 && (
                              <span style={{ fontSize: '0.6rem', fontWeight: 800, background: markerColor, color: '#fff', borderRadius: 999, padding: '1px 6px', letterSpacing: '0.02em' }}>{cl.entries.length}</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.62rem', color: 'hsl(var(--muted-foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{formatRouteLabel(route.name)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Updated timestamp banner */}
                    <div style={{ padding: '0.45rem 1.1rem', background: 'hsl(var(--muted)/0.4)', borderBottom: '1px solid hsl(var(--border)/0.6)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: route.updatedAt ? markerColor : 'hsl(var(--muted-foreground))', flexShrink: 0, boxShadow: route.updatedAt ? `0 0 5px ${markerColor}80` : 'none' }} />
                      <span style={{ fontSize: '0.63rem', fontWeight: 500, color: 'hsl(var(--muted-foreground))' }}>Last updated</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: markerColor, flex: 1 }}>
                        {route.updatedAt ? formatRelative(route.updatedAt) : '—'}
                      </span>
                      {route.updatedAt && (
                        <span style={{ fontSize: '0.58rem', color: 'hsl(var(--muted-foreground)/0.7)', textAlign: 'right' }}>
                          {formatExact(route.updatedAt)}
                        </span>
                      )}
                    </div>

                    {/* Log entries */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '0.7rem 1rem', display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {cl?.loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem', color: 'hsl(var(--muted-foreground))' }}>
                          <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
                          <span style={{ fontSize: '0.72rem' }}>Loading…</span>
                        </div>
                      ) : !cl || cl.entries.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.4rem', color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'hsl(var(--muted))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                            <History style={{ width: 18, height: 18, opacity: 0.3 }} />
                          </div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>No log entries yet</span>
                          <span style={{ fontSize: '0.62rem', opacity: 0.6, lineHeight: 1.4 }}>Changes will appear here</span>
                        </div>
                      ) : (
                        cl.entries.map((entry, i) => (
                          <div key={entry.id} style={{ display: 'flex', gap: '0.6rem', paddingBottom: i < cl.entries.length - 1 ? '0.65rem' : 0, marginBottom: i < cl.entries.length - 1 ? '0.65rem' : 0 }}>
                            {/* timeline */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 4 }}>
                              <div style={{ width: 7, height: 7, borderRadius: '50%', background: i === 0 ? markerColor : 'hsl(var(--muted-foreground)/0.4)', flexShrink: 0, boxShadow: i === 0 ? `0 0 6px ${markerColor}70` : 'none', transition: 'all 0.2s' }} />
                              {i < cl.entries.length - 1 && <div style={{ width: 1, flex: 1, background: `hsl(var(--border))`, marginTop: 3, opacity: 0.5 }} />}
                            </div>
                            {/* content bubble */}
                            <div style={{ flex: 1, minWidth: 0, background: i === 0 ? `${markerColor}12` : 'hsl(var(--muted)/0.35)', borderRadius: 8, padding: '0.35rem 0.55rem', border: i === 0 ? `1px solid ${markerColor}28` : '1px solid hsl(var(--border)/0.4)' }}>
                              <p style={{ margin: '0 0 0.18rem', fontSize: '0.72rem', fontWeight: i === 0 ? 600 : 500, color: 'hsl(var(--foreground))', lineHeight: 1.45 }}>{entry.text}</p>
                              <span style={{ fontSize: '0.6rem', color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{formatRelative(entry.created_at)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Clear button inside content - only show if there are entries AND in edit mode */}
                    {isEditMode && cl && !cl.loading && cl.entries.length > 0 && (
                      <button
                        onClick={() => setClearLogConfirm(route.id)}
                        style={{ borderRadius: 9, fontSize: '0.74rem', fontWeight: 700, padding: '0.45rem 0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: 'none', color: '#dc2626', border: 'none', cursor: 'pointer', opacity: 1, width: '100%' }}
                        title={clearLogText.clearAllEntries}
                      >
                        <Trash2 style={{ width: 11, height: 11, color: '#dc2626' }} /> Clear
                      </button>
                    )}

                    {/* Footer */}
                    <div style={{ padding: '0.6rem 1rem 0.9rem', borderTop: '1px solid hsl(var(--border)/0.6)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                      <button
                        onClick={() => setCardPanels(prev => ({ ...prev, [route.id]: { info: false, edit: false } }))}
                        style={{ flex: 1, borderRadius: 9, fontSize: '0.74rem', fontWeight: 700, padding: '0.45rem 0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: `linear-gradient(135deg, ${markerColor}, ${markerColor}cc)`, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: `0 3px 10px ${markerColor}40`, letterSpacing: '0.01em' }}
                      >
                        <ArrowDown style={{ width: 11, height: 11, transform: 'rotate(90deg)' }} /> Back
                      </button>
                    </div>
                  </div>
                  )
                })()}

                {/* ── Panel 3: Edit ── */}
                <div style={{ width: cardW, flexShrink: 0, height: cardH, display: 'flex', flexDirection: 'column', background: 'transparent' }}>
                  <div style={{ padding: '0.95rem 1rem 0.8rem', background: `linear-gradient(180deg, ${markerColor}18, transparent)`, borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
                    <div style={{ width: 31, height: 31, borderRadius: 9, background: `linear-gradient(135deg, ${markerColor}, ${markerColor}bb)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 12px ${markerColor}40` }}>
                      <Edit2 style={{ color: '#fff', width: 13, height: 13 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: editTitleFs, color: 'hsl(var(--foreground))' }}>Edit Card</div>
                      <div style={{ fontSize: editMetaFs, color: 'hsl(var(--muted-foreground))' }}>Update route details and badges</div>
                    </div>
                    <span
                      style={{
                        fontSize: editMetaFs,
                        fontWeight: 700,
                        color: markerColor,
                        border: `1px solid ${markerColor}55`,
                        borderRadius: 999,
                        padding: '2px 8px',
                        background: `${markerColor}14`,
                      }}
                    >
                      {ep.shift}
                    </span>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem' }}>
                      <div style={{ background: 'hsl(var(--background)/0.7)', border: `1.5px solid ${editPanelErrors[route.id]?.name ? '#dc2626' : 'hsl(var(--border)/0.75)'}`, borderRadius: 10, padding: '0.55rem 0.6rem' }}>
                        <label style={{ fontSize: editLabelFs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: editPanelErrors[route.id]?.name ? '#dc2626' : 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '0.35rem' }}>Route Name</label>
                        <input
                          value={ep.name}
                          onChange={e => {
                            const val = e.target.value
                            const dup = routes.find(r => r.id !== route.id && r.name.trim().toLowerCase() === val.trim().toLowerCase() && r.shift === ep.shift)
                            setEditPanelErrors(prev => ({ ...prev, [route.id]: { ...prev[route.id], name: dup ? `Name already used by "${dup.code}" (${dup.shift})` : !val.trim() ? 'Name is required' : undefined } }))
                            setEditPanelState(prev => ({ ...prev, [route.id]: { ...ep, name: val } }))
                          }}
                          placeholder="Route name..."
                          style={{ width: '100%', padding: '0.5rem 0.68rem', borderRadius: 8, border: `1.5px solid ${editPanelErrors[route.id]?.name ? '#dc2626' : 'hsl(var(--border))'}`, fontSize: editInputFs, fontWeight: 600, color: 'hsl(var(--foreground))', background: 'hsl(var(--background))', outline: 'none', boxSizing: 'border-box' }}
                          onFocus={e => e.target.style.borderColor = editPanelErrors[route.id]?.name ? '#dc2626' : markerColor}
                          onBlur={e => e.target.style.borderColor = editPanelErrors[route.id]?.name ? '#dc2626' : 'hsl(var(--border))'}
                        />
                        {editPanelErrors[route.id]?.name && (
                          <p style={{ margin: '0.3rem 0 0', fontSize: '0.68rem', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                            ⚠ {editPanelErrors[route.id]?.name}
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <div style={{ background: 'hsl(var(--background)/0.7)', border: `1.5px solid ${editPanelErrors[route.id]?.code ? '#dc2626' : 'hsl(var(--border)/0.75)'}`, borderRadius: 10, padding: '0.55rem 0.6rem' }}>
                          <label style={{ fontSize: editLabelFs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: editPanelErrors[route.id]?.code ? '#dc2626' : 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '0.35rem' }}>Code</label>
                          <input
                            value={ep.code}
                            onChange={e => {
                              const val = e.target.value
                              const dup = routes.find(r => r.id !== route.id && r.code.trim().toLowerCase() === val.trim().toLowerCase())
                              setEditPanelErrors(prev => ({ ...prev, [route.id]: { ...prev[route.id], code: dup ? `Code used by "${dup.name}"` : !val.trim() ? 'Code is required' : undefined } }))
                              setEditPanelState(prev => ({ ...prev, [route.id]: { ...ep, code: val } }))
                            }}
                            placeholder="Route code"
                            style={{ width: '100%', padding: '0.5rem 0.68rem', borderRadius: 8, border: `1.5px solid ${editPanelErrors[route.id]?.code ? '#dc2626' : 'hsl(var(--border))'}`, fontSize: editInputFs, fontWeight: 700, color: 'hsl(var(--foreground))', background: 'hsl(var(--background))', outline: 'none', boxSizing: 'border-box' }}
                            onFocus={e => e.target.style.borderColor = editPanelErrors[route.id]?.code ? '#dc2626' : markerColor}
                            onBlur={e => e.target.style.borderColor = editPanelErrors[route.id]?.code ? '#dc2626' : 'hsl(var(--border))'}
                          />
                          {editPanelErrors[route.id]?.code && (
                            <p style={{ margin: '0.3rem 0 0', fontSize: '0.68rem', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                              ⚠ {editPanelErrors[route.id]?.code}
                            </p>
                          )}
                        </div>

                        <div style={{ background: 'hsl(var(--background)/0.7)', border: '1px solid hsl(var(--border)/0.75)', borderRadius: 10, padding: '0.55rem 0.6rem' }}>
                          <label style={{ fontSize: editLabelFs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '0.35rem' }}>Shift</label>
                          <select
                            value={ep.shift}
                            onChange={(e) => {
                              const newShift = e.target.value
                              const dup = routes.find(r => r.id !== route.id && r.name.trim().toLowerCase() === ep.name.trim().toLowerCase() && r.shift === newShift)
                              setEditPanelErrors(prev => ({ ...prev, [route.id]: { ...prev[route.id], name: dup ? `Name already used by "${dup.code}" (${dup.shift})` : ep.name.trim() ? undefined : 'Name is required' } }))
                              setEditPanelState(prev => ({ ...prev, [route.id]: { ...ep, shift: newShift } }))
                            }}
                            style={{ width: '100%', padding: '0.5rem 0.68rem', borderRadius: 8, border: `1.5px solid ${markerColor}55`, fontSize: editInputFs, fontWeight: 700, color: 'hsl(var(--foreground))', background: 'hsl(var(--background))', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
                            onFocus={e => e.target.style.borderColor = markerColor}
                            onBlur={e => e.target.style.borderColor = `${markerColor}55`}
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                            {!['AM', 'PM'].includes(ep.shift) && <option value={ep.shift}>{ep.shift}</option>}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'hsl(var(--background)/0.68)', border: '1px solid hsl(var(--border)/0.75)', borderRadius: 10, padding: '0.6rem' }}>
                      <label style={{ fontSize: editLabelFs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: '0.3rem' }}>Delivery Type (Auto)</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.32rem', marginBottom: '0.5rem', minHeight: 24 }}>
                        {autoLabels.length > 0 ? autoLabels.map((lbl) => {
                          const badgeTextColor = isDark ? '#d1d5db' : '#525866'
                          const badgeBg = isDark ? 'linear-gradient(135deg, #434b59, #2f3744)' : 'linear-gradient(135deg, #eef1f4, #d3d9e1)'
                          const badgeBorder = isDark ? '#626d7d' : '#b7c0cc'
                          return (
                            <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: badgeBg, color: badgeTextColor, fontSize: editChipFs, fontWeight: 700, lineHeight: 1, padding: '3px 10px', borderRadius: '6px', border: `1px solid ${badgeBorder}`, letterSpacing: '0.03em', textShadow: isDark ? '0 1px 0 #0008' : '0 1px 0 #fff8' }}>
                              {lbl}
                            </span>
                          )
                        }) : (
                          <span style={{ fontSize: editMetaFs, color: 'hsl(var(--muted-foreground))', opacity: 0.85 }}>No auto badge</span>
                        )}
                      </div>

                    </div>

                    <button onClick={() => { setCardPanels(prev => ({ ...prev, [route.id]: { info: false, edit: false } })); setRouteToDelete(route); setDeleteRouteConfirmOpen(true) }} style={{ borderRadius: 9, fontSize: editLabelFs, fontWeight: 700, padding: '0.55rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', color: '#dc2626', border: 'none', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                      <Trash2 style={{ width: 13, height: 13 }} /> Delete Route
                    </button>
                  </div>

                  <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', gap: '0.5rem', flexShrink: 0, borderTop: '1px solid hsl(var(--border))', background: 'hsl(var(--background)/0.66)' }}>
                    <button onClick={() => { setCardPanels(prev => ({ ...prev, [route.id]: { info: false, edit: false } })); setEditPanelState(prev => { const n = { ...prev }; delete n[route.id]; return n }); setEditPanelErrors(prev => { const n = { ...prev }; delete n[route.id]; return n }) }} style={{ flex: 1, borderRadius: 8, fontSize: editActionFs, fontWeight: 700, padding: '0.45rem 0', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'transparent', color: '#dc2626', border: 'none', boxShadow: 'none', cursor: 'pointer' }}>
                      <X style={{ width: 12, height: 12 }} /> Cancel
                    </button>
                    {(() => {
                      const hasEditChanges = ep.name !== route.name || ep.code !== route.code || ep.shift !== route.shift || ep.color !== (route.color || markerColor)
                      const hasPanelErrors = !!(editPanelErrors[route.id]?.name || editPanelErrors[route.id]?.code)
                      return (
                        <button
                          disabled={!hasEditChanges || hasPanelErrors}
                          onClick={() => {
                            if (!ep.name.trim() || !ep.code.trim()) { toast.error('Name and Code required'); return }
                            if (hasPanelErrors) return
                            setHasUnsavedChanges(true)
                            setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, name: ep.name, code: ep.code, shift: ep.shift, color: ep.color, labels: ep.labels } : r))
                            setCardPanels(prev => ({ ...prev, [route.id]: { info: false, edit: false } }))
                            setEditPanelState(prev => { const n = { ...prev }; delete n[route.id]; return n })
                            setEditPanelErrors(prev => { const n = { ...prev }; delete n[route.id]; return n })
                            toast.success('Route updated', { description: `"${ep.name}" · remember to save.`, icon: <CheckCircle2 className="size-4 text-primary" />, duration: 3000 })
                          }}
                          style={{ flex: 1, borderRadius: 8, fontSize: editActionFs, fontWeight: 700, padding: '0.45rem 0', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'transparent', color: hasEditChanges && !hasPanelErrors ? '#16a34a' : 'hsl(var(--muted-foreground))', border: 'none', boxShadow: 'none', cursor: hasEditChanges && !hasPanelErrors ? 'pointer' : 'not-allowed', opacity: hasEditChanges && !hasPanelErrors ? 1 : 0.65, transition: 'all 0.15s' }}
                        >
                          <Check style={{ width: 12, height: 12 }} /> Save
                        </button>
                      )
                    })()}
                  </div>
                </div>

              </div>{/* end sliding track */}
            </div>{/* end card */}

                  <Dialog open={detailDialogOpen && route.id === currentRouteId} onOpenChange={(open) => { if (!open) { setDetailDialogOpen(false); setDetailFullscreen(false); setDialogView('table'); setDetailSearchQuery(''); setSelectedRows([]); setCombinedRouteIds(new Set([currentRouteId])); setShowPolyline(false); setMapRefitToken(0); setMapResizeToken(0) } }}>
                  <DialogContent
                    className={`p-0 gap-0 flex flex-col overflow-hidden duration-300 ease-in-out ${
                      detailFullscreen
                        ? '!fixed !inset-0 !translate-x-0 !translate-y-0 !top-0 !left-0 !w-screen !max-w-none !h-dvh !rounded-none !border-0 !shadow-none'
                        : 'transition-[width,height,max-width,border-radius]'
                    }`}
                    style={detailFullscreen
                      ? {}
                      : { width: '92vw', maxWidth: '56rem', height: 'calc(5 * 44px + 96px)', borderRadius: '0.75rem' }
                    }
                  >
                    {/* Header */}
                    <div className="shrink-0 border-b border-border bg-background">
                      <div className="px-5 py-3 flex items-center gap-3">
                        {(route.name + " " + route.code).toLowerCase().includes("kl")
                          ? <img src="/kl-flag.png" className="object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/10 shrink-0" style={{ width: 28, height: 17, borderRadius: 3 }} alt="KL" />
                          : (route.name + " " + route.code).toLowerCase().includes("sel")
                          ? <img src="/selangor-flag.png" className="object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/10 shrink-0" style={{ width: 28, height: 17, borderRadius: 3 }} alt="Selangor" />
                          : (
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${markerColor}25`, boxShadow: `0 0 0 1.5px ${markerColor}50` }}>
                              <Truck className="size-4" style={{ color: markerColor }} />
                            </div>
                          )}
                        <h1 className="flex-1 min-w-0 text-base font-bold leading-tight truncate">{formatRouteLabel(route.name)}</h1>
                        {/* Settings */}
                        <button
                          onClick={() => {
                            if (dialogView === 'map') {
                              setMapSettingsOpen(true)
                            } else {
                              openSettings(route.id)
                            }
                          }}
                          title={dialogView === 'map' ? 'Map Settings' : 'Table Settings'}
                          className="shrink-0 w-[32px] h-[32px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        >
                          <Cog className="size-[15px]" />
                        </button>
                        {/* Map / Table toggle */}
                        <button
                          onClick={() => {
                            setDialogView(prev => {
                              const next = prev === 'table' ? 'map' : 'table'
                              if (next === 'map') setMapRefitToken(t => t + 1)
                              return next
                            })
                            setMapResizeToken(t => t + 1)
                          }}
                          title={dialogView === 'table' ? 'Switch to Map' : 'Switch to Table'}
                          className="shrink-0 w-[32px] h-[32px] flex items-center justify-center rounded-lg transition-colors hover:bg-muted/60"
                          style={{ color: dialogView === 'map' ? markerColor : 'hsl(var(--muted-foreground))' }}
                        >
                          {dialogView === 'table' ? <MapPinned className="size-[15px]" /> : <TableProperties className="size-[15px]" />}
                        </button>
                        {/* Fullscreen */}
                        <button
                          onClick={() => {
                            setDetailFullscreen(f => !f)
                            if (dialogView === 'map') setMapResizeToken(t => t + 1)
                          }}
                          title={detailFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                          className="shrink-0 w-[32px] h-[32px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        >
                          {detailFullscreen ? <Shrink className="size-[15px]" /> : <Expand className="size-[15px]" />}
                        </button>
                      </div>
                    </div>
                    {/* Table / Map */}
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {dialogView === 'map' ? (
                      <div className="flex-1 overflow-auto min-h-0">
                      <div className="h-full min-h-[400px] relative">
                        <DeliveryMap deliveryPoints={mapDeliveryPoints} scrollZoom={true} showPolyline={showPolyline} markerStyle={markerStyle} mapStyle={mapStyle} startPoint={kmStartPoint} includeStartInBounds={false} refitToken={mapRefitToken} resizeToken={mapResizeToken} />
                        <button
                          onClick={() => {
                            setCombinedRouteIds(new Set([route.id]))
                            setMapRefitToken(v => v + 1)
                          }}
                          title="Return View to This Route"
                          className="absolute bottom-3 left-3 z-[500] size-8 rounded-lg border border-border bg-background/95 backdrop-blur flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/85 transition-colors shadow-sm"
                        >
                          <MapPinned className="size-4" />
                        </button>
                      </div>
                      </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                          <div className="shrink-0 border-b border-border/70 bg-background/95 px-3 py-2.5 flex items-center gap-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
                              <Input
                                value={detailSearchQuery}
                                onChange={(e) => setDetailSearchQuery(e.target.value)}
                                placeholder="Search by code, name, delivery..."
                                className="h-10 pl-10 pr-10 text-[12px]"
                              />
                              {detailSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setDetailSearchQuery("")}
                                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground"
                                  aria-label="Clear search"
                                >
                                  <X className="size-4" />
                                </button>
                              )}
                            </div>
                            {(isPlaygroundMode || isEditMode) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isPlaygroundMode) {
                                    setPgAddLocSearch("")
                                    setPgAddLocSelected(new Set())
                                    setPgAddLocOpen(true)
                                    return
                                  }
                                  setCodeError("")
                                  setAddPointDialogOpen(true)
                                }}
                                className="shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background text-[11px] font-medium text-foreground hover:bg-muted/60 transition-colors"
                              >
                                <Plus className="size-3.5" />
                                Add Location
                              </button>
                            )}
                          </div>

                          <div className="flex-1 overflow-auto min-h-0">
                          {tableRows.length === 0 ? (
                            <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-foreground">No matching delivery point</p>
                                <p className="text-xs">Try a different keyword.</p>
                              </div>
                            </div>
                          ) : (
                          <table className="border-collapse text-[11px] whitespace-nowrap min-w-max w-full text-center [&_th]:text-center [&_td]:text-center">
                            <thead className="sticky top-0 z-10 backdrop-blur-sm" style={{ background: 'hsl(var(--background)/0.92)' }}>
                              <tr>
                                {isEditMode && (
                                  <th className="px-4 h-10 text-center w-12 bg-background/95 border-b border-border/70">
                                    <input
                                      type="checkbox"
                                      checked={areAllVisibleRowsSelected}
                                      onChange={() => toggleSelectAll(visibleRowCodes)}
                                      className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                                    />
                                  </th>
                                )}
                                {visibleDataColumns.map(col => (
                                  <th key={col.key} className="px-4 h-10 text-center text-[9px] font-bold uppercase tracking-wider bg-background/95 border-b border-border/70" style={{ color: 'hsl(var(--foreground)/0.72)' }}>{col.label}</th>
                                ))}
                                {isActionColumnVisible && (
                                  <th className="px-4 h-10 text-center text-[9px] font-bold uppercase tracking-wider bg-background/95 border-b border-border/70" style={{ color: 'hsl(var(--foreground)/0.72)' }}>Action</th>
                                )}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map(({ point, index }) => {
                            const isActive = isDeliveryActive(point.delivery)
                            const distInfo = pointDistances[index]
                            const hasCoords = point.latitude !== 0 || point.longitude !== 0
                            const segmentLabel = !isStepMode
                            ? `Start point → ${point.name || point.code}: ${hasCoords && distInfo ? formatKm(distInfo.display) : '-'}`
                            : index === 0
                              ? `Start point → ${point.name || point.code}: ${hasCoords && distInfo ? formatKm(distInfo.segment) : '-'}`
                              : `${sortedDeliveryPoints[index - 1].name || sortedDeliveryPoints[index - 1].code} → ${point.name || point.code}: ${hasCoords && distInfo ? formatKm(distInfo.segment) : '-'}`

                            const isEditingThisRow = editingCell?.rowCode === point.code
                            const hasRowPending = [...pendingCellEdits].some(k => k.startsWith(`${point.code}-`))
                            return (
                              <tr key={point.code} className={`transition-colors duration-100 ${
                                isEditingThisRow
                                  ? 'bg-primary/10'
                                  : hasRowPending
                                  ? 'bg-amber-50/40 dark:bg-amber-900/10'
                                  : isActive
                                  ? index % 2 === 0 ? 'bg-background hover:bg-muted/30' : 'bg-muted/20 hover:bg-muted/35'
                                  : 'bg-muted/30 text-muted-foreground/80 hover:bg-muted/45'
                              }`}
                              >
                                {isEditMode && (
                                  <td className="px-4 h-9 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedRows.includes(point.code)}
                                      onChange={() => toggleRowSelection(point.code)}
                                      className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                                    />
                                  </td>
                                )}
                                {effectiveColumns.filter(c => c.visible).map(col => {
                                  if (col.key === 'no') return (
                                    <td key="no" className="px-4 h-9 text-center">
                                      <span className="text-[9px] font-semibold tabular-nums" style={{ color: markerColor }}>
                                        {index + 1}
                                      </span>
                                    </td>
                                  )
                                  if (col.key === 'code') return (
                                    <td key="code" className="px-4 h-9 text-center">
                                      {(() => {
                                        const isChanged = editingCell?.rowCode === point.code && editingCell.field === 'code' && normalizePointCode(editValue) !== point.code
                                        const canSave = isChanged && !editError
                                        return isEditMode ? (
                                      <Popover
                                        open={isEditMode && !!popoverOpen[`${point.code}-code`]}
                                        onOpenChange={(open) => {
                                          if (!isEditMode) return
                                          if (!open) cancelEdit()
                                          setPopoverOpen({ [`${point.code}-code`]: open })
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <button className="hover:bg-accent px-3 py-1 rounded flex w-fit mx-auto items-center justify-center gap-1.5 group text-[9px] font-semibold" onClick={() => startEdit(point.code, 'code', point.code)}>
                                            <span className={`text-[9px] font-semibold ${pendingCellEdits.has(`${point.code}-code`) ? 'text-amber-600 dark:text-amber-400' : ''}`}>{point.code}</span>
                                            <Edit2 className="size-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72">
                                          <div className="space-y-3">
                                            <div className="space-y-2">
                                              <label className="text-sm font-medium">Code</label>
                                              <Input
                                                className={`h-8 text-[11px] md:text-[11px] font-semibold leading-none text-center ${editError ? 'border-red-500 focus-visible:ring-red-500/30' : ''}`}
                                                value={editValue}
                                                onChange={(e) => handleEditCodeChange(e.target.value)}
                                                placeholder="0000"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                maxLength={4}
                                                autoFocus
                                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                                              />
                                              {editError && <p className="text-xs text-red-500">{editError}</p>}
                                            </div>
                                            <div className="flex gap-2">
                                              <Button size="sm" onClick={saveEdit} disabled={!canSave} className={`flex-1 !border-0 !bg-transparent shadow-none hover:!bg-transparent ${canSave ? 'text-green-600 hover:text-green-700' : 'text-muted-foreground/50'}`}><Check className="size-4 mr-1" /> Save</Button>
                                              <Button size="sm" onClick={cancelEdit} className="flex-1 !border-0 !bg-transparent text-red-600 shadow-none hover:!bg-transparent hover:text-red-700"><X className="size-4 mr-1" /> Cancel</Button>
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                      ) : (<span className="text-[9px] font-semibold">{point.code}</span>)
                                      })()}
                                    </td>
                                  )
                                  if (col.key === 'name') return (
                                    <td key="name" className="px-3 h-9 text-center">
                                      {(() => {
                                        const isChanged = editingCell?.rowCode === point.code && editingCell.field === 'name' && editValue !== point.name
                                        const canSave = isChanged
                                        return isEditMode ? (
                                      <Popover
                                        open={isEditMode && !!popoverOpen[`${point.code}-name`]}
                                        onOpenChange={(open) => {
                                          if (!isEditMode) return
                                          if (!open) cancelEdit()
                                          setPopoverOpen({ [`${point.code}-name`]: open })
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <button className="hover:bg-accent px-3 py-1 rounded flex w-fit mx-auto items-center justify-center gap-1.5 group text-[9px] font-semibold" onClick={() => startEdit(point.code, 'name', point.name)}>
                                            <span className={`text-[9px] font-semibold ${pendingCellEdits.has(`${point.code}-name`) ? 'text-amber-600 dark:text-amber-400' : ''}`}>{point.name}</span>
                                            <Edit2 className="size-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72">
                                          <div className="space-y-3">
                                            <div className="space-y-2">
                                              <label className="text-sm font-medium">Name</label>
                                              <Input className="h-8 text-[11px] md:text-[11px] font-semibold leading-none text-center" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Enter name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
                                            </div>
                                            <div className="flex gap-2">
                                              <Button size="sm" onClick={saveEdit} disabled={!canSave} className={`flex-1 !border-0 !bg-transparent shadow-none hover:!bg-transparent ${canSave ? 'text-green-600 hover:text-green-700' : 'text-muted-foreground/50'}`}><Check className="size-4 mr-1" /> Save</Button>
                                              <Button size="sm" onClick={cancelEdit} className="flex-1 !border-0 !bg-transparent text-red-600 shadow-none hover:!bg-transparent hover:text-red-700"><X className="size-4 mr-1" /> Cancel</Button>
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                      ) : (<span className="text-[9px] font-semibold">{point.name}</span>)
                                      })()}
                                    </td>
                                  )
                                  if (col.key === 'delivery') {
                                    const isPending = pendingCellEdits.has(`${point.code}-delivery`)
                                    return (
                                      <td key="delivery" className="px-3 h-9 text-center">
                                        {isEditMode ? (
                                          <button
                                            className="group flex w-fit mx-auto items-center gap-1.5 hover:opacity-70 transition-opacity"
                                            onClick={() => openDeliveryTypeModal(point)}
                                          >
                                            <span className={`text-[9px] font-semibold ${isPending ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                                              {getDeliveryLabel(point.delivery)}
                                            </span>
                                            <Edit2 className="size-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                                          </button>
                                        ) : (
                                          <span className="text-[9px] font-semibold">{getDeliveryLabel(point.delivery)}</span>
                                        )}
                                      </td>
                                    )
                                  }
                                  if (col.key === 'km') return (
                                    <td key="km" className="px-3 h-9 text-center">
                                      <TooltipProvider delayDuration={100}>
                                        <Tooltip
                                          open={openKmTooltip === point.code}
                                          onOpenChange={(open) => setOpenKmTooltip(open ? point.code : null)}
                                        >
                                          <TooltipTrigger
                                            type="button"
                                            className="text-[9px] font-semibold cursor-help tabular-nums"
                                            onClick={() => setOpenKmTooltip(prev => prev === point.code ? null : point.code)}
                                          >
                                            {hasCoords && distInfo ? formatKm(distInfo.display) : ''}
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="max-w-[220px] text-center text-[11px] z-[9999]">
                                            {segmentLabel}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </td>
                                  )
                                  if (col.key === 'action') return null
                                  return null
                                })}
                                {isActionColumnVisible && (
                                  <td className="px-3 h-9 text-center">
                                    <div className="inline-flex items-center gap-1 justify-center">
                                      <button
                                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 hover:scale-110 active:scale-95 ${
                                          isActive
                                            ? 'text-emerald-600 hover:bg-emerald-500/10'
                                            : 'text-rose-500 hover:bg-rose-500/10'
                                        }`}
                                        onClick={() => { setSelectedPoint(point); setInfoModalOpen(true) }}
                                      >
                                        <Info className="size-3.5" />
                                      </button>
                                      {isPlaygroundMode && (
                                        <button
                                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
                                          title="Remove location"
                                          onClick={() => {
                                            const updatedRoutes = routes.map(r =>
                                              r.id === route.id
                                                ? { ...r, deliveryPoints: r.deliveryPoints.filter(p => p.code !== point.code) }
                                                : r
                                            )
                                            setRoutes(updatedRoutes)
                                            localStorage.setItem(LS_PLAYGROUND_ROUTES, JSON.stringify(updatedRoutes))
                                            toast.success(`Removed ${point.name || point.code}`, { duration: 2000 })
                                          }}
                                        >
                                          <X className="size-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                          
                        </tbody>
                      </table>
                    )}
                    </div>
                    </div>
                    )}
                    </div>

                    {dialogView === 'table' && (
                      <div className="border-t border-border bg-background/95 px-4 py-2.5 min-h-[52px] flex flex-wrap items-center justify-between gap-2 shrink-0 backdrop-blur-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {!isEditMode && (
                            <span className="font-medium text-muted-foreground">
                              Location : {tableRows.length}
                            </span>
                          )}
                          {pendingCellEdits.size > 0 && (
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              {pendingCellEdits.size} pending edit{pendingCellEdits.size !== 1 ? 's' : ''}
                            </span>
                          )}
                          {selectedRows.length > 0 && isEditMode && (
                            <span className="font-medium text-primary">
                              {selectedRows.length} selected
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {selectedRows.length > 0 && isEditMode && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px] text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              onClick={() => setSelectedRows([])}
                            >
                              Clear selection
                            </Button>
                          )}
                          {selectedRows.length > 0 && isEditMode && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 text-[11px] text-green-600 hover:text-green-600 hover:bg-green-500/10"
                              onClick={handleDoneClick}
                            >
                              <Check className="size-3 mr-1" />Action
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </DialogContent>
                  </Dialog>
                
                {/* Action Modal - After Done is clicked */}
                <Dialog open={actionModalOpen} onOpenChange={setActionModalOpen}>
                  <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex items-center justify-center shrink-0">
                          <Edit2 className="size-4 text-primary" />
                        </div>
                        <div>
                          <DialogTitle className="text-base font-bold">Manage Rows</DialogTitle>
                          <DialogDescription className="text-xs mt-0.5">
                            {pendingSelectedRows.length} row{pendingSelectedRows.length > 1 ? 's' : ''} selected
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="px-5 py-4 space-y-2.5">
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:bg-muted/60 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => { setActionModalOpen(false); setMoveDialogOpen(true) }}
                        disabled={routes.length <= 1}
                      >
                        <div className="w-8 h-8 flex items-center justify-center shrink-0">
                          <ArrowUp className="size-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Move to Route</p>
                          <p className="text-xs text-muted-foreground">{routes.length <= 1 ? 'Create another route first' : 'Transfer to another route'}</p>
                        </div>
                      </button>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors text-left"
                        onClick={() => { setActionModalOpen(false); setDeleteConfirmOpen(true) }}
                      >
                        <div className="w-8 h-8 flex items-center justify-center shrink-0">
                          <Trash2 className="size-4 text-destructive" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-destructive">Delete Rows</p>
                          <p className="text-xs text-muted-foreground">Permanently remove selected rows</p>
                        </div>
                      </button>
                    </div>
                    <div className="px-5 pb-5 flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => { setActionModalOpen(false); setPendingSelectedRows([]); setSelectedRows([]) }}>
                        Cancel
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                {/* Move Dialog */}
                <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
                  <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex items-center justify-center shrink-0">
                          <ArrowUp className="size-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <DialogTitle className="text-base font-bold">Move to Route</DialogTitle>
                          <DialogDescription className="text-xs mt-0.5">
                            {pendingSelectedRows.length} point{pendingSelectedRows.length > 1 ? 's' : ''} will be moved
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="px-5 py-4 space-y-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destination Route</label>
                      <select
                        className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={selectedTargetRoute}
                        onChange={(e) => setSelectedTargetRoute(e.target.value)}
                      >
                        <option value="">Choose a route…</option>
                        {routes
                          .filter(route => route.id !== currentRouteId)
                          .map(route => (
                            <option key={route.id} value={route.id}>
                              {route.name} ({route.code} . {route.shift})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="px-5 pb-5 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setMoveDialogOpen(false); setActionModalOpen(true) }}>
                        Back
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={handleMoveRows}
                        disabled={!selectedTargetRoute}
                      >
                        Move
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                {/* Delete Confirmation Dialog */}
                <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex items-center justify-center shrink-0">
                          <Trash2 className="size-4 text-destructive" />
                        </div>
                        <div>
                          <DialogTitle className="text-base font-bold">Delete Rows?</DialogTitle>
                          <DialogDescription className="text-xs mt-0.5">
                            This will permanently remove {pendingSelectedRows.length} point{pendingSelectedRows.length > 1 ? 's' : ''}.
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="px-5 py-4">
                      <p className="text-sm text-muted-foreground">This action <span className="font-semibold text-foreground">cannot be undone</span>. The selected delivery points will be permanently deleted.</p>
                    </div>
                    <div className="px-5 pb-5 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setDeleteConfirmOpen(false); setActionModalOpen(true) }}>
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={handleDeleteRows}
                      >
                        Delete
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                {/* Add New Delivery Point Modal */}
                <Dialog open={addPointDialogOpen} onOpenChange={setAddPointDialogOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{addDialogTitle}</DialogTitle>
                      <DialogDescription>
                        {addDialogDescription}
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                      {isPlaygroundMode && (
                        <div className="space-y-2">
                          <label className="text-[11px] font-medium">
                            Existing Location <span className="text-red-500">*</span>
                          </label>
                          <select
                            className="w-full p-2 rounded border border-border bg-background text-[11px] md:text-[11px]"
                            value={selectedExistingLocationCode}
                            onChange={(e) => handleExistingLocationSelect(e.target.value)}
                          >
                            <option value="">Choose location...</option>
                            {existingLocationOptions.map(option => {
                              const alreadyInCurrentRoute = deliveryPoints.some(point => point.code === option.code)
                              return (
                                <option
                                  key={option.code}
                                  value={option.code}
                                  disabled={alreadyInCurrentRoute}
                                >
                                  {option.code} - {option.name} ({option.routeName})
                                  {alreadyInCurrentRoute ? ' - already in this route' : ''}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[11px] font-medium">
                            Code <span className="text-red-500">*</span>
                          </label>
                          {isPlaygroundMode ? (
                            <Input
                              placeholder="Select location first"
                              value={newPoint.code}
                              readOnly
                              className={codeError ? "border-red-500" : ""}
                            />
                          ) : (
                            <Input
                              placeholder="0000"
                              value={newPoint.code}
                              onChange={(e) => handleCodeChange(e.target.value)}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              className={codeError ? "border-red-500" : ""}
                            />
                          )}
                          {codeError && (
                            <p className="text-xs text-red-500">{codeError}</p>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <label className="text-[11px] font-medium">Label</label>
                          <select
                            className="w-full p-2 rounded border border-border bg-background text-[11px] md:text-[11px]"
                            value={newPoint.delivery}
                            onChange={(e) => setNewPoint({ ...newPoint, delivery: e.target.value })}
                          >
                            {getAvailableDeliveryLabels(currentRoute).map(lbl => (
                              <option key={lbl} value={lbl}>{lbl}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      
                      {isPlaygroundMode ? (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[11px] font-medium">Name</label>
                            <Input value={newPoint.name} readOnly />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[11px] font-medium">Source</label>
                            <Input
                              value={existingLocationOptions.find(option => option.code === selectedExistingLocationCode)?.routeName ?? ""}
                              readOnly
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <label className="text-[11px] font-medium">Name</label>
                            <Input
                              placeholder="Enter location name"
                              value={newPoint.name}
                              onChange={(e) => setNewPoint({ ...newPoint, name: e.target.value })}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[11px] font-medium">Latitude</label>
                              <Input
                                type="number"
                                step="0.0001"
                                placeholder="0.0000"
                                value={newPoint.latitude || ""}
                                onChange={(e) => setNewPoint({ ...newPoint, latitude: parseFloat(e.target.value) || 0 })}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-[11px] font-medium">Longitude</label>
                              <Input
                                type="number"
                                step="0.0001"
                                placeholder="0.0000"
                                value={newPoint.longitude || ""}
                                onChange={(e) => setNewPoint({ ...newPoint, longitude: parseFloat(e.target.value) || 0 })}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAddPointDialogOpen(false)
                          setCodeError("")
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAddNewPoint}
                        disabled={isPlaygroundMode ? (!selectedExistingLocationCode || !!codeError) : (!newPoint.code || !!codeError)}
                      >
                        Add Point
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                {/* Delivery Edit Modal */}
                <Dialog open={deliveryModalOpen && currentRouteId === route.id} onOpenChange={(open) => {
                  if (!open) closeDeliveryTypeModal()
                }}>
                  <DialogContent className="max-w-xs p-0 gap-0 overflow-hidden rounded-2xl">
                    <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
                      <DialogTitle className="text-base font-bold">Delivery Type</DialogTitle>
                      <DialogDescription className="text-xs">
                        {deliveryModalCode && (() => {
                          const pt = deliveryPoints.find(p => p.code === deliveryModalCode)
                          if (!pt) return ''
                          const selectedDelivery = deliveryModalDraft ?? pt.delivery
                          const active = isDeliveryActive(selectedDelivery)
                          return (
                            <span className="flex items-center gap-2">
                              <span>{pt.code} — {pt.name}</span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                active ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${ active ? 'bg-green-500' : 'bg-red-500' }`} />
                                {active ? 'ON' : 'OFF'}
                              </span>
                            </span>
                          )
                        })()}
                      </DialogDescription>
                    </DialogHeader>

                    {deliveryModalCode && (() => {
                      const pt = deliveryPoints.find(p => p.code === deliveryModalCode)
                      if (!pt) return null
                      const selectedDelivery = deliveryModalDraft ?? pt.delivery
                      const hasPendingChange = selectedDelivery !== pt.delivery
                      // Build item list: known items + any unknown value already set
                      const extraVal = DELIVERY_MAP.has(selectedDelivery) ? [] : [{ value: selectedDelivery, label: selectedDelivery, description: '(existing)', bg: 'bg-muted', text: 'text-muted-foreground', dot: '#6b7280' }]
                      const items = [...DELIVERY_ITEMS, ...extraVal]
                      return (
                        <>
                          <div className="py-1.5 px-1.5">
                            {items.map(item => {
                              const isSelected = selectedDelivery === item.value
                              return (
                                <button
                                  key={item.value}
                                  onClick={() => setDeliveryModalDraft(item.value)}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                                    isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-muted/70'
                                  }`}
                                >
                                  <span className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10" style={{ backgroundColor: item.dot }} />
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-bold text-foreground">{item.label}</span>
                                    <span className="block text-[11px] text-muted-foreground leading-tight">{item.description}</span>
                                  </span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                    isDeliveryActive(item.value) ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${isDeliveryActive(item.value) ? 'bg-green-500' : 'bg-red-500'}`} />
                                    {isDeliveryActive(item.value) ? 'ON' : 'OFF'}
                                  </span>
                                  {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                                </button>
                              )
                            })}
                          </div>

                          <div className="px-5 pb-4 pt-2 flex justify-end gap-4 border-t border-border">
                            <button
                              type="button"
                              onClick={closeDeliveryTypeModal}
                              className="text-sm font-semibold text-red-600 transition-colors hover:text-red-700"
                            >
                              Close
                            </button>
                            {hasPendingChange && (
                              <button
                                type="button"
                                onClick={applyDeliveryTypeChange}
                                className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                              >
                                Apply
                              </button>
                            )}
                          </div>
                        </>
                      )
                    })()}
                  </DialogContent>
                </Dialog>

                {/* Info Modal */}
                {selectedPoint && (
                  <RowInfoModal
                    open={infoModalOpen}
                    onOpenChange={setInfoModalOpen}
                    point={selectedPoint}
                    isEditMode={isEditMode}
                    allowMarkerColorEdit={combinedRouteIds.size === 1}
                    onSave={(updated) => {
                      setDeliveryPoints(prev => prev.map(p => p.code === updated.code ? updated : p))
                      setSelectedPoint(updated)
                      setHasUnsavedChanges(true)
                    }}
                  />
                )}
          </div>
          )
        })}
        </div>
        </div> {/* end card list */}
        {/* No Results Message */}
        {filteredRoutes.length === 0 && (searchQuery || filterRegion !== "all") && (
          <div className="flex w-full flex-col items-center justify-center py-14 text-center sm:py-18">
            <div className="relative mb-7">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 flex items-center justify-center">
                <Search className="size-10 text-muted-foreground/50" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent blur-xl" />
            </div>
            <h3 className="text-xl font-bold mb-2.5 text-foreground">No routes found</h3>
            <p className="max-w-md px-2 text-sm leading-relaxed text-muted-foreground">
              {searchQuery
                ? `No routes match "${searchQuery}".`
                : `No routes found in ${filterRegion === "KL" ? "Kuala Lumpur" : "Selangor"}.`}{" "}
              Try adjusting your search or filter.
            </p>
            {filterRegion !== "all" && (
              <button
                onClick={() => setCombinedFilter('all')}
                className="mt-4 text-xs text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
        
        {isPlaygroundMode && filteredRoutes.length === 0 && !searchQuery && filterRegion === "all" && filterShift === "all" && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-dashed border-border bg-card/40 px-6 py-8 text-center">
            <h3 className="text-lg font-semibold text-foreground">No custom card route yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Create a card route first, then add locations from existing Location records.</p>
            <button
              onClick={() => setAddRouteDialogOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              Create Card Route
            </button>
          </div>
        )}

        {!isPlaygroundMode && filteredRoutes.length === 0 && !searchQuery && filterRegion === "all" && filterShift === "all" && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-dashed border-border bg-card/40 px-6 py-8 text-center">
            <h3 className="text-lg font-semibold text-foreground">No routes yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Start by creating your first delivery route.</p>
            {isEditMode && (
              <button
                onClick={() => setAddRouteDialogOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="size-4" />
                Create Route
              </button>
            )}
          </div>
        )}

        {/* Add New Route Dialog */}
        {(isEditMode || isPlaygroundMode) && (
        <>
          <Dialog open={addRouteDialogOpen} onOpenChange={setAddRouteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{createRouteDialogTitle}</DialogTitle>
                <DialogDescription>
                  {createRouteDialogDescription}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name Route</label>
                  <Input
                    placeholder="Enter route name"
                    value={newRoute.name}
                    onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Code Route</label>
                  <Input
                    placeholder="Enter route code"
                    value={newRoute.code}
                    onChange={(e) => setNewRoute({ ...newRoute, code: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shift</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    value={newRoute.shift}
                    onChange={(e) => setNewRoute({ ...newRoute, shift: e.target.value })}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setAddRouteDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (newRoute.name && newRoute.code) {
                      const newRouteData: Route = {
                        id: `route-${Date.now()}`,
                        name: newRoute.name,
                        code: newRoute.code,
                        shift: newRoute.shift,
                        deliveryPoints: []
                      }
                      setHasUnsavedChanges(true)
                      setRoutes(prev => [...prev, newRouteData])
                      setNewRoute({ name: "", code: "", shift: "AM" })
                      setAddRouteDialogOpen(false)
                    }
                  }}
                >
                  {createRouteButtonLabel}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
        )}

      {/* Playground: Add Location dialog (multi-select from existing Location records) */}
      {isPlaygroundMode && (
        <Dialog open={pgAddLocOpen} onOpenChange={(open) => { setPgAddLocOpen(open); if (!open) { setPgAddLocSearch(""); setPgAddLocSelected(new Set()) } }}>
          <DialogContent className="w-[92vw] max-w-lg overflow-hidden flex flex-col gap-0 p-0 rounded-2xl" style={{ maxHeight: '80vh' }}>
            <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
              <DialogTitle className="text-sm font-bold leading-tight">Add Location</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Select one or more locations from existing Location records.
                {pgAddLocAvailable.length > 0 && (
                  <span className="ml-1 text-muted-foreground">({pgAddLocAvailable.length} available)</span>
                )}
              </DialogDescription>
            </div>

            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={pgAddLocSearch}
                  onChange={(e) => setPgAddLocSearch(e.target.value)}
                  placeholder="Search code or name..."
                  className="h-8 pl-8 pr-8 text-[11px]"
                  autoFocus
                />
                {pgAddLocSearch && (
                  <button type="button" onClick={() => setPgAddLocSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {pgAddLocSelected.size > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-primary font-medium">{pgAddLocSelected.size} selected</span>
                  <button type="button" onClick={() => setPgAddLocSelected(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">
                    Clear selection
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-2">
              {pgAddLocAvailable.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">All locations already added, or no location records found.</div>
              ) : (() => {
                const filtered = pgAddLocAvailable.filter(loc => {
                  const q = pgAddLocSearch.toLowerCase()
                  return !q || loc.code.toLowerCase().includes(q) || loc.name.toLowerCase().includes(q) || loc.routeName.toLowerCase().includes(q)
                })
                if (filtered.length === 0) return (
                  <div className="py-8 text-center text-sm text-muted-foreground">No matching locations.</div>
                )
                const allFilteredSelected = filtered.every(loc => pgAddLocSelected.has(loc.code))
                return (
                  <>
                    <div className="sticky top-0 bg-background/95 backdrop-blur-sm py-1.5 flex items-center gap-2 border-b border-border/50 mb-1">
                      <input
                        type="checkbox"
                        id="pg-select-all"
                        checked={allFilteredSelected && filtered.length > 0}
                        onChange={() => {
                          if (allFilteredSelected) {
                            setPgAddLocSelected(prev => {
                              const next = new Set(prev)
                              filtered.forEach(loc => next.delete(loc.code))
                              return next
                            })
                          } else {
                            setPgAddLocSelected(prev => {
                              const next = new Set(prev)
                              filtered.forEach(loc => next.add(loc.code))
                              return next
                            })
                          }
                        }}
                        className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      />
                      <label htmlFor="pg-select-all" className="text-[11px] font-medium text-muted-foreground cursor-pointer select-none">
                        Select all ({filtered.length})
                      </label>
                    </div>
                    {filtered.map(loc => (
                      <label
                        key={loc.code}
                        className={`flex items-start gap-3 rounded-lg px-2 py-2.5 cursor-pointer transition-colors ${
                          pgAddLocSelected.has(loc.code) ? 'bg-primary/8 border border-primary/20' : 'hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={pgAddLocSelected.has(loc.code)}
                          onChange={() => {
                            setPgAddLocSelected(prev => {
                              const next = new Set(prev)
                              if (next.has(loc.code)) next.delete(loc.code)
                              else next.add(loc.code)
                              return next
                            })
                          }}
                          className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[11px] font-bold tabular-nums">{loc.code}</span>
                            <span className="text-[11px] font-medium truncate">{loc.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground truncate">{loc.routeName}</span>
                            <span className="text-[10px] text-muted-foreground">· {loc.delivery}</span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </>
                )
              })()}
            </div>

            <div className="shrink-0 border-t border-border px-5 py-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPgAddLocOpen(false); setPgAddLocSearch(""); setPgAddLocSelected(new Set()) }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pgAddLocSelected.size === 0}
                onClick={() => {
                  const toAdd = existingLocationOptions.filter(opt => pgAddLocSelected.has(opt.code))
                  const existingCodes = new Set(deliveryPoints.map(p => p.code))
                  const newPoints: DeliveryPoint[] = toAdd
                    .filter(loc => !existingCodes.has(loc.code))
                    .map(loc => ({
                      code: loc.code,
                      name: loc.name,
                      delivery: loc.delivery,
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      descriptions: [],
                    }))
                  if (newPoints.length > 0) {
                    const updatedRoutes = routes.map(r =>
                      r.id === currentRouteId
                        ? { ...r, deliveryPoints: [...r.deliveryPoints, ...newPoints] }
                        : r
                    )
                    setRoutes(updatedRoutes)
                    localStorage.setItem(LS_PLAYGROUND_ROUTES, JSON.stringify(updatedRoutes))
                    toast.success(`${newPoints.length} location${newPoints.length !== 1 ? 's' : ''} added`, {
                      description: `Added to Route ${currentRoute?.name}`,
                      icon: <MapPin className="size-3.5 text-primary" />,
                      duration: 3000,
                    })
                  }
                  setPgAddLocOpen(false)
                  setPgAddLocSearch("")
                  setPgAddLocSelected(new Set())
                }}
              >
                Add {pgAddLocSelected.size > 0 ? `(${pgAddLocSelected.size})` : ''}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

        </div>

        {/* Edit Route Dialog */}
        <Dialog open={editRouteDialogOpen} onOpenChange={setEditRouteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Route</DialogTitle>
              <DialogDescription>
                Update route information
              </DialogDescription>
            </DialogHeader>
            
            {editingRoute && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Route Name *</label>
                  <Input
                    placeholder="Enter route name"
                    value={editingRoute.name}
                    className={editRouteErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => {
                      const val = e.target.value
                      const nameDup = routes.find(r => r.id !== editingRoute.id && r.name.trim().toLowerCase() === val.trim().toLowerCase() && r.shift === editingRoute.shift)
                      setEditRouteErrors(prev => ({ ...prev, name: nameDup ? `Name already used by "${nameDup.code}" (${nameDup.shift})` : val.trim() ? undefined : "Route name is required" }))
                      setEditingRoute({ ...editingRoute, name: val })
                    }}
                  />
                  {editRouteErrors.name && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" />{editRouteErrors.name}
                    </p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Route Code *</label>
                  <Input
                    placeholder="Enter route code"
                    value={editingRoute.code}
                    className={editRouteErrors.code ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => {
                      const val = e.target.value
                      const codeDup = routes.find(r => r.id !== editingRoute.id && r.code.trim().toLowerCase() === val.trim().toLowerCase())
                      setEditRouteErrors(prev => ({ ...prev, code: codeDup ? `Code already used by "${codeDup.name}"` : val.trim() ? undefined : "Route code is required" }))
                      setEditingRoute({ ...editingRoute, code: val })
                    }}
                  />
                  {editRouteErrors.code && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" />{editRouteErrors.code}
                    </p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shift</label>
                  <select
                    value={editingRoute.shift}
                    onChange={(e) => {
                      const newShift = e.target.value
                      const nameDup = routes.find(r => r.id !== editingRoute.id && r.name.trim().toLowerCase() === editingRoute.name.trim().toLowerCase() && r.shift === newShift)
                      setEditRouteErrors(prev => ({ ...prev, name: nameDup ? `Name already used by "${nameDup.code}" (${nameDup.shift})` : editingRoute.name.trim() ? undefined : "Route name is required" }))
                      setEditingRoute({ ...editingRoute, shift: newShift })
                    }}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
                
                <div className="flex justify-between items-center pt-4">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setRouteToDelete(editingRoute)
                      setEditRouteDialogOpen(false)
                      setDeleteRouteConfirmOpen(true)
                    }}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Delete Route
                  </Button>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditRouteDialogOpen(false)
                        setEditingRoute(null)
                        setEditRouteErrors({})
                      }}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleSaveRoute} disabled={Object.keys(editRouteErrors).length > 0}>
                      <Check className="size-4 mr-2" />
                      Save Changes
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Clear Log Confirmation Dialog */}
        <Dialog open={!!clearLogConfirm} onOpenChange={open => { if (!open) setClearLogConfirm(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">{clearLogText.title}</DialogTitle>
              <DialogDescription>
                {clearLogText.description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setClearLogConfirm(null)}>{clearLogText.cancel}</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  const routeId = clearLogConfirm
                  if (!routeId) return
                  setClearLogConfirm(null)
                  setCardChangelogs(prev => ({ ...prev, [routeId]: { loading: true, entries: [] } }))
                  try {
                    await fetch(`/api/route-notes?routeId=${encodeURIComponent(routeId)}&type=changelog`, { method: 'DELETE' })
                    setCardChangelogs(prev => ({ ...prev, [routeId]: { loading: false, entries: [] } }))
                    toast.success('Log cleared', { description: 'All log entries have been removed.', icon: <CheckCircle2 className="size-4 text-primary" />, duration: 3000 })
                  } catch {
                    setCardChangelogs(prev => ({ ...prev, [routeId]: { ...prev[routeId], loading: false } }))
                    toast.error('Failed to clear log', { duration: 3000 })
                  }
                }}
              >
                <Trash2 className="size-4 mr-2" /> {clearLogText.clearAll}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Route Confirmation Dialog */}
        <Dialog open={deleteRouteConfirmOpen} onOpenChange={setDeleteRouteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Delete Route</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this route?
              </DialogDescription>
            </DialogHeader>
            
            {routeToDelete && (
              <div className="space-y-4 py-4">
                <div className="bg-destructive/10 border border-destructive/50 rounded-md p-4">
                  <dl className="space-y-2">
                    <div>
                      <dt className="font-bold text-sm">Route Name</dt>
                      <dd className="ml-0 mb-2 text-sm">{routeToDelete.name}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-sm">Code</dt>
                      <dd className="ml-0 mb-2 text-sm">{routeToDelete.code}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-sm">Delivery Points</dt>
                      <dd className="ml-0 mb-2 text-sm">{routeToDelete.deliveryPoints.length} points</dd>
                    </div>
                  </dl>
                </div>
                
                <div className="bg-muted/50 rounded-md p-4">
                  <p className="text-sm text-muted-foreground">
                    <strong>Warning:</strong> This will permanently delete the route and all its delivery points. This action cannot be undone.
                  </p>
                </div>
                
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleteRouteConfirmOpen(false)
                      setRouteToDelete(null)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    variant="destructive"
                    onClick={handleDeleteRoute}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Delete Route
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

      {/* ── Map Settings Modal ──────────────────────────────────────── */}
      <Dialog open={mapSettingsOpen} onOpenChange={setMapSettingsOpen}>
        <DialogContent className="w-[92vw] max-w-lg h-[60vh] max-h-[540px] overflow-hidden flex flex-col gap-0 p-0">
          <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
            <div className="text-center">
              <DialogTitle className="text-sm font-bold leading-tight">Map Settings</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">Select additional routes to combine on the map</DialogDescription>
            </div>
          </div>
          <div className="px-4 pt-3 border-b border-border shrink-0">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMapSettingsTab('route')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  mapSettingsTab === 'route'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                Route
              </button>
              <button
                type="button"
                onClick={() => setMapSettingsTab('coordinate')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  mapSettingsTab === 'coordinate'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                Coordinate
              </button>
              <button
                type="button"
                onClick={() => setMapSettingsTab('markerpoly')}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  mapSettingsTab === 'markerpoly'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                Marker & Poly
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-4">
            {mapSettingsTab === 'route' ? (
              <div className="h-full min-h-0">
                <div className="h-full overflow-y-auto space-y-2 pr-1">
                  {routes
                    .slice()
                    .sort((a, b) =>
                      String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
                        numeric: true,
                        sensitivity: 'base',
                      })
                    )
                    .map(r => {
                      const isCurrentRoute = r.id === currentRouteId
                      const checked = draftCombinedRouteIds.has(r.id)
                      const rColor = r.color ?? routeColorPalette[(routes.indexOf(r)) % routeColorPalette.length] ?? '#6b7280'
                      return (
                        <label
                          key={r.id}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors select-none ${
                            checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-background hover:bg-muted/40'
                          } ${isCurrentRoute ? 'opacity-70 cursor-default' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded accent-primary cursor-pointer"
                            checked={checked}
                            disabled={isCurrentRoute}
                            onChange={() => {
                              if (isCurrentRoute) return
                              setDraftCombinedRouteIds(prev => {
                                const next = new Set(prev)
                                if (next.has(r.id)) next.delete(r.id)
                                else next.add(r.id)
                                return next
                              })
                            }}
                          />
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: rColor }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{r.name}</p>
                            <p className="text-[10px] text-muted-foreground">{r.code} · {r.shift} · {r.deliveryPoints.length} pts</p>
                          </div>
                          {isCurrentRoute && (
                            <span className="text-[10px] font-medium text-primary shrink-0">Current</span>
                          )}
                        </label>
                      )
                    })}
                </div>
              </div>
            ) : mapSettingsTab === 'markerpoly' ? (
              <div className="h-full overflow-y-auto space-y-2 pr-1">
                <div className="rounded-xl border border-border bg-background p-3 space-y-2">
                  <p className="text-xs font-semibold">Marker Design</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'pin', label: 'Pin' },
                      { value: 'dot', label: 'Dot' },
                      { value: 'ring', label: 'Ring' },
                    ] as const).map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraftMarkerStyle(option.value)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          draftMarkerStyle === option.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-3 space-y-2">
                  <p className="text-xs font-semibold">Map Style</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'google-streets', label: 'Google Streets' },
                      { value: 'google-satellite', label: 'Satellite' },
                      { value: 'osm', label: 'OSM' },
                    ] as const).map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraftMapStyle(option.value)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          draftMapStyle === option.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:bg-muted/40 transition-colors cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                    checked={draftShowPolyline}
                    onChange={(e) => setDraftShowPolyline(e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">Show Polyline</p>
                    <p className="text-[10px] text-muted-foreground">Show connecting lines between route points</p>
                  </div>
                </label>

                <div className="rounded-xl border border-border bg-background p-3 space-y-3">
                  <p className="text-xs font-semibold">KM Column Settings</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDraftKmMode('direct')}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        draftKmMode === 'direct'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      From Start Point
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftKmMode('step')}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        draftKmMode === 'step'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      Step by Step
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-muted-foreground">
                      Start Lat
                      <Input
                        type="number"
                        step="0.000001"
                        value={draftKmStartPoint.lat}
                        onChange={(e) => {
                          const next = Number.parseFloat(e.target.value)
                          if (Number.isFinite(next)) setDraftKmStartPoint(prev => ({ ...prev, lat: next }))
                        }}
                        className="h-8 mt-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      Start Lng
                      <Input
                        type="number"
                        step="0.000001"
                        value={draftKmStartPoint.lng}
                        onChange={(e) => {
                          const next = Number.parseFloat(e.target.value)
                          if (Number.isFinite(next)) setDraftKmStartPoint(prev => ({ ...prev, lng: next }))
                        }}
                        className="h-8 mt-1 text-xs"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDraftKmStartPoint(DEFAULT_MAP_CENTER)}
                      className="text-xs"
                    >
                      Reset Start Point
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-0 flex flex-col gap-3">
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Set latitude and longitude for each location in this route.</p>
                  {!isEditMode && (
                    <p className="mt-1.5 text-[11px] text-red-800 dark:text-red-400">Coordinates can only be edited when Edit Mode is active.</p>
                  )}
                </div>
                {/* Header row */}
                <div className="grid grid-cols-[1fr_100px_100px] gap-3 px-2 py-2 items-center border-b border-border/40">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center flex items-center justify-center">Location</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center flex items-center justify-center">Latitude</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center flex items-center justify-center">Longitude</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                  {deliveryPoints
                    .slice()
                    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }))
                    .map(point => {
                      const draftCoordinate = draftCoordinates[point.code]
                      const baselineCoordinate = coordinateBaseline[point.code]
                      const hasDraftCoordinateChange = !!draftCoordinate && !!baselineCoordinate && (
                        draftCoordinate.lat !== baselineCoordinate.lat || draftCoordinate.lng !== baselineCoordinate.lng
                      )
                      const hasPendingCoordinate =
                        hasDraftCoordinateChange
                        || pendingCellEdits.has(`${point.code}-latitude`)
                        || pendingCellEdits.has(`${point.code}-longitude`)

                      return (
                        <div
                          key={point.code}
                          className={`grid grid-cols-[1fr_100px_100px] items-center gap-3 rounded-lg border px-3 py-2 ${
                            hasPendingCoordinate
                              ? 'border-amber-400/50 bg-amber-50/40 dark:bg-amber-900/10'
                              : 'border-border bg-background'
                          }`}
                        >
                          <div className="min-w-0 flex items-center justify-center">
                            <p className="text-[10px] font-semibold truncate leading-tight text-center">{point.name || '-'}</p>
                          </div>
                          <Input
                            type="number"
                            step="0.000001"
                            value={draftCoordinates[point.code]?.lat ?? ''}
                            onChange={(e) => {
                              setDraftCoordinates((prev) => ({
                                ...prev,
                                [point.code]: {
                                  lat: e.target.value,
                                  lng: prev[point.code]?.lng ?? formatCoordinateInput(point.longitude),
                                },
                              }))
                            }}
                            disabled={!isEditMode}
                            className="h-7 text-[10px] px-2 text-center"
                            placeholder="0.000000"
                          />
                          <Input
                            type="number"
                            step="0.000001"
                            value={draftCoordinates[point.code]?.lng ?? ''}
                            onChange={(e) => {
                              setDraftCoordinates((prev) => ({
                                ...prev,
                                [point.code]: {
                                  lat: prev[point.code]?.lat ?? formatCoordinateInput(point.latitude),
                                  lng: e.target.value,
                                },
                              }))
                            }}
                            disabled={!isEditMode}
                            className="h-7 text-[10px] px-2 text-center"
                            placeholder="0.000000"
                          />
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-3.5 border-t border-border shrink-0 min-h-[60px] flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {combinedDeliveryPoints.length} points shown
            </p>
            <div className="flex items-center gap-4">
              {mapSettingsTab === 'route' && routeCanReset && (
                <button
                  type="button"
                  onClick={resetRouteSettings}
                  className="text-sm font-semibold text-red-600 transition-colors hover:text-red-700"
                >
                  Reset
                </button>
              )}
              {mapSettingsTab === 'route' && routeDraftChanged && (
                <button
                  type="button"
                  onClick={applyRouteSettings}
                  className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                >
                  Apply
                </button>
              )}
              {mapSettingsTab === 'markerpoly' && markerPolyCanReset && (
                <button
                  type="button"
                  onClick={resetMarkerPolySettings}
                  className="text-sm font-semibold text-red-600 transition-colors hover:text-red-700"
                >
                  Reset
                </button>
              )}
              {mapSettingsTab === 'markerpoly' && markerPolyDraftChanged && (
                <button
                  type="button"
                  onClick={applyMarkerPolySettings}
                  className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                >
                  Apply
                </button>
              )}
              {mapSettingsTab === 'coordinate' && isEditMode && coordinateDraftChanged && (
                <button
                  type="button"
                  onClick={saveCoordinateSettings}
                  className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Settings Modal ──────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[92vw] max-w-lg h-[56vh] max-h-[500px] overflow-hidden flex flex-col gap-0 p-0">
          <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
            <div className="text-center">
              <DialogTitle className="text-sm font-bold leading-tight">Table Settings</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">Customize how the table looks and behaves</DialogDescription>
            </div>
          </div>

          {/* Tab Menu */}
          <div className="px-4 pt-2.5 border-b border-border shrink-0">
            <div className="grid grid-cols-3 gap-2">
            {(['column', 'row', 'sorting'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSettingsMenu(m)}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                  settingsMenu === m
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                {m === 'column' ? 'Column' : m === 'row' ? 'Row' : 'Sorting'}
              </button>
            ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-3">

            {/* ── COLUMN CUSTOMIZE ── */}
            {settingsMenu === 'column' && (
              <div className="h-full min-h-0 flex flex-col gap-2.5">
                <div className="rounded-xl border border-border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">Toggle visibility and reorder columns.</p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
                  {draftColumns.map((col, idx) => {
                    return (
                    <div key={col.key} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border bg-background">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        onChange={() =>
                          setDraftColumns(prev =>
                            prev.map((c, i) => i === idx ? { ...c, visible: !c.visible } : c)
                          )
                        }
                        className="w-4 h-4 cursor-pointer accent-primary"
                      />
                      <span className="flex-1 text-xs font-medium">{col.label}</span>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={idx === 0}
                          onClick={() => moveDraftCol(idx, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={idx === draftColumns.length - 1}
                          onClick={() => moveDraftCol(idx, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── ROW CUSTOMIZE ── */}
            {settingsMenu === 'row' && (
              <div className="h-full min-h-0 flex flex-col gap-2.5">
                <div className="rounded-xl border border-border bg-background p-2.5">
                  <p className="text-[11px] text-muted-foreground">Input a position number to reorder rows. No duplicates allowed.</p>
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] font-medium text-foreground">Order Name (optional)</p>
                    <Input
                      value={draftRowOrderName}
                      onChange={(e) => setDraftRowOrderName(e.target.value)}
                      placeholder="Example: Monday Route Priority"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                {rowOrderError && (
                  <p className="text-[11px] text-destructive font-medium">{rowOrderError}</p>
                )}
                <div className={`flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 relative transition-opacity duration-300 ${rowSaving ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                  {rowSaving && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="bg-background/90 backdrop-blur-sm rounded-xl px-5 py-3 flex items-center gap-2.5 shadow-lg border border-border">
                        <Loader2 className="size-5 animate-spin text-primary" />
                        <span className="text-[11px] font-semibold text-foreground">Sorting rows…</span>
                      </div>
                    </div>
                  )}
                  {draftRowOrder.map((row) => (
                    <div key={row.code} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border bg-background">
                      <div className="relative w-16 shrink-0">
                        <Input
                          value={row.position}
                          onChange={(e) => handleRowPositionChange(row.code, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="#"
                          className={`w-16 text-center text-[11px] md:text-[11px] font-semibold ${
                            row.position !== '' && draftRowOrder.filter(r => r.position !== '' && r.position === row.position).length > 1
                              ? 'border-destructive focus-visible:ring-destructive/30'
                              : ''
                          }`}
                          inputMode="numeric"
                          maxLength={3}
                        />
                      </div>
                      <span className="w-20 text-[11px] font-mono font-semibold text-center">{row.code}</span>
                      <span className="flex-1 text-[11px] text-center">{row.name}</span>
                      <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{row.delivery}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── SORTING ── */}
            {settingsMenu === 'sorting' && (
              <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-2.5">
                {/* Sort by Column */}
                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-background p-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sort by Column</p>
                  </div>
                  <div className="rounded-xl border border-border overflow-hidden bg-background">
                    {([
                      { key: 'code'     as ColumnKey, label: 'Code' },
                      { key: 'name'     as ColumnKey, label: 'Name' },
                      { key: 'delivery' as ColumnKey, label: 'Delivery' },
                    ]).map(({ key, label }, i, arr) => {
                      const isActive = draftSort?.type === 'column' && draftSort.key === key
                      const dir = (isActive && draftSort.type === 'column') ? draftSort.dir : 'asc'
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            if (isActive) {
                              setDraftSort({ type: 'column', key, dir: dir === 'asc' ? 'desc' : 'asc' })
                            } else {
                              setDraftSort({ type: 'column', key, dir: 'asc' })
                            }
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors${
                            i < arr.length - 1 ? ' border-b border-border/50' : ''
                          }${
                            isActive
                              ? ' text-primary font-semibold bg-primary/5'
                              : ' text-foreground hover:bg-muted/60'
                          }`}
                        >
                          <span>{label}</span>
                          {isActive
                            ? (dir === 'asc'
                                ? <ChevronUp className="w-4 h-4" />
                                : <ChevronDown className="w-4 h-4" />)
                            : <ChevronsUpDown className="w-4 h-4 text-muted-foreground/40" />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* My Sort List */}
                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-background p-2.5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My Sort List</p>
                    <p className="text-xs text-muted-foreground">Saved custom row orders - specific to this route only.</p>
                  </div>
                  {savedRowOrders.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/50">
                      <p>No saved sort orders yet.</p>
                      <p className="text-xs mt-1.5">Go to <strong>Row Customize</strong> and save a custom order.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {savedRowOrders.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          {editingSavedOrderId === s.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <Input
                                value={editingSavedOrderName}
                                onChange={(e) => setEditingSavedOrderName(e.target.value)}
                                className="h-8 text-xs"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    saveRenameSavedOrder(s.id)
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelRenameSavedOrder()
                                  }
                                }}
                              />
                              <button
                                onClick={() => saveRenameSavedOrder(s.id)}
                                className="p-2 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors text-muted-foreground shrink-0"
                                title="Save name"
                              >
                                <Check className="size-4" />
                              </button>
                              <button
                                onClick={cancelRenameSavedOrder}
                                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
                                title="Cancel rename"
                              >
                                <X className="size-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDraftSort({ type: 'saved', id: s.id })}
                              className={`flex-1 py-2 px-3 text-xs rounded-lg border transition-colors text-left font-medium ${
                                draftSort?.type === 'saved' && draftSort.id === s.id
                                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                                  : 'border-border hover:bg-muted hover:border-border/80'
                              }`}
                            >
                              {s.label}
                            </button>
                          )}
                          {editingSavedOrderId !== s.id && (
                            <button
                              onClick={() => startRenameSavedOrder(s.id, s.label)}
                              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
                              title="Edit sort name"
                            >
                              <Edit2 className="size-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSavedRowOrders(prev => {
                                const updated = prev.filter(r => r.id !== s.id)
                                persistSavedRowOrders(updated, currentRouteId)
                                return updated
                              })
                              if (draftSort?.type === 'saved' && draftSort.id === s.id) setDraftSort(null)
                              if (editingSavedOrderId === s.id) cancelRenameSavedOrder()
                            }}
                            className="p-2 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground shrink-0"
                            title="Delete this sort"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {draftSort && (
                  <button
                    onClick={() => setDraftSort(null)}
                    className="text-sm text-muted-foreground hover:text-destructive flex items-center gap-1.5 pt-1"
                  >
                    <X className="size-4" /> Clear sorting
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Footer Buttons ── */}
          <div className="px-5 py-2.5 border-t border-border shrink-0 min-h-[52px] flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {settingsMenu === 'column'
                ? `${draftColumns.filter(c => c.visible).length} / ${draftColumns.length} columns visible`
                : settingsMenu === 'row'
                  ? `${draftRowOrder.length} rows available`
                  : `${savedRowOrders.length} saved sort list(s)`}
            </p>
            {settingsMenu === 'column' && (
              <div className="flex items-center gap-4">
                {columnsCanReset && (
                  <button
                    className="text-sm font-semibold text-red-600 transition-colors hover:text-red-700"
                    onClick={() => {
                      setDraftColumns([...DEFAULT_COLUMNS])
                      setColumns([...DEFAULT_COLUMNS])
                      setRouteColumnOverrides(prev => {
                        const updated = { ...prev }
                        delete updated[currentRouteId]
                        try {
                          if (Object.keys(updated).length === 0) localStorage.removeItem('fcalendar_route_columns')
                          else localStorage.setItem('fcalendar_route_columns', JSON.stringify(updated))
                        } catch {}
                        return updated
                      })
                    }}
                  >
                    Reset to Default
                  </button>
                )}
                <div className="flex-1" />
                {columnsDirty && (
                  <button
                    className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                    onClick={() => setColumnApplyScopeOpen(true)}
                  >
                    Apply Changes
                  </button>
                )}
              </div>
            )}

            {settingsMenu === 'row' && (
              <div className="flex items-center gap-4">
                <div className="flex-1" />
                {draftRowOrder.some(r => r.position !== '') && !rowOrderError && (
                  <button
                    disabled={rowSaving}
                    className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700 disabled:opacity-50 flex items-center gap-1.5"
                    onClick={saveRowOrder}
                  >
                    {rowSaving ? (
                      <><Loader2 className="size-3.5 animate-spin" />Saving…</>
                    ) : rowSaved ? (
                      <><Check className="size-3.5" />Saved!</>
                    ) : (
                      'Save Order'
                    )}
                  </button>
                )}
              </div>
            )}

            {settingsMenu === 'sorting' && (
              <div className="flex items-center gap-4">
                {activeSortConfig !== null && (
                  <button
                    className="text-sm font-semibold text-red-600 transition-colors hover:text-red-700"
                    onClick={() => { setDraftSort(null); setActiveSortConfig(null) }}
                  >
                    Reset to Default
                  </button>
                )}
                <div className="flex-1" />
                {JSON.stringify(draftSort) !== JSON.stringify(activeSortConfig) && (
                  <button
                    className="text-sm font-semibold text-green-600 transition-colors hover:text-green-700"
                    onClick={() => {
                      if (activeSortConfig?.type === 'saved' && draftSort?.type === 'column') {
                        setSortConflictPending(draftSort)
                      } else {
                        setActiveSortConfig(draftSort)
                        setSettingsOpen(false)
                      }
                    }}
                  >
                    Apply Sorting
                  </button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Column Apply Scope Dialog */}
      <Dialog open={columnApplyScopeOpen} onOpenChange={setColumnApplyScopeOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center shrink-0">
                <TableProperties className="size-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Apply Column Settings</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Where should this column layout be applied?
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="px-5 py-4 space-y-2.5">
            {/* Apply for all routes */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-background hover:bg-muted/60 transition-colors text-left group"
              onClick={() => {
                setColumns([...draftColumns])
                // Clear all per-route overrides so global applies everywhere
                setRouteColumnOverrides({})
                try { localStorage.removeItem('fcalendar_route_columns') } catch {}
                setColumnApplyScopeOpen(false)
                setSettingsOpen(false)
              }}
            >
              <Route className="size-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Apply for All Routes</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                  Use this column layout across every route table
                </p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground/40 -rotate-90 shrink-0" />
            </button>
            {/* Only this route */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-background hover:bg-muted/60 transition-colors text-left group"
              onClick={() => {
                setRouteColumnOverrides(prev => {
                  const updated = { ...prev, [currentRouteId]: [...draftColumns] }
                  try { localStorage.setItem('fcalendar_route_columns', JSON.stringify(updated)) } catch {}
                  return updated
                })
                setColumnApplyScopeOpen(false)
                setSettingsOpen(false)
              }}
            >
              <MapPin className="size-4 text-violet-600 dark:text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Only This Route</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                  Apply only to <span className="font-semibold text-foreground">{currentRoute?.name ?? 'this route'}</span>
                </p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground/40 -rotate-90 shrink-0" />
            </button>
          </div>
          <div className="px-5 pb-5 flex justify-end border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setColumnApplyScopeOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sort Conflict Confirmation */}
      <Dialog open={!!sortConflictPending} onOpenChange={(o) => { if (!o) setSortConflictPending(null) }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Switch Sort Method?</DialogTitle>
            <DialogDescription>
              You currently have a <strong>My Sort List</strong> order active. Applying this sort will replace it with{' '}
              <strong>
                {sortConflictPending?.type === 'column'
                  ? `${sortConflictPending.key} (${sortConflictPending.dir === 'asc' ? 'A → Z' : 'Z → A'})`
                  : 'a new sort'}
              </strong>{' '}
              and your custom order will no longer be in use.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setSortConflictPending(null)}>Cancel</Button>
            <Button size="sm" onClick={() => {
              setActiveSortConfig(sortConflictPending)
              setSortConflictPending(null)
              setSettingsOpen(false)
            }}>Apply Anyway</Button>
          </div>
        </DialogContent>
      </Dialog>



    </div>
  )
}
