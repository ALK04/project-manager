import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { Bell, AlertTriangle, Clock } from 'lucide-react'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useTasks } from '@/hooks/useTasks'
import { useProfiles } from '@/hooks/useProfiles'
import { UserAvatar } from '@/components/UserAvatar'
import type { Task } from '@/types/database'

// Notifications déjà vues : `${id}:${due_date}`. La date fait partie de la clé,
// une tâche repoussée puis de nouveau en retard redevient donc « non lue ».
const SEEN_KEY = 'pm_notifications_seen'

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSeen(keys: string[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(keys)) } catch { /* stockage indisponible */ }
}

const notifKey = (t: Task) => `${t.id}:${t.due_date}`

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function NotificationBell() {
  const { tasks } = useTasks()
  const { byId } = useProfiles()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(loadSeen)
  // L'onglet peut rester ouvert d'un jour à l'autre : on recalcule « aujourd'hui ».
  const [today, setToday] = useState(todayStr)

  useEffect(() => {
    const timer = setInterval(() => setToday(todayStr()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const { overdue, dueSoon } = useMemo(() => {
    const tomorrow = format(addDays(parseISO(today), 1), 'yyyy-MM-dd')
    const pending = tasks.filter(t => t.status !== 'done' && t.due_date)
    return {
      overdue: pending
        .filter(t => t.due_date! < today)
        .sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
      dueSoon: pending
        .filter(t => t.due_date === today || t.due_date === tomorrow)
        .sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
    }
  }, [tasks, today])

  const all = useMemo(() => [...overdue, ...dueSoon], [overdue, dueSoon])
  const unseen = all.filter(t => !seen.has(notifKey(t))).length

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // Marque tout comme lu, en oubliant les clés qui ne correspondent plus à rien.
      const keys = all.map(notifKey)
      saveSeen(keys)
      setSeen(new Set(keys))
    }
  }

  const goToBoard = () => {
    setOpen(false)
    void navigate('/')
  }

  const renderTask = (t: Task, late: boolean) => {
    const days = differenceInCalendarDays(parseISO(today), parseISO(t.due_date!))
    const when = late
      ? `En retard de ${days} jour${days > 1 ? 's' : ''}`
      : days === 0 ? "Échéance aujourd'hui" : 'Échéance demain'
    return (
      <li key={t.id}>
        <button
          onClick={goToBoard}
          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-secondary rounded-md transition-colors"
        >
          <UserAvatar member={t.assignee_id ? byId.get(t.assignee_id) : undefined} size="sm" className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-foreground truncate">{t.title}</span>
            <span className={cn('block text-[11px]', late ? 'text-red-600' : 'text-amber-600')}>
              {when} · {format(parseISO(t.due_date!), 'd MMM', { locale: fr })}
            </span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label={unseen > 0 ? `${unseen} notification(s) non lue(s)` : 'Notifications'}
          title="Notifications"
        >
          <Bell className={cn('h-4 w-4', overdue.length > 0 && 'text-red-500')} />
          {unseen > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-4 text-center">
              {unseen > 9 ? '9+' : unseen}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-white shadow-lg p-2"
        >
          <p className="px-3 pt-1 pb-2 text-sm font-semibold text-foreground">Notifications</p>

          {all.length === 0 && (
            <p className="px-3 pb-3 text-sm text-muted-foreground">Aucune tâche en retard. 🎉</p>
          )}

          {overdue.length > 0 && (
            <>
              <p className="flex items-center gap-1.5 px-3 pt-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-red-600">
                <AlertTriangle className="h-3 w-3" /> En retard ({overdue.length})
              </p>
              <ul>{overdue.map(t => renderTask(t, true))}</ul>
            </>
          )}

          {dueSoon.length > 0 && (
            <>
              <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-amber-600">
                <Clock className="h-3 w-3" /> Bientôt dues ({dueSoon.length})
              </p>
              <ul>{dueSoon.map(t => renderTask(t, false))}</ul>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
