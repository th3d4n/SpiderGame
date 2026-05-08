export interface SaveData {
  bossesDefeated: string[]
  legTier: number
  inventory: Record<string, number>
  unlockedWeapons: string[]
  colonyCount: number
  lastZone: string
}

const SAVE_KEY = 'noLegs_save'

export class SaveSystem {
  save(data: SaveData): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  }

  load(): SaveData | null {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as SaveData
    } catch {
      return null
    }
  }

  deleteSave(): void {
    localStorage.removeItem(SAVE_KEY)
  }

  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null
  }
}

export const saveSystem = new SaveSystem()
