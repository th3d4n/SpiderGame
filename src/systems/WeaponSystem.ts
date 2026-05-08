// TS6 erasableSyntaxOnly: use const objects instead of enum
export const WeaponType = {
  Empty:        'Empty',
  Sword:        'Sword',
  Bow:          'Bow',
  Axe:          'Axe',
  BoxingGloves: 'BoxingGloves',
  Glider:       'Glider',
  FlameBreather:'FlameBreather',
} as const

export type WeaponType = (typeof WeaponType)[keyof typeof WeaponType]

export type WeaponCategory = 'melee' | 'ranged' | 'traversal'

export interface WeaponConfig {
  name: string
  damage: number
  staminaCost: number
  type: WeaponCategory
  requiredTier: number
}

// Slots unlock in pairs as leg tier increases: tier 0 → slots 0-1, tier 1 → 2-3, etc.
const SLOT_UNLOCK_TIERS = [0, 0, 1, 1, 2, 2, 3, 3] as const

export class WeaponSystem {
  private slots:   WeaponType[] = Array(8).fill(WeaponType.Empty)
  private legTier  = 0
  private configs: Map<WeaponType, WeaponConfig>

  constructor(configs: Map<WeaponType, WeaponConfig>) {
    this.configs = configs
  }

  getLegTier(): number {
    return this.legTier
  }

  setLegTier(tier: number): void {
    this.legTier = Math.max(0, Math.min(3, tier))
    // Drop weapons from slots that no longer meet unlock requirements
    for (let i = 0; i < 8; i++) {
      if (!this.isSlotUnlocked(i)) this.slots[i] = WeaponType.Empty
    }
  }

  isSlotUnlocked(slot: number): boolean {
    return this.legTier >= SLOT_UNLOCK_TIERS[slot]
  }

  canEquip(slot: number, weaponType: WeaponType): boolean {
    if (!this.isSlotUnlocked(slot)) return false
    if (weaponType === WeaponType.Empty) return true
    const config = this.configs.get(weaponType)
    return config !== undefined && this.legTier >= config.requiredTier
  }

  equip(slot: number, weaponType: WeaponType): boolean {
    if (!this.canEquip(slot, weaponType)) return false
    this.slots[slot] = weaponType
    return true
  }

  unequip(slot: number): void {
    this.slots[slot] = WeaponType.Empty
  }

  getSlot(slot: number): WeaponType {
    return this.slots[slot]
  }

  getConfig(weaponType: WeaponType): WeaponConfig | undefined {
    return this.configs.get(weaponType)
  }

  getUnlockedSlotCount(): number {
    return SLOT_UNLOCK_TIERS.filter(t => t <= this.legTier).length
  }

  getAllSlots(): WeaponType[] {
    return [...this.slots]
  }
}
