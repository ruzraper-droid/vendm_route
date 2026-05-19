import { useState, useEffect, useRef, useCallback } from "react"
import { useRegisterRefresh } from "@/contexts/RefreshContext"
import { ImageIcon, LayoutGrid } from "lucide-react"
import { LoadingState } from "@/components/ui/loading"
import "lightgallery/css/lightgallery.css"
import "lightgallery/css/lg-thumbnail.css"
import "lightgallery/css/lg-zoom.css"

interface PlanoImage {
  id: string
  url: string
  title: string
  description: string
}

interface PlanoRow {
  id: string
  title: string
  images: PlanoImage[]
}

interface PlanoPage {
  id: string
  name: string
  rows: PlanoRow[]
}

interface FlatImage extends PlanoImage {
  pageName: string
  rowTitle: string
}

type GridSize = 2 | 3 | 4 | 6 | 8

const GRID_OPTIONS: { value: GridSize; label: string }[] = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 6, label: "6" },
  { value: 8, label: "8" },
]

const gridClass: Record<GridSize, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  6: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6",
  8: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8",
}

const GALLERY_ID = "album-lightgallery"

export function Album() {
  const [pages, setPages] = useState<PlanoPage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterPage, setFilterPage] = useState<string>("all")
  const [gridSize, setGridSize] = useState<GridSize>(4)
  const [showGridPicker, setShowGridPicker] = useState(false)
  const lgInstanceRef = useRef<any>(null)

  const loadAlbum = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/plano")
      if (!res.ok) throw new Error("Failed to load")
      const json = await res.json()
      setPages(json.data ?? [])
    } catch (e: any) {
      setLoadError(e.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadAlbum() }, [loadAlbum])
  useRegisterRefresh(loadAlbum)

  // Flatten all images from all pages/rows
  const allImages: FlatImage[] = pages.flatMap(page =>
    page.rows.flatMap(row =>
      row.images.map(img => ({
        ...img,
        pageName: page.name,
        rowTitle: row.title,
      }))
    )
  )

  const filteredImages =
    filterPage === "all"
      ? allImages
      : allImages.filter(img => img.pageName === filterPage)

  const pageNames = pages.map(p => p.name)

  // Initialize / reinitialize lightgallery whenever filtered images change
  useEffect(() => {
    if (filteredImages.length === 0) return

    const init = async () => {
      try {
        const { default: lightGallery } = await import("lightgallery")
        const { default: lgThumbnail } = await import("lightgallery/plugins/thumbnail")
        const { default: lgZoom } = await import("lightgallery/plugins/zoom")

        await new Promise(resolve => setTimeout(resolve, 200))

        // Destroy previous instance
        if (lgInstanceRef.current?.destroy) {
          lgInstanceRef.current.destroy()
          lgInstanceRef.current = null
        }

        const el = document.getElementById(GALLERY_ID)
        if (!el) return
        const links = el.querySelectorAll("a")
        if (links.length === 0) return

        lgInstanceRef.current = lightGallery(el, {
          plugins: [lgThumbnail, lgZoom],
          speed: 500,
          thumbnail: true,
          animateThumb: false,
          allowMediaOverlap: true,
          toggleThumb: true,
        })
      } catch (err) {
        console.error("LightGallery init error:", err)
      }
    }

    init()

    return () => {
      if (lgInstanceRef.current?.destroy) {
        lgInstanceRef.current.destroy()
        lgInstanceRef.current = null
      }
    }
  }, [filteredImages])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <LoadingState
          message="Loading album…"
          description="Gathering images and album details."
          className="max-w-md"
        />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-destructive text-sm">
        {loadError}
      </div>
    )
  }

  if (allImages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
        <ImageIcon className="size-12 opacity-30" />
        <p className="text-sm">No images uploaded yet.</p>
        <p className="text-xs text-muted-foreground/60">Upload images in Plano VM to see them here.</p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-y-auto"
      style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-3 max-w-5xl mx-auto w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <ImageIcon className="size-4 shrink-0 text-primary" />
              <h2 className="text-base font-semibold tracking-tight text-foreground">Album</h2>
            </div>
            <p className="ml-7 text-sm text-muted-foreground leading-relaxed">
              {allImages.length} images across {pages.length} pages
            </p>
          </div>

          {/* Grid size picker */}
          <div className="relative">
            <button
              onClick={() => setShowGridPicker(v => !v)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-muted text-muted-foreground hover:bg-muted-foreground/20 text-xs font-medium transition-colors"
            >
              <LayoutGrid className="size-3.5" />
              Grid {gridSize}
            </button>
            {showGridPicker && (
              <>
                {/* backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setShowGridPicker(false)} />
                <div className="absolute right-0 top-9 z-20 bg-popover border border-border rounded-xl shadow-lg p-2 flex gap-1">
                  {GRID_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setGridSize(opt.value); setShowGridPicker(false) }}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        gridSize === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Page filter chips */}
      {pageNames.length > 0 && (
        <div className="px-4 pb-4 max-w-5xl mx-auto w-full flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterPage("all")}
            className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
              filterPage === "all"
                ? "bg-foreground text-background shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
            }`}
          >
            All
          </button>
          {pageNames.map(name => (
            <button
              key={name}
              onClick={() => setFilterPage(name)}
              className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                filterPage === name
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Image grid — lightgallery container */}
      <div className="px-4 max-w-5xl mx-auto w-full">
        {filteredImages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No images in this page.</p>
        ) : (
          <div
            id={GALLERY_ID}
            className={`grid gap-1.5 ${gridClass[gridSize]}`}
          >
            {filteredImages.map(img => (
              <a
                key={img.id}
                href={img.url}
                data-sub-html={`<h4>${img.title || ""}</h4><p>${img.description || ""}${img.pageName ? ` · ${img.pageName}` : ""}</p>`}
                className="relative group aspect-square rounded-xl overflow-hidden bg-muted ring-1 ring-border/40 shadow-sm hover:ring-primary/50 hover:shadow-md transition-all block"
              >
                <img
                  src={img.url}
                  alt={img.title || "Plano image"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                  onError={e => {
                    (e.target as HTMLImageElement).src =
                      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23e2e8f0'/%3E%3C/svg%3E"
                  }}
                />
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-end">
                  {img.title && (
                    <p className="w-full px-2 pb-2 pt-6 text-[11px] text-white font-medium truncate opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent">
                      {img.title}
                    </p>
                  )}
                </div>
                {/* Page badge */}
                <span className="absolute top-1.5 left-1.5 bg-black/50 text-white text-[9px] px-1.5 py-0.5 rounded-md font-medium truncate max-w-[70%] opacity-0 group-hover:opacity-100 transition-opacity">
                  {img.pageName}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
