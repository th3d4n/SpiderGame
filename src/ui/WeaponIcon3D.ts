import { WeaponType } from '../systems/WeaponSystem'

// Returns SVG path/shape elements (no wrapper <svg> tag) centered at 0,0.
// Coordinates fit within a roughly 22×22 unit box (matching WeaponIcon.ts 2D source).
export function weaponIconPaths(weapon: WeaponType, color: string): string {
  switch (weapon) {
    case WeaponType.Sword:
      return `<polygon points="-7,-2 -7,2 8,0" fill="${color}" stroke="#222" stroke-width="0.5"/>
              <rect x="-8" y="-4" width="2" height="8" fill="#665533"/>`
    case WeaponType.Bow:
      return `<path d="M0,-8 A8,8 0 0,1 0,8" fill="none" stroke="${color}" stroke-width="2"/>
              <line x1="0" y1="-8" x2="0" y2="8" stroke="#eeeeee" stroke-width="1" stroke-opacity="0.9"/>`
    case WeaponType.Axe:
      return `<line x1="-7" y1="0" x2="3" y2="0" stroke="#553322" stroke-width="2"/>
              <polygon points="1,-7 1,7 10,0" fill="${color}" stroke="#222" stroke-width="0.5"/>`
    case WeaponType.BoxingGloves:
      return `<line x1="-9" y1="0" x2="6" y2="0" stroke="${color}" stroke-width="2"/>
              <polygon points="5,-2 5,2 10,0" fill="${color}" stroke="#665533" stroke-width="0.5"/>`
    case WeaponType.Glider:
      return `<polygon points="-6,-1 6,-7 6,-1" fill="${color}" fill-opacity="0.85" stroke="#4477aa" stroke-width="0.5"/>
              <polygon points="-6,1 6,7 6,1" fill="${color}" fill-opacity="0.85" stroke="#4477aa" stroke-width="0.5"/>`
    case WeaponType.FlameBreather:
      return `<rect x="-6" y="-3" width="9" height="6" fill="#333333" stroke="#111111" stroke-width="0.5"/>
              <polygon points="3,-3 3,3 9,0" fill="${color}"/>`
    case WeaponType.WebLauncher:
      return `<rect x="-5" y="-5" width="10" height="10" fill="none" stroke="#333344" stroke-width="1.5"/>
              <circle cx="0" cy="0" r="3.5" fill="${color}" fill-opacity="0.9" stroke="#888899" stroke-width="1"/>
              <line x1="5" y1="0" x2="9" y2="0" stroke="${color}" stroke-width="1"/>`
    case WeaponType.Empty:
    default:
      return ''
  }
}

// Full <svg> element suitable for DOM innerHTML (e.g. EquipScreen, CraftingMenu).
export function weaponIconSvg(weapon: WeaponType, color: string, size = 22): string {
  const paths = weaponIconPaths(weapon, color)
  if (!paths) return ''
  return `<svg width="${size}" height="${size}" viewBox="-11 -11 22 22" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`
}
