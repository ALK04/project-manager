import { useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LoginForm } from '@/components/LoginForm'

// Vitrine affichée aux visiteurs non connectés. Les captures de `public/landing/`
// sont générées sur des données de démo (aucune donnée réelle).

const NAV = [
  { href: '#kanban', label: 'Kanban' },
  { href: '#planning', label: 'Planning' },
  { href: '#suivi', label: 'Suivi' },
  { href: '#alternance', label: 'Alternance' },
  { href: '#equipe', label: 'Équipe' },
]

const FACTS = [
  {
    title: 'Synchronisé en temps réel',
    text: "Une carte déplacée, une échéance repoussée : la modification apparaît aussitôt chez l'autre membre, sans recharger la page.",
  },
  {
    title: 'Chaque tâche est qualifiée',
    text: 'Une priorité, une échéance, une personne assignée. Les dates de démarrage et de fin sont enregistrées automatiquement.',
  },
  {
    title: 'Accès réservé',
    text: "Pas d'inscription publique : seuls les comptes créés par l'administrateur accèdent à l'espace partagé.",
  },
]

interface Feature {
  id: string
  index: string
  kicker: string
  title: string
  text: string
  points: string[]
  shots: Shot[]
}

// Dimensions réelles des captures (CSS px, rendues en @2x) : évite le décalage au chargement.
interface Shot { src: string; alt: string; w: number; h: number }

const FEATURES: Feature[] = [
  {
    id: 'kanban',
    index: '01',
    kicker: 'Kanban',
    title: 'Le tableau du quotidien',
    text: "Les tâches circulent entre À faire, En cours, Bloqué et Terminé d'un simple glisser-déposer. On voit d'un coup d'œil qui fait quoi et ce qui coince.",
    points: [
      'Filtre par personne, ou les tâches que personne n’a prises',
      'Tri par priorité, échéance ou ordre manuel, colonne par colonne',
      'Date de fin renseignée dès qu’une tâche passe en Terminé',
    ],
    shots: [{ src: '/landing/kanban-detail.jpg', alt: 'Tableau Kanban avec quatre colonnes de tâches', w: 1216, h: 640 }],
  },
  {
    id: 'planning',
    index: '02',
    kicker: 'Gantt',
    title: 'Le planning, prévu contre réel',
    text: "Chaque tâche affiche deux barres : ce qui était prévu, et ce qui s'est réellement passé. Les écarts sautent aux yeux, sans tableur à tenir à jour.",
    points: [
      'Échéance ajustable en étirant la barre planifiée',
      'Tâches livrées en retard signalées par leur couleur',
      'Absences et week-ends reportés sur la frise',
    ],
    shots: [{ src: '/landing/gantt.jpg', alt: 'Diagramme de Gantt avec barres planifiées et réelles', w: 1216, h: 720 }],
  },
  {
    id: 'suivi',
    index: '03',
    kicker: 'Burndown et Burn-up',
    title: 'Savoir où en est le projet',
    text: "Le burndown compare le reste à faire à la trajectoire idéale jusqu'à la date de fin. Le burn-up montre en plus l'évolution du périmètre, et projette la date d'arrivée au rythme actuel.",
    points: [
      'Trajectoire idéale calculée sur la date de fin du projet',
      'Avance ou retard estimé en jours',
      'Flux cumulatif pour repérer les goulets d’étranglement',
    ],
    shots: [
      { src: '/landing/burndown.jpg', alt: 'Graphique burndown', w: 1216, h: 710 },
      { src: '/landing/burnup.jpg', alt: 'Graphique burn-up', w: 1216, h: 780 },
    ],
  },
  {
    id: 'alternance',
    index: '04',
    kicker: 'Alternance',
    title: 'Le rythme école et entreprise',
    text: "Un calendrier sur toute la durée de la formation pour poser les semaines de cours, de présence en entreprise et de télétravail. Les week-ends et jours fériés sont déjà en place.",
    points: [
      'Jours peints au clic ou en glissant sur une semaine entière',
      'Jours fériés français calculés automatiquement',
      'Récapitulatif des jours par type et export PDF',
    ],
    shots: [{ src: '/landing/alternance.jpg', alt: "Calendrier d'alternance sur douze mois", w: 1216, h: 660 }],
  },
  {
    id: 'equipe',
    index: '05',
    kicker: 'Équipe',
    title: 'Pensé pour travailler à deux',
    text: "Chaque membre a son nom et sa couleur, repris sur toutes les cartes. La charge de chacun est visible, et les tâches en retard sont signalées dès l'ouverture.",
    points: [
      'Profils et charge de travail par membre',
      'Notifications des tâches en retard ou dues sous 24 h',
      'Absences partagées, prises en compte dans les statistiques',
    ],
    shots: [{ src: '/landing/settings.jpg', alt: "Paramètres de l'équipe", w: 760, h: 720 }],
  },
]

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative h-6 w-6 rounded-[5px] bg-navy" aria-hidden>
        <span className="absolute left-[5px] bottom-[5px] h-[9px] w-[4px] rounded-[1px] bg-oak" />
        <span className="absolute left-[11px] bottom-[5px] h-[13px] w-[4px] rounded-[1px] bg-white/90" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-navy">Project Manager</span>
    </span>
  )
}

function Screenshot({ src, alt, w, h, eager }: Shot & { eager?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-[0_1px_2px_rgba(20,42,68,0.06),0_12px_32px_-12px_rgba(20,42,68,0.18)]">
      <img
        src={src}
        alt={alt}
        width={w}
        height={h}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="block w-full h-auto"
      />
    </figure>
  )
}

export function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false)
  const openLogin = () => setLoginOpen(true)

  return (
    <div className="min-h-screen text-foreground bg-[linear-gradient(180deg,#eef3f8_0%,#f6f8f3_38%,#f8f9f5_70%,#ffffff_100%)]">
      {/* ── Barre de navigation ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-navy/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#top" aria-label="Retour en haut"><Logo /></a>
          <nav className="hidden md:flex items-center gap-7 text-sm text-navy/70">
            {NAV.map(n => (
              <a key={n.href} href={n.href} className="hover:text-navy transition-colors">{n.label}</a>
            ))}
          </nav>
          <button
            onClick={openLogin}
            className="h-9 rounded-md bg-navy px-4 text-sm font-medium text-white hover:bg-navy-dark transition-colors"
          >
            Se connecter
          </button>
        </div>
      </header>

      <main id="top">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 sm:px-8 pt-16 sm:pt-24">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-oak">Gestion de projet en équipe</p>
            <h1 className="mt-4 text-4xl sm:text-5xl lg:text-[56px] font-semibold leading-[1.08] tracking-tight text-navy">
              Tout le projet sur un seul écran, du cadrage à la recette.
            </h1>
            <p className="mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-navy/70">
              Project Manager réunit le tableau Kanban, le planning Gantt, les indicateurs
              d'avancement et le calendrier d'alternance dans un espace partagé,
              synchronisé en temps réel entre les membres.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                onClick={openLogin}
                className="h-11 rounded-md bg-navy px-6 text-sm font-medium text-white hover:bg-navy-dark transition-colors"
              >
                Accéder à mon espace
              </button>
              <a href="#kanban" className="text-sm font-medium text-oak hover:text-oak-dark underline-offset-4 hover:underline">
                Découvrir les fonctionnalités
              </a>
            </div>
          </div>

          <div className="mt-14 sm:mt-20">
            <Screenshot src="/landing/kanban.jpg" alt="Aperçu de l'application : tableau Kanban" w={1440} h={900} eager />
          </div>
        </section>

        {/* ── Points clés ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24">
          <div className="grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-navy/10">
            {FACTS.map((f, i) => (
              <div key={f.title} className={cn('md:px-8', i === 0 && 'md:pl-0', i === FACTS.length - 1 && 'md:pr-0')}>
                <div className="h-0.5 w-8 bg-oak" />
                <h2 className="mt-5 text-base font-semibold text-navy">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-navy/65">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Fonctionnalités ──────────────────────────────────────────── */}
        <div className="border-t border-navy/10">
          {FEATURES.map((f, i) => {
            const wide = f.shots.length > 1
            const reversed = i % 2 === 1
            return (
              <section
                key={f.id}
                id={f.id}
                className="scroll-mt-16 border-b border-navy/10 py-20 sm:py-28"
              >
                <div className="mx-auto max-w-6xl px-5 sm:px-8">
                  <div className={cn(
                    'grid gap-10 lg:gap-14',
                    wide ? 'lg:grid-cols-1' : 'lg:grid-cols-12 lg:items-center',
                  )}>
                    <div className={cn(
                      wide ? 'grid gap-6 lg:grid-cols-12 lg:items-end' : 'lg:col-span-4',
                      !wide && reversed && 'lg:order-2',
                    )}>
                      <div className={cn(wide && 'lg:col-span-6')}>
                        <p className="flex items-baseline gap-3 text-sm">
                          <span className="font-semibold tabular-nums text-oak">{f.index}</span>
                          <span className="text-navy/55">{f.kicker}</span>
                        </p>
                        <h2 className="mt-4 text-3xl sm:text-[34px] font-semibold leading-tight tracking-tight text-navy">
                          {f.title}
                        </h2>
                        <p className="mt-4 text-[15px] leading-relaxed text-navy/70">{f.text}</p>
                      </div>
                      <ul className={cn('space-y-3', wide ? 'lg:col-span-5 lg:col-start-8' : 'mt-8')}>
                        {f.points.map(p => (
                          <li key={p} className="border-l-2 border-oak/60 pl-4 text-sm leading-relaxed text-navy/80">
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className={cn(
                      wide ? 'grid gap-6 md:grid-cols-2' : 'lg:col-span-8',
                      !wide && reversed && 'lg:order-1',
                    )}>
                      {f.shots.map(s => (
                        // Capture en portrait : on la borne pour qu'elle ne domine pas la section.
                        <div key={s.src} className={cn(s.h > s.w * 0.8 && 'max-w-xl lg:ml-auto')}>
                          <Screenshot {...s} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )
          })}
        </div>

        {/* ── Appel final ──────────────────────────────────────────────── */}
        <section className="bg-navy">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 sm:px-8 py-20 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white">Reprendre là où le projet s'est arrêté.</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/70">
                Connectez-vous avec le compte fourni par l'administrateur de l'espace.
              </p>
            </div>
            <button
              onClick={openLogin}
              className="h-11 shrink-0 self-start rounded-md bg-oak px-6 text-sm font-medium text-white hover:bg-oak-dark transition-colors md:self-auto"
            >
              Se connecter
            </button>
          </div>
        </section>
      </main>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 sm:px-8 py-8 text-sm text-navy/55 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Espace de travail privé · {new Date().getFullYear()}</p>
        </div>
      </footer>

      {/* ── Pop-up de connexion ─────────────────────────────────────────── */}
      <DialogPrimitive.Root open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-dark/40 backdrop-blur-[2px]" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-navy/10 bg-white p-7 shadow-xl focus:outline-none">
            <div className="mb-6">
              <Logo />
              <DialogPrimitive.Title className="mt-6 text-xl font-semibold tracking-tight text-navy">
                Connexion
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-navy/60">
                Accédez à votre espace de travail partagé.
              </DialogPrimitive.Description>
            </div>
            <LoginForm />
            <DialogPrimitive.Close
              className="absolute right-4 top-4 rounded p-1 text-navy/40 hover:text-navy transition-colors"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  )
}
