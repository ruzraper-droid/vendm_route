import { useEffect, useState } from "react"
import { RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { onSWUpdateReady, applySWUpdate } from "@/lib/pwa"

export function PWAUpdatePrompt() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    onSWUpdateReady(() => {
      setDismissed(false)
      setVisible(true)
    })
  }, [])

  const handleUpdate = () => {
    setUpdating(true)
    applySWUpdate()
  }

  const handleDismiss = () => {
    setDismissed(true)
    setTimeout(() => setVisible(false), 300)
  }

  if (!visible) return null

  return (
    <>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss update prompt"
        className={cn(
          "fixed inset-0 z-[9998] bg-black/40 backdrop-blur-[1px] transition-opacity duration-300",
          visible && !dismissed ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        className={cn(
          "fixed top-4 left-0 right-0 z-[9999] px-4 flex justify-center",
          "transition-all duration-300 ease-out",
          visible && !dismissed ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        )}
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-green-600 to-green-400 flex items-center justify-center shadow-md">
              <RefreshCw className="w-4 h-4 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">Update available</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                A new version is ready. Refresh to use the latest version.
              </p>
            </div>

            <button
              onClick={handleDismiss}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              onClick={handleDismiss}
            >
              Later
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={handleUpdate}
              disabled={updating}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", updating && "animate-spin")} />
              {updating ? "Updating..." : "Refresh now"}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
