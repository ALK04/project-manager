import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Task, Priority, Status } from '@/types/database'
import { TaskCard } from '@/components/TaskCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TaskForm } from '@/components/TaskForm'

const COLUMN_CONFIG: Record<Status, { label: string; color: string; dot: string }> = {
  todo: { label: 'À faire', color: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400' },
  in_progress: { label: 'En cours', color: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
  blocked: { label: 'Bloqué', color: 'bg-red-50 border-red-200', dot: 'bg-red-500' },
  done: { label: 'Terminé', color: 'bg-green-50 border-green-200', dot: 'bg-green-500' },
}

interface KanbanColumnProps {
  status: Status
  tasks: Task[]
  isActiveOver: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  onMoveLeft: () => void
  onMoveRight: () => void
  onMoveCard: (taskId: string, direction: -1 | 1) => void
  onCreateTask: (data: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => Promise<void>
  onUpdateTask: (id: string, updates: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => Promise<void>
  onDeleteTask: (id: string) => Promise<void>
}

export function KanbanColumn({
  status, tasks, isActiveOver,
  canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
  onMoveCard, onCreateTask, onUpdateTask, onDeleteTask,
}: KanbanColumnProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const config = COLUMN_CONFIG[status]
  const { setNodeRef } = useDroppable({ id: status })

  const handleCreate = async (data: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => {
    await onCreateTask({ ...data, status })
    setCreateOpen(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border h-full overflow-hidden transition-all duration-100 ${
        isActiveOver ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-300 ring-offset-2 shadow-md' : config.color
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-inherit">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${config.dot}`} />
          <span className="text-sm font-semibold text-foreground">{config.label}</span>
          <span className="text-xs text-muted-foreground bg-white rounded-full px-1.5 py-0.5 border">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveLeft} disabled={!canMoveLeft} title="Déplacer à gauche">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveRight} disabled={!canMoveRight} title="Déplacer à droite">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2 p-3 overflow-y-auto min-h-0">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task, idx) => (
            <TaskCard
              key={task.id}
              task={task}
              onMoveUp={idx > 0 ? () => onMoveCard(task.id, -1) : undefined}
              onMoveDown={idx < tasks.length - 1 ? () => onMoveCard(task.id, 1) : undefined}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">Aucune tâche</p>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle tâche — {config.label}</DialogTitle>
          </DialogHeader>
          <TaskForm
            initialTask={{ status }}
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
