import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parses a freeform search string and extracts an optional shift keyword.
 *
 * Examples:
 *   "sel 3 am"  → { nameQuery: "sel 3", shiftFilter: "AM" }
 *   "KL 7 PM"   → { nameQuery: "KL 7", shiftFilter: "PM" }
 *   "sel"       → { nameQuery: "sel",   shiftFilter: null }
 *   "am"        → { nameQuery: "",      shiftFilter: "AM" }
 */
export function parseSmartQuery(raw: string): {
  nameQuery: string
  shiftFilter: "AM" | "PM" | null
} {
  const tokens = raw.trim().split(/\s+/)
  let shiftFilter: "AM" | "PM" | null = null
  const nameTokens: string[] = []

  for (const token of tokens) {
    const t = token.toLowerCase()
    if (t === "am") {
      shiftFilter = "AM"
    } else if (t === "pm") {
      shiftFilter = "PM"
    } else if (token) {
      nameTokens.push(token)
    }
  }

  return { nameQuery: nameTokens.join(" "), shiftFilter }
}
