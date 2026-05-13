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
// Damage values mirror the constants in WeaponUseSystem (and FLAME_DPS for the
// flame breather, which deals continuous damage). Keep these in sync when tuning.
export const WEAPON_DATA: Map<WeaponType, WeaponConfig> = new Map([
  [WeaponType.Sword, {
    name: 'Leg-Attached Broken Sword',
    damage: 18,
    staminaCost: 10,
    type: 'melee',
    requiredTier: 0,
  }],
  [WeaponType.Bow, {
    name: 'Web Bow',
    damage: 22,
    staminaCost: 12,
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
    damage: 44,
    staminaCost: 22,
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
    damage: 18,
    staminaCost: 0,
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

// Display-only stats that show up in the inventory tooltip. Damage/stamina come
// from WEAPON_DATA. The cooldown values are duplicated from WeaponUseSystem +
// WebLauncherSystem so the tooltip can show attack speed without UI code
// reaching into the gameplay systems — keep these in sync if those are tuned.
export interface WeaponStats {
  cooldownMs: number
  range:      string
  blurb:      string
}

export const WEAPON_STATS: Record<WeaponType, WeaponStats> = {
  [WeaponType.Empty]: {
    cooldownMs: 0,
    range:      '—',
    blurb:      'Nothing equipped.',
  },
  [WeaponType.Sword]: {
    cooldownMs: 280,
    range:      '70u arc',
    blurb:      'Quick 90° forward arc. Reliable damage, modest knockback.',
  },
  [WeaponType.Bow]: {
    cooldownMs: 380,
    range:      'long',
    blurb:      'Fires a thistle. Consumes 1 Thistle per shot; misses can be recovered.',
  },
  [WeaponType.Axe]: {
    cooldownMs: 760,
    range:      '88u cleave',
    blurb:      'Slow 170° heavy cleave. Big damage, huge knockback.',
  },
  [WeaponType.BoxingGloves]: {
    cooldownMs: 220,
    range:      '90u stab',
    blurb:      'Long thin stab in a narrow cone. Cheap and fast.',
  },
  [WeaponType.Glider]: {
    cooldownMs: 0,
    range:      'traversal',
    blurb:      'Traversal aid. No combat damage.',
  },
  [WeaponType.FlameBreather]: {
    cooldownMs: 1000,   // damage is already DPS; cd of 1s makes dpsFor() return the raw value
    range:      '120u cone',
    blurb:      'Continuous flame cone. Drains energy while held.',
  },
  [WeaponType.WebLauncher]: {
    cooldownMs: 220,
    range:      '480u line',
    blurb:      'Reels in pickups, yanks light enemies, pulls you to walls. Anchors against suction.',
  },
}

// Sustained damage per second the weapon can output if mashed against a target.
// Returns "—" for utility / no-damage weapons.
export function dpsFor(weapon: WeaponType): string {
  const cfg   = WEAPON_DATA.get(weapon)
  const stats = WEAPON_STATS[weapon]
  if (!cfg || cfg.damage <= 0 || stats.cooldownMs <= 0) return '—'
  const dps = cfg.damage / (stats.cooldownMs / 1000)
  return `${dps.toFixed(1)} dps`
}
