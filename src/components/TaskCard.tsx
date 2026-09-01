import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Pencil, Trash2, Calendar, Clock, GripVertical, CheckCircle2, ChevronUp, ChevronDown } from 'lucide-react'
import type { Task, Priority, Status } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TaskForm } from '@/components/TaskForm'

const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Urgent',
  should: 'Important',
  could: 'Neutre',
  wont: 'Peut attendre',
}

interface TaskCardProps {
  task: Task
  onMoveUp?: () => void
  onMoveDown?: () => void
  onUpdate: (id: string, updates: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function TaskCard({ task, onMoveUp, onMoveDown, onUpdate, onDelete }: TaskCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const handleUpdate = async (data: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => {
    await onUpdate(task.id, data)
    setEditOpen(false)
  }

  const handleDelete = async () => {
    if (confirm('Supprimer cette tâche ?')) {
      await onDelete(task.id)
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="bg-white rounded-lg border border-border p-3 shadow-sm group cursor-default"
      >
        <div className="flex items-start gap-2">
          {/* Drag handle + reorder arrows */}
          <div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:pointer-events-none transition-colors"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              title="Monter"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              {...attributes}
              {...listeners}
              className="text-muted-foreground cursor-grab active:cursor-grabbing"
              aria-label="Déplacer"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <button
              className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:pointer-events-none transition-colors"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              title="Descendre"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug break-words">{task.title}</p>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={task.priority}>{PRIORITY_LABELS[task.priority]}</Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {format(new Date(task.created_at), 'd MMM', { locale: fr })}
              </span>
              {task.due_date && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(task.due_date), 'd MMM', { locale: fr })}
                </span>
              )}
              {task.status === 'done' && task.completed_at && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  {format(new Date(task.completed_at), 'd MMM yyyy', { locale: fr })}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { void handleDelete() }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la tâche</DialogTitle>
          </DialogHeader>
          <TaskForm initialTask={task} onSubmit={handleUpdate} onCancel={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
