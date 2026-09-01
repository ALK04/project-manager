import type { jsPDF } from 'jspdf'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  DAY_TYPE_LABELS,
  DAY_TYPE_ORDER,
  DAY_TYPE_PDF,
  MONTHS,
  PERIOD_END,
  PERIOD_START,
  WEEKDAY_INITIALS,
  monthCells,
  resolveDay,
} from '@/lib/alternance'
import type { DayOverrides, DayType } from '@/types/calendar'

// ─── Mise en page A4 paysage, en millimètres ─────────────────────────────────

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 10
const HEADER_H = 22

const COLS = 4
const GAP_X = 5
const GAP_Y = 4
const COL_W = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP_X) / COLS

const PAD = 2
const CELL_W = (COL_W - 2 * PAD) / 7
const CELL_H = 5.8
const BAND_H = 6
const WEEKDAY_H = 4
const SUMMARY_H = 5
const BLOCK_H = BAND_H + WEEKDAY_H + 6 * CELL_H + SUMMARY_H + 1.5

const ROWS_PER_PAGE = 3
const PER_PAGE = COLS * ROWS_PER_PAGE

// Rayons volontairement discrets : cadre légèrement adouci, cases quasi carrées.
const FRAME_RADIUS = 1
const CELL_RADIUS = 0.3

// ─── Palette ─────────────────────────────────────────────────────────────────

const INK: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [100, 116, 139]
const FAINT: [number, number, number] = [148, 163, 184]
const LINE: [number, number, number] = [203, 213, 225]
const BAND: [number, number, number] = [248, 250, 252]

/** Types résumés sous chaque mois (les week-ends/fériés n'apportent rien ici). */
const SUMMARY_TYPES: DayType[] = ['formation', 'entreprise', 'teletravail']

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ─── Entête de page ──────────────────────────────────────────────────────────

function drawHeader(doc: jsPDF) {
  const title = "Calendrier d'alternance"
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  doc.text(title, MARGIN, MARGIN + 4)
  const titleW = doc.getTextWidth(title)

  // Sous-titre positionné d'après la largeur réelle du titre, pour éviter tout chevauchement
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text('CESI - Manager en Architecture et Applications Logicielles des SI', MARGIN + titleW + 4, MARGIN + 4)

  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(
    `${capitalize(format(PERIOD_START, 'MMMM yyyy', { locale: fr }))} - ${capitalize(format(PERIOD_END, 'MMMM yyyy', { locale: fr }))}`,
    PAGE_W - MARGIN,
    MARGIN + 4,
    { align: 'right' }
  )

  // Légende dans un cadre, largeur ajustée au contenu
  const boxY = MARGIN + 8
  const boxH = 7
  doc.setFontSize(7)
  const items = DAY_TYPE_ORDER.map(type => ({ type, label: DAY_TYPE_LABELS[type], w: doc.getTextWidth(DAY_TYPE_LABELS[type]) }))
  const boxW = items.reduce((sum, item) => sum + 3 + 1.5 + item.w + 5, 0) + 1

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.25)
  doc.roundedRect(MARGIN, boxY, boxW, boxH, FRAME_RADIUS, FRAME_RADIUS, 'S')

  let x = MARGIN + 3
  for (const item of items) {
    const colors = DAY_TYPE_PDF[item.type]
    doc.setFillColor(...colors.fill)
    doc.setDrawColor(...colors.border)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, boxY + boxH / 2 - 1.5, 3, 3, CELL_RADIUS, CELL_RADIUS, 'FD')
    doc.setTextColor(...MUTED)
    doc.text(item.label, x + 4.5, boxY + boxH / 2, { baseline: 'middle' })
    x += 3 + 1.5 + item.w + 5
  }
}

function drawFooter(doc: jsPDF, pageIndex: number, pageCount: number, exportedAt: Date) {
  const y = PAGE_H - 6
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.25)
  doc.line(MARGIN, y - 3.5, PAGE_W - MARGIN, y - 3.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...FAINT)
  doc.text(`Exporte le ${format(exportedAt, 'dd/MM/yyyy')}`, MARGIN, y)
  doc.text(`Page ${pageIndex + 1} / ${pageCount}`, PAGE_W - MARGIN, y, { align: 'right' })
}

// ─── Un mois ─────────────────────────────────────────────────────────────────

function drawMonth(doc: jsPDF, month: Date, overrides: DayOverrides, x: number, y: number) {
  const days = monthCells(month)

  // Fond blanc du cadre (le contour est tracé en dernier, par-dessus les remplissages)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, COL_W, BLOCK_H, FRAME_RADIUS, FRAME_RADIUS, 'F')

  // Bandeau de titre : arrondi en haut, coins du bas rattrapés par un rectangle droit
  doc.setFillColor(...BAND)
  doc.roundedRect(x, y, COL_W, BAND_H, FRAME_RADIUS, FRAME_RADIUS, 'F')
  doc.rect(x, y + BAND_H - FRAME_RADIUS, COL_W, FRAME_RADIUS, 'F')

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.25)
  doc.line(x, y + BAND_H, x + COL_W, y + BAND_H)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(capitalize(format(month, 'MMMM', { locale: fr })), x + PAD, y + BAND_H / 2, { baseline: 'middle' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.text(format(month, 'yyyy'), x + COL_W - PAD, y + BAND_H / 2, { align: 'right', baseline: 'middle' })

  // Initiales des jours — samedi/dimanche estompés
  doc.setFontSize(6)
  WEEKDAY_INITIALS.forEach((initial, i) => {
    doc.setTextColor(...(i >= 5 ? FAINT : MUTED))
    doc.text(initial, x + PAD + i * CELL_W + CELL_W / 2, y + BAND_H + WEEKDAY_H / 2 + 0.6, {
      align: 'center',
      baseline: 'middle',
    })
  })

  // Grille des jours
  const gridY = y + BAND_H + WEEKDAY_H
  const counts: Record<DayType, number> = { libre: 0, formation: 0, entreprise: 0, teletravail: 0, ferme: 0 }

  days.forEach((date, index) => {
    if (!date) return
    const day = resolveDay(date, overrides)
    counts[day.type]++

    const colors = DAY_TYPE_PDF[day.type]
    const cellX = x + PAD + (index % 7) * CELL_W
    const cellY = gridY + Math.floor(index / 7) * CELL_H

    doc.setFillColor(...colors.fill)
    doc.setDrawColor(...colors.border)
    doc.setLineWidth(0.15)
    doc.roundedRect(cellX + 0.25, cellY + 0.25, CELL_W - 0.5, CELL_H - 0.5, CELL_RADIUS, CELL_RADIUS, 'FD')

    doc.setFontSize(7)
    doc.setTextColor(...colors.text)
    doc.text(format(date, 'd'), cellX + CELL_W / 2, cellY + CELL_H / 2, { align: 'center', baseline: 'middle' })
  })

  // Récapitulatif du mois : pastille + effectif, uniquement pour les types présents
  const summaryY = y + BLOCK_H - SUMMARY_H / 2 - 1
  let sx = x + PAD
  doc.setFontSize(6.5)
  for (const type of SUMMARY_TYPES) {
    if (counts[type] === 0) continue
    const colors = DAY_TYPE_PDF[type]
    doc.setFillColor(...colors.fill)
    doc.setDrawColor(...colors.border)
    doc.setLineWidth(0.15)
    doc.roundedRect(sx, summaryY - 1.1, 2.2, 2.2, CELL_RADIUS, CELL_RADIUS, 'FD')
    doc.setTextColor(...MUTED)
    const text = String(counts[type])
    doc.text(text, sx + 3.2, summaryY, { baseline: 'middle' })
    sx += 3.2 + doc.getTextWidth(text) + 3.5
  }

  // Contour du cadre, tracé en dernier pour rester net au-dessus des aplats
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, COL_W, BLOCK_H, FRAME_RADIUS, FRAME_RADIUS, 'S')
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Construit le document (A4 paysage, 4 mois par ligne) sans le télécharger.
 * Séparé de l'export pour être exécutable hors navigateur.
 * jsPDF est importé dynamiquement pour rester hors du bundle initial.
 */
export async function buildAlternancePdf(overrides: DayOverrides, exportedAt: Date = new Date()) {
  const { jsPDF: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageCount = Math.ceil(MONTHS.length / PER_PAGE)

  MONTHS.forEach((month, index) => {
    const pageIndex = Math.floor(index / PER_PAGE)
    const slot = index % PER_PAGE

    if (slot === 0) {
      if (pageIndex > 0) doc.addPage()
      drawHeader(doc)
      drawFooter(doc, pageIndex, pageCount, exportedAt)
    }

    drawMonth(
      doc,
      month,
      overrides,
      MARGIN + (slot % COLS) * (COL_W + GAP_X),
      MARGIN + HEADER_H + Math.floor(slot / COLS) * (BLOCK_H + GAP_Y)
    )
  })

  return doc
}

/** Génère et télécharge le calendrier complet en PDF. */
export async function exportAlternancePdf(overrides: DayOverrides) {
  const doc = await buildAlternancePdf(overrides)
  doc.save(`calendrier-alternance-${format(PERIOD_START, 'yyyy-MM')}_${format(PERIOD_END, 'yyyy-MM')}.pdf`)
}
