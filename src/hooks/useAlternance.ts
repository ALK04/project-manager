import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Brush, DayOverrides, DayType } from '@/types/calendar'

const DAYS_KEY = 'pm_alternance_days'
const BRUSH_KEY = 'pm_alternance_brush'
/** Délai avant écriture en base, pour regrouper une peinture au glisser en un seul upsert. */
const FLUSH_DELAY = 600

export type SyncState = 'loading' | 'idle' | 'saving' | 'error'

const BRUSHES: Brush[] = ['libre', 'formation', 'entreprise', 'teletravail', 'ferme']

/** Miroir localStorage : sauvegarde de secours + affichage instantané au chargement. */
function loadLocalOverrides(): DayOverrides {
  try {
    const stored = localStorage.getItem(DAYS_KEY)
    return stored ? (JSON.parse(stored) as DayOverrides) : {}
  } catch {
    return {}
  }
}

function loadBrush(): Brush {
  const stored = localStorage.getItem(BRUSH_KEY) as Brush | null
  return stored && BRUSHES.includes(stored) ? stored : 'formation'
}

/**
 * Source de vérité : la table `alternance_days` (Supabase).
 * Le localStorage reste maintenu en miroir — il sert de cache d'affichage immédiat
 * et de filet de sécurité si la base est injoignable.
 */
export function useAlternance() {
  const [overrides, setOverrides] = useState<DayOverrides>(loadLocalOverrides)
  const [brush, setBrush] = useState<Brush>(loadBrush)
  const [sync, setSync] = useState<SyncState>('loading')
  const [syncError, setSyncError] = useState<string | null>(null)

  const userIdRef = useRef<string | null>(null)
  const pendingRef = useRef<Map<string, DayType>>(new Map())
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Miroir localStorage
  useEffect(() => {
    localStorage.setItem(DAYS_KEY, JSON.stringify(overrides))
  }, [overrides])

  useEffect(() => {
    localStorage.setItem(BRUSH_KEY, brush)
  }, [brush])

  /** Écrit en base les jours en attente. */
  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const userId = userIdRef.current
    if (!userId || pendingRef.current.size === 0) return

    const rows = [...pendingRef.current].map(([day, type]) => ({ user_id: userId, day, type }))
    pendingRef.current.clear()

    if (mountedRef.current) setSync('saving')
    const { error } = await supabase
      .from('alternance_days')
      .upsert(rows, { onConflict: 'user_id,day' })

    if (!mountedRef.current) return
    if (error) {
      // Les jours restent dans le miroir localStorage : rien n'est perdu.
      setSync('error')
      setSyncError(error.message)
    } else {
      setSync('idle')
      setSyncError(null)
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush() }, FLUSH_DELAY)
  }, [flush])

  // Chargement initial + migration one-shot du localStorage vers la base
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id ?? null
      userIdRef.current = userId

      if (!userId) {
        if (!cancelled) setSync('idle')
        return
      }

      const { data, error } = await supabase
        .from('alternance_days')
        .select('day, type')
        .eq('user_id', userId)

      if (cancelled) return

      if (error) {
        setSync('error')
        setSyncError(error.message)
        return
      }

      const remote: DayOverrides = {}
      for (const row of data ?? []) remote[row.day] = row.type

      // La base gagne sur le miroir local, mais une peinture faite pendant le
      // chargement (encore en attente d'écriture) gagne sur la base.
      setOverrides(prev => ({ ...prev, ...remote, ...Object.fromEntries(pendingRef.current) }))

      const local = loadLocalOverrides()
      const missing = Object.keys(local).filter(key => !(key in remote))
      if (missing.length > 0) {
        for (const key of missing) pendingRef.current.set(key, local[key])
        void flush()
      } else {
        setSync('idle')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [flush])

  // Écriture des derniers jours en attente si on quitte la page
  useEffect(() => () => { void flush() }, [flush])

  /**
   * Applique le pinceau courant à un jour. `libre` est stocké explicitement (et non
   * effacé) pour pouvoir neutraliser un jour férié mal détecté.
   */
  const paintDay = useCallback((key: string, value: Brush) => {
    setOverrides(prev => (prev[key] === value ? prev : { ...prev, [key]: value }))
    pendingRef.current.set(key, value)
    scheduleFlush()
  }, [scheduleFlush])

  const resetAll = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current.clear()
    setOverrides({})

    const userId = userIdRef.current
    if (!userId) return

    setSync('saving')
    const { error } = await supabase.from('alternance_days').delete().eq('user_id', userId)
    if (!mountedRef.current) return
    if (error) {
      setSync('error')
      setSyncError(error.message)
    } else {
      setSync('idle')
      setSyncError(null)
    }
  }, [])

  return { overrides, brush, setBrush, paintDay, resetAll, sync, syncError }
}
