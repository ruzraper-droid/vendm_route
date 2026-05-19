import { Loader2Icon } from "lucide-react"

type LoadingStateProps = {
  message?: string
  description?: string
  className?: string
}

export function LoadingState({ className }: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className ?? ""}`}>
      <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading</p>
    </div>
  )
}
