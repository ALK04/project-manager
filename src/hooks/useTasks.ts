import { useState, useEffect, useCallback, useId } from 'react'
import { supabase } from '@/lib/supabase'
import type { Task, TaskInsert, TaskUpdate } from '@/types/database'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelId = useId()

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setTasks((data as Task[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks])

  // Synchro temps réel : le tableau est partagé, les modifications de l'autre
  // membre doivent arriver sans rechargement. Le nom du canal est unique par
  // instance du hook — deux pages montées en même temps sinon se marchent dessus.
  useEffect(() => {
    const channel = supabase
      .channel(`tasks-sync-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        payload => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Task
            setTasks(prev => (prev.some(t => t.id === row.id) ? prev : [row, ...prev]))
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Task
            setTasks(prev => prev.map(t => (t.id === row.id ? row : t)))
          } else if (payload.eventType === 'DELETE') {
            const { id } = payload.old as { id?: string }
            if (id) setTasks(prev => prev.filter(t => t.id !== id))
          }
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [channelId])

  const createTask = async (task: TaskInsert) => {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase
      .from('tasks')
      .insert({ ...task, user_id: session?.user?.id ?? null } as never)
      .select()
      .single()

    if (error) throw new Error(error.message)
    setTasks(prev => [data as Task, ...prev])
    return data as Task
  }

  const updateTask = async (id: string, updates: TaskUpdate) => {
    const patch: TaskUpdate = { ...updates }

    if (!('completed_at' in updates)) {
      if (updates.status === 'done') {
        patch.completed_at = new Date().toISOString()
      } else if ('status' in updates) {
        patch.completed_at = null
      }
    }

    if (!('started_at' in updates)) {
      if (updates.status === 'in_progress') {
        const existing = tasks.find(t => t.id === id)
        if (existing && !existing.started_at) {
          patch.started_at = new Date().toISOString()
        }
      } else if (updates.status === 'todo') {
        patch.started_at = null
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(patch as never)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    setTasks(prev => prev.map(t => (t.id === id ? (data as Task) : t)))
    return data as Task
  }

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw new Error(error.message)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const bulkCreateTasks = async (newTasks: TaskInsert[]) => {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    const { data, error } = await supabase
      .from('tasks')
      .insert(newTasks.map(t => ({ ...t, user_id: userId })) as never)
      .select()

    if (error) throw new Error(error.message)
    const created = (data as Task[]) ?? []
    setTasks(prev => [...created, ...prev])
    return created
  }

  return { tasks, loading, error, createTask, bulkCreateTasks, updateTask, deleteTask, refetch: fetchTasks }
}
