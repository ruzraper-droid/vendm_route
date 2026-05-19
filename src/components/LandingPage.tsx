import { useState, useEffect } from "react"
import { ArrowRight, CalendarDays, MapPin, Package, Layers, Users, Sun, Moon } from "lucide-react"
import { useTheme } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Route Calendar",
    description: "Plan and track daily delivery routes with colour-coded schedules.",
    color: "theme-accent-blue",
  },
  {
    icon: MapPin,
    title: "Location Tracking",
    description: "Log delivery locations and manage stop records efficiently.",
    color: "theme-accent-emerald",
  },
  {
    icon: Package,
    title: "VM Management",
    description: "Monitor vending machine stock, planograms, and movements.",
    color: "theme-accent-orange",
  },
  {
    icon: Users,
    title: "Rooster",
    description: "View shift schedules in weekly or monthly calendar view.",
    color: "theme-accent-violet",
  },
  {
    icon: Layers,
    title: "Gallery",
    description: "Store and browse VM photo albums organised by album.",
    color: "theme-accent-pink",
  },
]

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const { mode, toggleMode } = useTheme()
  const isDark = mode === "dark"

  useEffect(() => {
    // Slight delay so the fade-in triggers after mount
    const t = setTimeout(() => setVisible(true), 30)
    return () => clearTimeout(t)
  }, [])

  const handleEnter = () => {
    setExiting(true)
    setTimeout(onEnter, 450)
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col overflow-y-auto transition-opacity duration-300 ease-in-out ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Exit overlay */}
      <div
        className={`pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-400 ease-in-out ${exiting ? "opacity-100" : "opacity-0"}`}
      />

      {/* Background */}
      {isDark ? (
        <>
          <div className="absolute inset-0 bg-[hsl(var(--background))]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,hsl(var(--primary)/0.18),transparent_38%),radial-gradient(circle_at_80%_70%,hsl(var(--accent)/0.14),transparent_42%)]" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-[hsl(var(--background))]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.16),transparent_42%),radial-gradient(circle_at_78%_75%,hsl(var(--accent)/0.11),transparent_40%)]" />
        </>
      )}

      {/* Theme toggle */}
      <div className="relative z-10 flex justify-end px-5 sm:px-8 pt-5">
        <Button
          onClick={toggleMode}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          size="sm"
          variant="ghost"
          className="p-2 hover:opacity-80 transition-opacity active:scale-[0.94]"
        >
          {isDark ? <Sun className="size-5 text-amber-400" /> : <Moon className="size-5 text-blue-900" />}
        </Button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-start sm:justify-center min-h-[calc(100%-3rem)] px-5 sm:px-8 pt-10 pb-20 sm:py-20">
        {/* Hero Section */}
        <div className="w-full max-w-3xl mx-auto text-center space-y-6 sm:space-y-8">
          {/* Main Title */}
          <h1
            className={`mx-auto max-w-[14ch] px-2 text-[clamp(1.1rem,5.5vw,1.75rem)] sm:text-[1.25rem] lg:text-[1.55rem] font-bold tracking-tight break-words [text-wrap:balance] text-foreground transition-all duration-700 ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
            style={{ transitionDelay: visible ? "100ms" : "0ms" }}
          >
            Info Driver
          </h1>

          {/* Description */}
          <p
            className={`text-sm sm:text-base max-w-md mx-auto leading-relaxed text-muted-foreground transition-all duration-700 ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
            style={{ transitionDelay: visible ? "150ms" : "0ms" }}
          >
            Streamline your delivery routes, track locations, and manage operations with a single powerful tool.
          </p>

          {/* CTA Button */}
          <Button
            onClick={handleEnter}
            variant="outline"
            className={`landing-cta group relative inline-flex items-center gap-2 border-border/90 bg-card/85 text-foreground hover:bg-card hover:border-ring/60 shadow-sm ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
            style={{ transitionDelay: visible ? "200ms" : "0ms" }}
          >
            <span>Get Started</span>
            <ArrowRight className="landing-cta-arrow size-4" />
          </Button>

          {/* Features Grid */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-10 sm:mt-14 transition-all duration-700 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
            style={{ transitionDelay: visible ? "250ms" : "0ms" }}
          >
            {FEATURES.map(({ icon: Icon, title, description, color }) => (
              <Card
                key={title}
                className="group relative cursor-default gap-0 rounded-2xl border-border/70 bg-card/70 py-4 sm:py-5 hover:scale-[1.03] hover:bg-card/95 hover:shadow-md transition-all duration-300"
              >
                <CardHeader className="mb-3 px-4 sm:px-5">
                  <CardTitle className="flex items-center gap-2.5 text-sm leading-none text-foreground">
                    <span className={`${color} rounded-lg bg-foreground/5 p-1.5`}>
                    <Icon className="size-4" />
                    </span>
                    <span>{title}</span>
                  </CardTitle>
                </CardHeader>
                <CardDescription className="px-4 text-left text-xs leading-relaxed sm:px-5">{description}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
