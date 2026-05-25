import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA } from '../config/WeaponData'
import { weaponIconSvg } from './WeaponIcon3D'
import type { InputManager } from '../core/InputManager'
import type { TextDisplay3D } from './TextDisplay3D'

const WEAPON_DESCRIPTIONS: Partial<Record<WeaponType, string>> = {
  [WeaponType.Sword]:         'A blade of woven silk.\nQuick arcing swing, low stamina cost.\nReliable in close quarters.',
  [WeaponType.Bow]:           'A recurve bow of webbing.\nFires Thistles — gather them in the colony.\nLong range, medium stamina cost.',
  [WeaponType.Axe]:           'A heavy chitin cleave.\nWide 170° arc, high damage, slow swing.\nCosts stamina — use it to end a fight fast.',
  [WeaponType.BoxingGloves]:  'A sharpened toothpick.\nFast narrow stab with long reach.\nLowest stamina cost of any weapon.',
  [WeaponType.Glider]:        'Silk-web wings.\nHold fire to ride air currents across gaps.',
  [WeaponType.FlameBreather]: 'A repurposed venom gland.\nHold fire to spray a cone of flame.\nDrains energy — not stamina.',
  [WeaponType.WebLauncher]:   'The Web Thrower.\nFires sticky silk — pull yourself or items\ntoward the anchor point.',
}

// Round 6 Issue 1 — discovery card is now player-dismissed (Space/M).
// MIN_VISIBLE_MS keeps an accidental keypress at the moment of opening from
// closing the card instantly.
const MIN_VISIBLE_MS = 400

export class PickupCelebration3D {
  private overlay: HTMLElement
  private panel:   HTMLDivElement

  isOpen   = false
  onClose?: () => void

  private openedAtMs = 0   // wall-clock timestamp when shown — not affected by delta clamping

  // Round 6 Issue 1: constructor still accepts a TextDisplay3D for backwards
  // compatibility with callers, but the value is no longer used internally —
  // PresentationPhase now owns the tutorial follow-up.
  constructor(menuOverlay: HTMLElement, _textDisplay: TextDisplay3D) {
    this.overlay = menuOverlay
    this.panel   = document.createElement('div')
    this.panel.style.display = 'none'

    if (!document.getElementById('celeb-styles')) {
      const style = document.createElement('style')
      style.id = 'celeb-styles'
      style.textContent = [
        '@keyframes celeb-pop {',
        '  0%   { transform: scale(0); opacity: 0; }',
        '  60%  { transform: scale(1.25); opacity: 1; }',
        '  100% { transform: scale(1); opacity: 1; }',
        '}',
        '@keyframes celeb-bob {',
        '  0%,100% { transform: translateY(0) rotate(-5deg); }',
        '  50%     { transform: translateY(-10px) rotate(5deg); }',
        '}',
        '@keyframes celeb-glow {',
        '  0%,100% { box-shadow: 0 0 20px currentColor; }',
        '  50%     { box-shadow: 0 0 60px currentColor; }',
        '}',
        '@keyframes celeb-blink {',
        '  0%,100% { opacity: 1; } 50% { opacity: 0.35; }',
        '}',
      ].join('\n')
      document.head.appendChild(style)
    }

    menuOverlay.appendChild(this.panel)
  }

  show(
    weaponType:       WeaponType,
    _tutorialPages?:  string[],
    _tutorialTitle?:  string,
    _tutorialAccent?: string,
  ): void {
    this.openedAtMs = performance.now()   // WALL CLOCK — not affected by delta

    const colorNum = WEAPON_COLORS[weaponType]
    const colorHex = `#${colorNum.toString(16).padStart(6, '0')}`
    const name     = WEAPON_DATA.get(weaponType)?.name ?? weaponType
    const desc     = WEAPON_DESCRIPTIONS[weaponType] ?? ''

    this.panel.innerHTML = ''
    this.panel.style.cssText = [
      'display:flex; flex-direction:column; align-items:center; justify-content:center;',
      'position:absolute; inset:0; background:rgba(0,0,0,0.84); z-index:150;',
      'font-family:monospace;',
    ].join('')

    const box = document.createElement('div')
    box.style.cssText = [
      `border:1.5px solid ${colorHex};`,
      'background:#0d0d1a; padding:36px 48px 28px;',
      'display:flex; flex-direction:column; align-items:center; width:400px;',
      `animation: celeb-glow 2s ease-in-out infinite;`,
      `color: ${colorHex};`,   // for currentColor in box-shadow
    ].join('')

    const header = document.createElement('div')
    header.style.cssText = 'color:#aabbcc; font-size:11px; letter-spacing:3px; margin-bottom:24px;'
    header.textContent = '★  NEW DISCOVERY  ★'

    // Big animated icon — pop in, then bob
    const iconWrap = document.createElement('div')
    iconWrap.style.cssText = [
      'position:relative; width:120px; height:120px;',
      'display:flex; align-items:center; justify-content:center;',
      'margin-bottom:24px;',
      `background:radial-gradient(circle, ${colorHex}33 0%, transparent 70%);`,
      'border-radius:50%;',
      'animation: celeb-pop 600ms ease-out 0ms both, celeb-bob 1.8s ease-in-out 600ms infinite;',
    ].join('')
    iconWrap.innerHTML = weaponIconSvg(weaponType, colorHex, 80)

    const itemName = document.createElement('div')
    itemName.style.cssText = `color:${colorHex}; font-size:22px; letter-spacing:2px; margin-bottom:14px; text-align:center; font-weight:bold;`
    itemName.textContent = name

    const descEl = document.createElement('div')
    descEl.style.cssText = 'color:#aabbcc; font-size:12px; line-height:1.7; text-align:center; margin-bottom:24px; white-space:pre-wrap;'
    descEl.textContent = desc

    const prompt = document.createElement('div')
    prompt.style.cssText = 'color:#556677; font-size:11px; animation:celeb-blink 1.4s ease-in-out infinite;'
    prompt.textContent = '[ Space ] continue'

    box.appendChild(header)
    box.appendChild(iconWrap)
    box.appendChild(itemName)
    box.appendChild(descEl)
    box.appendChild(prompt)
    this.panel.appendChild(box)

    this.overlay.style.display = 'block'
    this.isOpen = true
  }

  // Round 6 Issue 1: discovery card waits for player input rather than auto-dismissing.
  // MIN_VISIBLE_MS gate prevents an in-flight Space press (from the Webbs pose phase)
  // from closing the card instantly.
  update(input: InputManager, _delta: number): void {
    if (!this.isOpen) return
    const elapsedMs = performance.now() - this.openedAtMs
    if (elapsedMs < MIN_VISIBLE_MS) return
    if (input.justDown('Space') || input.justDown('KeyM')) this.dismiss()
  }

  close(): void {
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    this.onClose?.()
  }

  private dismiss(): void {
    this.panel.style.display   = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    // Round 6 Issue 1: PresentationPhase owns the tutorial follow-up — just notify.
    this.onClose?.()
  }
}
