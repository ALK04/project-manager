import type { DayType } from '@/types/calendar'

export type Priority = 'must' | 'should' | 'could' | 'wont'
export type Status = 'todo' | 'in_progress' | 'blocked' | 'done'

// ⚠️ Les types de lignes DB sont des `type` et non des `interface` : supabase-js
// exige que `Row` soit assignable à `Record<string, unknown>`, ce que seules les
// alias de type obtiennent (index signature implicite). En interface, toutes les
// requêtes typées dégénèrent silencieusement en `never`.
export type Task = {
  id: string
  title: string
  priority: Priority
  status: Status
  due_date: string | null
  completed_at: string | null
  started_at: string | null
  created_at: string
}

export type TaskInsert = {
  title: string
  priority: Priority
  status: Status
  due_date?: string | null
  created_at?: string
  completed_at?: string | null
  started_at?: string | null
}

export type TaskUpdate = {
  title?: string
  priority?: Priority
  status?: Status
  due_date?: string | null
  completed_at?: string | null
  started_at?: string | null
  created_at?: string
}

// DB-facing row type for absences (snake_case matches Supabase columns)
export type AbsenceRow = {
  id: string
  user_id: string | null
  label: string
  start_date: string
  end_date: string
  color: string
  created_at: string
}

// Un jour peint du calendrier d'alternance (clé composite user_id + day)
export type AlternanceDayRow = {
  user_id: string
  day: string // yyyy-MM-dd
  type: DayType
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      alternance_days: {
        Row: AlternanceDayRow
        Insert: Omit<AlternanceDayRow, 'updated_at'> & { updated_at?: string }
        Update: Partial<AlternanceDayRow>
        Relationships: []
      }
      tasks: {
        Row: Task
        Insert: TaskInsert
        Update: TaskUpdate
        Relationships: []
      }
      absences: {
        Row: AbsenceRow
        Insert: Omit<AbsenceRow, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<AbsenceRow, 'id' | 'created_at'>>
        Relationships: []
      }
    }
    // Requis par supabase-js : sans `Relationships` sur chaque table ni ces trois
    // clés, le schéma ne satisfait pas `GenericSchema` et tous les types de
    // requête dégénèrent en `never`.
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export interface Settings {
  projectEndDate: string
}

export interface AbsencePeriod {
  id: string
  label: string
  startDate: string  // yyyy-MM-dd
  endDate: string    // yyyy-MM-dd
  color: string      // hex e.g. "#f97316"
}
