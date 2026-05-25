import { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_COLORS, WEAPON_DATA } from '../config/WeaponData'
import { weaponIconSvg } from './WeaponIcon3D'
import type { InputManager } from '../core/InputManager'
import type { TextDisplay3D, TextDisplayData } from './TextDisplay3D'

const WEAPON_DESCRIPTIONS: Partial<Record<WeaponType, string>> = {
  [WeaponType.Sword]:         'A blade of woven silk.\nQuick arcing swing, low stamina cost.\nReliable in close quarters.',
  [WeaponType.Bow]:           'A recurve bow of webbing.\nFires Thistles — gather them in the colony.\nLong range, medium stamina cost.',
  [WeaponType.Axe]:           'A heavy chitin cleave.\nWide 170° arc, high damage, slow swing.\nCosts stamina — use it to end a fight fast.',
  [WeaponType.BoxingGloves]:  'A sharpened toothpick.\nFast narrow stab with long reach.\nLowest stamina cost of any weapon.',
  [WeaponType.Glider]:        'Silk-web wings.\nHold fire to ride air currents across gaps.',
  [WeaponType.FlameBreather]: 'A repurposed venom gland.\nHold fire to spray a cone of flame.\nDrains energy — not stamina.',
  [WeaponType.WebLauncher]:   'The Web Thrower.\nFires sticky silk — pull yourself or items\ntoward the anchor point.',
}

export class PickupCelebration3D {
  private overlay:    HTMLElement
  private panel:      HTMLDivElement
  private textDisplay: TextDisplay3D
  private tutorialPages: string[] = []
  private tutorialTitle?: string
  private tutorialAccent?: string

  isOpen     = false
  onClose?: () => void

  private animTimer = 0

  constructor(menuOverlay: HTMLElement, textDisplay: TextDisplay3D) {
    this.overlay     = menuOverlay
    this.textDisplay = textDisplay
    this.panel       = document.createElement('div')
    this.panel.style.display = 'none'

    // Inject CSS animations once
    if (!document.getElementById('celeb-styles')) {
      const style = document.createElement('style')
      style.id = 'celeb-styles'
      style.textContent = [
        '@keyframes celeb-pop {',
        '  0%   { transform: scale(0); }',
        '  70%  { transform: scale(1.18); }',
        '  100% { transform: scale(1); }',
        '}',
        '@keyframes celeb-bob {',
        '  0%,100% { transform: translateY(0); }',
        '  50%     { transform: translateY(-7px); }',
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
    weaponType:      WeaponType,
    tutorialPages?:  string[],
    tutorialTitle?:  string,
    tutorialAccent?: string,
  ): void {
    this.tutorialPages  = tutorialPages ?? []
    this.tutorialTitle  = tutorialTitle
    this.tutorialAccent = tutorialAccent
    this.animTimer      = 0

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

    // Inner panel
    const box = document.createElement('div')
    box.style.cssText = [
      `border:1.5px solid ${colorHex};`,
      'background:#0d0d1a; padding:28px 40px 22px;',
      'display:flex; flex-direction:column; align-items:center; width:360px;',
    ].join('')

    // Header
    const header = document.createElement('div')
    header.style.cssText = 'color:#445566; font-size:10px; letter-spacing:2px; margin-bottom:18px;'
    header.textContent = '— NEW DISCOVERY —'

    // Glow rings
    const glowWrap = document.createElement('div')
    glowWrap.style.cssText = 'position:relative; width:92px; height:92px; display:flex; align-items:center; justify-content:center; margin-bottom:16px;'

    const glow1 = document.createElement('div')
    glow1.style.cssText = `position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, ${colorHex}22 0%, transparent 70%);`
    const glow2 = document.createElement('div')
    glow2.style.cssText = `position:absolute; inset:16px; border-radius:50%; background:radial-gradient(circle, ${colorHex}44 0%, transparent 70%);`

    // Icon with pop + bob animation
    const iconWrap = document.createElement('div')
    iconWrap.style.cssText = 'position:relative; z-index:1; animation: celeb-pop 320ms ease-out both, celeb-bob 1.1s ease-in-out 360ms infinite;'
    iconWrap.innerHTML = weaponIconSvg(weaponType, colorHex, 48)

    glowWrap.appendChild(glow1)
    glowWrap.appendChild(glow2)
    glowWrap.appendChild(iconWrap)

    // Item name
    const itemName = document.createElement('div')
    itemName.style.cssText = `color:${colorHex}; font-size:18px; letter-spacing:1px; margin-bottom:10px; text-align:center;`
    itemName.textContent = name

    // Description
    const descEl = document.createElement('div')
    descEl.style.cssText = 'color:#778899; font-size:11px; line-height:1.7; text-align:center; margin-bottom:18px; white-space:pre-wrap;'
    descEl.textContent = desc

    // Hold beat — auto-advances after 2.5s, no skip
    const prompt = document.createElement('div')
    prompt.style.cssText = 'color:#444466; font-size:10px; animation:celeb-blink 1.4s ease-in-out infinite;'
    prompt.textContent = '— — —'

    box.appendChild(header)
    box.appendChild(glowWrap)
    box.appendChild(itemName)
    box.appendChild(descEl)
    box.appendChild(prompt)
    this.panel.appendChild(box)

    this.overlay.style.display = 'block'
    this.isOpen = true
  }

  update(_input: InputManager, delta: number): void {
    if (!this.isOpen) return
    this.animTimer += delta
    if (this.animTimer >= 2.5) this.dismiss()
  }

  close(): void {
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    this.onClose?.()
  }

  private dismiss(): void {
    this.panel.style.display = 'none'
    this.isOpen = false

    if (this.tutorialPages.length > 0) {
      const data: TextDisplayData = {
        pages:       this.tutorialPages,
        title:       this.tutorialTitle,
        accentColor: this.tutorialAccent,
      }
      // Chain onClose so celebZoom is reset when the card is dismissed
      const prevClose = this.textDisplay.onClose
      this.textDisplay.onClose = () => { prevClose?.(); this.onClose?.() }
      this.textDisplay.show(data)
    } else {
      this.overlay.style.display = 'none'
      this.onClose?.()
    }
  }
}
