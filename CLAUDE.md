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
Le hook ouvre aussi un canal Realtime Supabase (`postgres_changes` sur `tasks`, nom de canal dérivé de `useId()` pour que deux instances montées ne se marchent pas dessus) : les modifications de l'autre membre arrivent sans rechargement. Les mutations locales mettent déjà l'état à jour, l'événement reçu en retour est donc dédoublonné par id.

**`src/types/database.ts`** — canonical types. `Task` has: `id`, `title`, `priority` (`must|should|could|wont`), `status` (`todo|in_progress|blocked|done`), `due_date` (date string `yyyy-MM-dd` or null), `completed_at` (ISO datetime or null), `started_at`, `assignee_id` (uuid du membre à qui la tâche est assignée, ou null), `created_at` (ISO datetime). `TaskFormData` est la charge utile partagée par tous les formulaires de tâche (TaskForm → TaskCard/KanbanColumn → KanbanPage) : ne pas la redéclarer en ligne.

**`src/lib/supabase.ts`** — Supabase client, reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env.

**`src/hooks/useProfiles.ts`** — liste des membres de l'espace (table `profiles` : `display_name`, `color`). Le store est **au niveau module** (`useSyncExternalStore`) et non par composant : plusieurs pages consultent les membres en même temps, une seule requête suffit. Expose `members`, `byId`, `updateProfile` (RLS : chacun ne modifie que le sien) et `refresh`.

**`src/hooks/useSettings.ts`** — localStorage-only (key `pm_settings`). Only setting is `projectEndDate` used by the Burndown chart.

### Comptes et partage

L'espace est **partagé entre les comptes connectés** : `tasks` et `absences` ont une policy RLS `for all to authenticated using (true)`, tout le monde voit et modifie le même tableau. Seul `alternance_days` reste strictement personnel (`auth.uid() = user_id`).

- `supabase/SQL Editor/Espace partage a deux.sql` — idempotent : table `profiles`, backfill des comptes existants, trigger `on_auth_user_created`, colonne `tasks.assignee_id` (`on delete set null` : supprimer un compte ne supprime pas ses tâches), remplacement des anciennes policies (celles ouvertes à `anon` **et** celles par compte, `auth.uid() = user_id`, devenues des doublons permissifs), ajout de `tasks` à la publication `supabase_realtime`.
- **L'inscription est fermée dans l'app** (pas de formulaire signup) : un compte se crée dans Supabase → Authentication → Users → Add user. Le trigger `on_auth_user_created` crée le profil (nom déduit de l'email, couleur piochée dans la palette de `default_profile_color()` — à garder en phase avec `AVATAR_COLORS` dans SettingsPage) **et** la ligne `user_settings` : le `create or replace` du script écrase la version installée par le setup des tâches, les deux insertions doivent donc rester groupées dans la même fonction. Elle est `security definer` **avec `search_path` figé** et chaque insertion est enveloppée dans son propre bloc `exception` : un trigger qui échoue sur `auth.users` fait échouer la création du compte elle-même (« Database error creating new user »). `revoke all on function handle_new_user()` la retire au passage de `/rest/v1/rpc/` — PostgREST expose toute fonction de `public`. Le script se termine par un `select` qui liste les triggers de `auth.users` — un intrus y est le suspect n° 1.
- Comptes existants : `admin@pm.local` et `enzo@pm.local`.
- `UserAvatar` (`src/components/UserAvatar.tsx`) rend les initiales sur la couleur du membre, ou un rond pointillé si la tâche n'est assignée à personne. Tailles `xs` / `sm` / `md`.
- `useSettings` (date de fin de projet) reste en localStorage, donc **par navigateur** et non partagé.

### Pages

**KanbanPage** (`/`) — orchestrates dnd-kit drag-and-drop. Uses `pointerWithin` collision detection + `onDragOver` to track `overColumnStatus` for immediate column highlight (avoids the latency of `closestCenter`). Manages per-column sort (`pm_kanban_sort`) and manual card order (`pm_kanban_orders`) in localStorage. Un filtre par personne (`pm_kanban_assignee` : `all` | `unassigned` | id de membre) produit `visibleTasks` ; `tasksByStatus` est un `useMemo` qui applique `sortColumnTasks()` aux tâches **visibles** de chaque colonne. `tasks` reste complet partout ailleurs — la synchro de l'ordre manuel et `moveCard` réinsèrent la carte dans l'ordre **complet** de la colonne, sinon un filtre actif effacerait la position des cartes masquées ; `moveCard` bascule aussi le tri en `'manual'`. Props flow: KanbanPage → KanbanColumn → TaskCard.

**KanbanColumn** — droppable zone (`useDroppable`), ref covers the **entire column div** so the drop target includes the header. Receives sorted tasks from parent; computes `onMoveUp`/`onMoveDown` per-card based on index.

**TaskCard** — draggable (`useSortable`). Shows ↑/grip/↓ stack on hover (left side). Edit dialog opens `TaskForm`.

**TaskForm** — shared create/edit form. Shows "Terminé le" date field only when `status === 'done'`; auto-fills it with today when status switches to done. `onSubmit` reçoit un `TaskFormData` (donc `completed_at` **et** `assignee_id`). Le sélecteur « Assignée à » utilise la sentinelle `'none'` (Radix Select refuse la valeur vide) ; à la création la tâche est pré-assignée au compte courant, à l'édition elle garde son assignation.

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

**SettingsPage** (`/settings`) — onglets Général (date de fin de projet), Équipe (profil perso : nom affiché + couleur d'avatar ; liste des membres et de leur charge), Absences, Importer Trello, Diagnostic. Trello import decodes card creation date from the first 8 hex chars of the Trello card ID.

### UI components

`src/components/ui/` — shadcn-style components (Button, Badge, Dialog, Select, Input, Label) built on Radix UI primitives + `class-variance-authority`. `Badge` has variants matching `Priority` values (`must`, `should`, `could`, `wont`).

### localStorage keys

| Key | Content |
|-----|---------|
| `pm_settings` | `{ projectEndDate: string }` |
| `pm_column_order` | `Status[]` — column left-to-right order |
| `pm_kanban_sort` | `KanbanSortMode` string |
| `pm_kanban_assignee` | `'all' \| 'unassigned' \| <uuid membre>` — filtre par personne |
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
