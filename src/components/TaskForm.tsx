import { useState } from 'react'
import { format } from 'date-fns'
import type { Task, Priority, Status } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter } from '@/components/ui/dialog'

interface TaskFormProps {
  initialTask?: Partial<Task>
  onSubmit: (data: { title: string; priority: Priority; status: Status; due_date: string | null; completed_at: string | null }) => Promise<void>
  onCancel: () => void
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'must', label: 'Urgent' },
  { value: 'should', label: 'Important' },
  { value: 'could', label: 'Neutre' },
  { value: 'wont', label: 'Peut attendre' },
]

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'todo', label: 'À faire' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'blocked', label: 'Bloqué' },
  { value: 'done', label: 'Terminé' },
]

export function TaskForm({ initialTask, onSubmit, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initialTask?.title ?? '')
  const [priority, setPriority] = useState<Priority>(initialTask?.priority ?? 'should')
  const [status, setStatus] = useState<Status>(initialTask?.status ?? 'todo')
  const [dueDate, setDueDate] = useState(initialTask?.due_date ?? '')
  const [completedAt, setCompletedAt] = useState(
    initialTask?.completed_at ? format(new Date(initialTask.completed_at), 'yyyy-MM-dd') : ''
  )
  const [loading, setLoading] = useState(false)

  const createdDate = initialTask?.created_at
    ? format(new Date(initialTask.created_at), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd')

  const handleStatusChange = (v: Status) => {
    setStatus(v)
    if (v === 'done' && !completedAt) {
      setCompletedAt(format(new Date(), 'yyyy-MM-dd'))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      await onSubmit({
        title: title.trim(),
        priority,
        status,
        due_date: dueDate || null,
        completed_at: status === 'done' ? (completedAt || null) : null,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Titre</Label>
        <Input
          id="title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Description de la tâche"
          required
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Priorité MoSCoW</Label>
          <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Statut</Label>
          <Select value={status} onValueChange={v => handleStatusChange(v as Status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="created_date">Date de création</Label>
          <Input
            id="created_date"
            type="date"
            value={createdDate}
            readOnly
            className="bg-muted cursor-default"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_date">Date d'échéance</Label>
          <Input id="due_date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      {status === 'done' && (
        <div className="space-y-1.5">
          <Label htmlFor="completed_at">Terminé le</Label>
          <Input
            id="completed_at"
            type="date"
            value={completedAt}
            onChange={e => setCompletedAt(e.target.value)}
          />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button type="submit" disabled={loading || !title.trim()}>
          {loading ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </DialogFooter>
    </form>
  )
}
