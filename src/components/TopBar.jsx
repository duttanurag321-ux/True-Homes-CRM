import { useNavigate } from 'react-router-dom'
import { IconBack } from './Icons.jsx'

export default function TopBar({ title, subtitle, back, right }) {
  const navigate = useNavigate()
  return (
    <div className="sticky top-0 z-30 bg-base/80 backdrop-blur-xl px-4 pt-4 pb-2 safe-top">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {back && (
            <button onClick={() => navigate(-1)} className="press -ml-2 p-1.5 text-accent">
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
