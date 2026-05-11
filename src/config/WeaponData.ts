import { WeaponType, type WeaponConfig } from '../systems/WeaponSystem'

export const WEAPON_COLORS: Record<WeaponType, number> = {
  [WeaponType.Empty]:        0x444444, // placeholder; Webbs falls back to per-leg color
  [WeaponType.Sword]:        0xc0c0c0, // silver
  [WeaponType.Bow]:          0x8b6914, // dark gold
  [WeaponType.Axe]:          0x888888, // steel gray
  [WeaponType.BoxingGloves]: 0xddccaa, // toothpick wood tone
  [WeaponType.Glider]:       0x87ceeb, // sky blue
  [WeaponType.FlameBreather]:0xff6600, // fire orange
  [WeaponType.WebLauncher]:  0xeeeeff, // ghostly silk
}

// All Phase 1 weapons. requiredTier = minimum leg tier to equip in any unlocked slot.
export const WEAPON_DATA: Map<WeaponType, WeaponConfig> = new Map([
  [WeaponType.Sword, {
    name: 'Leg-Attached Broken Sword',
    damage: 25,
    staminaCost: 15,
    type: 'melee',
    requiredTier: 0,
  }],
  [WeaponType.Bow, {
    name: 'Web Bow',
    damage: 20,
    staminaCost: 10,
    type: 'ranged',
    requiredTier: 0,
  }],
  [WeaponType.BoxingGloves, {
    name: 'Toothpick Stabber',
    damage: 14,
    staminaCost: 5,
    type: 'melee',
    requiredTier: 0,
  }],
  [WeaponType.Axe, {
    name: 'Bolt-On Axe',
    damage: 50,
    staminaCost: 28,
    type: 'melee',
    requiredTier: 1,
  }],
  [WeaponType.Glider, {
    name: 'Glider',
    damage: 0,
    staminaCost: 20,
    type: 'traversal',
    requiredTier: 1,
  }],
  [WeaponType.FlameBreather, {
    name: 'Flame Breather',
    damage: 30,
    staminaCost: 30,
    type: 'ranged',
    requiredTier: 2,
  }],
  [WeaponType.WebLauncher, {
    name: 'Web Launcher',
    damage: 0,
    staminaCost: 8,
    type: 'utility',
    requiredTier: 0,
  }],
])
