import { eachDayOfInterval, parseISO, startOfDay, addDays, isAfter, isBefore } from 'date-fns'
import type { AbsencePeriod } from '@/types/database'

export function isAbsentDay(date: Date, absences: AbsencePeriod[]): boolean {
  const d = startOfDay(date)
  return absences.some(a => {
    const s = startOfDay(parseISO(a.startDate))
    const e = startOfDay(parseISO(a.endDate))
    return !isBefore(d, s) && !isAfter(d, e)
  })
}

export function countWorkingDays(start: Date, end: Date, absences: AbsencePeriod[]): number {
  if (isAfter(start, end)) return 0
  return eachDayOfInterval({ start: startOfDay(start), end: startOfDay(end) })
    .filter(d => !isAbsentDay(d, absences)).length
}

export function addWorkingDays(from: Date, workingDays: number, absences: AbsencePeriod[]): Date {
  if (workingDays <= 0) return from
  let d = startOfDay(from)
  let remaining = Math.ceil(workingDays)
  while (remaining > 0) {
    d = addDays(d, 1)
    if (!isAbsentDay(d, absences)) remaining--
  }
  return d
}
