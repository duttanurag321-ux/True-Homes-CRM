import { useNavigate } from 'react-router-dom'
import { IconBack } from './Icons.jsx'

export default function TopBar({ title, subtitle, back, right, fallback = '/' }) {
  const navigate = useNavigate()

  function handleBack() {
    // navigate(-1) assumes there's a previous page in THIS session's
    // history — true when you tapped into this page from inside the
    // app, but not when a notification (or any direct link) opened it
    // fresh. history.state.idx is how deep into the app's own
    // navigation we are; 0 means there's nothing behind us to go back
    // to, so fall back to a real destination instead of doing nothing
    // (or exiting the app entirely).
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate(fallback, { replace: true })
    }
  }

  return (
    <div className="sticky top-0 z-30 bg-base/80 backdrop-blur-xl px-4 pt-4 pb-2 safe-top">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {back && (
            <button onClick={handleBack} className="press -ml-2 p-1.5 text-accent">
              <IconBack />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-sm text-muted -mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    </div>
  )
}
