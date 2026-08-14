import { useState } from 'react'

export const DRAG_THRESHOLD_PX = 3
export const MIXED_MARKER = '—'

export function useEditBuffer(value: string): {
  readonly text: string
  readonly editing: boolean
  setText: (value: string) => void
  begin: () => void
  commit: () => string
  cancel: () => void
} {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)

  if (!editing && text !== value) {
    setText(value)
  }

  return {
    text,
    editing,
    setText,
    begin: () => {
      setEditing(true)
    },
    commit: () => {
      setEditing(false)
      return text
    },
    cancel: () => {
      setEditing(false)
    },
  }
}
