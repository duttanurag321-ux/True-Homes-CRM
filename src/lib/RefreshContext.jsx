import { createContext, useContext, useEffect, useRef } from 'react'

const RefreshContext = createContext(null)

export function RefreshProvider({ children }) {
  const refreshRef = useRef(null)

  const api = useRef({
    register(fn) {
      refreshRef.current = fn
      return () => {
        if (refreshRef.current === fn) refreshRef.current = null
      }
    },
    trigger: async () => {
      if (refreshRef.current) await refreshRef.current()
    }
  }).current

  return <RefreshContext.Provider value={api}>{children}</RefreshContext.Provider>
}

// Call this in any page that has its own `load` function so the pull-down
// gesture (and anything else that wants a generic "refresh the current
// page" action) knows what to re-run. Automatically points at whichever
// page is currently mounted — registers on mount, unregisters on unmount,
// so navigating away can never leave a stale refresher behind.
export function useRegisterRefresh(load) {
  const ctx = useContext(RefreshContext)
  useEffect(() => {
    if (!ctx) return undefined
    return ctx.register(load)
  }, [ctx, load])
}

export function useRefreshTrigger() {
  return useContext(RefreshContext)?.trigger
}
