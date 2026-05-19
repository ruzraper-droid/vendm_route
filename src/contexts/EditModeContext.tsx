import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react"
import { toast } from "sonner"
import { AlertCircle } from "lucide-react"

interface EditModeContextType {
  isEditMode: boolean
  hasUnsavedChanges: boolean
  isSaving: boolean
  setIsEditMode: (value: boolean) => void
  setHasUnsavedChanges: (value: boolean) => void
  saveChanges: () => void
  registerSaveHandler: (handler: () => Promise<void>) => () => void
  discardChanges: () => void
  registerDiscardHandler: (handler: () => void) => void
}

const EditModeContext = createContext<EditModeContextType | undefined>(undefined)

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const saveHandlersRef = useRef<Map<string, () => Promise<void>>>(new Map())
  const discardHandlerRef = useRef<(() => void) | null>(null)
  const handlerKeyRef = useRef(0)

  const registerSaveHandler = useCallback((handler: () => Promise<void>) => {
    const key = String(++handlerKeyRef.current)
    saveHandlersRef.current.set(key, handler)
    return () => { saveHandlersRef.current.delete(key) }
  }, [])

  const registerDiscardHandler = useCallback((handler: () => void) => {
    discardHandlerRef.current = handler
  }, [])

  const saveChanges = async () => {
    const handlers = Array.from(saveHandlersRef.current.values())
    if (handlers.length > 0) {
      setIsSaving(true)
      try {
        await Promise.all(handlers.map(h => h()))
        setHasUnsavedChanges(false)
      } catch (e) {
        toast.error("Save failed", {
          description: e instanceof Error ? e.message : "Unknown error. Please try again.",
          icon: <AlertCircle className="size-4" />,
          duration: 6000,
        })
      } finally {
        setIsSaving(false)
      }
    } else {
      setHasUnsavedChanges(false)
    }
  }

  const discardChanges = () => {
    if (discardHandlerRef.current) {
      discardHandlerRef.current()
    }
    setHasUnsavedChanges(false)
  }

  return (
    <EditModeContext.Provider
      value={{
        isEditMode,
        hasUnsavedChanges,
        isSaving,
        setIsEditMode,
        setHasUnsavedChanges,
        saveChanges,
        registerSaveHandler,
        discardChanges,
        registerDiscardHandler,
      }}
    >
      {children}
    </EditModeContext.Provider>
  )
}

export function useEditMode() {
  const context = useContext(EditModeContext)
  if (context === undefined) {
    return {
      isEditMode: false,
      hasUnsavedChanges: false,
      isSaving: false,
      setIsEditMode: () => {},
      setHasUnsavedChanges: () => {},
      saveChanges: () => {},
      registerSaveHandler: () => () => {},
      discardChanges: () => {},
      registerDiscardHandler: () => {},
    }
  }
  return context
}
