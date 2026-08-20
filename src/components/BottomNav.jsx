import { NavLink } from 'react-router-dom'
import { IconToday, IconPipeline, IconLeads, IconReports, IconMore } from './Icons.jsx'

const tabs = [
  { to: '/', label: 'Today', icon: IconToday, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: IconPipeline },
  { to: '/leads', label: 'Leads', icon: IconLeads },
  { to: '/reports/daily', label: 'Reports', icon: IconReports },
  { to: '/settings', label: 'More', icon: IconMore }
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom">
      <div className="mx-auto max-w-md">
        <div className="mx-3 mb-3 rounded-2xl bg-white/90 backdrop-blur-xl shadow-card border border-line/60 flex justify-between px-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-2.5 press ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              <t.icon size={22} />
              <span className="text-[10px] font-medium tracking-tight">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
