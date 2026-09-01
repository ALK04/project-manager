import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  format,
  eachDayOfInterval,
  parseISO,
  isAfter,
  startOfDay,
  differenceInCalendarDays,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTasks } from '@/hooks/useTasks'
import { useSettings } from '@/hooks/useSettings'
import type { Task } from '@/types/database'

interface BurnupPoint {
  date: string
  scope: number
  completed: number | null
}

interface CfdPoint {
  date: string
  done: number
  in_progress: number
  todo: number
}

function getStatusOnDay(task: Task, day: Date): 'done' | 'in_progress' | 'todo' | null {
  const created = startOfDay(parseISO(task.created_at))
  if (isAfter(created, day)) return null

  if (task.completed_at) {
    const completed = startOfDay(parseISO(task.completed_at))
    if (!isAfter(completed, day)) return 'done'
  }

  if (task.started_at) {
    const started = startOfDay(parseISO(task.started_at))
    if (!isAfter(started, day)) return 'in_progress'
  }

  return 'todo'
}

export function BurnupPage() {
  const { tasks, loading } = useTasks()
  const { settings } = useSettings()
  const [activeTab, setActiveTab] = useState<'burnup' | 'cfd'>('burnup')

  const today = startOfDay(new Date())
  const endDate = startOfDay(parseISO(settings.projectEndDate))

  const burnupData = useMemo((): BurnupPoint[] => {
    if (!tasks.length) return []

    const startDate = tasks.reduce((earliest, t) => {
      const d = startOfDay(parseISO(t.created_at))
      return d < earliest ? d : earliest
    }, today)

    const rangeEnd = isAfter(today, endDate) ? today : endDate
    if (isAfter(startDate, rangeEnd)) return []

    const days = eachDayOfInterval({ start: startDate, end: rangeEnd })

    return days.map((day) => {
      // Scope: tasks that exist on this day (created on or before)
      const scope = tasks.filter(t => !isAfter(startOfDay(parseISO(t.created_at)), day)).length

      // Completed: tasks done on or before this day — only shown for past/today
      const completed = !isAfter(day, today)
        ? tasks.filter(t => {
            if (!t.completed_at) return false
            return !isAfter(startOfDay(parseISO(t.completed_at)), day)
          }).length
        : null

      return { date: format(day, 'd MMM', { locale: fr }), scope, completed }
    })
  }, [tasks, settings.projectEndDate])

  const cfdData = useMemo((): CfdPoint[] => {
    if (!tasks.length) return []

    const startDate = tasks.reduce((earliest, t) => {
      const d = startOfDay(parseISO(t.created_at))
      return d < earliest ? d : earliest
    }, today)

    if (isAfter(startDate, today)) return []

    const days = eachDayOfInterval({ start: startDate, end: today })

    return days.map((day) => {
      let done = 0, in_progress = 0, todo = 0
      for (const task of tasks) {
        const s = getStatusOnDay(task, day)
        if (s === 'done') done++
        else if (s === 'in_progress') in_progress++
        else if (s === 'todo') todo++
      }
      return { date: format(day, 'd MMM', { locale: fr }), done, in_progress, todo }
    })
  }, [tasks])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Chargement…</div>
  }

  const done = tasks.filter(t => t.status === 'done').length
  const remaining = tasks.filter(t => t.status !== 'done').length
  const completionRate = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  // Gap analysis for burn-up summary
  const currentScope = tasks.length
  const currentCompleted = done
  const gapDays = (() => {
    if (!burnupData.length) return null
    const lastReal = [...burnupData].reverse().find(p => p.completed !== null)
    if (!lastReal || lastReal.completed === null) return null
    const daysUntilEnd = differenceInCalendarDays(endDate, today)
    const tasksPerDay = currentCompleted / Math.max(1, differenceInCalendarDays(today, parseISO(tasks.reduce((e, t) => t.created_at < e ? t.created_at : e, tasks[0].created_at))))
    if (tasksPerDay <= 0) return null
    const daysToFinish = Math.ceil(remaining / tasksPerDay)
    return daysUntilEnd - daysToFinish
  })()

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-xl font-semibold">Burn-up &amp; Flux cumulatif</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Fin de projet : {format(endDate, 'd MMMM yyyy', { locale: fr })}
        </p>
      </div>

      {/* Tabs */}
      <div className="px-6 flex gap-6 border-b border-border">
        {([
          { id: 'burnup', label: 'Burn-up' },
          { id: 'cfd', label: 'Flux cumulatif (CFD)' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="text-sm text-muted-foreground">Périmètre total</p>
            <p className="text-3xl font-bold mt-1">{currentScope}</p>
          </div>
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="text-sm text-muted-foreground">Terminées</p>
            <p className="text-3xl font-bold mt-1 text-green-600">{currentCompleted}</p>
          </div>
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="text-sm text-muted-foreground">Restantes</p>
            <p className="text-3xl font-bold mt-1">{remaining}</p>
          </div>
          <div className="rounded-xl border border-border bg-white p-4">
            <p className="text-sm text-muted-foreground">Avancement</p>
            <p className={`text-3xl font-bold mt-1 ${completionRate >= 75 ? 'text-green-600' : completionRate >= 40 ? 'text-amber-500' : 'text-blue-500'}`}>
              {completionRate} %
            </p>
          </div>
        </div>

        {/* Burn-up tab */}
        {activeTab === 'burnup' && (
          burnupData.length > 0 ? (
            <div className="rounded-xl border border-border bg-white p-6">
              <p className="text-sm font-medium text-muted-foreground mb-4">
                La courbe <b>Scope</b> peut monter si des tâches sont ajoutées en cours de projet.
                La courbe <b>Terminées</b> rejoint le Scope quand tout est livré.
              </p>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={burnupData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                    labelStyle={{ fontWeight: 600 }}
                    formatter={value => (value === null || value === undefined ? '–' : String(value))}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
                  {/* Scope: dashed gray — shows how the total grew over time */}
                  <Line
                    type="stepAfter"
                    dataKey="scope"
                    name="Périmètre"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    connectNulls
                  />
                  {/* Completed: solid blue — the burn-up curve */}
                  <Line
                    type="monotone"
                    dataKey="completed"
                    name="Terminées"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              {gapDays !== null && (
                <p className={`text-sm mt-3 text-center ${gapDays >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {gapDays >= 0
                    ? `Au rythme actuel : ${gapDays} jour${gapDays !== 1 ? 's' : ''} d'avance sur la date de fin.`
                    : `Au rythme actuel : ${Math.abs(gapDays)} jour${Math.abs(gapDays) !== 1 ? 's' : ''} de retard estimé.`
                  }
                </p>
              )}
            </div>
          ) : (
            <EmptyState />
          )
        )}

        {/* CFD tab */}
        {activeTab === 'cfd' && (
          cfdData.length > 0 ? (
            <div className="rounded-xl border border-border bg-white p-6">
              <p className="text-sm font-medium text-muted-foreground mb-4">
                Un élargissement de la bande <b>En cours</b> ou <b>À faire</b> signale un goulot d'étranglement.
                La bande <b>Terminées</b> doit croître régulièrement.
              </p>
              <ResponsiveContainer width="100%" height={380}>
                <AreaChart data={cfdData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradDone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="gradIP" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="gradTodo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
                  {/* Stacking order: done (bottom) → in_progress → todo (top) */}
                  <Area
                    type="monotone"
                    dataKey="done"
                    name="Terminées"
                    stackId="1"
                    stroke="#22c55e"
                    fill="url(#gradDone)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="in_progress"
                    name="En cours"
                    stackId="1"
                    stroke="#3b82f6"
                    fill="url(#gradIP)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="todo"
                    name="À faire"
                    stackId="1"
                    stroke="#94a3b8"
                    fill="url(#gradTodo)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState />
          )
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center text-muted-foreground">
      Pas encore de données. Créez des tâches pour voir les graphiques.
    </div>
  )
}
