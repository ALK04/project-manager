import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProfileRow } from '@/types/database'

export interface Member {
  id: string
  displayName: string
  color: string
}

interface Snapshot {
  members: Member[]
  loading: boolean
}

// Store module-level : la liste des membres est identique pour toute l'app et
// consultée par plusieurs pages à la fois (Kanban, Gantt, Paramètres, Sidebar).
// Un état partagé évite autant de requêtes que de composants montés.
let snapshot: Snapshot = { members: [], loading: true }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function rowToMember(row: ProfileRow): Member {
  return {
    id: row.id,
    displayName: row.display_name.trim() || 'Sans nom',
    color: row.color,
  }
}

function setSnapshot(next: Snapshot) {
  snapshot = next
  listeners.forEach(l => { l() })
}

async function fetchMembers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('display_name', { ascending: true })

  setSnapshot({
    members: error ? snapshot.members : (data ?? []).map(rowToMember),
    loading: false,
  })
}

function ensureLoaded() {
  inflight ??= fetchMembers()
  return inflight
}

/** Force un rechargement (après renommage d'un profil, par exemple). */
export function refreshMembers() {
  inflight = fetchMembers()
  return inflight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  void ensureLoaded()
  return () => { listeners.delete(listener) }
}

const getSnapshot = () => snapshot

export function useProfiles() {
  const { members, loading } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const byId = useMemo(
    () => new Map(members.map(m => [m.id, m])),
    [members]
  )

  const updateProfile = useCallback(async (id: string, patch: { display_name?: string; color?: string }) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    await refreshMembers()
  }, [])

  return { members, byId, loading, updateProfile, refresh: refreshMembers }
}
