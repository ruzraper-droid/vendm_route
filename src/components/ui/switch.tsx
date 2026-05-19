"use client"

import { InputSwitch } from "primereact/inputswitch"
import type { InputSwitchChangeEvent } from "primereact/inputswitch"

export interface SwitchProps {
  id?: string
  size?: "sm" | "default"
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

function Switch({ id, size = "default", checked = false, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <InputSwitch
      inputId={id}
      checked={checked}
      onChange={(e: InputSwitchChangeEvent) => onCheckedChange?.(!!e.value)}
      disabled={disabled}
      className={[
        "fcal-switch",
        size === "sm" ? "fcal-switch-sm" : "fcal-switch-md",
        className,
      ].filter(Boolean).join(" ")}
    />
  )
}

export { Switch }
