export const LS_ROUTE_COLORS = "fcalendar_route_colors"

export const DEFAULT_ROUTE_COLORS = ["#374151", "#7c3aed", "#0891b2", "#16a34a", "#dc2626", "#d97706"]

export function getRouteColorPalette(): string[] {
  try {
    const v = localStorage.getItem(LS_ROUTE_COLORS)
    if (v) return JSON.parse(v)
  } catch {
    // Ignore invalid stored values and fall back to defaults.
  }
  return DEFAULT_ROUTE_COLORS
}
