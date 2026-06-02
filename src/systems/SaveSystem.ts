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
}

const SAVE_KEY = 'noLegs_save_v1'

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
]

export class SaveSystem {
  // Snapshot the registry into localStorage.
  save(): void {
    const data: Record<string, unknown> = {}
    for (const key of SAVE_FIELDS) {
      const val = registry.get(key)
      if (val !== undefined && val !== null) data[key] = val
    }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)) } catch { /* quota / private mode */ }
  }

  // Restore saved data into the registry.  Call once at boot before scene construction.
  load(): void {
    let raw: string | null
    try { raw = localStorage.getItem(SAVE_KEY) } catch { return }
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
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

  hasSave(): boolean {
    try { return localStorage.getItem(SAVE_KEY) !== null } catch { return false }
  }

  deleteSave(): void {
    try { localStorage.removeItem(SAVE_KEY) } catch { }
  }
}

export const saveSystem = new SaveSystem()
