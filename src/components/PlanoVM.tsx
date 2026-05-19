import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRegisterRefresh } from "@/contexts/RefreshContext"
import { Plus, Trash2, ChevronLeft, ChevronRight, Image as ImageIcon, Pencil, MoreVertical, ArrowUp, ArrowDown, Upload, Link, Loader2, Save, Layers, Search, ChevronDown } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingState } from "@/components/ui/loading"
import { useEditMode } from "@/contexts/EditModeContext"
import { uploadImageToImgBB } from "@/lib/imgbb"
import "lightgallery/css/lightgallery.css"
import "lightgallery/css/lg-thumbnail.css"
import "lightgallery/css/lg-zoom.css"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

interface AlbumImageOption extends PlanoImage {
  pageId: string
  pageName: string
  rowId: string
  rowTitle: string
}

export function PlanoVM() {
  const { isEditMode, setHasUnsavedChanges, registerSaveHandler, registerDiscardHandler, hasUnsavedChanges, isSaving, saveChanges } = useEditMode()
  const lightGalleryRefs = useRef<Map<string, any>>(new Map())
  const [selectedImage, setSelectedImage] = useState<{ url: string; title: string; description: string } | null>(null)
  const [pages, setPages] = useState<PlanoPage[]>([])
  const pagesSnapshotRef = useRef<PlanoPage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load data from database on mount
  const loadPages = useCallback(async () => {
    try {
      setIsLoading(true)
      setLoadError(null)
      const res = await fetch('/api/plano')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const loaded: PlanoPage[] = json.data ?? []
      setPages(loaded)
      setActivePage(prev => {
        if (prev && loaded.some(p => p.id === prev)) return prev
        return loaded.length > 0 ? loaded[0].id : ""
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadPages() }, [loadPages])
  useRegisterRefresh(loadPages)

  const [activePage, setActivePage] = useState<string>("")
  const [pageListOpen, setPageListOpen] = useState(false)
  const [addPageDialog, setAddPageDialog] = useState(false)
  const [editPageDialog, setEditPageDialog] = useState<{ open: boolean; pageId?: string }>({ open: false })
  const [deletePageDialog, setDeletePageDialog] = useState<{ open: boolean; pageId?: string }>({ open: false })
  const [addRowDialog, setAddRowDialog] = useState(false)
  const [editRowDialog, setEditRowDialog] = useState<{ open: boolean; rowId?: string }>({ open: false })
  const [deleteRowDialog, setDeleteRowDialog] = useState<{ open: boolean; rowId?: string }>({ open: false })
  const [addImageDialog, setAddImageDialog] = useState<{ open: boolean; rowId?: string }>({ open: false })
  const [editImageDialog, setEditImageDialog] = useState<{ open: boolean; rowId?: string; imageId?: string }>({ open: false })
  const [deleteImageDialog, setDeleteImageDialog] = useState<{ open: boolean; rowId?: string; imageId?: string }>({ open: false })
  const [hoveredImage, setHoveredImage] = useState<string | null>(null)
  
  const [newPageName, setNewPageName] = useState("")
  const [editPageName, setEditPageName] = useState("")
  const [newRowTitle, setNewRowTitle] = useState("")
  const [editRowTitle, setEditRowTitle] = useState("")
  const [newImage, setNewImage] = useState({ url: "", title: "", description: "" })
  const [editImage, setEditImage] = useState({ url: "", title: "", description: "" })
  const [searchQuery, setSearchQuery] = useState("")
  const [addImageTab, setAddImageTab] = useState<"url" | "upload" | "album">("url")
  const [editImageTab, setEditImageTab] = useState<"url" | "upload" | "album">("url")
  const [addAlbumPageFilter, setAddAlbumPageFilter] = useState<string>("all")
  const [editAlbumPageFilter, setEditAlbumPageFilter] = useState<string>("all")
  const [addAlbumQuery, setAddAlbumQuery] = useState("")
  const [editAlbumQuery, setEditAlbumQuery] = useState("")
  const [addUploadPreview, setAddUploadPreview] = useState<string | null>(null)
  const [editUploadPreview, setEditUploadPreview] = useState<string | null>(null)
  const [addUploading, setAddUploading] = useState(false)
  const [editUploading, setEditUploading] = useState(false)
  const addFileRef = useRef<HTMLInputElement>(null)
  const editFileRef = useRef<HTMLInputElement>(null)

  const currentPage = pages.find(p => p.id === activePage)

  const albumImages = useMemo<AlbumImageOption[]>(() => {
    return pages.flatMap((page) =>
      page.rows.flatMap((row) =>
        row.images.map((image) => ({
          ...image,
          pageId: page.id,
          pageName: page.name,
          rowId: row.id,
          rowTitle: row.title,
        }))
      )
    )
  }, [pages])

  const albumPageNames = useMemo(
    () => Array.from(new Set(albumImages.map((image) => image.pageName))),
    [albumImages]
  )

  const addFilteredAlbumImages = useMemo(() => {
    const q = addAlbumQuery.trim().toLowerCase()
    return albumImages.filter((image) => {
      const pageMatch = addAlbumPageFilter === "all" || image.pageName === addAlbumPageFilter
      if (!pageMatch) return false
      if (!q) return true
      return (
        image.title.toLowerCase().includes(q) ||
        image.description.toLowerCase().includes(q) ||
        image.rowTitle.toLowerCase().includes(q) ||
        image.pageName.toLowerCase().includes(q)
      )
    })
  }, [addAlbumPageFilter, addAlbumQuery, albumImages])

  const editFilteredAlbumImages = useMemo(() => {
    const q = editAlbumQuery.trim().toLowerCase()
    return albumImages.filter((image) => {
      const pageMatch = editAlbumPageFilter === "all" || image.pageName === editAlbumPageFilter
      if (!pageMatch) return false
      if (!q) return true
      return (
        image.title.toLowerCase().includes(q) ||
        image.description.toLowerCase().includes(q) ||
        image.rowTitle.toLowerCase().includes(q) ||
        image.pageName.toLowerCase().includes(q)
      )
    })
  }, [editAlbumPageFilter, editAlbumQuery, albumImages])

  const getPagePreviewImage = (page: PlanoPage): string | null => {
    for (const row of page.rows) {
      const firstImage = row.images[0]
      if (firstImage?.url) return firstImage.url
    }
    return null
  }

  const filteredRows = useMemo(() => {
    if (!currentPage) return [] as PlanoRow[]
    const q = searchQuery.trim().toLowerCase()
    if (!q) return currentPage.rows

    return currentPage.rows
      .map((row) => {
        const rowMatch = row.title.toLowerCase().includes(q)
        if (rowMatch) return row

        const matchedImages = row.images.filter((image) =>
          image.title.toLowerCase().includes(q) ||
          image.description.toLowerCase().includes(q)
        )

        if (matchedImages.length === 0) return null
        return { ...row, images: matchedImages }
      })
      .filter((row): row is PlanoRow => row !== null)
  }, [currentPage, searchQuery])

  // Register save handler so App-level Save button persists to DB
  useEffect(() => {
    const unregister = registerSaveHandler(async () => {
      const res = await fetch('/api/plano', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
    })
    return unregister
  }, [pages, registerSaveHandler])

  // Snapshot pages when edit mode turns ON for instant discard
  useEffect(() => {
    if (isEditMode) {
      pagesSnapshotRef.current = JSON.parse(JSON.stringify(pages))
    }
  }, [isEditMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Register discard handler — restore snapshot instantly
  useEffect(() => {
    registerDiscardHandler(() => {
      setPages(pagesSnapshotRef.current)
      if (pagesSnapshotRef.current.length > 0) setActivePage(pagesSnapshotRef.current[0].id)
    })
  }, [registerDiscardHandler])

  // Initialize lightGallery for each row when not in edit mode
  useEffect(() => {
    const initLightGallery = async () => {
      if (!isEditMode && currentPage && currentPage.rows.length > 0) {
        
        try {
          // Dynamic import - use proper destructuring for default exports
          const { default: lightGallery } = await import('lightgallery')
          const { default: lgThumbnail } = await import('lightgallery/plugins/thumbnail')
          const { default: lgZoom } = await import('lightgallery/plugins/zoom')

          // Wait for DOM
          await new Promise(resolve => setTimeout(resolve, 300))

          // Cleanup previous instances
          lightGalleryRefs.current.forEach((instance) => {
            if (instance && instance.destroy) {
              instance.destroy()
            }
          })
          lightGalleryRefs.current.clear()

          // Initialize for each row
          currentPage.rows.forEach((row) => {
            if (row.images.length > 0) {
              const element = document.getElementById(`lightgallery-${row.id}`)
              
              if (element) {
                const links = element.querySelectorAll('a')
                
                if (links.length > 0) {
                  const instance = lightGallery(element, {
                    plugins: [lgThumbnail, lgZoom],
                    speed: 500,
                    thumbnail: true,
                    animateThumb: false,
                    allowMediaOverlap: true,
                    toggleThumb: true,
                  })
                  lightGalleryRefs.current.set(row.id, instance)
                }
              }
            }
          })
        } catch (error) {
          console.error('❌ LightGallery initialization error:', error)
        }
      } else {
        // Cleanup when switching to edit mode
        lightGalleryRefs.current.forEach((instance) => {
          if (instance && instance.destroy) {
            instance.destroy()
          }
        })
        lightGalleryRefs.current.clear()
      }
    }

    initLightGallery()

    return () => {
      lightGalleryRefs.current.forEach((instance) => {
        if (instance && instance.destroy) {
          instance.destroy()
        }
      })
      lightGalleryRefs.current.clear()
    }
  }, [isEditMode, currentPage])

  const handleAddPage = () => {
    if (!newPageName) return
    
    const newPage: PlanoPage = {
      id: `page-${Date.now()}`,
      name: newPageName,
      rows: []
    }
    setPages([...pages, newPage])
    setActivePage(newPage.id)
    setNewPageName("")
    setAddPageDialog(false)
    setHasUnsavedChanges(true)
  }

  const handleEditPage = () => {
    if (!editPageName) return
    if (!editPageDialog.pageId) return
    
    setPages(pages.map(page => 
      page.id === editPageDialog.pageId
        ? { ...page, name: editPageName }
        : page
    ))
    
    setEditPageName("")
    setEditPageDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleDeletePage = () => {
    if (!deletePageDialog.pageId) return
    
    const updatedPages = pages.filter(page => page.id !== deletePageDialog.pageId)
    setPages(updatedPages)
    
    // If deleting the active page, switch to first available page
    if (activePage === deletePageDialog.pageId && updatedPages.length > 0) {
      setActivePage(updatedPages[0].id)
    }
    
    setDeletePageDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleAddRow = () => {
    if (!newRowTitle) return
    
    const newRow: PlanoRow = {
      id: `row-${Date.now()}`,
      title: newRowTitle,
      images: []
    }
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? { ...page, rows: [...page.rows, newRow] }
        : page
    ))
    setNewRowTitle("")
    setAddRowDialog(false)
    setHasUnsavedChanges(true)
  }

  const handleEditRow = () => {
    if (!editRowTitle) return
    if (!editRowDialog.rowId) return
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? {
            ...page,
            rows: page.rows.map(row => 
              row.id === editRowDialog.rowId
                ? { ...row, title: editRowTitle }
                : row
            )
          }
        : page
    ))
    
    setEditRowTitle("")
    setEditRowDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleMoveRowUp = (rowId: string) => {
    setPages(pages.map(page => {
      if (page.id !== activePage) return page
      
      const rowIndex = page.rows.findIndex(r => r.id === rowId)
      if (rowIndex <= 0) return page
      
      const newRows = [...page.rows]
      const temp = newRows[rowIndex]
      newRows[rowIndex] = newRows[rowIndex - 1]
      newRows[rowIndex - 1] = temp
      
      return { ...page, rows: newRows }
    }))
    setHasUnsavedChanges(true)
  }

  const handleMoveRowDown = (rowId: string) => {
    setPages(pages.map(page => {
      if (page.id !== activePage) return page
      
      const rowIndex = page.rows.findIndex(r => r.id === rowId)
      if (rowIndex >= page.rows.length - 1) return page
      
      const newRows = [...page.rows]
      const temp = newRows[rowIndex]
      newRows[rowIndex] = newRows[rowIndex + 1]
      newRows[rowIndex + 1] = temp
      
      return { ...page, rows: newRows }
    }))
    setHasUnsavedChanges(true)
  }

  const handleDeleteRow = () => {
    if (!deleteRowDialog.rowId) return
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? { ...page, rows: page.rows.filter(row => row.id !== deleteRowDialog.rowId) }
        : page
    ))
    
    setDeleteRowDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleAddImage = () => {
    if (!newImage.url || !newImage.title) return
    if (!addImageDialog.rowId) return
    
    const image: PlanoImage = {
      id: `img-${Date.now()}`,
      ...newImage
    }
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? {
            ...page,
            rows: page.rows.map(row => 
              row.id === addImageDialog.rowId
                ? { ...row, images: [...row.images, image] }
                : row
            )
          }
        : page
    ))
    
    setNewImage({ url: "", title: "", description: "" })
    setAddImageTab("url")
    setAddUploadPreview(null)
    setAddImageDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleEditImage = () => {
    if (!editImage.url || !editImage.title) return
    if (!editImageDialog.rowId || !editImageDialog.imageId) return
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? {
            ...page,
            rows: page.rows.map(row => 
              row.id === editImageDialog.rowId
                ? { 
                    ...row, 
                    images: row.images.map(img => 
                      img.id === editImageDialog.imageId
                        ? { ...img, ...editImage }
                        : img
                    )
                  }
                : row
            )
          }
        : page
    ))
    
    setEditImage({ url: "", title: "", description: "" })
    setEditImageTab("url")
    setEditUploadPreview(null)
    setEditImageDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const handleDeleteImage = () => {
    if (!deleteImageDialog.rowId || !deleteImageDialog.imageId) return
    
    setPages(pages.map(page => 
      page.id === activePage 
        ? {
            ...page,
            rows: page.rows.map(row => 
              row.id === deleteImageDialog.rowId
                ? { ...row, images: row.images.filter(img => img.id !== deleteImageDialog.imageId) }
                : row
            )
          }
        : page
    ))
    
    setDeleteImageDialog({ open: false })
    setHasUnsavedChanges(true)
  }

  const scrollRow = (rowId: string, direction: 'left' | 'right') => {
    const elementId = isEditMode ? `row-${rowId}` : `lightgallery-${rowId}`
    const element = document.getElementById(elementId)
    if (!element) return
    
    const scrollAmount = 400
    element.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[40vh] p-4 sm:p-6">
        <LoadingState
          message="Loading data…"
          description="Preparing the planogram workspace."
          className="max-w-md"
        />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center min-h-[40vh] gap-3 text-destructive">
        <p className="font-medium">Failed to load data</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-background overflow-y-auto">
      {/* Content */}
      <div className="px-8 py-6">
        {/* Title and Add Page Button */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <Layers className="size-4 shrink-0 text-primary" />
                <h2 className="text-base font-semibold tracking-tight text-foreground">Plano VM</h2>
              </div>
              <p className="ml-7 text-sm text-muted-foreground leading-relaxed">Visual Merchandising Planogram Manager</p>
            </div>
            {isEditMode && (
              <div className="flex justify-end gap-2">
                {hasUnsavedChanges && (
                  <button
                    type="button"
                    onClick={saveChanges}
                    disabled={isSaving}
                    className={[
                      "inline-flex items-center gap-2",
                      "px-5 py-2 text-xs font-bold uppercase tracking-widest",
                      "border-2 transition-all duration-200 active:scale-95 select-none",
                      isSaving
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-500 cursor-not-allowed"
                        : "border-foreground bg-foreground text-background hover:bg-transparent hover:text-foreground shadow-[3px_3px_0px_0px] shadow-foreground/30 hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]",
                    ].join(" ")}
                  >
                    {isSaving
                      ? <Loader2 className="size-3.5 animate-spin shrink-0" />
                      : <Save className="size-3.5 shrink-0" />}
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            )}
          </div>
          <Separator className="mt-4" />
        </div>

        {/* Page Picker and Search */}
        <div className="mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="relative w-full sm:max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search row or image..."
                  className="h-12 rounded-xl pl-10 pr-10"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <Dialog open={pageListOpen} onOpenChange={setPageListOpen}>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-between rounded-xl px-3 sm:ml-auto sm:w-auto sm:min-w-[240px]"
                  >
                    <span className="flex min-w-0 items-center gap-3 text-left">
                      {currentPage && getPagePreviewImage(currentPage) ? (
                        <img
                          src={getPagePreviewImage(currentPage)!}
                          alt={currentPage.name}
                          className="size-8 rounded-md object-cover border border-border"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = "none"
                          }}
                        />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Layers className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {currentPage?.name ?? "Select Page"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {currentPage ? `${currentPage.rows.length} ${currentPage.rows.length === 1 ? 'row' : 'rows'}` : 'Open page list'}
                        </span>
                      </span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg p-0 overflow-hidden">
                  <DialogHeader className="px-6 pt-6 pb-3">
                    <DialogTitle>Page List</DialogTitle>
                    <DialogDescription>Select a page to view its planogram</DialogDescription>
                  </DialogHeader>

                  <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">
                    <div className="space-y-3 pb-4">
                      {pages.map((page) => {
                        const previewImage = getPagePreviewImage(page)
                        const itemCount = page.rows.reduce((count, row) => count + row.images.length, 0)

                        return (
                          <div
                            key={page.id}
                            className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                              activePage === page.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/40 hover:bg-muted/30"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActivePage(page.id)
                                setPageListOpen(false)
                              }}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              {previewImage ? (
                                <img
                                  src={previewImage}
                                  alt={page.name}
                                  className="h-14 w-14 rounded-xl object-cover border border-border bg-muted"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement
                                    target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='112' height='112'%3E%3Crect width='112' height='112' rx='16' fill='%23e5e7eb'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='14' fill='%239ca3af'%3ENo Image%3C/text%3E%3C/svg%3E"
                                  }}
                                />
                              ) : (
                                <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-muted-foreground">
                                  <ImageIcon className="size-5" />
                                </span>
                              )}

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground">{page.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {page.rows.length} {page.rows.length === 1 ? 'row' : 'rows'} • {itemCount} {itemCount === 1 ? 'image' : 'images'}
                                </span>
                              </span>
                            </button>

                            {isEditMode && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 w-9 shrink-0 p-0"
                                  >
                                    <MoreVertical className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditPageName(page.name)
                                      setEditPageDialog({ open: true, pageId: page.id })
                                    }}
                                  >
                                    <Pencil className="size-4 mr-2" />
                                    Rename Page
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setDeletePageDialog({ open: true, pageId: page.id })}
                                    className="text-destructive focus:text-destructive"
                                    disabled={pages.length === 1}
                                  >
                                    <Trash2 className="size-4 mr-2" />
                                    Delete Page
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {isEditMode && (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-2 w-full justify-center rounded-xl border-dashed"
                        onClick={() => {
                          setPageListOpen(false)
                          setAddPageDialog(true)
                        }}
                      >
                        <Plus className="size-4 mr-2" />
                        Add Page
                      </Button>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {currentPage ? (
          <>
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ImageIcon className="size-16 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No matching rows</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery.trim()
                    ? `No results for "${searchQuery}"`
                    : isEditMode
                    ? "Create your first row to start organizing planogram"
                    : "Enable Edit Mode to add rows"
                  }
                </p>
                {isEditMode && !searchQuery.trim() && (
                  <Button onClick={() => setAddRowDialog(true)}>
                    <Plus className="size-4 mr-2" />
                    Add First Row
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                {filteredRows.map((row, rowIndex) => (
                  <div key={row.id} className="border-b pb-8">
                    {/* Row Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <h3 className="text-xl font-semibold">{row.title}</h3>
                        <span className="text-sm text-muted-foreground">
                          {row.images.length} {row.images.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => scrollRow(row.id, 'left')}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ChevronLeft className="size-5" />
                        </button>
                        <button
                          onClick={() => scrollRow(row.id, 'right')}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ChevronRight className="size-5" />
                        </button>
                        
                        {isEditMode && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem 
                                onClick={() => {
                                  const currentRow = currentPage.rows.find(r => r.id === row.id)
                                  if (currentRow) {
                                    setEditRowTitle(currentRow.title)
                                    setEditRowDialog({ open: true, rowId: row.id })
                                  }
                                }}
                              >
                                <Pencil className="size-4 mr-2" />
                                Edit Row
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => handleMoveRowUp(row.id)}
                                disabled={rowIndex === 0}
                              >
                                <ArrowUp className="size-4 mr-2" />
                                Move Up
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleMoveRowDown(row.id)}
                                disabled={rowIndex === filteredRows.length - 1}
                              >
                                <ArrowDown className="size-4 mr-2" />
                                Move Down
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => setDeleteRowDialog({ open: true, rowId: row.id })}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-4 mr-2" />
                                Delete Row
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Horizontal Scroll */}
                    <div
                      id={isEditMode ? `row-${row.id}` : `lightgallery-${row.id}`}
                      className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide scroll-smooth"
                    >
                      {row.images.map((image) => (
                        !isEditMode ? (
                          <a 
                            key={image.id}
                            href={image.url}
                            data-sub-html={`<h4>${image.title}</h4><p>${image.description}</p>`}
                            className="flex-shrink-0 group"
                          >
                            <div className="relative w-48 h-48 rounded-lg overflow-hidden bg-muted cursor-pointer">
                              <img
                                src={image.url}
                                alt={image.title}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23e5e7eb'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%239ca3af'%3ENo Image%3C/text%3E%3C/svg%3E"
                                }}
                              />
                            </div>
                            <div className="mt-3">
                              <p className="font-medium text-sm truncate text-center">{image.title}</p>
                              <p className="text-xs text-muted-foreground truncate text-center">{image.description}</p>
                            </div>
                          </a>
                        ) : (
                          <div 
                            key={image.id}
                            className="flex-shrink-0 group"
                            onMouseEnter={() => setHoveredImage(image.id)}
                            onMouseLeave={() => setHoveredImage(null)}
                          >
                            <div className="relative w-48 h-48 rounded-lg overflow-hidden bg-muted">
                              <img
                                src={image.url}
                                alt={image.title}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23e5e7eb'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%239ca3af'%3ENo Image%3C/text%3E%3C/svg%3E"
                                }}
                              />
                              {hoveredImage === image.id && (
                                <div className="absolute inset-0 bg-black/80 flex items-center justify-center gap-3 transition-opacity duration-200">
                                  <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700 text-white"
                                    onClick={() => {
                                      const img = row.images.find(i => i.id === image.id)
                                      if (img) {
                                        setEditImage({ url: img.url, title: img.title, description: img.description })
                                        setEditImageDialog({ open: true, rowId: row.id, imageId: image.id })
                                      }
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                    onClick={() => setDeleteImageDialog({ open: true, rowId: row.id, imageId: image.id })}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="mt-3">
                              <p className="font-medium text-sm truncate text-center">{image.title}</p>
                              <p className="text-xs text-muted-foreground truncate text-center">{image.description}</p>
                            </div>
                          </div>
                        )
                      ))}
                      
                      {/* Add Image Card */}
                      {isEditMode && (
                        <div className="flex-shrink-0">
                          <button
                            onClick={() => setAddImageDialog({ open: true, rowId: row.id })}
                            className="w-48 h-48 rounded-lg border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all duration-200 flex items-center justify-center group cursor-pointer"
                          >
                            <div className="text-center">
                              <Plus className="size-12 text-primary group-hover:scale-110 mx-auto mb-2 transition-transform" />
                              <p className="text-sm text-muted-foreground group-hover:text-primary transition-colors">Add Image</p>
                            </div>
                          </button>
                        </div>
                      )}
                      
                      {row.images.length === 0 && (
                        <div className="flex items-center justify-center w-full py-12 text-center">
                          <div>
                            <ImageIcon className="size-12 text-muted-foreground/50 mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">No images in this row</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Add Row Button at Bottom */}
            {currentPage.rows.length > 0 && isEditMode && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" size="lg" onClick={() => setAddRowDialog(true)}>
                  <Plus className="size-4 mr-2" />
                  Add Row
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h3 className="text-lg font-semibold mb-2">No page selected</h3>
            <p className="text-sm text-muted-foreground">Create a page to get started</p>
          </div>
        )}
      </div>

      {/* Add Row Dialog */}
      <Dialog open={addRowDialog} onOpenChange={setAddRowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Row</DialogTitle>
            <DialogDescription>Add a new product row</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Row title (e.g., Top Shelf Products)"
              value={newRowTitle}
              onChange={(e) => setNewRowTitle(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddRowDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddRow}>Create Row</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Image Dialog */}
      <Dialog open={addImageDialog.open} onOpenChange={(open) => {
        if (!open) {
          setAddImageTab("url")
          setAddUploadPreview(null)
          setAddAlbumPageFilter("all")
          setAddAlbumQuery("")
          setNewImage({ url: "", title: "", description: "" })
        }
        setAddImageDialog({ open })
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Image</DialogTitle>
            <DialogDescription>Add a new product image to the row</DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border mb-2">
            {([
              { key: "url", label: "Paste URL", icon: <Link className="size-3.5" /> },
              { key: "upload", label: "Upload File", icon: <Upload className="size-3.5" /> },
              { key: "album", label: "From Album", icon: <ImageIcon className="size-3.5" /> },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setAddImageTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  addImageTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-4 py-2">
            {addImageTab === "url" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Image URL *</label>
                <Input
                  placeholder="https://example.com/image.jpg"
                  value={newImage.url}
                  onChange={(e) => setNewImage({ ...newImage, url: e.target.value })}
                />
                {newImage.url && (
                  <img src={newImage.url} alt="preview" className="w-full h-40 object-cover rounded-lg border border-border mt-1" onError={(e) => (e.currentTarget.style.display = "none")} />
                )}
              </div>
            ) : addImageTab === "upload" ? (
              <div className="space-y-3">
                <input ref={addFileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (ev) => setAddUploadPreview(ev.target?.result as string)
                  reader.readAsDataURL(file)
                }} />
                {addUploadPreview ? (
                  <div className="relative">
                    <img src={addUploadPreview} alt="preview" className="w-full h-40 object-cover rounded-lg border border-border" />
                    <button
                      onClick={() => { setAddUploadPreview(null); if (addFileRef.current) addFileRef.current.value = "" }}
                      className="absolute top-2 right-2 bg-background/80 rounded-full p-1 hover:bg-background"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => addFileRef.current?.click()}
                    className="w-full h-40 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Upload className="size-8" />
                    <span className="text-sm font-medium">Click to choose image</span>
                    <span className="text-xs">JPG, PNG, WEBP supported</span>
                  </button>
                )}
                {addUploadPreview && !newImage.url && (
                  <Button
                    className="w-full"
                    disabled={addUploading}
                    onClick={async () => {
                      const file = addFileRef.current?.files?.[0]
                      if (!file) return
                      setAddUploading(true)
                      try {
                        const url = await uploadImageToImgBB(file)
                        setNewImage(prev => ({ ...prev, url }))
                      } catch {
                        alert("Upload failed. Please try again.")
                      } finally {
                        setAddUploading(false)
                      }
                    }}
                  >
                    {addUploading ? <><Loader2 className="size-4 mr-2 animate-spin" />Uploading…</> : <><Upload className="size-4 mr-2" />Upload to ImgBB</>}
                  </Button>
                )}
                {newImage.url && addImageTab === "upload" && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium text-center">✓ Uploaded successfully</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    placeholder="Search image, row, or page..."
                    value={addAlbumQuery}
                    onChange={(e) => setAddAlbumQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAddAlbumPageFilter("all")}
                    className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                      addAlbumPageFilter === "all"
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                    }`}
                  >
                    All
                  </button>
                  {albumPageNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setAddAlbumPageFilter(name)}
                      className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                        addAlbumPageFilter === name
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                {addFilteredAlbumImages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No album images found.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                    {addFilteredAlbumImages.map((image) => {
                      const isSelected = newImage.url === image.url
                      return (
                        <button
                          key={`${image.pageId}-${image.rowId}-${image.id}`}
                          type="button"
                          onClick={() => setNewImage({ url: image.url, title: image.title, description: image.description })}
                          className={`relative rounded-lg overflow-hidden border text-left transition-colors ${
                            isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                          }`}
                          title={`${image.pageName} • ${image.rowTitle}`}
                        >
                          <img src={image.url} alt={image.title} className="w-full h-20 object-cover" />
                          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-1 truncate">
                            {image.title || "Untitled"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Title *</label>
              <Input
                placeholder="Product name"
                value={newImage.title}
                onChange={(e) => setNewImage({ ...newImage, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="Product description"
                value={newImage.description}
                onChange={(e) => setNewImage({ ...newImage, description: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddImageDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={handleAddImage} disabled={!newImage.url || !newImage.title}>
                Add Image
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Image Dialog */}
      <Dialog open={editImageDialog.open} onOpenChange={(open) => {
        if (!open) {
          setEditImageTab("url")
          setEditUploadPreview(null)
          setEditAlbumPageFilter("all")
          setEditAlbumQuery("")
          setEditImage({ url: "", title: "", description: "" })
        }
        setEditImageDialog({ open })
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Image</DialogTitle>
            <DialogDescription>Update product image details</DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border mb-2">
            {([
              { key: "url", label: "Paste URL", icon: <Link className="size-3.5" /> },
              { key: "upload", label: "Upload File", icon: <Upload className="size-3.5" /> },
              { key: "album", label: "From Album", icon: <ImageIcon className="size-3.5" /> },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setEditImageTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  editImageTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-4 py-2">
            {editImageTab === "url" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Image URL *</label>
                <Input
                  placeholder="https://example.com/image.jpg"
                  value={editImage.url}
                  onChange={(e) => setEditImage({ ...editImage, url: e.target.value })}
                />
                {editImage.url && (
                  <img src={editImage.url} alt="preview" className="w-full h-40 object-cover rounded-lg border border-border mt-1" onError={(e) => (e.currentTarget.style.display = "none")} />
                )}
              </div>
            ) : editImageTab === "upload" ? (
              <div className="space-y-3">
                <input ref={editFileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (ev) => setEditUploadPreview(ev.target?.result as string)
                  reader.readAsDataURL(file)
                }} />
                {editUploadPreview ? (
                  <div className="relative">
                    <img src={editUploadPreview} alt="preview" className="w-full h-40 object-cover rounded-lg border border-border" />
                    <button
                      onClick={() => { setEditUploadPreview(null); if (editFileRef.current) editFileRef.current.value = "" }}
                      className="absolute top-2 right-2 bg-background/80 rounded-full p-1 hover:bg-background"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => editFileRef.current?.click()}
                    className="w-full h-40 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Upload className="size-8" />
                    <span className="text-sm font-medium">Click to choose image</span>
                    <span className="text-xs">JPG, PNG, WEBP supported</span>
                  </button>
                )}
                {editUploadPreview && !editImage.url && (
                  <Button
                    className="w-full"
                    disabled={editUploading}
                    onClick={async () => {
                      const file = editFileRef.current?.files?.[0]
                      if (!file) return
                      setEditUploading(true)
                      try {
                        const url = await uploadImageToImgBB(file)
                        setEditImage(prev => ({ ...prev, url }))
                      } catch {
                        alert("Upload failed. Please try again.")
                      } finally {
                        setEditUploading(false)
                      }
                    }}
                  >
                    {editUploading ? <><Loader2 className="size-4 mr-2 animate-spin" />Uploading…</> : <><Upload className="size-4 mr-2" />Upload to ImgBB</>}
                  </Button>
                )}
                {editImage.url && editImageTab === "upload" && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium text-center">✓ Uploaded successfully</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    placeholder="Search image, row, or page..."
                    value={editAlbumQuery}
                    onChange={(e) => setEditAlbumQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditAlbumPageFilter("all")}
                    className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                      editAlbumPageFilter === "all"
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                    }`}
                  >
                    All
                  </button>
                  {albumPageNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setEditAlbumPageFilter(name)}
                      className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                        editAlbumPageFilter === name
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                {editFilteredAlbumImages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No album images found.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                    {editFilteredAlbumImages.map((image) => {
                      const isSelected = editImage.url === image.url
                      return (
                        <button
                          key={`${image.pageId}-${image.rowId}-${image.id}`}
                          type="button"
                          onClick={() => setEditImage({ url: image.url, title: image.title, description: image.description })}
                          className={`relative rounded-lg overflow-hidden border text-left transition-colors ${
                            isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                          }`}
                          title={`${image.pageName} • ${image.rowTitle}`}
                        >
                          <img src={image.url} alt={image.title} className="w-full h-20 object-cover" />
                          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-1 truncate">
                            {image.title || "Untitled"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Title *</label>
              <Input
                placeholder="Product name"
                value={editImage.title}
                onChange={(e) => setEditImage({ ...editImage, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="Product description"
                value={editImage.description}
                onChange={(e) => setEditImage({ ...editImage, description: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditImageDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={handleEditImage} disabled={!editImage.url || !editImage.title}>
                Update Image
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Image Confirmation */}
      <Dialog open={deleteImageDialog.open} onOpenChange={(open) => setDeleteImageDialog({ open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Image</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeleteImageDialog({ open: false })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteImage}>
              <Trash2 className="size-4 mr-2" />
              Delete Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Row Dialog */}
      <Dialog open={editRowDialog.open} onOpenChange={(open) => setEditRowDialog({ open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Row</DialogTitle>
            <DialogDescription>Update row title</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Row title (e.g., Top Shelf Products)"
              value={editRowTitle}
              onChange={(e) => setEditRowTitle(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditRowDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={handleEditRow} disabled={!editRowTitle}>
                Update Row
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Row Confirmation */}
      <Dialog open={deleteRowDialog.open} onOpenChange={(open) => setDeleteRowDialog({ open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Row</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this row and all its images? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeleteRowDialog({ open: false })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteRow}>
              <Trash2 className="size-4 mr-2" />
              Delete Row
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Page Dialog */}
      <Dialog open={editPageDialog.open} onOpenChange={(open) => setEditPageDialog({ open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Page</DialogTitle>
            <DialogDescription>Update page name</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Page name (e.g., Store Layout 1)"
              value={editPageName}
              onChange={(e) => setEditPageName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditPageDialog({ open: false })}>
                Cancel
              </Button>
              <Button onClick={handleEditPage} disabled={!editPageName}>
                Update Page
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Page Dialog */}
      <Dialog open={addPageDialog} onOpenChange={setAddPageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Page</DialogTitle>
            <DialogDescription>Add a new planogram page</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Page name (e.g., Store Layout 1)"
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddPageDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddPage} disabled={!newPageName.trim()}>
                Create Page
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Page Confirmation */}
      <Dialog open={deletePageDialog.open} onOpenChange={(open) => setDeletePageDialog({ open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Page</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this page and all its contents? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeletePageDialog({ open: false })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeletePage}>
              <Trash2 className="size-4 mr-2" />
              Delete Page
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Lightbox */}
      <Dialog open={!!selectedImage} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedImage?.title}</DialogTitle>
            <DialogDescription>{selectedImage?.description}</DialogDescription>
          </DialogHeader>
          <div className="relative w-full aspect-video">
            <img 
              src={selectedImage?.url} 
              alt={selectedImage?.title}
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
