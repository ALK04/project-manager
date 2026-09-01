import { useMemo } from 'react'
import { format, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DAY_TYPE_CELL,
  DAY_TYPE_LABELS,
  DAY_TYPE_SHORT,
  WEEKDAY_INITIALS,
  monthCells,
  resolveDay,
} from '@/lib/alternance'
import type { DayInfo, DayOverrides } from '@/types/calendar'

interface AlternanceMonthProps {
  month: Date
  overrides: DayOverrides
  size?: 'sm' | 'lg'
  /** Clic (ou touche) sur un jour modifiable. */
  onPaint: (day: DayInfo) => void
  /** Survol avec le bouton enfoncé — peinture au glisser. */
  onPaintEnter: (day: DayInfo) => void
  /** Si fourni, l'entête du mois ouvre la vue focus. */
  onZoom?: () => void
}

export function AlternanceMonth({ month, overrides, size = 'sm', onPaint, onPaintEnter, onZoom }: AlternanceMonthProps) {
  const cells = useMemo(
    () => monthCells(month).map(date => (date ? resolveDay(date, overrides) : null)),
    [month, overrides]
  )

  const title = format(month, 'MMMM yyyy', { locale: fr })
  const today = new Date()
  const large = size === 'lg'

  return (
    <section
      className={cn('rounded-lg border border-border bg-card', large ? 'p-5' : 'p-3')}
    >
      {onZoom ? (
        <button
          type="button"
          onClick={onZoom}
          className="group mb-2 flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary"
          title="Vue focus sur ce mois"
        >
          <span className="text-sm font-semibold capitalize text-foreground">{title}</span>
          <Maximize2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : (
        <h2 className={cn('mb-3 font-semibold capitalize text-foreground', large ? 'text-xl' : 'text-sm')}>
          {title}
        </h2>
      )}

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_INITIALS.map((initial, i) => (
          <div
            key={i}
            className={cn(
              'font-medium uppercase text-muted-foreground',
              large ? 'pb-1 text-xs' : 'text-[10px]'
            )}
          >
            {initial}
          </div>
        ))}

        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} aria-hidden />

          const isToday = isSameDay(day.date, today)

          return (
            <button
              key={day.key}
              type="button"
              disabled={day.locked}
              onPointerDown={() => onPaint(day)}
              onPointerEnter={() => onPaintEnter(day)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPaint(day)
                }
              }}
              title={`${format(day.date, 'EEEE d MMMM yyyy', { locale: fr })} — ${day.label ?? DAY_TYPE_LABELS[day.type]}`}
              aria-label={`${format(day.date, 'd MMMM yyyy', { locale: fr })} : ${DAY_TYPE_LABELS[day.type]}`}
              className={cn(
                'flex flex-col items-center justify-center rounded border tabular-nums transition-colors',
                DAY_TYPE_CELL[day.type],
                large ? 'h-16 gap-0.5 text-sm' : 'h-7 text-[11px]',
                day.locked
                  ? 'cursor-default'
                  : 'cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                day.overridden && 'font-semibold',
                isToday && 'ring-2 ring-primary ring-offset-1'
              )}
            >
              <span>{format(day.date, 'd')}</span>
              {large && !day.locked && (
                <span className="text-[10px] leading-none opacity-70">{DAY_TYPE_SHORT[day.type]}</span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
