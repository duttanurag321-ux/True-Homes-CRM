import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// The whole app scrolls inside one #root element (see index.css) rather
// than each page having its own scroll container, so a route change
// never naturally resets scroll on its own — the old <ScrollToTop>
// component was the thing forcing every navigation back to 0, including
// the "go back to the list" case where that's exactly what felt broken.
//
// Rule this applies instead:
//  - Navigating forward to a new page (PUSH) — start at the top, same
//    as opening a new screen normally would.
//  - Navigating back (POP — the in-app back button uses navigate(-1),
//    same as the browser/hardware back gesture) — restore exactly where
//    that page was scrolled to before you left it.
const scrollStore = new Map()

export function useScrollRestoration() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const pathRef = useRef(pathname)

  useEffect(() => {
    const el = document.getElementById('root')
    if (!el) return undefined

    if (navType === 'POP' && scrollStore.has(pathname)) {
      const target = scrollStore.get(pathname)
      // The page we're returning to (e.g. a filtered Leads list) may
      // still be re-fetching its data and rendering shorter than its
      // saved scroll position for the first few frames — retrying for a
      // short window lets the restore "stick" once the full list is back,
      // instead of silently clamping to whatever little content exists
      // at frame one.
      let attempts = 0
      const tryRestore = () => {
        el.scrollTop = target
        attempts++
        if (attempts < 12) requestAnimationFrame(tryRestore)
      }
      requestAnimationFrame(tryRestore)
    } else {
      el.scrollTop = 0
    }

    pathRef.current = pathname

    const onScroll = () => scrollStore.set(pathRef.current, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [pathname, navType])

  return null
}
