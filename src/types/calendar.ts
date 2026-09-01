// Types du calendrier d'alternance (stocké en localStorage, pas en base).

/** `libre` = jour ouvré non encore qualifié (état neutre par défaut). */
export type DayType = 'libre' | 'formation' | 'entreprise' | 'teletravail' | 'ferme'

/** Pinceau du panneau latéral. Peindre `libre` remet le jour à sa valeur par défaut. */
export type Brush = DayType

/** Surcharges manuelles : `yyyy-MM-dd` → type de jour. Seuls les jours modifiés sont stockés. */
export type DayOverrides = Record<string, DayType>

export interface DayInfo {
  date: Date
  /** Clé `yyyy-MM-dd` */
  key: string
  type: DayType
  /** Seuls les week-ends sont verrouillés ; tout le reste (fériés inclus) est modifiable. */
  locked: boolean
  /** Libellé affiché en infobulle (nom du férié, « Session CESI »…). */
  label: string | null
  /** `true` si le jour porte une surcharge manuelle. */
  overridden: boolean
}
