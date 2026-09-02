import { NavLink } from 'react-router-dom'
import { LayoutDashboard, TrendingDown, TrendingUp, GanttChartSquare, CalendarDays, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useProfiles } from '@/hooks/useProfiles'
import { UserAvatar } from '@/components/UserAvatar'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Kanban' },
  { to: '/burndown', icon: TrendingDown, label: 'Burndown' },
  { to: '/burnup', icon: TrendingUp, label: 'Burn-up / CFD' },
  { to: '/gantt', icon: GanttChartSquare, label: 'Gantt' },
  { to: '/alternance', icon: CalendarDays, label: 'Alternance' },
  { to: '/settings', icon: Settings, label: 'Paramètres' },
]

export function Sidebar() {
  const { user, signOut } = useAuth()
  const { members, byId } = useProfiles()
  const me = user ? byId.get(user.id) : undefined
  const others = members.filter(m => m.id !== user?.id)

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-white flex flex-col min-h-screen">
      <div className="px-5 py-5 border-b border-border">
        <h1 className="text-base font-semibold text-foreground tracking-tight">Project Manager</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Espace partagé</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-border">
        {others.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2.5" title={`Équipe : ${members.map(m => m.displayName).join(', ')}`}>
            {others.map(m => <UserAvatar key={m.id} member={m} size="xs" />)}
            <span className="text-[11px] text-muted-foreground truncate">
              {others.map(m => m.displayName).join(', ')}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-2 min-w-0">
          <UserAvatar member={me} />
          <p className="text-xs text-muted-foreground truncate" title={user?.email}>
            {me?.displayName ?? user?.email}
          </p>
        </div>
        <button
          onClick={() => { void signOut() }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-red-500 transition-colors w-full"
        >
          <LogOut className="h-3.5 w-3.5" />
          Déconnexion
        </button>
      </div>
    </aside>
  )
}
