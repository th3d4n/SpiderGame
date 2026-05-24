import Phaser from 'phaser'

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
]

export class SaveSystem {
  saveFromRegistry(registry: Phaser.Data.DataManager): void {
    const data: Record<string, unknown> = {}
    for (const key of SAVE_FIELDS) {
      const val = registry.get(key)
      if (val !== undefined && val !== null) data[key] = val
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    } catch {
      // localStorage unavailable (private browsing quota exceeded, etc.)
    }
  }

  loadIntoRegistry(registry: Phaser.Data.DataManager): void {
    let raw: string | null
    try {
      raw = localStorage.getItem(SAVE_KEY)
    } catch {
      return
    }
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      for (const key of SAVE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          registry.set(key, data[key])
        }
      }
    } catch {
      // corrupt save — leave registry untouched, player starts fresh
    }
  }

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null
    } catch {
      return false
    }
  }

  deleteSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      // ignore
    }
  }
}

export const saveSystem = new SaveSystem()
