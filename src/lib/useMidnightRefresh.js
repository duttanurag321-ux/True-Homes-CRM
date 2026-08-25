import { useEffect, useRef } from 'react'

// Without this, "today" and "overdue" only ever get recalculated when a
// page happens to reload its data (opening the app, pulling to refresh,
// a realtime event). If the app is just sitting open across midnight,
// nothing tells it the day changed — so a follow-up due "today" quietly
// stays looking due-today instead of flipping to overdue right at 12:00
// AM, and agents only saw it turn red the next time they reopened the
// app. This schedules a one-shot timer for the next local midnight,
// calls `onMidnight`, then reschedules itself for the following one.
export function useMidnightRefresh(onMidnight) {
  const callbackRef = useRef(onMidnight)
  callbackRef.current = onMidnight

  useEffect(() => {
    let timeoutId

    function scheduleNext() {
      const now = new Date()
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5) // a few seconds past midnight for safety
      const ms = nextMidnight.getTime() - now.getTime()
      timeoutId = setTimeout(() => {
        callbackRef.current?.()
        scheduleNext()
      }, ms)
    }

    scheduleNext()
    return () => clearTimeout(timeoutId)
  }, [])
}
