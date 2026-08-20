import { useState, useEffect } from 'react'

// Plain useState resets the moment a component unmounts — which, in this
// app, happens every time you navigate from a list (Leads, Lead Pool,
// Pipeline, Today's Work) to a lead's detail page and back, since they're
// sibling routes. That was wiping out search text, active filters, and
// the selected tab on every single "open a lead, save, go back".
//
// This keeps the value in a plain in-memory store that outlives the
// component (but not a full page reload/refresh, which is the right
// scope for "where I left off browsing" — same behavior as a native app
// backgrounding a screen). Reused across every list page instead of each
// page inventing its own persistence.
const memoryStore = new Map()

export function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => (memoryStore.has(key) ? memoryStore.get(key) : initialValue))

  useEffect(() => {
    memoryStore.set(key, value)
  }, [key, value])

  return [value, setValue]
}
