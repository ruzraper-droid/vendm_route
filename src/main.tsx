import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { registerServiceWorker } from "./lib/pwa"
import { DEFAULT_APP_FONT, FONT_OPTIONS } from "./hooks/use-theme"

// ── Apply persisted display settings before first paint ──────────────────────
;(function applyStoredDisplaySettings() {
  try {
    // Color mode — apply immediately to avoid flash
    const colorMode = localStorage.getItem("colorMode") ?? "dark"
    document.documentElement.classList.toggle("dark", colorMode === "dark")
    localStorage.removeItem("eye-comfort")

    // App zoom — responsive default: 100% on mobile/tablet, 120% on desktop
    const rawZoom = localStorage.getItem("app-zoom")
    const allowedZooms = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"])
    const isSmallScreen = window.innerWidth < 1024
    const desktopDefault = "120"
    const mobileDefault  = "100"
    const responsiveDefault = isSmallScreen ? mobileDefault : desktopDefault
    // If stored zoom is the old desktop default ("120") but we're on a small screen, use mobile default
    const effectiveRaw = isSmallScreen && rawZoom === desktopDefault ? null : rawZoom
    const zoom = effectiveRaw !== null && allowedZooms.has(effectiveRaw) ? effectiveRaw : responsiveDefault
    document.body.style.zoom = `${zoom}%`

    // Re-apply responsive default zoom on orientation change / resize
    // (only when no user preference is explicitly stored)
    const handleResize = () => {
      const stored = localStorage.getItem("app-zoom")
      // Only auto-adjust if no explicit user preference is stored
      if (stored === null || !allowedZooms.has(stored)) {
        const small = window.innerWidth < 1024
        document.body.style.zoom = small ? `${mobileDefault}%` : `${desktopDefault}%`
      } else if (stored === desktopDefault && window.innerWidth < 1024) {
        // Stored value is the old auto-default; override on small screens
        document.body.style.zoom = `${mobileDefault}%`
      }
    }
    window.addEventListener("resize", handleResize, { passive: true })

    // Text size (root scale via CSS variable)
    const textSize = localStorage.getItem("text-size") ?? "14"
    document.documentElement.style.setProperty("--text-size-base", `${textSize}px`)

    // Font family
    const storedFont = localStorage.getItem("app-font")
    const hasValidStoredFont = storedFont !== null && FONT_OPTIONS.some(f => f.id === storedFont)
    const fontId = hasValidStoredFont ? storedFont : DEFAULT_APP_FONT
    if (!hasValidStoredFont) localStorage.setItem("app-font", DEFAULT_APP_FONT)
    const fontOpt = FONT_OPTIONS.find(f => f.id === fontId)
    if (fontOpt) {
      // Inject Google Fonts link if needed
      if (fontOpt.googleId) {
        const link = document.createElement("link")
        link.rel  = "stylesheet"
        link.href = `https://fonts.googleapis.com/css2?family=${fontOpt.googleId}&display=swap`
        document.head.appendChild(link)
      }
      // Optionally preload the configured default app font when it is a Google font.
      const defaultFont = FONT_OPTIONS.find(f => f.id === DEFAULT_APP_FONT)
      if (defaultFont?.googleId && fontOpt.googleId !== defaultFont.googleId) {
        const preload = document.createElement("link")
        preload.rel  = "stylesheet"
        preload.href = `https://fonts.googleapis.com/css2?family=${defaultFont.googleId}&display=swap`
        document.head.appendChild(preload)
      }
      document.documentElement.style.setProperty("--app-font", fontOpt.family)
      document.body.style.fontFamily = fontOpt.family
    }
  } catch { /* localStorage may be unavailable */ }
})()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
      <App />
  </StrictMode>
)

// Register service worker for PWA functionality
registerServiceWorker()
