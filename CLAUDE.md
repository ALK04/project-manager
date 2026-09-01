# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (Vite HMR)
npm run build        # tsc -b && vite build
npm run lint         # eslint .
npx tsc --noEmit     # type-check without emitting (always run before finishing)
```

No test suite exists in this project.

## Architecture

Single-page React app (React 19 + TypeScript + Tailwind CSS v4 + Vite). Backend is Supabase (Postgres). No state management library — state lives in hooks and is passed via props.

### Routing

`App.tsx` wraps everything in a fixed `flex h-screen` layout: `<Sidebar />` (w-56, fixed) + `<main>` (flex-1). Routes: `/` Kanban, `/burndown` Burndown, `/burnup` Burn-up, `/gantt` Gantt, `/alternance` Calendrier d'alternance, `/settings` Settings.

### Data layer

**`src/hooks/useTasks.ts`** — single source of truth for all task data. Fetches from Supabase on mount, exposes `tasks`, `createTask`, `updateTask`, `deleteTask`, `bulkCreateTasks`. Critical behaviour in `updateTask`: if `completed_at` is **not** present in the update payload, it auto-sets `completed_at = now()` when `status → 'done'` and clears it when status changes away from done. If `completed_at` **is** explicitly in the payload, it is used as-is (allows manual date editing).

**`src/types/database.ts`** — canonical types. `Task` has: `id`, `title`, `priority` (`must|should|could|wont`), `status` (`todo|in_progress|blocked|done`), `due_date` (date string `yyyy-MM-dd` or null), `completed_at` (ISO datetime or null), `created_at` (ISO datetime).

**`src/lib/supabase.ts`** — Supabase client, reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env.

**`src/hooks/useSettings.ts`** — localStorage-only (key `pm_settings`). Only setting is `projectEndDate` used by the Burndown chart.

### Pages

**KanbanPage** (`/`) — orchestrates dnd-kit drag-and-drop. Uses `pointerWithin` collision detection + `onDragOver` to track `overColumnStatus` for immediate column highlight (avoids the latency of `closestCenter`). Manages per-column sort (`pm_kanban_sort`) and manual card order (`pm_kanban_orders`) in localStorage. `tasksByStatus` is a `useMemo` that applies `sortColumnTasks()` to each column's tasks. `moveCard` reorders within a column and switches to `'manual'` sort mode. Props flow: KanbanPage → KanbanColumn → TaskCard.

**KanbanColumn** — droppable zone (`useDroppable`), ref covers the **entire column div** so the drop target includes the header. Receives sorted tasks from parent; computes `onMoveUp`/`onMoveDown` per-card based on index.

**TaskCard** — draggable (`useSortable`). Shows ↑/grip/↓ stack on hover (left side). Edit dialog opens `TaskForm`.

**TaskForm** — shared create/edit form. Shows "Terminé le" date field only when `status === 'done'`; auto-fills it with today when status switches to done. `onSubmit` signature includes `completed_at`.

**GanttPage** (`/gantt`) — custom canvas-free Gantt using absolutely positioned divs within a scrollable container. Two independent drag systems using global `mousemove`/`mouseup` listeners via refs (to avoid stale closures):
  - **Planned bar drag** (always active): drags right edge → updates `due_date` via `updateTask({ due_date })` only (no `status` passed, preventing `completed_at` from being overwritten).
  - **Actual bar drag** (edit mode only): drags right edge → updates `completed_at`.
  
  Persists: zoom (`pm_gantt_zoom`), sort mode (`pm_gantt_sort`), manual order (`pm_gantt_order`), scroll position (`pm_gantt_scroll`). Scroll is restored via `requestAnimationFrame` after `loading` becomes false.

**BurndownPage** (`/burndown`) — read-only Recharts line chart. Ideal line = linear from `totalTasks → 0` over project duration. Real line = tasks not yet done as of each day (uses `completed_at`).

**AlternancePage** (`/alternance`) — calendrier CESI sur 29 mois (sept. 2026 → janv. 2029), grille 4 mois par ligne + vue focus, regroupés en blocs de 12 mois (« Année N », le dernier bloc est incomplet). Les jours peints sont persistés dans la table Supabase `alternance_days` (clé composite `user_id` + `day`), avec le localStorage (`pm_alternance_days`) maintenu **en miroir** : affichage instantané au chargement et filet de sécurité si la base est injoignable. Le reste est calculé.
  - `src/lib/alternance.ts` — période (`MONTHS` dérivé de `PERIOD_START`/`PERIOD_END`), `CESI_SESSIONS` / `CESI_CLOSURES` (vides par défaut : le calendrier démarre neutre), et `resolveDay()` qui applique la priorité : week-end → surcharge manuelle → férié → session CESI → fermeture → `libre` (défaut). La surcharge passe **avant** le férié, pour pouvoir corriger un férié mal détecté.
  - `src/lib/holidays.ts` — jours fériés français calculés (Pâques par Meeus/Jones/Butcher), mémoïsés par année.
  - `src/hooks/useAlternance.ts` — `overrides`, `brush`, `paintDay`, `resetAll`, `sync`. `paintDay` stocke **toujours** le type, `libre` compris (ne pas le transformer en `delete` : ça ferait réapparaître le férié par défaut). Les écritures sont regroupées puis `upsert` après 600 ms d'inactivité (`onConflict: 'user_id,day'`), sinon une peinture au glisser déclencherait une requête par jour. Au montage : fetch de la base, fusion `local < base < peintures en attente`, puis migration one-shot des jours présents en local mais absents en base (idempotente, pas de flag).
  - SQL : `supabase/SQL Editor/Calendrier alternance.sql` (idempotent, RLS `auth.uid() = user_id`).
  - `AlternanceMonth` — grille d'un mois (semaine L→D). Seuls les week-ends sont `locked` (boutons désactivés).
  - Peinture au clic **et au glisser** (`onPointerDown` + `onPointerEnter` avec un ref `painting`, relâché par un listener `pointerup` global).
  - `src/lib/alternancePdf.ts` — export PDF vectoriel via jsPDF (A4 paysage, 4 mois par ligne, 12 mois par page), dessiné en primitives (pas de rastérisation : html2canvas ne gère pas les couleurs `oklch` de Tailwind v4). jsPDF est en `import()` dynamique pour rester hors du bundle initial. Couleurs RGB dans `DAY_TYPE_PDF`, à garder en phase avec `DAY_TYPE_CELL`. `buildAlternancePdf()` renvoie le document sans le télécharger — c'est ce qui permet de le générer hors navigateur pour vérifier la mise en page (`npx esbuild src/lib/alternancePdf.ts --bundle --format=esm --platform=node --alias:@=./src --external:jspdf`, puis `doc.output('arraybuffer')`). Toute la géométrie est dérivée des constantes en haut du fichier : changer `CELL_H` ou `HEADER_H` recale tout, mais vérifier que la 3ᵉ ligne de mois reste au-dessus du trait de pied de page.

**SettingsPage** (`/settings`) — two tabs: project end date, and Trello JSON import. Trello import decodes card creation date from the first 8 hex chars of the Trello card ID.

### UI components

`src/components/ui/` — shadcn-style components (Button, Badge, Dialog, Select, Input, Label) built on Radix UI primitives + `class-variance-authority`. `Badge` has variants matching `Priority` values (`must`, `should`, `could`, `wont`).

### localStorage keys

| Key | Content |
|-----|---------|
| `pm_settings` | `{ projectEndDate: string }` |
| `pm_column_order` | `Status[]` — column left-to-right order |
| `pm_kanban_sort` | `KanbanSortMode` string |
| `pm_kanban_orders` | `Record<Status, string[]>` — manual card IDs per column |
| `pm_gantt_sort` | `SortMode` string |
| `pm_gantt_order` | `string[]` — manual task IDs |
| `pm_gantt_zoom` | number (px/day, one of `[3,7,18,28,44,64,92]`) |
| `pm_gantt_scroll` | `{ left: number, top: number }` |
| `pm_alternance_days` | `Record<'yyyy-MM-dd', DayType>` — miroir local de la table `alternance_days` |
| `pm_alternance_brush` | `DayType` — pinceau sélectionné (`libre\|formation\|entreprise\|teletravail\|ferme`) |

### Conventions

- UI language is **French** throughout (labels, comments, error messages).
- Dates: `due_date` and manual date inputs use `yyyy-MM-dd` strings; `created_at` / `completed_at` use full ISO datetime strings. `date-fns` with `fr` locale for all formatting.
- No `void` async side effects escape without `void` keyword (enforced by lint).
- `@/` path alias resolves to `src/`.
