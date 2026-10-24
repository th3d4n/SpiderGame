import type { WeaponType } from '../systems/WeaponSystem'
import { WEAPON_STATS } from '../config/WeaponData'
import { weaponIconSvg } from './WeaponIcon3D'
import { mountWeaponPreview } from './WeaponPreview'
import type { InputManager } from '../core/InputManager'
import type { TextDisplay3D } from './TextDisplay3D'
import { h, richText } from './theme'
import { WEAPON_DESCRIPTIONS, weaponColor, weaponName, weaponStatBars, weaponTypeLabel } from './weaponInfo'

// ─── Discovery card ───────────────────────────────────────────────────────────
// Shown after Webbs' lift pose.  Choreography (ms):
//    0  scrim fades in, light rays start turning
//   80  icon disc pops in (overshoot), then floats; a shine sweeps across it
//  300  name reveals letter by letter
//  650  type chip + stat bars grow in, description rises
//  900  prompt appears — the card can't be dismissed before this
//  out  card lifts and fades (240 ms) before the next step runs

export type DiscoveryVariant = 'found' | 'crafted' | 'gift'

const EYEBROW: Record<DiscoveryVariant, string> = {
  found:   'New discovery',
  crafted: 'Forged at the workbench',
  gift:    'A gift, unwrapped',
}

const MIN_VISIBLE_MS = 900
const OUT_MS         = 240

const STYLE = /* css */`
.nl-disc-wrap { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:160; }
.nl-disc-rays { position:absolute; width:900px; height:900px; left:50%; top:42%; margin:-450px 0 0 -450px; border-radius:50%;
  background: repeating-conic-gradient(from 0deg, var(--c) 0deg 5deg, transparent 5deg 18deg);
  -webkit-mask: radial-gradient(circle, #000 0%, transparent 62%); mask: radial-gradient(circle, #000 0%, transparent 62%);
  opacity:.16; animation: nl-spin 40s linear infinite, nl-fade-in 600ms ease both; }
.nl-disc { position:relative; width:440px; padding:34px 40px 26px; display:flex; flex-direction:column; align-items:center; text-align:center;
  animation: nl-up 420ms var(--nl-ease) both; }
.nl-disc.out { animation: nl-disc-out ${OUT_MS}ms ease-in both; }
@keyframes nl-disc-out { to { opacity:0; transform: translateY(-14px) scale(.97) } }
.nl-disc .eyebrow { color: var(--c); margin-bottom: 18px; }
.nl-disc .medal { position:relative; width:150px; height:150px; border-radius:50%; display:grid; place-items:center; overflow:hidden; margin-bottom:18px;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c) 35%, transparent), rgba(10,8,6,.9) 70%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent), 0 0 50px color-mix(in srgb, var(--c) 35%, transparent);
  animation: nl-pop 620ms var(--nl-ease-back) 80ms both; }
.nl-disc .medal svg, .nl-disc .medal img { animation: nl-float 2.6s ease-in-out 700ms infinite; filter: drop-shadow(0 6px 14px rgba(0,0,0,.6)); }
.nl-disc .medal canvas { position:relative; z-index:1; filter: drop-shadow(0 8px 16px rgba(0,0,0,.55)); }
.nl-disc .medal::before { content:''; position:absolute; inset:10px; border-radius:50%;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--c) 40%, transparent) 0deg 6deg, transparent 6deg 20deg);
  -webkit-mask: radial-gradient(circle, #000 20%, transparent 70%); mask: radial-gradient(circle, #000 20%, transparent 70%);
  animation: nl-spin 14s linear infinite; opacity:.55; }
.nl-disc .medal::after { content:''; position:absolute; top:-20%; bottom:-20%; width:34%; left:0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: nl-shine 1.1s ease-in-out 650ms both; }
.nl-disc .ripple { position:absolute; width:150px; height:150px; border-radius:50%; border:2px solid var(--c); top:34px; left:50%; margin-left:-75px;
  animation: nl-ripple 900ms ease-out 120ms both; pointer-events:none; }
.nl-disc .name { font-size: 30px; line-height: 1.15; margin-bottom: 10px; color: var(--nl-text); }
.nl-disc .name span { display:inline-block; animation: nl-letter 380ms var(--nl-ease) both; white-space: pre; }
.nl-disc .meta { display:flex; gap:8px; justify-content:center; margin-bottom:16px; animation: nl-up 360ms var(--nl-ease) 650ms both; }
.nl-disc .desc { font-size: 13px; line-height: 1.65; color: var(--nl-dim); margin: 14px 0 18px; animation: nl-up 360ms var(--nl-ease) 760ms both; }
.nl-disc .bars { width: 100%; animation: nl-up 360ms var(--nl-ease) 650ms both; }
.nl-disc .prompt { opacity:0; transition: opacity 300ms; }
.nl-disc .prompt.on { opacity:1; animation: nl-blink 1.6s ease-in-out 300ms infinite; }
`

export class PickupCelebration3D {
  private overlay: HTMLElement
  private wrap:    HTMLDivElement
  private card:    HTMLDivElement | null = null
  private prompt:  HTMLElement | null = null
  private closing  = false
  private stopPreview: (() => void) | null = null

  isOpen   = false
  onClose?: () => void

  private openedAtMs = 0   // wall-clock timestamp when shown — not affected by delta clamping

  // TextDisplay3D kept in the signature for callers; PresentationPhase owns the
  // tutorial follow-up.
  constructor(menuOverlay: HTMLElement, _textDisplay: TextDisplay3D) {
    this.overlay = menuOverlay
    this.wrap    = h('div', 'nl-disc-wrap') as HTMLDivElement
    this.wrap.style.display = 'none'
    if (!document.getElementById('nl-disc-style')) {
      const st = h('style'); st.id = 'nl-disc-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    menuOverlay.appendChild(this.wrap)
  }

  show(weaponType: WeaponType, variant: DiscoveryVariant = 'found'): void {
    this.openedAtMs = performance.now()
    this.closing    = false
    const c = weaponColor(weaponType)

    this.wrap.innerHTML = ''
    this.wrap.style.setProperty('--c', c)
    this.wrap.appendChild(h('div', 'nl-scrim'))
    this.wrap.appendChild(h('div', 'nl-disc-rays'))

    const card = h('div', 'nl-panel nl-disc') as HTMLDivElement
    card.appendChild(h('div', 'nl-eyebrow eyebrow', `★  ${EYEBROW[variant]}  ★`))
    const medal = h('div', 'medal')
    // The real model, turning; the flat icon only if there's no WebGL for it
    this.stopPreview?.()
    this.stopPreview = mountWeaponPreview(medal, weaponType, 150)
    if (!this.stopPreview) medal.innerHTML = weaponIconSvg(weaponType, c, 92)
    card.appendChild(medal)
    card.appendChild(h('div', 'ripple'))

    const name = h('div', 'nl-title name')
    ;[...weaponName(weaponType)].forEach((ch, i) => {
      const s = h('span', '', ch)
      s.style.animationDelay = `${300 + i * 28}ms`
      name.appendChild(s)
    })
    card.appendChild(name)

    const meta = h('div', 'meta')
    meta.innerHTML = `<span class="nl-chip">${weaponTypeLabel(weaponType)}</span><span class="nl-chip">Range <b>${WEAPON_STATS[weaponType]?.range ?? '—'}</b></span>`
    card.appendChild(meta)

    const bars = h('div', 'bars')
    bars.appendChild(weaponStatBars(weaponType, 700))
    card.appendChild(bars)

    const desc = h('div', 'desc')
    desc.innerHTML = richText(WEAPON_DESCRIPTIONS[weaponType] ?? '')
    card.appendChild(desc)

    this.prompt = h('div', 'nl-hints prompt')
    this.prompt.innerHTML = '<span><span class="nl-key">Space</span> continue</span>'
    card.appendChild(this.prompt)

    this.wrap.appendChild(card)
    this.card = card
    this.wrap.style.display = 'flex'
    this.overlay.style.display = 'block'
    this.isOpen = true
  }

  // Player-dismissed; MIN_VISIBLE_MS stops an in-flight key press from the pose
  // phase closing the card before it has even landed.
  update(input: InputManager, _delta: number): void {
    if (!this.isOpen || this.closing) return
    const elapsedMs = performance.now() - this.openedAtMs
    if (elapsedMs < MIN_VISIBLE_MS) return
    this.prompt?.classList.add('on')
    if (input.justDown('Space') || input.justDown('KeyM') || input.justDown('Escape') || input.justDown('Enter')) this.dismiss()
  }

  close(): void {
    this.hide()
    this.onClose?.()
  }

  private dismiss(): void {
    this.closing = true
    this.card?.classList.add('out')
    this.wrap.style.transition = `opacity ${OUT_MS}ms ease-in`
    this.wrap.style.opacity = '0'
    window.setTimeout(() => {
      this.hide()
      this.onClose?.()   // PresentationPhase owns the tutorial follow-up
    }, OUT_MS)
  }

  private hide(): void {
    this.stopPreview?.(); this.stopPreview = null
    this.wrap.style.display = 'none'
    this.wrap.style.opacity = '1'
    this.wrap.style.transition = ''
    this.overlay.style.display = 'none'
    this.isOpen  = false
    this.closing = false
  }
}
