import { useEffect } from 'react'
import { supabase } from './supabase.js'

// Lightest-possible realtime wiring: subscribe to INSERT/UPDATE on `leads`
// scoped to this agent (covers both a freshly-imported lead landing on
// them, and an existing lead being reassigned to them), and just re-run
// whatever `onChange` the page already uses to load its data. No new
// state machine, no store — pages keep using the same `load()` they
// already had.
export function useLeadsRealtime(userId, onChange) {
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`leads-assigned-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads', filter: `assigned_to=eq.${userId}` },
        () => onChange()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
}
