import { registry } from '../core/Registry'

export interface SaveData {
  health:                         number
  craftingInventory:              Record<string, number>
  consumableInventory:            Record<string, number>
  weaponSlots:                    string[]
  legTier:                        number
  weaponInventory:                string[]
  webThrowerFound:                boolean
  birthdayCardRead:               boolean
  pickupsCollected_HomeBaseScene: number[]
  weaponPickupsCollected:         string[]
  openingCutsceneSeen:            boolean
  antColonyFirstVisit:            boolean
  bossesBeaten:                   number
  bossesDefeated:                 string[]   // distinct boss ids — one leg tier each
  totalXp:                        number
  toothpickCollected:             boolean
  tutorialToothpickSeen:          boolean
  tutorialWebLauncherSeen:        boolean
  fogReveal_antColony:            string     // PNG data URL of the explored-map canvas
  endingSeen:                     boolean    // chapter-one ending played
  deaths:                         number
  brewsUsed:                      number
  guideStep:                      number     // den objectives progress (systems/DenGuide)
  cluesFoundIds:                  number[]
}

const SAVE_KEY = 'noLegs_save_v1'   // storage slot (kept); the schema version lives inside
// v1: no version field. v2: adds XP, toothpick/tutorial flags, colony fog,
// bossesDefeated.  Bump and extend migrate() whenever a field changes meaning.
const SAVE_VERSION = 2

function migrate(data: Record<string, unknown>): Record<string, unknown> {
  const v = typeof data.version === 'number' ? data.version : 1
  if (v < 2) {
    // v1 saves simply lack the new fields; their defaults apply.  The old
    // equip screen wrote `equippedSlots` (never read) — nothing to carry over.
  }
  return data
}

const SAVE_FIELDS: (keyof SaveData)[] = [
  'health',
  'craftingInventory',
  'consumableInventory',
  'weaponSlots',
  'legTier',
  'weaponInventory',
  'webThrowerFound',
  'birthdayCardRead',
  'pickupsCollected_HomeBaseScene',
  'weaponPickupsCollected',
  'openingCutsceneSeen',
  'antColonyFirstVisit',
  'bossesBeaten',
  'bossesDefeated',
  'totalXp',
  'toothpickCollected',
  'tutorialToothpickSeen',
  'tutorialWebLauncherSeen',
  'fogReveal_antColony',
  'endingSeen',
  'deaths',
  'brewsUsed',
  'guideStep',
  'cluesFoundIds',
]

export class SaveSystem {
  // Snapshot the registry into localStorage.
  save(): void {
    const data: Record<string, unknown> = {}
    for (const key of SAVE_FIELDS) {
      const val = registry.get(key)
      if (val !== undefined && val !== null) data[key] = val
    }
    data.version = SAVE_VERSION
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)) } catch { /* quota / private mode */ }
  }

  // Restore saved data into the registry.  Call once at boot before scene construction.
  load(): void {
    let raw: string | null
    try { raw = localStorage.getItem(SAVE_KEY) } catch { return }
    if (!raw) return
    try {
      const data = migrate(JSON.parse(raw) as Record<string, unknown>)
      for (const key of SAVE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          registry.set(key, data[key])
        }
      }
    } catch { /* corrupt save — leave registry untouched */ }
  }

  // Legacy shims for Phaser scene files — delegate to the new methods.
  saveFromRegistry(_reg?: unknown): void { this.save() }
  loadIntoRegistry(_reg?: unknown): void { this.load() }

  // Forget every saved field (New Game), so nothing from the old run leaks in
  resetRegistry(): void {
    for (const key of SAVE_FIELDS) registry.delete(key)
  }

  hasSave(): boolean {
    try { return localStorage.getItem(SAVE_KEY) !== null } catch { return false }
  }

  deleteSave(): void {
    try { localStorage.removeItem(SAVE_KEY) } catch { }
  }
}

export const saveSystem = new SaveSystem()
