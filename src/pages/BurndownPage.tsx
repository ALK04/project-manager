import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  LineChart,
  Line,
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
  isBefore,
  isAfter,
  startOfDay,
  differenceInCalendarDays,
  addDays,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTasks } from '@/hooks/useTasks'
import { useSettings } from '@/hooks/useSettings'
import { useAbsences } from '@/hooks/useAbsences'
import { countWorkingDays, addWorkingDays } from '@/lib/absences'

interface ChartPoint {
  date: string
  ideal: number | null
  real: number | null
}

type PredictionType = 'success' | 'warning' | 'danger'
interface Prediction {
  type: PredictionType
  text: string
}

export function BurndownPage() {
  const { tasks, loading } = useTasks()
  const { settings } = useSettings()
  const { absences } = useAbsences()
  const [activeTab, setActiveTab] = useState<'chart' | 'stats'>('chart')
  const [bubbleOpen, setBubbleOpen] = useState(false)

  const chartData = useMemo((): ChartPoint[] => {
    if (!tasks.length) return []

    const endDate = startOfDay(parseISO(settings.projectEndDate))
    const today = startOfDay(new Date())
    const startDate = tasks.reduce((earliest, t) => {
      const d = startOfDay(parseISO(t.created_at))
      return d < earliest ? d : earliest
    }, today)

    // Always extend range to endDate so the ideal line reaches 0
    const rangeEnd = isAfter(today, endDate) ? today : endDate
    if (isAfter(startDate, rangeEnd)) return []

    const days = eachDayOfInterval({ start: startDate, end: rangeEnd })
    const totalTasks = tasks.length
    const totalProjectDays = Math.max(1, differenceInCalendarDays(endDate, startDate))

    return days.map((day) => {
      const daysElapsed = differenceInCalendarDays(day, startDate)
      // Ideal: linear from totalTasks → 0, guaranteed to reach 0 at endDate
      const ideal = Math.max(0, Math.round((totalTasks - (totalTasks * daysElapsed) / totalProjectDays) * 10) / 10)

      // Real: null for future days; accounts for task creation date so
      // adding a task mid-project causes the curve to rise (true burndown behaviour)
      const real = !isAfter(day, today)
        ? tasks.filter(t => {
            const created = startOfDay(parseISO(t.created_at))
            if (isAfter(created, day)) return false // didn't exist yet
            if (t.status !== 'done' || !t.completed_at) return true
            return isAfter(startOfDay(parseISO(t.completed_at)), day)
          }).length
        : null

      return { date: format(day, 'd MMM', { locale: fr }), ideal, real }
    })
  }, [tasks, settings.projectEndDate])

  const stats = useMemo(() => {
    if (!tasks.length) return null

    const today = startOfDay(new Date())
    const endDate = startOfDay(parseISO(settings.projectEndDate))
    const startDate = tasks.reduce((earliest, t) => {
      const d = startOfDay(parseISO(t.created_at))
      return d < earliest ? d : earliest
    }, today)

    const done = tasks.filter(t => t.status === 'done' && t.completed_at)
    const remaining = tasks.filter(t => t.status !== 'done').length
    const daysUntilEnd = differenceInCalendarDays(endDate, today)

    // Working-day velocity (excludes absence periods)
    const calendarDaysElapsed = Math.max(1, differenceInCalendarDays(today, startDate))
    const workingDaysElapsed  = Math.max(1, countWorkingDays(startDate, today, absences))
    const absenceDaysElapsed  = calendarDaysElapsed - workingDaysElapsed

    const avgPerWorkingDay  = done.length / workingDaysElapsed
    const avgPerCalendarDay = done.length / calendarDaysElapsed

    // Recent: last 7 calendar days — but count working days within that window
    const sevenDaysAgo = addDays(today, -7)
    const recentDone = done.filter(t =>
      t.completed_at && !isBefore(startOfDay(parseISO(t.completed_at)), sevenDaysAgo)
    ).length
    const recentWorkingDays = Math.max(1, countWorkingDays(sevenDaysAgo, today, absences))
    const recentVelocityPerWorkingDay = recentDone / recentWorkingDays

    // Prediction uses working-day velocity and skips absence periods
    const velocity = recentVelocityPerWorkingDay > 0 ? recentVelocityPerWorkingDay : avgPerWorkingDay
    const predictedWorkingDaysRemaining = velocity > 0 ? Math.ceil(remaining / velocity) : null
    const predictedEndDate = predictedWorkingDaysRemaining !== null
      ? addWorkingDays(today, predictedWorkingDaysRemaining, absences)
      : null
    const advanceDays = predictedEndDate !== null ? differenceInCalendarDays(endDate, predictedEndDate) : null

    const completionRate = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0

    const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const doneThisMonth = done.filter(t =>
      t.completed_at && !isBefore(startOfDay(parseISO(t.completed_at)), startOfThisMonth)
    ).length

    return {
      avgPerWorkingDay, avgPerCalendarDay,
      recentDone, recentVelocityPerWorkingDay,
      predictedEndDate, advanceDays, completionRate, doneThisMonth,
      remaining, daysUntilEnd,
      absenceDaysElapsed, workingDaysElapsed,
    }
  }, [tasks, settings.projectEndDate, absences])

  const prediction = useMemo((): Prediction | null => {
    if (!stats) return { type: 'warning', text: 'Créez des tâches pour obtenir une prévision.' }
    const { remaining, predictedEndDate, advanceDays, absenceDaysElapsed } = stats
    const absenceNote = absenceDaysElapsed > 0 ? ` (${absenceDaysElapsed}j d'absence exclus)` : ''
    if (remaining === 0) return { type: 'success', text: 'Toutes les tâches sont terminées ! Projet complété avec succès.' }
    if (!predictedEndDate || advanceDays === null) return { type: 'warning', text: `Aucune tâche complétée récemment. Impossible de prédire la date de fin.${absenceNote}` }
    if (advanceDays >= 30) {
      const months = Math.round(advanceDays / 30)
      return { type: 'success', text: `À ce rythme, vous finirez avec ${months} mois d'avance. Excellent !${absenceNote}` }
    }
    if (advanceDays >= 7) return { type: 'success', text: `À ce rythme, vous finirez avec ${advanceDays} jours d'avance. Bon rythme !${absenceNote}` }
    if (advanceDays >= -7) return { type: 'warning', text: `Vous êtes dans les temps. Fin estimée : ${format(predictedEndDate, 'd MMMM yyyy', { locale: fr })}.${absenceNote}` }
    const delay = Math.abs(advanceDays)
    if (delay >= 30) {
      const months = Math.round(delay / 30)
      return { type: 'danger', text: `Attention : au rythme actuel, ${months} mois de retard en vue.${absenceNote}` }
    }
    return { type: 'danger', text: `Attention : retard estimé de ${delay} jours. Fin prévue : ${format(predictedEndDate, 'd MMMM yyyy', { locale: fr })}.${absenceNote}` }
  }, [stats])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Chargement…</div>
  }

  const remaining = tasks.filter(t => t.status !== 'done').length
  const done = tasks.filter(t => t.status === 'done').length

  const btnClass =
    prediction?.type === 'success' ? 'bg-green-500 hover:bg-green-600' :
    prediction?.type === 'danger'  ? 'bg-red-500 hover:bg-red-600' :
                                     'bg-amber-400 hover:bg-amber-500'

  const bubbleBg =
    prediction?.type === 'success' ? 'rgba(240,253,244,0.92)' :
    prediction?.type === 'danger'  ? 'rgba(254,242,242,0.92)' :
                                     'rgba(255,251,235,0.92)'
  const bubbleBorder =
    prediction?.type === 'success' ? '#86efac' :
    prediction?.type === 'danger'  ? '#fca5a5' :
                                     '#fcd34d'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Burndown Chart</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fin de projet : {format(parseISO(settings.projectEndDate), 'd MMMM yyyy', { locale: fr })}
          </p>
        </div>

        {/* Prediction bubble button */}
        <div className="relative">
          <button
            onClick={() => setBubbleOpen(v => !v)}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md text-white transition-colors ${btnClass}`}
            title="Prévision"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clipRule="evenodd" />
            </svg>
          </button>

          {bubbleOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBubbleOpen(false)} />
              <div
                className="absolute right-0 top-12 z-20 w-72 rounded-2xl shadow-xl p-4 text-sm backdrop-blur-sm border"
                style={{ background: bubbleBg, borderColor: bubbleBorder }}
              >
                <p className="font-semibold text-gray-800 mb-1.5">Prévision</p>
                <p className="text-gray-700 leading-relaxed">{prediction?.text}</p>
                {stats && (
                  <div className="mt-3 pt-3 border-t border-gray-200/60 text-xs text-gray-500 space-y-1">
                    <p>Vitesse (7 derniers jours) : <b>{stats.recentDone} tâches</b></p>
                    <p>Moy. globale : <b>{stats.avgPerWorkingDay.toFixed(2)} tâche / jour ouvré</b></p>
                    {stats.absenceDaysElapsed > 0 && (
                      <p className="text-gray-400">{stats.absenceDaysElapsed} j d'absence exclus</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 flex gap-6 border-b border-border">
        {(['chart', 'stats'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'chart' ? 'Graphique' : 'Statistiques'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary cards — always visible */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total tâches', value: tasks.length },
            { label: 'Terminées', value: done },
            { label: 'Restantes', value: remaining },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-border bg-white p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-3xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Chart tab */}
        {activeTab === 'chart' && (
          chartData.length > 0 ? (
            <div className="rounded-xl border border-border bg-white p-6">
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
                    formatter={value => [value === null || value === undefined ? '–' : String(value), '']}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
                  <Line
                    type="monotone"
                    dataKey="ideal"
                    name="Idéal"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="real"
                    name="Réel"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center text-muted-foreground">
              Pas encore de données. Créez des tâches pour voir le burndown.
            </div>
          )
        )}

        {/* Stats tab */}
        {activeTab === 'stats' && (
          stats ? (
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Vitesse moyenne (jours ouvrés)"
                value={`${stats.avgPerWorkingDay.toFixed(2)} tâches / jour ouvré`}
                sub={`${stats.avgPerCalendarDay.toFixed(2)} / jour calendaire`}
              />
              <StatCard
                label="Vitesse récente (7 jours glissants)"
                value={`${stats.recentDone} tâches`}
                sub={`${stats.recentVelocityPerWorkingDay.toFixed(2)} / jour ouvré sur 7 j`}
              />
              <StatCard
                label="Fin de projet estimée"
                value={stats.predictedEndDate ? format(stats.predictedEndDate, 'd MMM yyyy', { locale: fr }) : '–'}
                sub={
                  stats.advanceDays !== null
                    ? stats.advanceDays >= 0
                      ? `${stats.advanceDays} jour${stats.advanceDays !== 1 ? 's' : ''} d'avance`
                      : `${Math.abs(stats.advanceDays)} jour${Math.abs(stats.advanceDays) !== 1 ? 's' : ''} de retard`
                    : undefined
                }
                subColor={
                  stats.advanceDays !== null
                    ? stats.advanceDays >= 0 ? 'text-green-600' : 'text-red-500'
                    : undefined
                }
              />
              <StatCard
                label="Taux de complétion"
                value={`${stats.completionRate} %`}
                extra={
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${stats.completionRate}%` }}
                    />
                  </div>
                }
              />
              <StatCard
                label={`Terminées en ${format(new Date(), 'MMMM', { locale: fr })}`}
                value={`${stats.doneThisMonth} tâche${stats.doneThisMonth !== 1 ? 's' : ''}`}
              />
              <StatCard
                label="Jours avant la date de fin"
                value={
                  stats.daysUntilEnd < 0
                    ? `${Math.abs(stats.daysUntilEnd)} j de dépassement`
                    : `${stats.daysUntilEnd} jours`
                }
                sub={
                  stats.absenceDaysElapsed > 0
                    ? `${stats.absenceDaysElapsed} j d'absence exclus du calcul`
                    : `${stats.workingDaysElapsed} jours ouvrés écoulés`
                }
                subColor={stats.daysUntilEnd < 0 ? 'text-red-500' : undefined}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center text-muted-foreground">
              Pas encore de données.
            </div>
          )
        )}
      </div>
    </div>
  )
}

function StatCard({
  label, value, sub, subColor, extra,
}: {
  label: string
  value: string
  sub?: string
  subColor?: string
  extra?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={`text-sm mt-0.5 ${subColor ?? 'text-muted-foreground'}`}>{sub}</p>}
      {extra}
    </div>
  )
}
