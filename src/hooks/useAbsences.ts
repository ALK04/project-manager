import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { AbsencePeriod, AbsenceRow } from '@/types/database'

function rowToAbsence(row: AbsenceRow): AbsencePeriod {
  return {
    id: row.id,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    color: row.color,
  }
}

export function useAbsences() {
  const [absences, setAbsences] = useState<AbsencePeriod[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAbsences = useCallback(async () => {
    const { data, error } = await supabase
      .from('absences')
      .select('*')
      .order('start_date', { ascending: true })
    if (!error) setAbsences((data ?? []).map(rowToAbsence))
    setLoading(false)
  }, [])

  useEffect(() => { void fetchAbsences() }, [fetchAbsences])

  const addAbsence = async (a: Omit<AbsencePeriod, 'id'>) => {
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase
      .from('absences')
      .insert({
        user_id: session?.user?.id ?? null,
        label: a.label,
        start_date: a.startDate,
        end_date: a.endDate,
        color: a.color,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    setAbsences(prev => [...prev, rowToAbsence(data)])
  }

  const removeAbsence = async (id: string) => {
    const { error } = await supabase.from('absences').delete().eq('id', id)
    if (error) throw new Error(error.message)
    setAbsences(prev => prev.filter(a => a.id !== id))
  }

  return { absences, loading, addAbsence, removeAbsence }
}
