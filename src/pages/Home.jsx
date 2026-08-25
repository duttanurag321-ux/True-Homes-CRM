import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import HomeDashboard from '../components/HomeDashboard.jsx'
import { IconChevron } from '../components/Icons.jsx'

export default function Home() {
  return (
    <div>
      <TopBar
        title="Home"
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
      />

      <HomeDashboard />

      <div className="px-4 mt-3 pb-4">
        <Link
          to="/work"
          className="press flex items-center justify-between bg-ink rounded-2xl px-5 py-4 text-white shadow-pop"
        >
          <div>
            <p className="font-semibold">Go to Work Queue</p>
            <p className="text-xs text-white/70 mt-0.5">Overdue, today's follow-ups, and new leads</p>
          </div>
          <IconChevron size={18} />
        </Link>
      </div>
    </div>
  )
}
