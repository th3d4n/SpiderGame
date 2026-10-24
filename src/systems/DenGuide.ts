import * as THREE from 'three'
import { registry } from '../core/Registry'
import { h, richText } from '../ui/theme'
import { CLUE_TOTAL } from './Story'

// ─── Objective guide ─────────────────────────────────────────────────────────
// The opening needs a nudge: the den is big and the player arrives with no
// idea what's worth finding.  A chain of soft objectives, written as the
// story (see systems/Story):
//   den:        where is everyone? → Mum's present → what happened here (clues)
//               → something sharp → a real weapon → out the west door
//   crossroads: pick the ants' padlock → follow the tracks → (after the
//               Anteater) weave the Chitin Axe → chop the Hive chain
// shown as one objective line.  It never forces anything: a step that's
// already done (in any order) is skipped, a step whose `when` isn't true yet
// hides the line, and help escalates only if the player seems stuck — a hint
// line after a while, then a bouncing marker over the target (with an edge
// arrow when it's off screen).  Progress is saved per guide.

type Pt = { x: number; z: number }
export interface GuidePoints {
  pickups: Pt[]; card: Pt; gift: Pt; toothpick: Pt; workbench: Pt
  clues: Array<Pt & { id: number }>; exit: Pt
}
export interface CrossroadsPoints { antLock: Pt; hiveLock: Pt; antTunnel: Pt; door: Pt }

export interface Step<P> {
  id:        string
  objective: string
  hint:      string
  hintAfter: number   // s on this step before the hint line
  markAfter: number   // s before the marker appears
  done:      () => boolean
  when?:     () => boolean   // not yet relevant → no objective shown
  target:    (p: P, from: Pt) => Pt | null
}

const has = (k: string) => !!registry.get<boolean>(k)
const nearest = (pts: Pt[], from: Pt): Pt | null => {
  let best: Pt | null = null, bd = Infinity
  for (const p of pts) { const d = Math.hypot(p.x - from.x, p.z - from.z); if (d < bd) { bd = d; best = p } }
  return best
}
export const weaponsMade = () => (registry.get<string[]>('weaponInventory') ?? []).some(w => w === 'Sword' || w === 'Bow' || w === 'Axe')
export const axeMade = () => (registry.get<string[]>('weaponInventory') ?? []).includes('Axe')

export const DEN_STEPS: Step<GuidePoints>[] = [
  { id: 'card', objective: 'Where is everyone? Look around the den.',
    hint: 'There\'s a card by the party things. [E] to read it.',
    hintAfter: 18, markAfter: 30,
    done: () => has('birthdayCardRead'), target: (p) => p.card },
  { id: 'gift', objective: 'Open Mum\'s present.',
    hint: 'A wrapped present waits near the party decorations. [E] to open it.',
    hintAfter: 14, markAfter: 22,
    done: () => has('webThrowerFound'), target: (p) => p.gift },
  { id: 'clues', objective: 'Something\'s wrong. Find out what happened here.',
    hint: 'Look closer at what\'s out of place — the cradle, the hammocks, the floor, the door. [E] to look.',
    hintAfter: 20, markAfter: 34,
    done: () => (registry.get<number[]>('cluesFoundIds') ?? []).length >= CLUE_TOTAL,
    target: (p, f) => {
      const found = registry.get<number[]>('cluesFoundIds') ?? []
      return nearest(p.clues.filter(c => !found.includes(c.id)), f)
    } },
  { id: 'toothpick', objective: 'Whatever did this could come back. Find something sharp.',
    hint: 'Something pointed is stuck in the floor somewhere here. It glints — keep looking.',
    hintAfter: 16, markAfter: 26,
    done: () => has('toothpickCollected'), target: (p) => p.toothpick },
  { id: 'craft', objective: 'Weave a real weapon at Mum\'s workbench.',
    hint: 'Walk over glinting silk and chitin to gather it. The workbench is by the half-built leg — [E] to open it.',
    hintAfter: 16, markAfter: 24,
    done: weaponsMade, target: (p) => p.workbench },
  { id: 'exit', objective: 'Go after them — through the west door.',
    hint: 'The west door is the lit opening at the far edge of the den.',
    hintAfter: 14, markAfter: 20,
    done: () => has('crossroadsVisited'), target: (p) => p.exit },
]

export const CROSSROADS_STEPS: Step<CrossroadsPoints>[] = [
  { id: 'antlock', objective: 'Pick the padlock on the ant tunnel.',
    hint: 'The toothpick is thin enough to work a lock. [E] at the padlock.',
    hintAfter: 12, markAfter: 18,
    done: () => has('antLockOpen'), target: (p) => p.antLock },
  { id: 'warrens', objective: 'Follow the ant tracks into the colony.',
    hint: 'The gate is open. Walk into the ant tunnel.',
    hintAfter: 12, markAfter: 18,
    done: () => has('antColonyFirstVisit'), target: (p) => p.antTunnel },
  { id: 'axe', objective: 'Weave the Chitin Axe at a workbench.',
    hint: 'The Anteater\'s armor is enough for an axe. Workbenches: the den, and the colony entrance.',
    hintAfter: 20, markAfter: 9999,
    when: () => has('axeRecipeUnlocked'),
    done: axeMade, target: () => null },
  { id: 'hive', objective: 'Chop the chain off the Hive tunnel.',
    hint: 'The Hive tunnel is the one sealed with wax. [E] at the chain.',
    hintAfter: 12, markAfter: 18,
    when: () => has('axeRecipeUnlocked'),
    done: () => has('hiveLockOpen'), target: (p) => p.hiveLock },
]

const STYLE = /* css */`
#nl-objective { position:absolute; left:50%; top: 50px; transform: translateX(-50%); display:none; align-items:center; gap:10px;
  padding: 7px 14px 7px 10px; font-size: 13px; color: var(--nl-text); pointer-events:none; white-space:nowrap; z-index: 60; }
#nl-objective.on { display:flex; }
#nl-objective .tag { font-size: 9.5px; font-weight: 700; letter-spacing: 2px; color: var(--nl-amber); text-transform: uppercase; }
#nl-objective.new { animation: nl-pop 420ms var(--nl-ease-back); }
#nl-objective.hint .txt { color: #ffe2b8; }
#nl-guide-arrow { position:absolute; left:0; top:0; width: 34px; height: 34px; margin: -17px 0 0 -17px; display:none; pointer-events:none; z-index: 60;
  filter: drop-shadow(0 3px 8px rgba(0,0,0,.6)); }
#nl-guide-arrow.on { display:block; }
#nl-guide-arrow svg { width:100%; height:100%; animation: nl-pulse 1.2s ease-in-out infinite; }
`

export class Guide<P> {
  private stepIdx: number
  private stepT = 0
  private hinted = false
  private chip: HTMLElement
  private chipTxt: HTMLElement
  private arrow: HTMLElement
  private marker: THREE.Group
  private scene: THREE.Scene
  private visible = true
  private shownStep = -1
  private _v = new THREE.Vector3()
  onHint?: (text: string) => void

  private steps: Step<P>[]
  private saveKey: string

  constructor(scene: THREE.Scene, steps: Step<P>[], saveKey: string) {
    this.scene = scene
    this.steps = steps
    this.saveKey = saveKey
    this.stepIdx = Math.min(registry.get<number>(saveKey) ?? 0, steps.length)
    if (!document.getElementById('nl-guide-style')) {
      const st = h('style'); st.id = 'nl-guide-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    this.chip = h('div', 'hud-card'); this.chip.id = 'nl-objective'
    this.chip.appendChild(h('span', 'tag', 'Objective'))
    this.chipTxt = h('span', 'txt'); this.chip.appendChild(this.chipTxt)
    this.arrow = h('div'); this.arrow.id = 'nl-guide-arrow'
    this.arrow.innerHTML = '<svg viewBox="-12 -12 24 24"><path d="M-7,-8 L9,0 L-7,8 L-3,0 Z" fill="#ffcf8a" stroke="#1a120c" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    const hud = document.getElementById('hud-overlay')!
    hud.append(this.chip, this.arrow)

    // Bouncing chevron over the target — drawn on top of everything
    this.marker = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcf8a, depthTest: false, transparent: true, opacity: 0.95 })
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), mat)
    cone.rotation.x = Math.PI   // point down
    cone.renderOrder = 999
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide }))
    ring.renderOrder = 998
    ring.userData.ring = true
    this.marker.add(cone, ring)
    this.marker.visible = false
    scene.add(this.marker)
  }

  get complete(): boolean { return this.stepIdx >= this.steps.length }

  // Hide everything while menus/story/transitions own the screen
  setVisible(on: boolean): void { this.visible = on }

  update(dt: number, from: Pt, points: P, camera: THREE.Camera, unit: number): void {
    // Skip anything already done, in whatever order the player did it
    while (this.stepIdx < this.steps.length && this.steps[this.stepIdx].done()) {
      this.stepIdx++; this.stepT = 0; this.hinted = false
      registry.set(this.saveKey, this.stepIdx)
    }
    if (this.complete || !this.visible) { this.hideAll(); return }
    const step = this.steps[this.stepIdx]
    if (step.when && !step.when()) { this.hideAll(); return }
    this.stepT += dt

    if (this.shownStep !== this.stepIdx) {
      this.shownStep = this.stepIdx
      this.chipTxt.innerHTML = richText(step.objective)
      this.chip.classList.remove('hint', 'new'); void this.chip.offsetWidth; this.chip.classList.add('new')
    }
    this.chip.classList.add('on')
    if (!this.hinted && this.stepT >= step.hintAfter) {
      this.hinted = true
      this.onHint?.(step.hint)
    }

    const target = this.stepT >= step.markAfter ? step.target(points, from) : null
    if (!target) { this.marker.visible = false; this.arrow.classList.remove('on'); return }

    // World marker: bobbing chevron + slow ring
    const t = performance.now() / 1000
    this.marker.visible = true
    this.marker.position.set(target.x, 0, target.z)
    this.marker.scale.setScalar(unit)
    const cone = this.marker.children[0], ring = this.marker.children[1]
    cone.position.y = 1.7 + Math.sin(t * 3.2) * 0.22
    cone.rotation.y = t * 1.5
    ring.position.y = 0.03
    ring.scale.setScalar(1 + 0.12 * Math.sin(t * 2.4))

    // Edge arrow when the target is off screen
    this._v.set(target.x, 0.5 * unit, target.z).project(camera)
    const inFront = this._v.z < 1
    const off = !inFront || Math.abs(this._v.x) > 0.92 || Math.abs(this._v.y) > 0.88
    if (!off) { this.arrow.classList.remove('on'); return }
    let nx = this._v.x, ny = this._v.y
    if (!inFront) { nx = -nx; ny = -ny }
    const k = 0.86 / Math.max(Math.abs(nx), Math.abs(ny), 1e-3)
    nx *= k; ny *= k
    const px = (nx * 0.5 + 0.5) * 1280, py = (-ny * 0.5 + 0.5) * 720
    this.arrow.style.transform = `translate(${px}px, ${py}px) rotate(${Math.atan2(-ny, nx)}rad)`
    this.arrow.classList.add('on')
  }

  private hideAll(): void {
    this.chip.classList.remove('on')
    this.arrow.classList.remove('on')
    this.marker.visible = false
  }

  dispose(): void {
    this.chip.remove()
    this.arrow.remove()
    this.marker.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      if (m.material) (m.material as THREE.Material).dispose()
    })
    this.scene.remove(this.marker)
  }
}
