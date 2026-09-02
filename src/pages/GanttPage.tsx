import { useState, useEffect, useCallback, useMemo, useRef, type UIEvent } from 'react'
import {
  startOfDay,
  addDays,
  differenceInDays,
  format,
  parseISO,
  eachDayOfInterval,
  eachMonthOfInterval,
  startOfMonth,
  isBefore,
  isAfter,
  isToday,
  isValid,
  getISOWeek,
  getISOWeekYear,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { ZoomIn, ZoomOut, ChevronUp, ChevronDown, Pencil, Eye, EyeOff } from 'lucide-react'
import type { Task, Priority, Status } from '@/types/database'
import { useTasks } from '@/hooks/useTasks'
import { useProfiles } from '@/hooks/useProfiles'
import { UserAvatar } from '@/components/UserAvatar'
import { useAbsences } from '@/hooks/useAbsences'
import { useSettings } from '@/hooks/useSettings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ROW_HEIGHT = 72
const NAME_COL   = 240

const ZOOM_STEPS = [3, 7, 18, 28, 44, 64, 92] as const
type ZoomPx = typeof ZOOM_STEPS[number]
const ZOOM_DEFAULT: ZoomPx = 44

type TimeScale = 'days' | 'weeks' | 'weeks+days'

const TIME_SCALE_OPTIONS: { value: TimeScale; label: string }[] = [
  { value: 'days',       label: 'Jours' },
  { value: 'weeks',      label: 'Semaines' },
  { value: 'weeks+days', label: 'Semaines + jours' },
]

function zoomLabel(px: ZoomPx): string {
  if (px <=  3) return 'Année'
  if (px <=  7) return 'Semestre'
  if (px <= 18) return 'Trimestre'
  if (px <= 28) return 'Mois'
  if (px <= 44) return 'Semaines'
  if (px <= 64) return 'Semaine'
  return 'Jours'
}

function isDayWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

/** Dernier jour où la tâche « occupe » le diagramme (fin de barre planifiée ou réelle). */
function taskEndDate(task: Task, today: Date): Date {
  const dates = [startOfDay(parseISO(task.created_at))]
  if (task.due_date)     dates.push(startOfDay(parseISO(task.due_date)))
  if (task.completed_at) dates.push(startOfDay(parseISO(task.completed_at)))
  if (task.started_at)   dates.push(startOfDay(parseISO(task.started_at)))
  // Une tâche non terminée court jusqu'à aujourd'hui : elle reste visible.
  if (task.status !== 'done') dates.push(today)
  return dates.reduce((a, b) => (a > b ? a : b))
}

const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Urgent',
  should: 'Important',
  could: 'Neutre',
  wont: 'Peut attendre',
}

type SortMode = 'manual' | 'name' | 'priority' | 'status' | 'due_asc' | 'due_desc' | 'created'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual',   label: 'Ordre manuel' },
  { value: 'name',     label: 'Nom (A→Z)' },
  { value: 'priority', label: 'Priorité' },
  { value: 'status',   label: 'Statut' },
  { value: 'due_asc',  label: 'Échéance ↑' },
  { value: 'due_desc', label: 'Échéance ↓' },
  { value: 'created',  label: 'Création' },
]

const PRIORITY_ORDER: Record<Priority, number> = { must: 0, should: 1, could: 2, wont: 3 }
const STATUS_ORDER: Record<Status, number>     = { in_progress: 0, todo: 1, blocked: 2, done: 3 }

function loadGanttOrder(): string[] {
  try {
    const saved = localStorage.getItem('pm_gantt_order')
    if (saved) return JSON.parse(saved) as string[]
  } catch { /* ignore */ }
  return []
}

function saveGanttOrder(order: string[]) {
  localStorage.setItem('pm_gantt_order', JSON.stringify(order))
}

interface DragState        { taskId: string; originalDueDateStr: string; startPageX: number }
interface ActualDragState  { taskId: string; originalDateStr: string;    startPageX: number }
interface StartedAtDragState { taskId: string; originalDateStr: string;  startPageX: number }

export function GanttPage() {
  const { tasks, loading, updateTask } = useTasks()
  const { byId: membersById } = useProfiles()
  const { absences } = useAbsences()
  const { settings } = useSettings()

  /** Date de fin de projet (Paramètres), si elle est exploitable — elle étend l'axe. */
  const projectEnd = useMemo(() => {
    const d = startOfDay(parseISO(settings.projectEndDate))
    return isValid(d) ? d : null
  }, [settings.projectEndDate])

  const [absDropdownOpen,    setAbsDropdownOpen]    = useState(false)
  const [absDropdownPos,     setAbsDropdownPos]     = useState<{ top: number; left: number } | null>(null)
  const absButtonRef = useRef<HTMLButtonElement>(null)
  const [dragState,          setDragState]          = useState<DragState | null>(null)
  const [pendingDueDate,     setPendingDueDate]     = useState<Record<string, string>>({})
  const [editMode,           setEditMode]           = useState(false)
  const [actualDragState,    setActualDragState]    = useState<ActualDragState | null>(null)
  const [pendingCompletedAt, setPendingCompletedAt] = useState<Record<string, string>>({})
  const [startedAtDragState, setStartedAtDragState] = useState<StartedAtDragState | null>(null)
  const [pendingStartedAt,   setPendingStartedAt]   = useState<Record<string, string>>({})

  const [pxPerDay, setPxPerDay] = useState<ZoomPx>(() => {
    const saved = Number(localStorage.getItem('pm_gantt_zoom'))
    return (ZOOM_STEPS as readonly number[]).includes(saved) ? (saved as ZoomPx) : ZOOM_DEFAULT
  })
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    (localStorage.getItem('pm_gantt_sort') as SortMode) ?? 'manual'
  )
  const [manualOrder, setManualOrder] = useState<string[]>(loadGanttOrder)

  const [showPlannedBars, setShowPlannedBars] = useState(() =>
    localStorage.getItem('pm_gantt_show_planned') !== 'false'
  )
  const [timeScale, setTimeScale] = useState<TimeScale>(() =>
    (localStorage.getItem('pm_gantt_time_scale') as TimeScale) ?? 'days'
  )
  const [hideWeekends, setHideWeekends] = useState(() =>
    localStorage.getItem('pm_gantt_hide_weekends') === 'true'
  )
  // 'all' | 'yyyy-MM' — début de l'axe temporel, les tâches finies avant sont masquées
  const [startMonth, setStartMonth] = useState<string>(() =>
    localStorage.getItem('pm_gantt_start_month') ?? 'all'
  )

  const scrollRef           = useRef<HTMLDivElement>(null)
  const scrollRestoredRef   = useRef(false)
  const dragStateRef          = useRef<DragState | null>(null)
  const actualDragStateRef    = useRef<ActualDragState | null>(null)
  const startedAtDragStateRef = useRef<StartedAtDragState | null>(null)
  const tasksRef           = useRef<Task[]>([])
  const updateTaskRef      = useRef(updateTask)
  const pxPerDayRef        = useRef<number>(pxPerDay)
  const manualOrderRef     = useRef<string[]>(manualOrder)

  tasksRef.current       = tasks
  updateTaskRef.current  = updateTask
  pxPerDayRef.current    = pxPerDay
  manualOrderRef.current = manualOrder

  const setDrag = useCallback((s: DragState | null) => {
    dragStateRef.current = s; setDragState(s)
  }, [])
  const setActualDrag = useCallback((s: ActualDragState | null) => {
    actualDragStateRef.current = s; setActualDragState(s)
  }, [])
  const setStartedAtDrag = useCallback((s: StartedAtDragState | null) => {
    startedAtDragStateRef.current = s; setStartedAtDragState(s)
  }, [])

  // Sync manualOrder when tasks change
  useEffect(() => {
    if (tasks.length === 0) return
    const taskIds = tasks.map(t => t.id)
    const current = manualOrderRef.current
    const filtered = current.filter(id => taskIds.includes(id))
    const newIds = taskIds.filter(id => !filtered.includes(id))
    if (newIds.length > 0 || filtered.length !== current.length) {
      const updated = [...filtered, ...newIds]
      setManualOrder(updated)
      saveGanttOrder(updated)
    }
  }, [tasks])

  // ── Filtre « à partir du mois » ───────────────────────────────────────────
  /** Premier jour affiché quand un mois est sélectionné, sinon null. */
  const cutoff = useMemo(
    () => (startMonth === 'all' ? null : startOfMonth(parseISO(`${startMonth}-01`))),
    [startMonth]
  )

  /** Mois proposés : de la plus ancienne date connue à la fin de projet. */
  const monthOptions = useMemo(() => {
    const dates: Date[] = [startOfDay(new Date())]
    if (projectEnd) dates.push(projectEnd)
    for (const t of tasks) {
      dates.push(parseISO(t.created_at))
      if (t.due_date)     dates.push(parseISO(t.due_date))
      if (t.completed_at) dates.push(parseISO(t.completed_at))
      if (t.started_at)   dates.push(parseISO(t.started_at))
    }
    const min = startOfMonth(dates.reduce((a, b) => (a < b ? a : b)))
    const max = startOfMonth(dates.reduce((a, b) => (a > b ? a : b)))
    const months = eachMonthOfInterval({ start: min, end: max })
    // Garde le mois sélectionné dans la liste même si plus aucune tâche ne le couvre.
    if (cutoff && !months.some(m => format(m, 'yyyy-MM') === startMonth)) {
      months.push(cutoff)
      months.sort((a, b) => a.getTime() - b.getTime())
    }
    return months.map(m => ({ value: format(m, 'yyyy-MM'), label: format(m, 'MMMM yyyy', { locale: fr }) }))
  }, [tasks, cutoff, startMonth, projectEnd])

  /** Tâches conservées : celles qui s'étendent encore au-delà du mois choisi. */
  const visibleTasks = useMemo(() => {
    if (!cutoff) return tasks
    const today = startOfDay(new Date())
    return tasks.filter(t => !isBefore(taskEndDate(t, today), cutoff))
  }, [tasks, cutoff])

  const hiddenCount = tasks.length - visibleTasks.length

  const sortedAllTasks = useMemo(() => {
    if (sortMode === 'manual') {
      const taskMap = new Map(tasks.map(t => [t.id, t]))
      return manualOrder.map(id => taskMap.get(id)).filter(Boolean) as Task[]
    }
    const sorted = [...tasks]
    switch (sortMode) {
      case 'name':     return sorted.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
      case 'priority': return sorted.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      case 'status':   return sorted.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
      case 'due_asc':
        return sorted.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1; if (!b.due_date) return -1
          return a.due_date.localeCompare(b.due_date)
        })
      case 'due_desc':
        return sorted.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1; if (!b.due_date) return -1
          return b.due_date.localeCompare(a.due_date)
        })
      case 'created': return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
      default: return sorted
    }
  }, [tasks, sortMode, manualOrder])

  const sortedTasks = useMemo(() => {
    if (!cutoff) return sortedAllTasks
    const visibleIds = new Set(visibleTasks.map(t => t.id))
    return sortedAllTasks.filter(t => visibleIds.has(t.id))
  }, [sortedAllTasks, visibleTasks, cutoff])

  // Restore scroll
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return
    scrollRestoredRef.current = true
    const saved = localStorage.getItem('pm_gantt_scroll')
    if (!saved) return
    try {
      const { left, top } = JSON.parse(saved) as { left: number; top: number }
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = left
          scrollRef.current.scrollTop  = top
        }
      })
    } catch { /* ignore */ }
  }, [loading])

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    localStorage.setItem('pm_gantt_scroll', JSON.stringify({ left: el.scrollLeft, top: el.scrollTop }))
  }, [])

  const moveTask = useCallback((taskId: string, direction: -1 | 1) => {
    // Le voisin est cherché dans la liste *visible*, mais l'échange se fait dans
    // l'ordre *complet* : sinon un filtre actif effacerait les tâches masquées.
    const visibleIdx = sortedTasks.findIndex(t => t.id === taskId)
    const neighbour  = sortedTasks[visibleIdx + direction]
    if (visibleIdx === -1 || !neighbour) return
    const newOrder = sortedAllTasks.map(t => t.id)
    const from = newOrder.indexOf(taskId)
    const to   = newOrder.indexOf(neighbour.id)
    if (from === -1 || to === -1) return
    ;[newOrder[from], newOrder[to]] = [newOrder[to], newOrder[from]]
    setManualOrder(newOrder)
    setSortMode('manual')
    saveGanttOrder(newOrder)
  }, [sortedTasks, sortedAllTasks])

  const zoomOut = () => {
    const idx = ZOOM_STEPS.indexOf(pxPerDay)
    if (idx > 0) { const next = ZOOM_STEPS[idx - 1]; setPxPerDay(next); localStorage.setItem('pm_gantt_zoom', String(next)) }
  }
  const zoomIn = () => {
    const idx = ZOOM_STEPS.indexOf(pxPerDay)
    if (idx < ZOOM_STEPS.length - 1) { const next = ZOOM_STEPS[idx + 1]; setPxPerDay(next); localStorage.setItem('pm_gantt_zoom', String(next)) }
  }

  // ── Time range ────────────────────────────────────────────────────────────
  const { rangeStart, days } = useMemo(() => {
    const today = startOfDay(new Date())
    const build = (rawStart: Date, rawEnd: Date) => {
      // Le mois choisi prime sur la date de début calculée.
      const start = cutoff ?? rawStart
      // Toujours au moins deux semaines à l'écran (mois choisi dans le futur).
      const end   = isAfter(addDays(start, 14), rawEnd) ? addDays(start, 14) : rawEnd
      return { rangeStart: start, days: eachDayOfInterval({ start, end }) }
    }
    if (!visibleTasks.length) {
      const emptyEnd = addDays(today, 30)
      return build(addDays(today, -7), projectEnd && isAfter(projectEnd, emptyEnd) ? projectEnd : emptyEnd)
    }
    const allDates: Date[] = [today]
    // La date de fin de projet (Paramètres) tire l'axe jusqu'à elle, même sans tâche là-bas.
    if (projectEnd) allDates.push(projectEnd)
    for (const t of visibleTasks) {
      allDates.push(parseISO(t.created_at))
      if (t.due_date)     allDates.push(parseISO(t.due_date))
      if (t.completed_at) allDates.push(parseISO(t.completed_at))
      if (t.started_at)   allDates.push(parseISO(t.started_at))
    }
    const minDate = allDates.reduce((a, b) => (a < b ? a : b))
    const maxDate = allDates.reduce((a, b) => (a > b ? a : b))
    return build(startOfDay(addDays(minDate, -3)), startOfDay(addDays(maxDate, 8)))
  }, [visibleTasks, cutoff, projectEnd])

  // ── Visible days (weekends filtered when needed) ──────────────────────────
  const visibleDays = useMemo(() => {
    if (!hideWeekends) return days
    return days.filter(d => !isDayWeekend(d))
  }, [days, hideWeekends])

  // ── Date → X position map (used when weekends are hidden) ─────────────────
  const dateToX = useMemo(() => {
    const map = new Map<string, number>()
    visibleDays.forEach((d, i) => map.set(format(d, 'yyyy-MM-dd'), i * pxPerDay))
    return map
  }, [visibleDays, pxPerDay])

  // ── Position helpers ──────────────────────────────────────────────────────
  const xForDate = useCallback((date: Date): number => {
    if (!hideWeekends) {
      return differenceInDays(startOfDay(date), rangeStart) * pxPerDay
    }
    const ds = format(startOfDay(date), 'yyyy-MM-dd')
    const x = dateToX.get(ds)
    if (x !== undefined) return x
    // Weekend date: snap to next visible weekday
    let d = startOfDay(date)
    for (let i = 1; i <= 7; i++) {
      const next = addDays(d, i)
      const nx = dateToX.get(format(next, 'yyyy-MM-dd'))
      if (nx !== undefined) return nx
    }
    return 0
  }, [hideWeekends, dateToX, rangeStart, pxPerDay])

  const widthBetween = useCallback(
    (a: Date, b: Date) => Math.max(pxPerDay * 0.3, xForDate(b) - xForDate(a)),
    [xForDate, pxPerDay]
  )

  /** Une barre qui démarre avant le mois choisi est coupée au bord gauche. */
  const clampToRange = useCallback(
    (d: Date) => (isBefore(startOfDay(d), rangeStart) ? rangeStart : d),
    [rangeStart]
  )
  const isClipped = useCallback(
    (d: Date) => isBefore(startOfDay(d), rangeStart),
    [rangeStart]
  )

  /**
   * Grille de fond d'une ligne, en dégradés répétés plutôt qu'un div par jour :
   * l'axe peut couvrir plusieurs années, un div/jour/tâche ferait des dizaines
   * de milliers de nœuds. Les deux motifs sont réguliers (1 jour / 7 jours).
   */
  const rowGridStyle = useMemo(() => {
    const lines = `repeating-linear-gradient(to right, rgba(148,163,184,0.25) 0 1px, transparent 1px ${pxPerDay}px)`
    if (hideWeekends) {
      return { backgroundImage: lines, backgroundPosition: '0 0' }
    }
    // Le motif week-end s'ancre sur le premier samedi ; il se répète aussi vers
    // la gauche, donc un dimanche en tête de plage est correctement grisé.
    const firstSaturday = visibleDays.findIndex(d => d.getDay() === 6)
    const weekends = `repeating-linear-gradient(to right, rgba(148,163,184,0.12) 0 ${2 * pxPerDay}px, transparent ${2 * pxPerDay}px ${7 * pxPerDay}px)`
    return {
      backgroundImage: `${weekends}, ${lines}`,
      backgroundPosition: `${(firstSaturday < 0 ? 0 : firstSaturday) * pxPerDay}px 0, 0 0`,
    }
  }, [pxPerDay, hideWeekends, visibleDays])

  const totalWidth = visibleDays.length * pxPerDay
  const headerH    = timeScale === 'weeks+days' ? 84 : 56

  // ── Absence legend ────────────────────────────────────────────────────────
  const absenceLegendItems = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of absences) { if (!seen.has(a.label)) seen.set(a.label, a.color) }
    return Array.from(seen.entries()).map(([label, color]) => ({ label, color }))
  }, [absences])

  // ── Absence overlays ──────────────────────────────────────────────────────
  const absenceOverlays = useMemo(() => {
    if (!visibleDays.length) return []
    const rangeEnd = addDays(visibleDays[visibleDays.length - 1], 1)
    return absences
      .map(a => {
        const aStart = startOfDay(parseISO(a.startDate))
        const aEnd   = addDays(startOfDay(parseISO(a.endDate)), 1)
        if (isAfter(aStart, rangeEnd) || isBefore(aEnd, rangeStart)) return null
        const cStart = isBefore(aStart, rangeStart) ? rangeStart : aStart
        const cEnd   = isAfter(aEnd, rangeEnd) ? rangeEnd : aEnd
        const left  = xForDate(cStart)
        const width = xForDate(cEnd) - xForDate(cStart)
        return { id: a.id, label: a.label, color: a.color, left, width }
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
  }, [absences, visibleDays, rangeStart, xForDate])

  // ── Month groups ──────────────────────────────────────────────────────────
  const monthGroups = useMemo(() => {
    const groups: { label: string; short: string; count: number }[] = []
    for (const d of visibleDays) {
      const label = format(d, 'MMMM yyyy', { locale: fr })
      const short = format(d, 'MMM yy',    { locale: fr })
      if (!groups.length || groups[groups.length - 1].label !== label) {
        groups.push({ label, short, count: 1 })
      } else {
        groups[groups.length - 1].count++
      }
    }
    return groups
  }, [visibleDays])

  // ── Week groups ───────────────────────────────────────────────────────────
  const weekGroups = useMemo(() => {
    const groups: { label: string; count: number; key: string }[] = []
    for (const d of visibleDays) {
      const weekNum  = getISOWeek(d)
      const weekYear = getISOWeekYear(d)
      const key      = `${weekYear}-W${weekNum}`
      const label    = `S${weekNum}`
      if (!groups.length || groups[groups.length - 1].key !== key) {
        groups.push({ label, count: 1, key })
      } else {
        groups[groups.length - 1].count++
      }
    }
    return groups
  }, [visibleDays])

  // ── Global mouse: planned bar (due_date) drag ─────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      if (!task) return
      const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
      const original  = parseISO(drag.originalDueDateStr)
      const newDate   = addDays(original, deltaDays)
      const minDate   = parseISO(task.created_at)
      const clamped   = isBefore(newDate, minDate) ? minDate : newDate
      setPendingDueDate(prev => ({ ...prev, [drag.taskId]: format(clamped, 'yyyy-MM-dd') }))
    }
    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      setDrag(null)
      if (task) {
        const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
        if (deltaDays !== 0) {
          const original  = parseISO(drag.originalDueDateStr)
          const newDate   = addDays(original, deltaDays)
          const minDate   = parseISO(task.created_at)
          const clamped   = isBefore(newDate, minDate) ? minDate : newDate
          void (async () => { await updateTaskRef.current(task.id, { due_date: format(clamped, 'yyyy-MM-dd') }); setPendingDueDate({}) })()
        } else { setPendingDueDate({}) }
      } else { setPendingDueDate({}) }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [setDrag])

  // ── Global mouse: started_at (left edge) drag ─────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = startedAtDragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      if (!task) return
      const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
      const original  = parseISO(drag.originalDateStr)
      const newDate   = addDays(original, deltaDays)
      const minDate   = parseISO(task.created_at)
      const endDate   = task.completed_at ? parseISO(task.completed_at) : new Date()
      const maxDate   = addDays(startOfDay(endDate), -1)
      let clamped = isBefore(newDate, minDate) ? minDate : newDate
      if (differenceInDays(startOfDay(clamped), startOfDay(maxDate)) > 0) clamped = maxDate
      setPendingStartedAt(prev => ({ ...prev, [drag.taskId]: format(clamped, 'yyyy-MM-dd') }))
    }
    const handleMouseUp = (e: MouseEvent) => {
      const drag = startedAtDragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      setStartedAtDrag(null)
      if (task) {
        const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
        if (deltaDays !== 0) {
          const original  = parseISO(drag.originalDateStr)
          const newDate   = addDays(original, deltaDays)
          const minDate   = parseISO(task.created_at)
          const endDate   = task.completed_at ? parseISO(task.completed_at) : new Date()
          const maxDate   = addDays(startOfDay(endDate), -1)
          let clamped = isBefore(newDate, minDate) ? minDate : newDate
          if (differenceInDays(startOfDay(clamped), startOfDay(maxDate)) > 0) clamped = maxDate
          void (async () => { await updateTaskRef.current(task.id, { started_at: format(clamped, 'yyyy-MM-dd') }); setPendingStartedAt({}) })()
        } else { setPendingStartedAt({}) }
      } else { setPendingStartedAt({}) }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [setStartedAtDrag])

  // ── Global mouse: actual bar (completed_at) drag ──────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = actualDragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      if (!task) return
      const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
      const original  = parseISO(drag.originalDateStr)
      const newDate   = addDays(original, deltaDays)
      const minDate   = parseISO(task.created_at)
      const clamped   = isBefore(newDate, minDate) ? minDate : newDate
      setPendingCompletedAt(prev => ({ ...prev, [drag.taskId]: format(clamped, 'yyyy-MM-dd') }))
    }
    const handleMouseUp = (e: MouseEvent) => {
      const drag = actualDragStateRef.current
      if (!drag) return
      const px   = pxPerDayRef.current
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      setActualDrag(null)
      if (task) {
        const deltaDays = Math.round((e.pageX - drag.startPageX) / px)
        if (deltaDays !== 0) {
          const original  = parseISO(drag.originalDateStr)
          const newDate   = addDays(original, deltaDays)
          const minDate   = parseISO(task.created_at)
          const clamped   = isBefore(newDate, minDate) ? minDate : newDate
          void (async () => { await updateTaskRef.current(task.id, { completed_at: format(clamped, 'yyyy-MM-dd') }); setPendingCompletedAt({}) })()
        } else { setPendingCompletedAt({}) }
      } else { setPendingCompletedAt({}) }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [setActualDrag])

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Chargement…
      </div>
    )
  }

  const today  = new Date()
  const todayX = xForDate(today)
  // Le mois choisi peut être dans le futur : le repère « aujourd'hui » sort alors de la plage.
  const showTodayMarker = visibleDays.length > 0
    && !isBefore(startOfDay(today), rangeStart)
    && !isAfter(startOfDay(today), visibleDays[visibleDays.length - 1])

  return (
    <div
      className="flex flex-col h-full"
      style={{ cursor: (dragState || actualDragState || startedAtDragState) ? 'col-resize' : 'default' }}
    >

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0 relative z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold">Diagramme de Gantt</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {visibleTasks.length} tâche{visibleTasks.length !== 1 ? 's' : ''}
              {hiddenCount > 0 && (
                <> · {hiddenCount} masquée{hiddenCount !== 1 ? 's' : ''} avant cette date</>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Trier par</span>
              <Select
                value={sortMode}
                onValueChange={v => { const m = v as SortMode; setSortMode(m); localStorage.setItem('pm_gantt_sort', m) }}
              >
                <SelectTrigger className="h-8 w-[148px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start month */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">À partir de</span>
              <Select
                value={startMonth}
                onValueChange={v => { setStartMonth(v); localStorage.setItem('pm_gantt_start_month', v) }}
              >
                <SelectTrigger className="h-8 w-[148px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all" className="text-xs">Tout l'historique</SelectItem>
                  {monthOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs capitalize">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Time scale */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Axe</span>
              <Select
                value={timeScale}
                onValueChange={v => { const s = v as TimeScale; setTimeScale(s); localStorage.setItem('pm_gantt_time_scale', s) }}
              >
                <SelectTrigger className="h-8 w-[148px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SCALE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Hide weekends */}
            <Button
              variant={hideWeekends ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                const next = !hideWeekends
                setHideWeekends(next)
                localStorage.setItem('pm_gantt_hide_weekends', String(next))
              }}
              title={hideWeekends ? 'Afficher les week-ends' : 'Masquer les week-ends'}
            >
              {hideWeekends ? 'Jours ouvrés' : 'Jours ouvrés'}
            </Button>

            {/* Show/hide planned bars */}
            <Button
              variant={showPlannedBars ? 'outline' : 'secondary'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                const next = !showPlannedBars
                setShowPlannedBars(next)
                localStorage.setItem('pm_gantt_show_planned', String(next))
              }}
              title={showPlannedBars ? 'Masquer les barres planifiées' : 'Afficher les barres planifiées'}
            >
              {showPlannedBars ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              Planifié
            </Button>

            {/* Edit mode */}
            <Button
              variant={editMode ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setEditMode(v => !v)}
              title="Modifier les dates réelles"
            >
              <Pencil className="h-3.5 w-3.5" />
              {editMode ? 'Modification active' : 'Modifier dates réelles'}
            </Button>

            {/* Zoom */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomOut} disabled={pxPerDay === ZOOM_STEPS[0]} title="Dézoomer">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-muted-foreground min-w-[72px] text-center">
                {zoomLabel(pxPerDay)}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomIn} disabled={pxPerDay === ZOOM_STEPS[ZOOM_STEPS.length - 1]} title="Zoomer">
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
          {showPlannedBars && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-3 rounded-sm bg-blue-300" /> Planifié
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-3 rounded-sm bg-green-500" /> Terminé à temps
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-3 rounded-sm bg-orange-400" /> Terminé en retard
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 h-3 rounded-sm bg-amber-400"
              style={{ backgroundImage: 'repeating-linear-gradient(90deg,transparent,transparent 5px,rgba(255,255,255,0.4) 5px,rgba(255,255,255,0.4) 6px)' }}
            /> En cours
          </span>
          {!hideWeekends && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-3 rounded-sm bg-slate-200" /> Week-end
            </span>
          )}
          <span className="text-muted-foreground/60 italic">
            · Glisser le bord droit d'une barre bleue pour modifier l'échéance
          </span>

          {absenceLegendItems.length > 0 && (
            <div className="relative">
              <button
                ref={absButtonRef}
                onClick={() => {
                  if (!absDropdownOpen && absButtonRef.current) {
                    const rect = absButtonRef.current.getBoundingClientRect()
                    setAbsDropdownPos({ top: rect.bottom + 4, left: rect.left })
                  }
                  setAbsDropdownOpen(v => !v)
                }}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <span className="flex items-center">
                  {absenceLegendItems.slice(0, 4).map(item => (
                    <span
                      key={item.label}
                      className="inline-block w-2.5 h-3 rounded-sm -ml-0.5 first:ml-0"
                      style={{ backgroundColor: item.color, opacity: 0.5 }}
                    />
                  ))}
                </span>
                Absences ({absenceLegendItems.length})
                <ChevronDown className={`h-3 w-3 transition-transform ${absDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {absDropdownOpen && absDropdownPos && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAbsDropdownOpen(false)} />
                  <div
                    className="fixed z-50 bg-white border border-border rounded-lg shadow-md py-1.5 min-w-[160px]"
                    style={{ top: absDropdownPos.top, left: absDropdownPos.left }}
                  >
                    {absenceLegendItems.map(item => (
                      <div key={item.label} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                        <span className="w-4 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color, opacity: 0.5 }} />
                        {item.label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit mode banner ─────────────────────────────────────────────── */}
      {editMode && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-2 bg-amber-50 border-b border-amber-200">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Pencil className="h-4 w-4 shrink-0" />
            <span>
              Mode modification actif — glissez le <span className="font-medium">bord gauche</span> pour ajuster le début réel, le <span className="font-medium">bord droit</span> pour la date de fin
            </span>
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-7 shrink-0 text-amber-700 hover:text-amber-900 hover:bg-amber-100"
            onClick={() => setEditMode(false)}
          >
            Quitter
          </Button>
        </div>
      )}

      {/* ── Gantt scrollable area ─────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <div style={{ width: NAME_COL + totalWidth, minWidth: '100%' }}>

          {/* Sticky time-axis header */}
          <div
            className="sticky top-0 z-20 flex border-b border-border bg-white"
            style={{ height: headerH }}
          >
            <div
              className="sticky left-0 z-30 bg-white border-r border-border flex items-end px-4 pb-2 shrink-0"
              style={{ width: NAME_COL }}
            >
              <span className="text-xs font-semibold text-muted-foreground">Tâche</span>
            </div>

            <div className="relative shrink-0" style={{ width: totalWidth }}>
              {/* Absence overlays in header */}
              {absenceOverlays.map(o => (
                <div
                  key={o.id}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: o.left, width: o.width, backgroundColor: o.color, opacity: 0.18 }}
                />
              ))}

              {/* Weekend shading in header */}
              {!hideWeekends && visibleDays.map((d, i) =>
                isDayWeekend(d) ? (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 pointer-events-none bg-slate-100/70"
                    style={{ left: i * pxPerDay, width: pxPerDay }}
                  />
                ) : null
              )}

              {/* Month row — always shown at top */}
              <div className="flex absolute top-0 left-0" style={{ height: 28 }}>
                {monthGroups.map((g, i) => {
                  const cellW = g.count * pxPerDay
                  const label = cellW >= 72 ? g.label : cellW >= 28 ? g.short : ''
                  return (
                    <div
                      key={i}
                      className="border-l border-border first:border-l-0 px-1 flex items-center text-xs font-semibold capitalize overflow-hidden whitespace-nowrap bg-white/80"
                      style={{ width: cellW, flexShrink: 0 }}
                    >
                      {label}
                    </div>
                  )
                })}
              </div>

              {/* Week row — shown when timeScale is 'weeks' or 'weeks+days' */}
              {(timeScale === 'weeks' || timeScale === 'weeks+days') && (
                <div className="flex absolute left-0" style={{ top: 28, height: 28 }}>
                  {weekGroups.map((g, i) => {
                    const cellW = g.count * pxPerDay
                    const label = cellW >= 24 ? g.label : ''
                    return (
                      <div
                        key={g.key}
                        className={`flex items-center justify-center text-xs border-l border-border/40 shrink-0 overflow-hidden text-muted-foreground ${i === 0 ? 'border-l-0' : ''}`}
                        style={{ width: cellW, flexShrink: 0 }}
                      >
                        {label}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Day row — shown when timeScale is 'days' or 'weeks+days' */}
              {(timeScale === 'days' || timeScale === 'weeks+days') && (
                <div
                  className="flex absolute left-0"
                  style={{ top: timeScale === 'weeks+days' ? 56 : 28, height: 28 }}
                >
                  {visibleDays.map((d, i) => {
                    const isFirst = d.getDate() === 1
                    const weekend = isDayWeekend(d)
                    const dayNum = pxPerDay >= 28
                      ? format(d, 'd')
                      : pxPerDay >= 14 && isFirst
                        ? format(d, 'd')
                        : ''
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-center text-xs border-l border-border/40 shrink-0 overflow-hidden ${
                          isToday(d)
                            ? 'text-blue-600 font-bold bg-blue-50'
                            : weekend
                              ? 'text-muted-foreground/50 bg-slate-100/70'
                              : 'text-muted-foreground'
                        }`}
                        style={{ width: pxPerDay }}
                      >
                        {dayNum}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Empty state */}
          {sortedTasks.length === 0 && (
            <div className="flex items-center justify-center text-muted-foreground text-sm py-16">
              {tasks.length === 0
                ? 'Aucune tâche — créez-en depuis le Kanban.'
                : 'Aucune tâche à partir de ce mois — choisissez une date plus ancienne.'}
            </div>
          )}

          {/* Task rows */}
          {sortedTasks.map((task, rowIndex) => {
            const createdAt             = parseISO(task.created_at)
            const effectiveDueDateStr   = pendingDueDate[task.id] ?? task.due_date
            const effectiveDueDate      = effectiveDueDateStr ? parseISO(effectiveDueDateStr) : null
            const effectiveCompletedStr = pendingCompletedAt[task.id] ?? task.completed_at
            const effectiveCompletedAt  = effectiveCompletedStr ? parseISO(effectiveCompletedStr) : null
            const effectiveStartedAtStr = pendingStartedAt[task.id] ?? task.started_at
            const actualStart           = effectiveStartedAtStr ? parseISO(effectiveStartedAtStr) : createdAt

            // Barres commencées avant le mois choisi : coupées au bord gauche.
            const plannedBarStart   = clampToRange(createdAt)
            const actualBarStart    = clampToRange(actualStart)
            const plannedIsClipped  = isClipped(createdAt)
            const actualIsClipped   = isClipped(actualStart)

            const showPlanned = showPlannedBars && effectiveDueDate !== null
            const showActual  = task.status === 'done' || task.status === 'in_progress'
            const showBoth    = showPlanned && showActual

            const isDone    = task.status === 'done'
            const actualEnd = effectiveCompletedAt ?? today
            const isLate    = effectiveDueDate && effectiveCompletedAt
              ? startOfDay(effectiveCompletedAt) > startOfDay(effectiveDueDate)
              : false

            const actualBarColor = isDone
              ? (isLate ? 'bg-orange-400' : 'bg-green-500')
              : 'bg-amber-400'

            const rowBg  = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
            const isFirst = rowIndex === 0
            const isLast  = rowIndex === sortedTasks.length - 1

            return (
              <div
                key={task.id}
                className={`flex border-b border-border/40 ${rowBg}`}
                style={{ height: ROW_HEIGHT }}
              >
                {/* Name column */}
                <div
                  className={`sticky left-0 z-10 flex items-center gap-1 px-2 border-r border-border shrink-0 ${rowBg}`}
                  style={{ width: NAME_COL }}
                >
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      onClick={() => moveTask(task.id, -1)}
                      disabled={isFirst}
                      title="Monter"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      onClick={() => moveTask(task.id, 1)}
                      disabled={isLast}
                      title="Descendre"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-col justify-center min-w-0 flex-1 pl-1">
                    <p className="text-sm font-medium truncate leading-snug" title={task.title}>
                      {task.title}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <UserAvatar
                        member={task.assignee_id ? membersById.get(task.assignee_id) : undefined}
                        size="xs"
                      />
                      <Badge variant={task.priority} className="text-[10px] px-1.5 py-0">
                        {PRIORITY_LABELS[task.priority]}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Timeline — grille de fond en CSS (voir rowGridStyle) */}
                <div
                  className="relative shrink-0"
                  style={{ width: totalWidth, height: ROW_HEIGHT, ...rowGridStyle }}
                >
                  {/* Absence overlays */}
                  {absenceOverlays.map(o => (
                    <div
                      key={o.id}
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: o.left, width: o.width, backgroundColor: o.color, opacity: 0.15 }}
                    />
                  ))}

                  {/* Today marker */}
                  {showTodayMarker && (
                    <div
                      className="absolute top-0 bottom-0 w-px bg-blue-400 z-10 pointer-events-none"
                      style={{ left: todayX }}
                    />
                  )}

                  {/* Planned bar */}
                  {showPlanned && (
                    <div
                      className={`absolute group select-none ${plannedIsClipped ? 'rounded-r' : 'rounded'}`}
                      style={{
                        left:            xForDate(plannedBarStart),
                        width:           widthBetween(plannedBarStart, effectiveDueDate!),
                        top:             showBoth ? 13 : 26,
                        height:          20,
                        backgroundColor: dragState?.taskId === task.id ? '#60a5fa' : '#93c5fd',
                      }}
                      title={`Planifié : ${format(createdAt, 'd MMM', { locale: fr })} → ${format(effectiveDueDate!, 'd MMM yyyy', { locale: fr })}`}
                    >
                      <span className="absolute inset-0 flex items-center px-2 text-[10px] text-blue-900 font-medium overflow-hidden whitespace-nowrap pointer-events-none">
                        {format(effectiveDueDate!, 'd MMM', { locale: fr })}
                      </span>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                        onMouseDown={e => {
                          e.preventDefault()
                          if (!effectiveDueDateStr) return
                          setDrag({ taskId: task.id, originalDueDateStr: effectiveDueDateStr, startPageX: e.pageX })
                        }}
                      >
                        <div className="w-0.5 h-3/4 bg-blue-700/70 rounded-full" />
                      </div>
                    </div>
                  )}

                  {/* Actual bar */}
                  {showActual && (
                    <div
                      className={`absolute select-none ${actualIsClipped ? 'rounded-r' : 'rounded'} ${actualBarColor} ${editMode ? 'group' : ''}`}
                      style={{
                        left:   xForDate(actualBarStart),
                        width:  widthBetween(actualBarStart, actualEnd),
                        top:    showBoth ? 39 : 26,
                        height: 20,
                        ...(!isDone ? {
                          backgroundImage: 'repeating-linear-gradient(90deg,transparent,transparent 5px,rgba(255,255,255,0.35) 5px,rgba(255,255,255,0.35) 6px)',
                        } : {}),
                        ...((editMode && (actualDragState?.taskId === task.id || startedAtDragState?.taskId === task.id)) ? { filter: 'brightness(1.15)' } : {}),
                      }}
                      title={`Réel : ${format(actualStart, 'd MMM', { locale: fr })} → ${format(actualEnd, 'd MMM yyyy', { locale: fr })}${isDone ? '' : ' (en cours)'}`}
                    >
                      <span className="absolute inset-0 flex items-center px-2 text-[10px] text-white font-medium overflow-hidden whitespace-nowrap pointer-events-none">
                        {isDone ? format(actualEnd, 'd MMM', { locale: fr }) : 'En cours…'}
                      </span>
                      {editMode && (
                        <div
                          className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={e => {
                            e.preventDefault()
                            const originStr = effectiveStartedAtStr ?? format(actualStart, 'yyyy-MM-dd')
                            setStartedAtDrag({ taskId: task.id, originalDateStr: originStr, startPageX: e.pageX })
                          }}
                        >
                          <div className="w-0.5 h-3/4 bg-white/70 rounded-full" />
                        </div>
                      )}
                      {editMode && (
                        <div
                          className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={e => {
                            e.preventDefault()
                            const originStr = effectiveCompletedStr ?? format(today, 'yyyy-MM-dd')
                            setActualDrag({ taskId: task.id, originalDateStr: originStr, startPageX: e.pageX })
                          }}
                        >
                          <div className="w-0.5 h-3/4 bg-white/70 rounded-full" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
