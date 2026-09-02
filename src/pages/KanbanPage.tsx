import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import type { Task, Status, Priority, TaskFormData } from '@/types/database'
import { useTasks } from '@/hooks/useTasks'
import { useAuth } from '@/hooks/useAuth'
import { useProfiles } from '@/hooks/useProfiles'
import { UserAvatar } from '@/components/UserAvatar'
import { KanbanColumn } from '@/components/KanbanColumn'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL_STATUSES: Status[] = ['todo', 'in_progress', 'blocked', 'done']
const DEFAULT_COLUMN_ORDER: Status[] = ['todo', 'in_progress', 'blocked', 'done']

const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Urgent', should: 'Important', could: 'Neutre', wont: 'Peut attendre',
}

type KanbanSortMode = 'manual' | 'name' | 'priority' | 'due_asc' | 'due_desc' | 'created'

const SORT_OPTIONS: { value: KanbanSortMode; label: string }[] = [
  { value: 'manual',   label: 'Ordre manuel' },
  { value: 'name',     label: 'Nom (A→Z)' },
  { value: 'priority', label: 'Priorité' },
  { value: 'due_asc',  label: 'Échéance ↑' },
  { value: 'due_desc', label: 'Échéance ↓' },
  { value: 'created',  label: 'Création' },
]

const PRIORITY_ORDER: Record<Priority, number> = { must: 0, should: 1, could: 2, wont: 3 }

// Filtre par personne : 'all', 'unassigned' ou l'id d'un membre.
const ASSIGNEE_ALL = 'all'
const ASSIGNEE_NONE = 'unassigned'

type ColumnOrders = Record<Status, string[]>

const EMPTY_ORDERS: ColumnOrders = { todo: [], in_progress: [], blocked: [], done: [] }

function loadColumnOrder(): Status[] {
  try {
    const saved = localStorage.getItem('pm_column_order')
    if (saved) {
      const parsed = JSON.parse(saved) as Status[]
      if (Array.isArray(parsed) && parsed.length === 4) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_COLUMN_ORDER
}

function loadKanbanOrders(): ColumnOrders {
  try {
    const saved = localStorage.getItem('pm_kanban_orders')
    if (saved) return { ...EMPTY_ORDERS, ...(JSON.parse(saved) as ColumnOrders) }
  } catch { /* ignore */ }
  return { ...EMPTY_ORDERS }
}

function saveKanbanOrders(orders: ColumnOrders) {
  localStorage.setItem('pm_kanban_orders', JSON.stringify(orders))
}

function sortColumnTasks(tasks: Task[], mode: KanbanSortMode, manualOrder: string[]): Task[] {
  if (mode === 'manual') {
    const taskMap = new Map(tasks.map(t => [t.id, t]))
    const ordered = manualOrder.map(id => taskMap.get(id)).filter(Boolean) as Task[]
    const unordered = tasks.filter(t => !manualOrder.includes(t.id))
    return [...ordered, ...unordered]
  }
  const sorted = [...tasks]
  switch (mode) {
    case 'name':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    case 'priority':
      return sorted.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    case 'due_asc':
      return sorted.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
    case 'due_desc':
      return sorted.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return b.due_date.localeCompare(a.due_date)
      })
    case 'created':
      return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
    default:
      return sorted
  }
}

export function KanbanPage() {
  const { tasks, loading, error, createTask, updateTask, deleteTask } = useTasks()
  const { user } = useAuth()
  const { members } = useProfiles()
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() =>
    localStorage.getItem('pm_kanban_assignee') ?? ASSIGNEE_ALL
  )
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [columnOrder, setColumnOrder] = useState<Status[]>(loadColumnOrder)
  const [overColumnStatus, setOverColumnStatus] = useState<Status | null>(null)
  const [sortMode, setSortMode] = useState<KanbanSortMode>(() =>
    (localStorage.getItem('pm_kanban_sort') as KanbanSortMode) ?? 'manual'
  )
  const [manualOrders, setManualOrders] = useState<ColumnOrders>(loadKanbanOrders)
  const manualOrdersRef = useRef<ColumnOrders>(manualOrders)
  manualOrdersRef.current = manualOrders

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } })
  )

  // Sync manualOrders when tasks change (add new, remove deleted)
  useEffect(() => {
    if (tasks.length === 0) return
    const taskIdSet = new Set(tasks.map(t => t.id))
    const current = manualOrdersRef.current
    let changed = false
    const updated = { ...current }

    for (const status of ALL_STATUSES) {
      const filtered = updated[status].filter(id => taskIdSet.has(id))
      const colNewIds = tasks
        .filter(t => t.status === status)
        .map(t => t.id)
        .filter(id => !filtered.includes(id))
      if (filtered.length !== updated[status].length || colNewIds.length > 0) {
        updated[status] = [...filtered, ...colNewIds]
        changed = true
      }
    }

    if (changed) {
      setManualOrders(updated)
      saveKanbanOrders(updated)
    }
  }, [tasks])

  // Le filtre ne s'applique qu'à l'affichage : `tasks` reste complet pour la
  // synchro de l'ordre manuel et la résolution des cartes glissées.
  const visibleTasks = useMemo(() => {
    if (assigneeFilter === ASSIGNEE_ALL) return tasks
    if (assigneeFilter === ASSIGNEE_NONE) return tasks.filter(t => !t.assignee_id)
    return tasks.filter(t => t.assignee_id === assigneeFilter)
  }, [tasks, assigneeFilter])

  const tasksByStatus = useMemo<Record<Status, Task[]>>(
    () => ALL_STATUSES.reduce(
      (acc, col) => ({
        ...acc,
        [col]: sortColumnTasks(visibleTasks.filter(t => t.status === col), sortMode, manualOrders[col]),
      }),
      { todo: [], in_progress: [], blocked: [], done: [] } as Record<Status, Task[]>
    ),
    [visibleTasks, sortMode, manualOrders]
  )

  const moveColumn = (status: Status, direction: -1 | 1) => {
    const idx = columnOrder.indexOf(status)
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= columnOrder.length) return
    const newOrder = [...columnOrder]
    ;[newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]]
    setColumnOrder(newOrder)
    localStorage.setItem('pm_column_order', JSON.stringify(newOrder))
  }

  const moveCard = useCallback((taskId: string, status: Status, direction: -1 | 1) => {
    // La carte échange sa place avec la voisine *visible*, mais l'ordre
    // enregistré porte sur toute la colonne : sinon un filtre par personne
    // effacerait la position des cartes masquées.
    const visibleIds = tasksByStatus[status].map(t => t.id)
    const idx = visibleIds.indexOf(taskId)
    if (idx < 0) return
    const neighbourId = visibleIds[idx + direction]
    if (neighbourId === undefined) return

    const fullIds = sortColumnTasks(
      tasks.filter(t => t.status === status),
      sortMode,
      manualOrdersRef.current[status]
    ).map(t => t.id)

    const rest = fullIds.filter(id => id !== taskId)
    const target = rest.indexOf(neighbourId)
    const insertAt = direction === -1 ? target : target + 1
    const newOrder = [...rest.slice(0, insertAt), taskId, ...rest.slice(insertAt)]

    const newOrders = { ...manualOrdersRef.current, [status]: newOrder }
    setManualOrders(newOrders)
    setSortMode('manual')
    localStorage.setItem('pm_kanban_sort', 'manual')
    saveKanbanOrders(newOrders)
  }, [tasksByStatus, tasks, sortMode])

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) { setOverColumnStatus(null); return }
    const overId = over.id as string
    if ((ALL_STATUSES as string[]).includes(overId)) {
      setOverColumnStatus(overId as Status)
    } else {
      setOverColumnStatus(tasks.find(t => t.id === overId)?.status ?? null)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null)
    setOverColumnStatus(null)
    const { active, over } = event
    if (!over) return

    const task = tasks.find(t => t.id === active.id)
    if (!task) return

    const overId = over.id as string
    const newStatus = (ALL_STATUSES as string[]).includes(overId)
      ? (overId as Status)
      : tasks.find(t => t.id === overId)?.status

    if (newStatus && newStatus !== task.status) {
      void updateTask(task.id, {
        title: task.title,
        priority: task.priority,
        status: newStatus,
        due_date: task.due_date,
      })
    }
  }

  const handleCreate = async (data: TaskFormData) => {
    await createTask(data)
  }

  const handleUpdate = async (id: string, updates: TaskFormData) => {
    await updateTask(id, updates)
  }

  const handleDelete = async (id: string) => {
    await deleteTask(id)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Chargement…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-destructive">
        Erreur : {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold">Tableau Kanban</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {visibleTasks.length} tâche{visibleTasks.length !== 1 ? 's' : ''}
              {assigneeFilter !== ASSIGNEE_ALL && ` sur ${tasks.length}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Assignée à</span>
            <Select
              value={assigneeFilter}
              onValueChange={v => {
                setAssigneeFilter(v)
                localStorage.setItem('pm_kanban_assignee', v)
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ASSIGNEE_ALL} className="text-xs">Tout le monde</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      <UserAvatar member={m} size="xs" />
                      {m.displayName}{m.id === user?.id ? ' (moi)' : ''}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value={ASSIGNEE_NONE} className="text-xs">Non assignées</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">Trier par</span>
            <Select
              value={sortMode}
              onValueChange={v => {
                const m = v as KanbanSortMode
                setSortMode(m)
                localStorage.setItem('pm_kanban_sort', m)
              }}
            >
              <SelectTrigger className="h-8 w-[148px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="h-full overflow-x-auto p-6">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-4 gap-4 h-full min-w-[900px]">
              {columnOrder.map((status, index) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={tasksByStatus[status]}
                  isActiveOver={overColumnStatus === status}
                  canMoveLeft={index > 0}
                  canMoveRight={index < columnOrder.length - 1}
                  onMoveLeft={() => moveColumn(status, -1)}
                  onMoveRight={() => moveColumn(status, 1)}
                  onMoveCard={(taskId, dir) => moveCard(taskId, status, dir)}
                  onCreateTask={handleCreate}
                  onUpdateTask={handleUpdate}
                  onDeleteTask={handleDelete}
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask && (
                <div className="bg-white rounded-lg border border-border p-3 shadow-xl rotate-2 opacity-95">
                  <p className="text-sm font-medium">{activeTask.title}</p>
                  <div className="mt-2">
                    <Badge variant={activeTask.priority}>{PRIORITY_LABELS[activeTask.priority]}</Badge>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  )
}
