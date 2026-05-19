import * as React from "react"
import { cn } from "@/lib/utils"

// ── FieldGroup ─────────────────────────────────────────────────────────────────
const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-3", className)}
    {...props}
  />
))
FieldGroup.displayName = "FieldGroup"

// ── Field ──────────────────────────────────────────────────────────────────────
interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "vertical" | "horizontal"
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, orientation = "vertical", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        orientation === "horizontal"
          ? "flex flex-row items-center gap-2"
          : "flex flex-col gap-1",
        className,
      )}
      {...props}
    />
  ),
)
Field.displayName = "Field"

// ── FieldLabel ─────────────────────────────────────────────────────────────────
interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 select-none cursor-pointer",
        className,
      )}
      {...props}
    />
  ),
)
FieldLabel.displayName = "FieldLabel"

export { FieldGroup, Field, FieldLabel }
