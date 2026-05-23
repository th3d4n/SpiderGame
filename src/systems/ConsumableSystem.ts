import { MaterialType } from './CraftingSystem'

export const ConsumableType = {
  HpPotion:        'HpPotion',
  StaminaTonicI:   'StaminaTonicI',
  StaminaTonicII:  'StaminaTonicII',
  StaminaTonicIII: 'StaminaTonicIII',
  MaxPotion:       'MaxPotion',
} as const
export type ConsumableType = (typeof ConsumableType)[keyof typeof ConsumableType]

export const CONSUMABLE_NAMES: Record<ConsumableType, string> = {
  [ConsumableType.HpPotion]:        'HP Potion',
  [ConsumableType.StaminaTonicI]:   'Stamina Tonic I',
  [ConsumableType.StaminaTonicII]:  'Stamina Tonic II',
  [ConsumableType.StaminaTonicIII]: 'Stamina Tonic III',
  [ConsumableType.MaxPotion]:       'Max Potion',
}

export interface ConsumableRecipe {
  id:          ConsumableType
  displayName: string
  materials:   Partial<Record<MaterialType, number>>
  findOnly?:   boolean
}

// All findOnly for Zone 1 — craftable in later zones per brief.
export const CONSUMABLE_RECIPES: ConsumableRecipe[] = [
  {
    id:          ConsumableType.HpPotion,
    displayName: 'HP Potion',
    materials:   { [MaterialType.SilkThread]: 3, [MaterialType.DriedFungus]: 2 },
    findOnly:    true,
  },
  {
    id:          ConsumableType.StaminaTonicI,
    displayName: 'Stamina Tonic I',
    materials:   { [MaterialType.BugPartsAnt]: 3, [MaterialType.Stone]: 2 },
    findOnly:    true,
  },
  {
    id:          ConsumableType.StaminaTonicII,
    displayName: 'Stamina Tonic II',
    materials:   { [MaterialType.BugPartsAnt]: 3, [MaterialType.Stone]: 2, [MaterialType.DriedFungus]: 2 },
    findOnly:    true,
  },
  {
    id:          ConsumableType.StaminaTonicIII,
    displayName: 'Stamina Tonic III',
    materials:   {},
    findOnly:    true,  // never craftable
  },
  {
    id:          ConsumableType.MaxPotion,
    displayName: 'Max Potion',
    materials:   {
      [MaterialType.SilkThread]:   3,
      [MaterialType.BugPartsAnt]:  3,
      [MaterialType.DriedFungus]:  2,
      [MaterialType.CrystalShard]: 1,
    },
    findOnly: true,
  },
]

// HP restored by one HP Potion (out of 100 max)
export const HP_POTION_AMOUNT = 40
// Stamina drain multiplier while any tonic is active (80% reduction)
export const TONIC_DRAIN_MULT = 0.2
// Max Potion protection window in ms
export const MAX_POT_DURATION = 10_000

const TONIC_DURATIONS: Record<ConsumableType, number> = {
  [ConsumableType.HpPotion]:        0,
  [ConsumableType.StaminaTonicI]:   15_000,
  [ConsumableType.StaminaTonicII]:  30_000,
  [ConsumableType.StaminaTonicIII]: 60_000,
  [ConsumableType.MaxPotion]:       0,
}

export class ConsumableSystem {
  private inventory:  Map<ConsumableType, number> = new Map()
  private tonicTimer  = 0   // ms remaining for active stamina tonic
  private maxPotTimer = 0   // ms remaining for Max Potion protection window

  // ── Inventory ─────────────────────────────────────────────────────────────

  getAmount(type: ConsumableType): number {
    return this.inventory.get(type) ?? 0
  }

  addConsumable(type: ConsumableType, amount: number): void {
    this.inventory.set(type, this.getAmount(type) + amount)
  }

  useConsumable(type: ConsumableType): boolean {
    const current = this.getAmount(type)
    if (current <= 0) return false
    this.inventory.set(type, current - 1)
    return true
  }

  // ── Quick-use helpers ──────────────────────────────────────────────────────

  /** Use an HP Potion. Returns amount to restore, or null if none available. */
  tryHpPotion(): number | null {
    if (!this.useConsumable(ConsumableType.HpPotion)) return null
    return HP_POTION_AMOUNT
  }

  /**
   * Use the best available stamina tonic (III > II > I).
   * Stacks with — or replaces — the current timer if longer.
   * Returns duration in ms, or null if no tonic available.
   */
  tryTonic(): number | null {
    const order: ConsumableType[] = [
      ConsumableType.StaminaTonicIII,
      ConsumableType.StaminaTonicII,
      ConsumableType.StaminaTonicI,
    ]
    for (const type of order) {
      if (this.useConsumable(type)) {
        const dur = TONIC_DURATIONS[type]
        this.tonicTimer = Math.max(this.tonicTimer, dur)
        return dur
      }
    }
    return null
  }

  /** Use the Max Potion. Returns true if consumed. */
  tryMaxPotion(): boolean {
    if (!this.useConsumable(ConsumableType.MaxPotion)) return false
    this.maxPotTimer = MAX_POT_DURATION
    return true
  }

  // ── Per-frame tick ─────────────────────────────────────────────────────────

  tick(delta: number): void {
    if (this.tonicTimer  > 0) this.tonicTimer  = Math.max(0, this.tonicTimer  - delta)
    if (this.maxPotTimer > 0) this.maxPotTimer = Math.max(0, this.maxPotTimer - delta)
  }

  // ── Effect queries (read each frame to drive webbs + weapon system) ────────

  isTonicActive(): boolean    { return this.tonicTimer  > 0 }
  isMaxProtActive(): boolean  { return this.maxPotTimer > 0 }

  /** Multiplier applied to all weapon stamina costs. 0 during Max Potion, TONIC_DRAIN_MULT during tonics. */
  getStaminaDrainMult(): number {
    if (this.maxPotTimer > 0) return 0
    if (this.tonicTimer  > 0) return TONIC_DRAIN_MULT
    return 1
  }

  // ── Registry persistence ──────────────────────────────────────────────────

  getInventorySnapshot(): Record<ConsumableType, number> {
    const snap = {} as Record<ConsumableType, number>
    for (const t of Object.values(ConsumableType)) snap[t] = this.getAmount(t)
    return snap
  }

  restoreFromSnapshot(snap: Record<string, number>): void {
    this.inventory.clear()
    for (const [t, amt] of Object.entries(snap)) {
      this.inventory.set(t as ConsumableType, amt)
    }
  }
}
