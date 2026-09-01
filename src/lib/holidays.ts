import { addDays, format } from 'date-fns'

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** Jours fériés français d'une année : `yyyy-MM-dd` → libellé. */
function computeHolidays(year: number): Record<string, string> {
  const easter = easterSunday(year)
  const entries: [Date, string][] = [
    [new Date(year, 0, 1), 'Jour de l’an'],
    [addDays(easter, 1), 'Lundi de Pâques'],
    [new Date(year, 4, 1), 'Fête du Travail'],
    [new Date(year, 4, 8), 'Victoire 1945'],
    [addDays(easter, 39), 'Ascension'],
    [addDays(easter, 50), 'Lundi de Pentecôte'],
    [new Date(year, 6, 14), 'Fête nationale'],
    [new Date(year, 7, 15), 'Assomption'],
    [new Date(year, 10, 1), 'Toussaint'],
    [new Date(year, 10, 11), 'Armistice 1918'],
    [new Date(year, 11, 25), 'Noël'],
  ]
  return Object.fromEntries(entries.map(([d, label]) => [format(d, 'yyyy-MM-dd'), label]))
}

const cache = new Map<number, Record<string, string>>()

/** Nom du jour férié, ou `null` si la date n'en est pas un. */
export function holidayName(date: Date): string | null {
  const year = date.getFullYear()
  let holidays = cache.get(year)
  if (!holidays) {
    holidays = computeHolidays(year)
    cache.set(year, holidays)
  }
  return holidays[format(date, 'yyyy-MM-dd')] ?? null
}
