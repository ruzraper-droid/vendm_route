import * as React from "react"
import { useDeviceType, type DeviceType } from "@/hooks/use-mobile"

interface DeviceContextValue {
  device: DeviceType
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  isTouch: boolean
  /** Compatibility font scale factor (kept stable at 1). */
  fontScale: number
}

const DeviceContext = React.createContext<DeviceContextValue>({
  device: "desktop",
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isTouch: false,
  fontScale: 1,
})

/**
 * DeviceProvider
 * – Detects device type (mobile / tablet / desktop) via window resize listener.
 * – Writes `data-device` and `data-touch` to the root <html> element so CSS
 *   can target each breakpoint with plain attribute selectors.
 * – Keeps `--app-font-scale` stable at 1 so typography stays consistent
 *   across device categories.
 */
export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const device = useDeviceType()

  const isMobile  = device === "mobile"
  const isTablet  = device === "tablet"
  const isDesktop = device === "desktop"
  const isTouch   = React.useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  )
  const fontScale = 1

  // Sync HTML data-attributes whenever device changes
  React.useEffect(() => {
    const html = document.documentElement
    html.setAttribute("data-device", device)
    html.setAttribute("data-touch", isTouch ? "true" : "false")
    // Keep font scale deterministic across all devices.
    html.style.setProperty("--app-font-scale", String(fontScale))
  }, [device, isTouch, fontScale])

  const value = React.useMemo<DeviceContextValue>(
    () => ({ device, isMobile, isTablet, isDesktop, isTouch, fontScale }),
    [device, isMobile, isTablet, isDesktop, isTouch, fontScale]
  )

  return (
    <DeviceContext.Provider value={value}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDevice() {
  return React.useContext(DeviceContext)
}
