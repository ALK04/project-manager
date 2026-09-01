import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, FileDown, Grid3x3, RotateCcw } from 'lucide-react'
import { AlternanceMonth } from '@/components/AlternanceMonth'
import { Button } from '@/components/ui/button'
import { useAlternance } from '@/hooks/useAlternance'
import type { SyncState } from '@/hooks/useAlternance'
import { cn } from '@/lib/utils'
import {
  DAY_TYPE_LABELS,
  DAY_TYPE_ORDER,
  DAY_TYPE_SWATCH,
  MONTHS,
  PERIOD_END,
  PERIOD_START,
  allPeriodDays,
  resolveDay,
} from '@/lib/alternance'
import { exportAlternancePdf } from '@/lib/alternancePdf'
import type { DayInfo, DayType } from '@/types/calendar'

// Découpage en blocs de 12 mois — le dernier bloc peut être incomplet.
const YEARS = Array.from({ length: Math.ceil(MONTHS.length / 12) }, (_, i) => ({
  label: `Année ${i + 1}`,
  months: MONTHS.slice(i * 12, (i + 1) * 12),
}))

export function AlternancePage() {
  const { overrides, brush, setBrush, paintDay, resetAll, sync, syncError } = useAlternance()
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const paintingRef = useRef(false)

  // Fin de la peinture au glisser, même si le pointeur sort du calendrier.
  useEffect(() => {
    const stop = () => { paintingRef.current = false }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const handlePaint = useCallback((day: DayInfo) => {
    if (day.locked) return
    paintingRef.current = true
    paintDay(day.key, brush)
  }, [brush, paintDay])

  const handlePaintEnter = useCallback((day: DayInfo) => {
    if (!paintingRef.current || day.locked) return
    paintDay(day.key, brush)
  }, [brush, paintDay])

  const counts = useMemo(() => {
    const acc: Record<DayType, number> = { libre: 0, formation: 0, entreprise: 0, teletravail: 0, ferme: 0 }
    for (const date of allPeriodDays()) acc[resolveDay(date, overrides).type]++
    return acc
  }, [overrides])

  const workingDays = counts.formation + counts.entreprise + counts.teletravail
  const remotePercent = workingDays > 0 ? Math.round((counts.teletravail / workingDays) * 100) : 0

  const handleReset = () => {
    if (confirm('Réinitialiser toutes vos modifications et revenir au calendrier par défaut ? Les jours enregistrés en base seront supprimés.')) {
      void resetAll()
    }
  }

  const focusMonth = focusIndex !== null ? MONTHS[focusIndex] : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Entête ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Calendrier d’alternance</h1>
            <p className="text-xs text-muted-foreground">
              CESI — Manager en Architecture et Applications Logicielles des SI ·{' '}
              {format(PERIOD_START, 'MMMM yyyy', { locale: fr })} → {format(PERIOD_END, 'MMMM yyyy', { locale: fr })} ·{' '}
              {MONTHS.length} mois
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SyncBadge sync={sync} error={syncError} />
            {focusMonth && (
              <Button variant="outline" size="sm" onClick={() => setFocusIndex(null)}>
                <Grid3x3 className="mr-1.5 h-3.5 w-3.5" />
                Tous les mois
              </Button>
            )}
            <Button size="sm" onClick={() => { void exportAlternancePdf(overrides) }}>
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Exporter en PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Calendrier ───────────────────────────────────────────────── */}
        <div className="flex-1 select-none overflow-y-auto p-6">
          {focusMonth ? (
            <div className="mx-auto max-w-3xl">
              <div className="mb-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={focusIndex === 0}
                  onClick={() => setFocusIndex(i => (i === null ? null : Math.max(0, i - 1)))}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                  Mois précédent
                </Button>
                <span className="text-xs text-muted-foreground">
                  Mois {(focusIndex ?? 0) + 1} / {MONTHS.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={focusIndex === MONTHS.length - 1}
                  onClick={() => setFocusIndex(i => (i === null ? null : Math.min(MONTHS.length - 1, i + 1)))}
                >
                  Mois suivant
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
              <AlternanceMonth
                month={focusMonth}
                overrides={overrides}
                size="lg"
                onPaint={handlePaint}
                onPaintEnter={handlePaintEnter}
              />
            </div>
          ) : (
            YEARS.map(year => (
              <div key={year.label} className="mb-8 last:mb-0">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {year.label} · {format(year.months[0], 'MMM yyyy', { locale: fr })} →{' '}
                  {format(year.months[year.months.length - 1], 'MMM yyyy', { locale: fr })}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {year.months.map(month => (
                    <AlternanceMonth
                      key={month.toISOString()}
                      month={month}
                      overrides={overrides}
                      onPaint={handlePaint}
                      onPaintEnter={handlePaintEnter}
                      onZoom={() => setFocusIndex(MONTHS.indexOf(month))}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ─── Panneau latéral : légende / pinceau ──────────────────────── */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-border bg-white px-4 py-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinceau</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Sélectionnez un type, puis cliquez (ou glissez) sur les jours du calendrier.
          </p>

          <div className="mt-3 space-y-1.5">
            {DAY_TYPE_ORDER.map(type => (
              <BrushButton
                key={type}
                active={brush === type}
                swatch={DAY_TYPE_SWATCH[type]}
                label={DAY_TYPE_LABELS[type]}
                count={counts[type]}
                onClick={() => setBrush(type)}
              />
            ))}
          </div>

          <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Tous les jours de semaine sont modifiables, jours fériés compris — si un férié est faux, repeignez-le.
            Seuls les week-ends sont verrouillés.
          </p>

          <div className="mt-5 border-t border-border pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Récapitulatif</h2>
            <dl className="mt-2 space-y-1.5 text-xs">
              <StatRow label="Jours qualifiés" value={workingDays} />
              <StatRow label="Formation CESI" value={counts.formation} />
              <StatRow label="Présentiel" value={counts.entreprise} />
              <StatRow label="Télétravail" value={counts.teletravail} />
              <StatRow label="Part de télétravail" value={`${remotePercent} %`} />
              <StatRow label="Restant à définir" value={counts.libre} />
            </dl>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <button
              onClick={handleReset}
              className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-red-500"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser mes modifications
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function SyncBadge({ sync, error }: { sync: SyncState; error: string | null }) {
  if (sync === 'loading') {
    return <span className="text-xs text-muted-foreground">Chargement…</span>
  }
  if (sync === 'saving') {
    return <span className="text-xs text-muted-foreground">Enregistrement…</span>
  }
  if (sync === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-500" title={error ?? undefined}>
        <AlertCircle className="h-3.5 w-3.5" />
        Non synchronisé
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      Enregistré
    </span>
  )
}

interface BrushButtonProps {
  active: boolean
  label: string
  swatch: string
  count: number
  onClick: () => void
}

function BrushButton({ active, label, swatch, count, onClick }: BrushButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
        active
          ? 'border-primary bg-secondary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <span className={cn('h-3 w-3 shrink-0 rounded-sm', swatch)} />
      <span className="flex-1 leading-tight">{label}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{count}</span>
    </button>
  )
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
