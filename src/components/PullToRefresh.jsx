import { useEffect, useRef, useState } from 'react'
import { useRefreshTrigger } from '../lib/RefreshContext.jsx'
import { Spinner } from './Loader.jsx'

const THRESHOLD = 70 // px of pull before letting go triggers a refresh

// Attaches a native touch gesture to the app's one scrollable container
// (#root — see index.css) instead of each page building its own: pull
// down while already at the top of a list, and whatever page is
// currently mounted re-runs its own `load()` (registered via
// useRegisterRefresh), same as a native pull-to-refresh.
export default function PullToRefresh() {
  const trigger = useRefreshTrigger()
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const startY = useRef(null)
  const active = useRef(false)

  useEffect(() => {
    const el = document.getElementById('root')
    if (!el) return undefined

    function onTouchStart(e) {
      if (el.scrollTop > 0 || refreshingRef.current) return
      startY.current = e.touches[0].clientY
      active.current = true
    }

    function onTouchMove(e) {
      if (!active.current || startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && el.scrollTop === 0) {
        const next = Math.min(dy * 0.5, 110)
        pullRef.current = next
        setPull(next)
      } else {
        active.current = false
        pullRef.current = 0
        setPull(0)
      }
    }

    async function onTouchEnd() {
      if (!active.current) return
      active.current = false
      startY.current = null
      if (pullRef.current > THRESHOLD && triggerRef.current) {
        refreshingRef.current = true
        setRefreshing(true)
        setPull(THRESHOLD)
        try {
          await triggerRef.current()
        } finally {
          refreshingRef.current = false
          setRefreshing(false)
          pullRef.current = 0
          setPull(0)
        }
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  if (pull === 0 && !refreshing) return null

  return (
    <div
      className="fixed left-0 right-0 top-0 z-50 flex items-center justify-center pointer-events-none overflow-hidden"
      style={{ height: pull, paddingTop: 'env(safe-area-inset-top)' }}
    >
      <Spinner size={20} className="text-accent" />
    </div>
  )
}
