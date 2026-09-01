import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  getDay,
  isWeekend,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { holidayName } from '@/lib/holidays'
import type { DayInfo, DayOverrides, DayType } from '@/types/calendar'

// ─── Période couverte : septembre 2026 → janvier 2029 ────────────────────────

export const PERIOD_START = new Date(2026, 8, 1)
export const PERIOD_END = new Date(2029, 0, 31)
export const MONTHS: Date[] = eachMonthOfInterval({ start: PERIOD_START, end: PERIOD_END })

// ─── Calendrier officiel CESI ────────────────────────────────────────────────

export interface DateRange {
  /** `yyyy-MM-dd` inclus */
  start: string
  /** `yyyy-MM-dd` inclus */
  end: string
  label?: string
}

/**
 * Sessions de formation CESI. Vide par défaut : le calendrier démarre neutre et
 * se remplit au pinceau. Pour figer les dates officielles une bonne fois, les
 * ajouter ici — ex. : { start: '2026-10-12', end: '2026-10-16' }.
 */
export const CESI_SESSIONS: DateRange[] = []

/** Fermetures CESI / congés récurrents. Ex. : { start: '2026-12-21', end: '2027-01-01' } */
export const CESI_CLOSURES: DateRange[] = []

function expand(ranges: DateRange[]): Map<string, string> {
  const days = new Map<string, string>()
  for (const range of ranges) {
    const start = parseISO(range.start)
    const end = parseISO(range.end)
    if (end < start) continue
    for (const day of eachDayOfInterval({ start, end })) {
      days.set(format(day, 'yyyy-MM-dd'), range.label ?? '')
    }
  }
  return days
}

const FORMATION_DAYS = expand(CESI_SESSIONS)
const CLOSURE_DAYS = expand(CESI_CLOSURES)

// ─── Apparence ───────────────────────────────────────────────────────────────

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  libre: 'Non défini',
  formation: 'Formation CESI',
  entreprise: 'Entreprise (présentiel)',
  teletravail: 'Télétravail',
  ferme: 'Week-end / férié / fermeture',
}

export const DAY_TYPE_SHORT: Record<DayType, string> = {
  libre: '',
  formation: 'CESI',
  entreprise: 'Présentiel',
  teletravail: 'Télétravail',
  ferme: 'Fermé',
}

/** Classes de la case du calendrier. */
export const DAY_TYPE_CELL: Record<DayType, string> = {
  libre: 'bg-white border-dashed border-slate-300 text-slate-500',
  formation: 'bg-amber-200 border-amber-300 text-amber-900',
  entreprise: 'bg-sky-200 border-sky-300 text-sky-900',
  teletravail: 'bg-emerald-200 border-emerald-300 text-emerald-900',
  ferme: 'bg-slate-300 border-slate-400 text-slate-600',
}

/** Pastille de la légende. */
export const DAY_TYPE_SWATCH: Record<DayType, string> = {
  libre: 'bg-white border border-dashed border-slate-300',
  formation: 'bg-amber-400',
  entreprise: 'bg-sky-500',
  teletravail: 'bg-emerald-500',
  ferme: 'bg-slate-400',
}

/** Couleurs du PDF : [remplissage, bordure, texte] en RGB. */
export const DAY_TYPE_PDF: Record<DayType, { fill: [number, number, number]; border: [number, number, number]; text: [number, number, number] }> = {
  libre: { fill: [255, 255, 255], border: [203, 213, 225], text: [100, 116, 139] },
  formation: { fill: [253, 230, 138], border: [252, 211, 77], text: [120, 53, 15] },
  entreprise: { fill: [186, 230, 253], border: [125, 211, 252], text: [12, 74, 110] },
  teletravail: { fill: [167, 243, 208], border: [110, 231, 183], text: [6, 78, 59] },
  ferme: { fill: [203, 213, 225], border: [148, 163, 184], text: [51, 65, 85] },
}

export const DAY_TYPE_ORDER: DayType[] = ['formation', 'entreprise', 'teletravail', 'ferme', 'libre']

// ─── Résolution d'un jour ────────────────────────────────────────────────────

/**
 * Type effectif d'une date, par priorité décroissante :
 * week-end → surcharge manuelle → férié → session CESI → fermeture CESI → libre.
 *
 * Les jours fériés sont surchargeables : si le calcul est faux pour ton cas
 * (jour travaillé, férié local…), le pinceau reprend la main.
 */
export function resolveDay(date: Date, overrides: DayOverrides): DayInfo {
  const key = format(date, 'yyyy-MM-dd')

  if (isWeekend(date)) {
    return { date, key, type: 'ferme', locked: true, label: 'Week-end', overridden: false }
  }

  const override = overrides[key]
  if (override) {
    return { date, key, type: override, locked: false, label: DAY_TYPE_LABELS[override], overridden: true }
  }

  const holiday = holidayName(date)
  if (holiday) {
    return { date, key, type: 'ferme', locked: false, label: `Férié — ${holiday}`, overridden: false }
  }

  if (FORMATION_DAYS.has(key)) {
    const label = FORMATION_DAYS.get(key)
    return {
      date, key, type: 'formation', locked: false,
      label: label ? `Session CESI — ${label}` : 'Session CESI', overridden: false,
    }
  }

  if (CLOSURE_DAYS.has(key)) {
    const label = CLOSURE_DAYS.get(key)
    return {
      date, key, type: 'ferme', locked: false,
      label: label ? `Fermeture CESI — ${label}` : 'Fermeture CESI', overridden: false,
    }
  }

  return { date, key, type: 'libre', locked: false, label: null, overridden: false }
}

/** Cases d'un mois : `null` pour les cellules vides avant le 1er (semaine démarrant lundi). */
export function monthCells(month: Date): (Date | null)[] {
  const first = startOfMonth(month)
  const days = eachDayOfInterval({ start: first, end: endOfMonth(month) })
  const leading = (getDay(first) + 6) % 7
  return [...(Array.from({ length: leading }, () => null) as (Date | null)[]), ...days]
}

/** Toutes les dates de la période, dans l'ordre. */
export function allPeriodDays(): Date[] {
  return eachDayOfInterval({ start: PERIOD_START, end: PERIOD_END })
}

export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
