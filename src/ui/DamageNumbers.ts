import * as THREE from 'three'
import { h } from './theme'

// ─── Damage numbers ───────────────────────────────────────────────────────────
// Numbers pop at the point of impact, follow it in screen space, rise and fade.
// Weak-point hits are gold and larger; killing blows punch harder; damage
// taken by Webbs is red.

const LIFE_MS = 720

const STYLE = /* css */`
#nl-dmg { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index: 40; }
.nl-dmg { position:absolute; left:0; top:0; font-family: var(--nl-mono); font-weight: 700; font-size: 17px; color: #fff4e6;
  text-shadow: 0 2px 0 rgba(0,0,0,.65), 0 0 12px rgba(0,0,0,.55); white-space: nowrap; will-change: transform, opacity; }
.nl-dmg.weak { color: #ffd76a; font-size: 22px; }
.nl-dmg.kill { font-size: 24px; }
.nl-dmg.hurt { color: #ff6a5c; }
.nl-dmg.heal { color: #7dffa0; }
.nl-dmg small { display:block; font-family: var(--nl-ui); font-size: 9px; letter-spacing: 2px; text-align:center; color: #ffd76a; }
`

interface Num { el: HTMLElement; world: THREE.Vector3; born: number; drift: number }

export class DamageNumbers {
  private root: HTMLElement
  private nums: Num[] = []
  private v = new THREE.Vector3()

  constructor() {
    if (!document.getElementById('nl-dmg-style')) {
      const st = h('style'); st.id = 'nl-dmg-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.root = h('div'); this.root.id = 'nl-dmg'
    document.getElementById('hud-overlay')!.appendChild(this.root)
  }

  spawn(x: number, y: number, z: number, amount: number, kind: { weak?: boolean; kill?: boolean; hurt?: boolean; heal?: boolean } = {}): void {
    if (amount < 0.5) return
    const el = h('div', `nl-dmg${kind.weak ? ' weak' : ''}${kind.kill ? ' kill' : ''}${kind.hurt ? ' hurt' : ''}${kind.heal ? ' heal' : ''}`)
    el.innerHTML = `${kind.hurt ? '−' : kind.heal ? '+' : ''}${Math.round(amount)}${kind.weak ? '<small>WEAK</small>' : ''}`
    this.root.appendChild(el)
    this.nums.push({ el, world: new THREE.Vector3(x, y, z), born: performance.now(), drift: (Math.random() - 0.5) * 30 })
    while (this.nums.length > 24) this.nums.shift()!.el.remove()
  }

  // Project and animate (call once per frame, after the camera moves)
  update(camera: THREE.Camera, width: number, height: number): void {
    const now = performance.now()
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]
      const t = (now - n.born) / LIFE_MS
      if (t >= 1) { n.el.remove(); this.nums.splice(i, 1); continue }
      this.v.copy(n.world).project(camera)
      const sx = (this.v.x * 0.5 + 0.5) * width
      const sy = (-this.v.y * 0.5 + 0.5) * height
      // pop (overshoot), rise, fade
      const pop  = t < 0.15 ? 0.6 + (t / 0.15) * 0.65 : 1.25 - Math.min(0.25, (t - 0.15) * 1.2)
      const rise = 46 * (1 - (1 - t) * (1 - t))
      n.el.style.opacity   = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3)
      n.el.style.transform = `translate(${sx + n.drift * t}px, ${sy - rise}px) translate(-50%, -50%) scale(${pop})`
    }
  }
}
