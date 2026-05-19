import { useEffect, useState } from "react"

export type ColorMode = "light" | "dark"

/** meta theme-color backgrounds */
const META_BG: Record<ColorMode, string> = {
  light: "#f1f4f7",
  dark:  "#0b0b0b",
}

const META_TILE: Record<ColorMode, string> = {
  light: "#e4ecf3",
  dark:  "#161b2a",
}

const APPLE_STATUS_BAR_STYLE: Record<ColorMode, string> = {
  light: "default",
  dark:  "black-translucent",
}

export type AppFont =
  | "system"
  | "inter"
  | "poppins"
  | "roboto"
  | "nunito"
  | "plus-jakarta-sans"
  | "quicksand"
  | "figtree"
  | "barlow"
  | "ubuntu"
  | "work-sans"
  | "outfit"
  | "caveat"

export const FONT_OPTIONS: { id: AppFont; label: string; family: string; googleId?: string }[] = [
  { id: "system",            label: "System Default",    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: "inter",             label: "Inter",             family: "'Inter', sans-serif",             googleId: "Inter:wght@300;400;500;600;700" },
  { id: "poppins",           label: "Poppins",           family: "'Poppins', sans-serif",           googleId: "Poppins:wght@300;400;500;600;700" },
  { id: "roboto",            label: "Roboto",            family: "'Roboto', sans-serif",            googleId: "Roboto:wght@300;400;500;700" },
  { id: "nunito",            label: "Nunito",            family: "'Nunito', sans-serif",            googleId: "Nunito:wght@300;400;500;600;700" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans", family: "'Plus Jakarta Sans', sans-serif", googleId: "Plus+Jakarta+Sans:wght@300;400;500;600;700" },
  { id: "quicksand",         label: "Quicksand",         family: "'Quicksand', sans-serif",         googleId: "Quicksand:wght@300;400;500;600;700" },
  { id: "figtree",           label: "Figtree",           family: "'Figtree', sans-serif",           googleId: "Figtree:wght@300;400;500;600;700" },
  { id: "barlow",            label: "Barlow",            family: "'Barlow', sans-serif",            googleId: "Barlow:wght@300;400;500;600;700" },
  { id: "ubuntu",            label: "Ubuntu",            family: "'Ubuntu', sans-serif",            googleId: "Ubuntu:wght@300;400;500;700" },
  { id: "work-sans",         label: "Work Sans",         family: "'Work Sans', sans-serif",         googleId: "Work+Sans:wght@300;400;500;600;700" },
  { id: "outfit",            label: "Outfit",            family: "'Outfit', sans-serif",            googleId: "Outfit:wght@300;400;500;600;700" },
  { id: "caveat",            label: "Caveat",            family: "'Caveat', cursive",               googleId: "Caveat:wght@400;500;600;700" },
]

export const DEFAULT_APP_FONT: AppFont = "system"

function getStoredOrDefaultFont(): AppFont {
  const stored = localStorage.getItem("app-font")
  const isValid = stored !== null && FONT_OPTIONS.some(f => f.id === stored)
  if (isValid) return stored as AppFont
  localStorage.setItem("app-font", DEFAULT_APP_FONT)
  return DEFAULT_APP_FONT
}

export type AppZoom = "80" | "85" | "90" | "95" | "100" | "105" | "110" | "115" | "120"
export type TextSize = "13" | "14" | "15" | "16" | "17" | "18" | "20"

const APP_ZOOM_OPTIONS: AppZoom[] = ["80", "85", "90", "95", "100", "105", "110", "115", "120"]

function getStoredOrDefaultZoom(): AppZoom {
  const stored = localStorage.getItem("app-zoom")
  if (stored !== null && APP_ZOOM_OPTIONS.includes(stored as AppZoom)) return stored as AppZoom
  localStorage.setItem("app-zoom", "120")
  return "120"
}

/** Inject a Google Fonts <link> once per googleId */
const loadedFonts = new Set<string>()
function loadGoogleFont(googleId: string) {
  if (loadedFonts.has(googleId)) return
  loadedFonts.add(googleId)
  const link = document.createElement("link")
  link.rel  = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?family=${googleId}&display=swap`
  document.head.appendChild(link)
}

export function useTheme() {
  const [mode, setMode] = useState<ColorMode>(() =>
    (localStorage.getItem("colorMode") as ColorMode) ?? "dark"
  )
  const [appFont, setAppFont] = useState<AppFont>(() =>
    getStoredOrDefaultFont()
  )
  const [appZoom, setAppZoom] = useState<AppZoom>(() =>
    getStoredOrDefaultZoom()
  )
  const [textSize, setTextSize] = useState<TextSize>(() =>
    (localStorage.getItem("text-size") as TextSize) ?? "14"
  )

  // Apply color mode
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", mode === "dark")
    // Remove legacy data-theme attribute
    root.removeAttribute("data-theme")
    localStorage.setItem("colorMode", mode)
    // Update PWA meta theme-color
    const metaColor = META_BG[mode]
    const allMetas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    if (allMetas.length === 0) {
      const meta = document.createElement("meta")
      meta.name = "theme-color"
      meta.setAttribute("content", metaColor)
      document.head.appendChild(meta)
    } else {
      allMetas.forEach(meta => meta.setAttribute("content", metaColor))
    }

    const tileColor = META_TILE[mode]
    document.querySelectorAll<HTMLMetaElement>('meta[name="msapplication-TileColor"]').forEach(meta => {
      meta.setAttribute("content", tileColor)
    })

    const statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (statusBar) {
      statusBar.setAttribute("content", APPLE_STATUS_BAR_STYLE[mode])
    }
  }, [mode])

  // Apply font
  useEffect(() => {
    const opt = FONT_OPTIONS.find(f => f.id === appFont)
    if (!opt) return
    if (opt.googleId) loadGoogleFont(opt.googleId)
    document.documentElement.style.setProperty("--app-font", opt.family)
    document.body.style.fontFamily = opt.family
    localStorage.setItem("app-font", appFont)
  }, [appFont])

  // Apply zoom (applied to body to avoid viewport distortion)
  useEffect(() => {
    document.body.style.zoom = `${appZoom}%`
    localStorage.setItem("app-zoom", appZoom)
  }, [appZoom])

  // Apply text size via CSS custom property as single source of truth
  useEffect(() => {
    document.documentElement.style.setProperty("--text-size-base", `${textSize}px`)
    localStorage.setItem("text-size", textSize)
  }, [textSize])

  // App language is fixed to English
  useEffect(() => {
    document.documentElement.setAttribute("lang", "en")
  }, [])

  const toggleMode = () => setMode(prev => prev === "light" ? "dark" : "light")

  // Backward-compat aliases
  const theme = mode
  const setTheme = setMode
  const toggleTheme = toggleMode

  return {
    mode, setMode, toggleMode,
    theme, setTheme, toggleTheme,
    appFont, setAppFont,
    appZoom, setAppZoom,
    textSize, setTextSize,
  }
}
