import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA, WEAPON_STATS } from '../config/WeaponData'
import { h, hex } from './theme'

// Shared weapon presentation for the discovery card, equip screen and workbench.

export const WEAPON_DESCRIPTIONS: Partial<Record<WeaponType, string>> = {
  [WeaponType.Sword]:         'Chitin shards bound with silk.\nQuick arcing swing, low stamina cost.\nReliable in close quarters.',
  [WeaponType.Bow]:           'A recurve bow of webbing.\nFires Thistles — gather them in the colony.\nLong range, medium stamina cost.',
  [WeaponType.Axe]:           'A heavy chitin cleave.\nWide 170° arc, high damage, slow swing.\nCosts stamina — use it to end a fight fast.',
  [WeaponType.BoxingGloves]:  'A sharpened toothpick.\nFast narrow stab with long reach.\nLowest stamina cost of any weapon.',
  [WeaponType.Glider]:        'Silk-web wings.\nHold fire to ride air currents across gaps.',
  [WeaponType.FlameBreather]: 'A repurposed venom gland.\nHold fire to spray a cone of flame.\nDrains energy — not stamina.',
  [WeaponType.WebLauncher]:   'The Web Thrower.\nFires a sticky silk line — zip to walls,\nyank light foes in, get dragged by heavy ones.',
}

export const weaponColor = (wt: WeaponType) => hex(WEAPON_COLORS[wt])
export const weaponName  = (wt: WeaponType) => WEAPON_DATA.get(wt)?.name ?? wt

const TYPE_LABEL: Record<string, string> = {
  melee: 'Melee', ranged: 'Ranged', traversal: 'Traversal', utility: 'Utility',
}
export const weaponTypeLabel = (wt: WeaponType) => TYPE_LABEL[WEAPON_DATA.get(wt)?.type ?? ''] ?? '—'

// Normalised against the strongest weapon in each column so bars compare.
const MAX_DMG   = 44
const MAX_SPEED = 1000 / 220
const MAX_STAM  = 22

// Stat bars (damage / speed / stamina).  `delayMs` staggers the grow-in.
export function weaponStatBars(wt: WeaponType, delayMs = 0): HTMLElement {
  const cfg   = WEAPON_DATA.get(wt)
  const stats = WEAPON_STATS[wt]
  const wrap  = h('div')
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:7px; width:100%;'
  const col = weaponColor(wt)
  const rows: Array<[string, number, string]> = []
  if ((cfg?.damage ?? 0) > 0) rows.push(['Damage', (cfg!.damage) / MAX_DMG, String(cfg!.damage)])
  if ((stats?.cooldownMs ?? 0) > 0 && (cfg?.damage ?? 0) > 0) {
    const sp = 1000 / stats.cooldownMs
    rows.push(['Speed', sp / MAX_SPEED, `${sp.toFixed(1)}/s`])
  }
  if (cfg?.staminaCost !== undefined) rows.push(['Stamina', cfg.staminaCost / MAX_STAM, cfg.staminaCost === 0 ? 'none' : String(cfg.staminaCost)])
  rows.forEach(([label, frac, val], i) => {
    const row = h('div', 'nl-stat')
    row.appendChild(h('span', '', label))
    const track = h('div', 'nl-stat-track')
    const fill  = h('div', 'nl-stat-fill')
    fill.style.width = `${Math.max(4, Math.min(1, frac) * 100)}%`
    fill.style.background = label === 'Stamina' ? '#f2c94c' : col
    fill.style.animationDelay = `${delayMs + i * 90}ms`
    track.appendChild(fill)
    row.appendChild(track)
    row.appendChild(h('span', 'nl-stat-val', val))
    wrap.appendChild(row)
  })
  return wrap
}
