import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { IconClose } from './Icons.jsx'

export default function Sheet({ open, onClose, title, children }) {
  // Without this, the page underneath keeps its own scroll/touch handling
  // active while the sheet is open. On mobile that causes exactly the
  // "lags, scrolls sideways, the content behind it moves instead" glitch —
  // the sheet's swipe gets fought over by (or leaks through to) the page
  // scrolling behind it. Locking the body while a sheet is open, and
  // letting only the sheet's own content contain its scroll, fixes it.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overscroll-contain">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="relative w-full max-w-md bg-white rounded-t-[28px] shadow-card max-h-[88vh] overflow-y-auto overscroll-contain safe-bottom"
            style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur-xl px-5 pt-3 pb-3 border-b border-line flex items-center justify-between rounded-t-[28px]">
              <div className="w-9 h-1.5 rounded-full bg-line absolute left-1/2 -translate-x-1/2 top-2" />
              <h2 className="text-lg font-semibold mt-2">{title}</h2>
              <button onClick={onClose} className="press mt-2 p-1.5 rounded-full bg-base text-muted">
                <IconClose size={16} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
