import { useState, useRef, useMemo } from 'react'
import { format, parseISO, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { FileJson, AlertCircle, CheckCircle2, ShieldCheck, Pencil, X, Check, Trash2, Plus } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { useAbsences } from '@/hooks/useAbsences'
import { useTasks } from '@/hooks/useTasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Priority, Status, Task, TaskInsert } from '@/types/database'

// ─── Trello JSON types ───────────────────────────────────────────────────────

interface TrelloList  { id: string; name: string; closed: boolean }
interface TrelloCard  {
  id: string; name: string; due: string | null; dueComplete: boolean
  closed: boolean; idList: string; dateLastActivity: string
}
interface TrelloBoard { name?: string; lists: TrelloList[]; cards: TrelloCard[] }

interface ImportRow {
  trelloId: string
  title: string
  priority: Priority
  status: Status
  due_date: string
  created_at: string
  completed_at: string | null
  include: boolean
}

// ─── Diagnostic types ────────────────────────────────────────────────────────

type IssueSeverity = 'critical' | 'warning'

interface DiagnosticIssue {
  taskId: string
  taskTitle: string
  taskCreatedAt: string
  severity: IssueSeverity
  code: string
  message: string
  canFixCreatedAt: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<Status, string> = {
  todo: 'À faire', in_progress: 'En cours', blocked: 'Bloqué', done: 'Terminé',
}
const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Urgent', should: 'Important', could: 'Neutre', wont: 'Peut attendre',
}

function trelloCreatedAt(id: string): string {
  return new Date(parseInt(id.substring(0, 8), 16) * 1000).toISOString()
}

function mapStatus(listName: string): Status {
  const n = listName.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (/cours|progress|doing|wip/.test(n))        return 'in_progress'
  if (/termin|done|complet|fini|achev/.test(n))  return 'done'
  if (/bloqu|blocked|hold/.test(n))              return 'blocked'
  return 'todo'
}

function parseTrelloJson(raw: unknown): ImportRow[] | string {
  try {
    const board = raw as TrelloBoard
    if (!Array.isArray(board.cards) || !Array.isArray(board.lists)) {
      return 'Format invalide : les champs "cards" et "lists" sont absents.'
    }
    const listsById = new Map(
      board.lists.filter(l => !l.closed).map(l => [l.id, l])
    )
    const rows: ImportRow[] = board.cards
      .filter(c => !c.closed && c.name?.trim())
      .map(c => {
        const list = listsById.get(c.idList)
        const baseStatus: Status = list ? mapStatus(list.name) : 'todo'
        const isDone = baseStatus === 'done' || c.dueComplete
        const status: Status = isDone ? 'done' : baseStatus
        return {
          trelloId:     c.id,
          title:        c.name.trim(),
          priority:     'should' as Priority,
          status,
          due_date:     c.due ? c.due.slice(0, 10) : '',
          created_at:   trelloCreatedAt(c.id),
          completed_at: isDone ? (c.dateLastActivity ?? null) : null,
          include:      true,
        }
      })
    if (!rows.length) return 'Aucune carte active trouvée dans ce fichier.'
    return rows
  } catch {
    return "Impossible de lire le JSON. Vérifie que c'est bien un export Trello."
  }
}

function computeIssues(tasks: Task[]): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []

  for (const task of tasks) {
    const createdAt   = parseISO(task.created_at)
    const dueDate     = task.due_date     ? parseISO(task.due_date)     : null
    const completedAt = task.completed_at ? parseISO(task.completed_at) : null

    if (completedAt && startOfDay(completedAt) < startOfDay(createdAt)) {
      issues.push({
        taskId: task.id, taskTitle: task.title, taskCreatedAt: task.created_at,
        severity: 'critical', code: 'completed_before_created', canFixCreatedAt: true,
        message: `Terminée le ${format(completedAt, 'd MMM yyyy', { locale: fr })} mais créée le ${format(createdAt, 'd MMM yyyy', { locale: fr })}`,
      })
    }

    if (dueDate && startOfDay(dueDate) < startOfDay(createdAt)) {
      issues.push({
        taskId: task.id, taskTitle: task.title, taskCreatedAt: task.created_at,
        severity: 'critical', code: 'due_before_created', canFixCreatedAt: true,
        message: `Échéance le ${format(dueDate, 'd MMM yyyy', { locale: fr })} mais créée le ${format(createdAt, 'd MMM yyyy', { locale: fr })}`,
      })
    }

    if (task.status === 'done' && !task.completed_at) {
      issues.push({
        taskId: task.id, taskTitle: task.title, taskCreatedAt: task.created_at,
        severity: 'warning', code: 'done_no_date', canFixCreatedAt: false,
        message: 'Statut "Terminé" mais aucune date de fin renseignée',
      })
    }

    if (task.completed_at && task.status !== 'done') {
      issues.push({
        taskId: task.id, taskTitle: task.title, taskCreatedAt: task.created_at,
        severity: 'warning', code: 'date_but_not_done', canFixCreatedAt: false,
        message: `Date de fin renseignée (${format(completedAt!, 'd MMM yyyy', { locale: fr })}) mais statut "${STATUS_LABELS[task.status]}"`,
      })
    }
  }

  return issues
}

// ─── Absence quick-labels ─────────────────────────────────────────────────────

const QUICK_LABELS = ['Alternance', 'Vacances', 'Maladie', 'Férié', 'Formation']
const COLOR_PRESETS = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#94a3b8']

// ─── Component ───────────────────────────────────────────────────────────────

type Tab = 'settings' | 'absences' | 'import' | 'diagnostic'

export function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const { absences, addAbsence, removeAbsence } = useAbsences()
  const { tasks, bulkCreateTasks, updateTask } = useTasks()

  // — Settings tab —
  const [tab, setTab]         = useState<Tab>('settings')
  const [endDate, setEndDate] = useState(settings.projectEndDate)
  const [saved, setSaved]     = useState(false)

  // — Absences tab —
  const [absLabel, setAbsLabel] = useState('')
  const [absStart, setAbsStart] = useState('')
  const [absEnd, setAbsEnd]     = useState('')
  const [absColor, setAbsColor] = useState(COLOR_PRESETS[0])

  // — Import tab —
  const [rows, setRows]               = useState<ImportRow[]>([])
  const [boardName, setBoardName]     = useState<string | null>(null)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [importing, setImporting]     = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // — Diagnostic tab —
  const issues = useMemo(() => computeIssues(tasks), [tasks])
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState('')
  const [savingId, setSavingId]       = useState<string | null>(null)

  const handleSave = () => {
    if (!endDate) return
    updateSettings({ projectEndDate: endDate })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddAbsence = () => {
    if (!absLabel.trim() || !absStart || !absEnd) return
    if (absStart > absEnd) return
    void addAbsence({ label: absLabel.trim(), startDate: absStart, endDate: absEnd, color: absColor })
    setAbsLabel('')
    setAbsStart('')
    setAbsEnd('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target?.result as string) as unknown
        const result = parseTrelloJson(json)
        if (typeof result === 'string') {
          setParseError(result); setRows([]); setBoardName(null)
        } else {
          setParseError(null); setRows(result)
          setBoardName((json as TrelloBoard).name ?? null)
          setImportResult(null)
        }
      } catch {
        setParseError('Fichier JSON invalide.'); setRows([])
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const updateRow = (trelloId: string, patch: Partial<ImportRow>) =>
    setRows(prev => prev.map(r => r.trelloId === trelloId ? { ...r, ...patch } : r))

  const selectedCount = rows.filter(r => r.include).length
  const allSelected   = rows.length > 0 && rows.every(r => r.include)

  const handleImport = async () => {
    const toImport = rows.filter(r => r.include)
    if (!toImport.length) return
    setImporting(true)
    try {
      await bulkCreateTasks(
        toImport.map((r): TaskInsert => ({
          title: r.title, priority: r.priority, status: r.status,
          due_date: r.due_date || null, created_at: r.created_at, completed_at: r.completed_at,
        }))
      )
      setImportResult({ success: toImport.length, errors: [] })
      setRows([]); setBoardName(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue'
      setImportResult({ success: 0, errors: [msg] })
    } finally {
      setImporting(false)
    }
  }

  const startEditCreatedAt = (issue: DiagnosticIssue) => {
    setEditingId(issue.taskId)
    setEditingDate(format(parseISO(issue.taskCreatedAt), 'yyyy-MM-dd'))
  }

  const cancelEditCreatedAt = () => { setEditingId(null); setEditingDate('') }

  const confirmEditCreatedAt = async (taskId: string) => {
    if (!editingDate) return
    setSavingId(taskId)
    try {
      await updateTask(taskId, { created_at: editingDate + 'T00:00:00.000Z' })
      setEditingId(null)
      setEditingDate('')
    } finally {
      setSavingId(null)
    }
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount  = issues.filter(i => i.severity === 'warning').length

  const TAB_LABELS: Record<Tab, string> = {
    settings: 'Général',
    absences: `Absences${absences.length > 0 ? ` (${absences.length})` : ''}`,
    import: 'Importer Trello',
    diagnostic: 'Diagnostic',
  }

  const canAddAbsence = absLabel.trim() && absStart && absEnd && absStart <= absEnd

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-xl font-semibold">Paramètres</h2>
      </div>

      <div className="px-6 border-b border-border flex shrink-0">
        {(['settings', 'absences', 'import', 'diagnostic'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {TAB_LABELS[t]}
            {t === 'diagnostic' && issues.length > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] ${
                criticalCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {issues.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="p-6 max-w-lg space-y-8">
            <section className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Projet</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Configure la date de fin pour le calcul du burndown.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white p-5 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="end_date">Date de fin du projet</Label>
                  <Input
                    id="end_date" type="date" value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                  {endDate && (
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(endDate), 'EEEE d MMMM yyyy', { locale: fr })}
                    </p>
                  )}
                </div>
                <Button onClick={handleSave} disabled={!endDate}>
                  {saved ? 'Enregistré ✓' : 'Enregistrer'}
                </Button>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-base font-semibold">À propos</h3>
              <div className="rounded-xl border border-border bg-white p-5 space-y-2 text-sm text-muted-foreground">
                <p>Stack : React · TypeScript · Tailwind CSS · Supabase · Recharts</p>
                <p>Drag &amp; drop : @dnd-kit</p>
              </div>
            </section>
          </div>
        )}

        {/* ── ABSENCES TAB ── */}
        {tab === 'absences' && (
          <div className="p-6 max-w-2xl space-y-6">
            <div>
              <h3 className="text-base font-semibold">Périodes d'absence</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Les jours dans ces périodes sont exclus des calculs de vélocité sur le Burndown,
                et apparaissent en surbrillance sur le Gantt.
              </p>
            </div>

            {/* Add form */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-4">
              <p className="text-sm font-medium">Ajouter une période</p>

              {/* Quick label buttons */}
              <div className="space-y-1.5">
                <Label>Raison</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {QUICK_LABELS.map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setAbsLabel(l)}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        absLabel === l
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <Input
                  placeholder="Ou saisir librement…"
                  value={absLabel}
                  onChange={e => setAbsLabel(e.target.value)}
                />
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="abs_start">Du</Label>
                  <Input id="abs_start" type="date" value={absStart} onChange={e => setAbsStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="abs_end">Au (inclus)</Label>
                  <Input id="abs_end" type="date" value={absEnd} min={absStart} onChange={e => setAbsEnd(e.target.value)} />
                </div>
              </div>

              {/* Color */}
              <div className="space-y-1.5">
                <Label>Couleur sur le Gantt</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAbsColor(c)}
                      className="w-7 h-7 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: c,
                        borderColor: absColor === c ? '#1e293b' : 'transparent',
                        boxShadow: absColor === c ? '0 0 0 1px #fff inset' : undefined,
                      }}
                      title={c}
                    />
                  ))}
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    <input
                      type="color"
                      value={absColor}
                      onChange={e => setAbsColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border border-border p-0.5"
                    />
                    Personnalisée
                  </label>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="w-5 h-3 rounded-sm" style={{ backgroundColor: absColor, opacity: 0.4 }} />
                    Aperçu
                  </span>
                </div>
              </div>

              <Button onClick={handleAddAbsence} disabled={!canAddAbsence} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>

            {/* Existing periods */}
            {absences.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Périodes enregistrées ({absences.length})</p>
                {absences.map(a => {
                  const start = parseISO(a.startDate)
                  const end   = parseISO(a.endDate)
                  const days  = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
                  return (
                    <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: a.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(start, 'd MMM yyyy', { locale: fr })} → {format(end, 'd MMM yyyy', { locale: fr })}
                          <span className="ml-2">({days} jour{days !== 1 ? 's' : ''})</span>
                        </p>
                      </div>
                      <button
                        onClick={() => { void removeAbsence(a.id) }}
                        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center text-muted-foreground text-sm">
                Aucune période d'absence enregistrée.
              </div>
            )}
          </div>
        )}

        {/* ── IMPORT TAB ── */}
        {tab === 'import' && (
          <div className="p-6 space-y-6 max-w-5xl">
            <div>
              <h3 className="text-base font-semibold">Importer depuis Trello</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Dans Trello : tableau → <strong>Afficher le menu</strong> → <strong>Plus</strong> → <strong>Imprimer et exporter</strong> → <strong>Exporter en JSON</strong>.
              </p>
            </div>

            <div
              className="rounded-xl border-2 border-dashed border-border bg-white p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-slate-50/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileJson className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Sélectionner le fichier JSON Trello</p>
              <p className="text-xs text-muted-foreground">Cliquer ici ou glisser le fichier</p>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
            </div>

            {parseError && (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{parseError}
              </div>
            )}

            {importResult && (
              <div className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
                importResult.errors.length
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}>
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  {importResult.success > 0 && (
                    <p className="font-medium">{importResult.success} tâche{importResult.success !== 1 ? 's' : ''} importée{importResult.success !== 1 ? 's' : ''} avec succès.</p>
                  )}
                  {importResult.errors.length > 0 && <p className="mt-0.5">{importResult.errors.join(', ')}</p>}
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    {boardName && (<>Tableau : <span className="text-foreground">{boardName}</span> — </>)}
                    <span className="text-foreground">{selectedCount}</span> / {rows.length} tâche{rows.length !== 1 ? 's' : ''} sélectionnée{selectedCount !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground italic">Modifie le statut, la priorité ou l'échéance avant d'importer</p>
                </div>

                <div className="rounded-xl border border-border overflow-auto" style={{ maxHeight: 440 }}>
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2.5 text-left w-10">
                          <input type="checkbox" checked={allSelected}
                            onChange={e => setRows(prev => prev.map(r => ({ ...r, include: e.target.checked })))}
                            className="cursor-pointer" />
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Titre</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-36">Statut</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-36">Priorité</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-28">Créé le</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-36">Échéance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.trelloId} className={`border-b border-border/40 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} ${row.include ? '' : 'opacity-35'}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={row.include}
                              onChange={e => updateRow(row.trelloId, { include: e.target.checked })}
                              className="cursor-pointer" />
                          </td>
                          <td className="px-3 py-2 max-w-[280px]">
                            <span className="block truncate" title={row.title}>{row.title}</span>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.status} onChange={e => updateRow(row.trelloId, { status: e.target.value as Status })}
                              className="w-full rounded-md border border-border bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                              {(Object.keys(STATUS_LABELS) as Status[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.priority} onChange={e => updateRow(row.trelloId, { priority: e.target.value as Priority })}
                              className="w-full rounded-md border border-border bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                              {(Object.keys(PRIORITY_LABELS) as Priority[]).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {format(parseISO(row.created_at), 'd MMM yyyy', { locale: fr })}
                          </td>
                          <td className="px-3 py-2">
                            <input type="date" value={row.due_date}
                              onChange={e => updateRow(row.trelloId, { due_date: e.target.value })}
                              className="w-full rounded-md border border-border bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">Les tâches décochées ne seront pas importées.</p>
                  <Button onClick={() => { void handleImport() }} disabled={importing || selectedCount === 0}>
                    {importing ? 'Import en cours…' : `Importer ${selectedCount} tâche${selectedCount !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DIAGNOSTIC TAB ── */}
        {tab === 'diagnostic' && (
          <div className="p-6 space-y-6 max-w-4xl">
            <div>
              <h3 className="text-base font-semibold">Diagnostic des données</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Détection des incohérences chronologiques et des statuts incorrects.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-border bg-white p-4">
                <p className="text-sm text-muted-foreground">Tâches analysées</p>
                <p className="text-3xl font-bold mt-1">{tasks.length}</p>
              </div>
              <div className={`rounded-xl border p-4 ${criticalCount > 0 ? 'border-red-200 bg-red-50' : 'border-border bg-white'}`}>
                <p className={`text-sm font-medium ${criticalCount > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>Critiques</p>
                <p className={`text-3xl font-bold mt-1 ${criticalCount > 0 ? 'text-red-700' : ''}`}>{criticalCount}</p>
              </div>
              <div className={`rounded-xl border p-4 ${warningCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-border bg-white'}`}>
                <p className={`text-sm font-medium ${warningCount > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>Avertissements</p>
                <p className={`text-3xl font-bold mt-1 ${warningCount > 0 ? 'text-amber-700' : ''}`}>{warningCount}</p>
              </div>
            </div>

            {issues.length === 0 && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-8 flex flex-col items-center gap-3">
                <ShieldCheck className="h-10 w-10 text-green-500" />
                <p className="text-sm font-medium text-green-800">Aucune incohérence détectée</p>
                <p className="text-xs text-green-700">Toutes vos données sont cohérentes.</p>
              </div>
            )}

            {issues.length > 0 && (
              <div className="space-y-2">
                {issues.map(issue => (
                  <div
                    key={`${issue.taskId}-${issue.code}`}
                    className={`rounded-xl border p-4 ${
                      issue.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${issue.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold truncate ${issue.severity === 'critical' ? 'text-red-900' : 'text-amber-900'}`} title={issue.taskTitle}>
                            {issue.taskTitle}
                          </p>
                          <p className={`text-xs mt-0.5 ${issue.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>
                            {issue.message}
                          </p>

                          {issue.canFixCreatedAt && (
                            <div className="mt-3">
                              {editingId === issue.taskId ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">Date de création :</span>
                                  <Input
                                    type="date"
                                    value={editingDate}
                                    onChange={e => setEditingDate(e.target.value)}
                                    className="h-7 text-xs w-40"
                                    autoFocus
                                  />
                                  <button
                                    className="h-7 w-7 flex items-center justify-center rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                                    onClick={() => { void confirmEditCreatedAt(issue.taskId) }}
                                    disabled={!editingDate || savingId === issue.taskId}
                                    title="Confirmer"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    className="h-7 w-7 flex items-center justify-center rounded border border-border bg-white hover:bg-muted transition-colors"
                                    onClick={cancelEditCreatedAt}
                                    title="Annuler"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                  {savingId === issue.taskId && (
                                    <span className="text-xs text-muted-foreground">Enregistrement…</span>
                                  )}
                                </div>
                              ) : (
                                <button
                                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition-colors"
                                  onClick={() => startEditCreatedAt(issue)}
                                >
                                  <Pencil className="h-3 w-3" />
                                  Modifier la date de création ({format(parseISO(issue.taskCreatedAt), 'd MMM yyyy', { locale: fr })})
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        issue.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {issue.severity === 'critical' ? 'Critique' : 'Attention'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
