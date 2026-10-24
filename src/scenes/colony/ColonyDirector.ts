import * as THREE from 'three'
import { audio } from '../../systems/AudioManager'
import { h } from '../../ui/theme'
import type { ColonyMaze } from './ColonyMaze'
import type { ColonyVision } from './ColonyVision'
import type { AntSoldier3D } from '../../entities/AntSoldier3D'

// ─── Colony director ──────────────────────────────────────────────────────────
// Keeps the tunnels tense.  Noise (fighting, traps, a burst sac) and being seen
// raise the colony's ALARM; at the top it sends hunters after Webbs from the
// far tunnels.  When things are quiet it plays on the dark instead: skittering
// behind a wall, eyes at the end of a corridor that are gone when you look
// again, the ceiling grinding.  Also owns the colony HUD: the objective, the
// colony's mood, and a red edge while you're being hunted.

export interface DirectorHooks {
  spawnHunter(x: number, z: number, targetX: number, targetZ: number): void
  spawnSwarm(x: number, z: number, count: number): void
  soldiers(): AntSoldier3D[]
  dust(x: number, z: number, color: number, count: number): void
  shake(amount: number, time: number): void
}

const STYLE = /* css */`
#nl-colony-hud { position:absolute; left:50%; top:50px; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none; z-index:60; }
#nl-colony-hud .obj { display:flex; align-items:center; gap:10px; padding:7px 14px 7px 10px; font-size:13px; color:var(--nl-text); white-space:nowrap; }
#nl-colony-hud .obj .tag { font-size:9.5px; font-weight:700; letter-spacing:2px; color:var(--nl-amber); text-transform:uppercase; }
#nl-colony-hud .obj.new { animation: nl-pop 420ms var(--nl-ease-back); }
#nl-colony-hud .mood { font-size:10.5px; letter-spacing:2.5px; text-transform:uppercase; font-weight:700; opacity:.85; transition: color 400ms; text-shadow: 0 1px 6px rgba(0,0,0,.8); }
#nl-colony-hud .mood.quiet { color:#8fa88a; } #nl-colony-hud .mood.restless { color:#e8b45a; } #nl-colony-hud .mood.hunting { color:#ff5a3a; animation: nl-blink 1s ease-in-out infinite; }
#nl-hunted { position:fixed; inset:0; pointer-events:none; z-index:39; opacity:0; transition: opacity 500ms;
  background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(120,8,0,0.45) 100%); }
`

export class ColonyDirector {
  alarm = 0
  private maze: ColonyMaze
  private vision: ColonyVision
  private hooks: DirectorHooks
  private scene: THREE.Scene
  private hunterCool = 20
  private swarmCool = 30
  private scareT = 14 + Math.random() * 10
  private spotCool = 0
  private eyes: Array<{ g: THREE.Group; t: number; life: number }> = []
  private eyeMat = new THREE.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3a0a, emissiveIntensity: 3.6 })
  private eyeGeo = new THREE.SphereGeometry(0.03, 8, 6)
  private hud: HTMLElement
  private objTxt: HTMLElement
  private objEl: HTMLElement
  private moodEl: HTMLElement
  private hunted: HTMLElement
  private mood = ''

  constructor(scene: THREE.Scene, maze: ColonyMaze, vision: ColonyVision, hooks: DirectorHooks) {
    this.scene = scene; this.maze = maze; this.vision = vision; this.hooks = hooks
    if (!document.getElementById('nl-colony-style')) {
      const st = h('style'); st.id = 'nl-colony-style'; st.textContent = STYLE; document.head.appendChild(st)
    }
    this.hud = h('div'); this.hud.id = 'nl-colony-hud'
    this.objEl = h('div', 'hud-card obj')
    this.objEl.appendChild(h('span', 'tag', 'Objective'))
    this.objTxt = h('span', 'txt'); this.objEl.appendChild(this.objTxt)
    this.moodEl = h('div', 'mood quiet', 'The colony is quiet')
    this.hud.append(this.objEl, this.moodEl)
    document.getElementById('hud-overlay')?.appendChild(this.hud)
    this.hunted = h('div'); this.hunted.id = 'nl-hunted'
    document.body.appendChild(this.hunted)
  }

  setObjective(text: string, pop = false): void {
    if (this.objTxt.textContent === text) return
    this.objTxt.textContent = text
    if (pop) { this.objEl.classList.remove('new'); void this.objEl.offsetWidth; this.objEl.classList.add('new') }
  }

  // A sound at (x, z): soldiers within `range` (path distance) come to look;
  // `alarm` is how much it stirs the colony.
  noise(x: number, z: number, range: number, alarm: number): void {
    this.alarm = Math.min(100, this.alarm + alarm)
    for (const s of this.hooks.soldiers()) s.hear(x, z, range)
  }

  // A soldier has eyes on Webbs: the colony knows, nearby soldiers converge
  spotted(x: number, z: number, from: AntSoldier3D): void {
    if (this.spotCool > 0) return
    this.spotCool = 1.2
    this.alarm = Math.min(100, this.alarm + 9)
    const f = this.maze.fieldTo(x, z)
    for (const s of this.hooks.soldiers()) {
      if (s === from || s.isDead()) continue
      if (this.maze.fieldDistance(f, s.collisionBody.x, s.collisionBody.z) < 14) s.rouse(x, z)
    }
  }

  update(dt: number, px: number, pz: number): void {
    this.spotCool = Math.max(0, this.spotCool - dt)
    const anyHunting = this.hooks.soldiers().some(s => s.hunting)
    this.alarm = Math.max(0, this.alarm - dt * (anyHunting ? 0.25 : 1.6))
    this.hunterCool -= dt; this.swarmCool -= dt

    // The colony sends hunters from far tunnels toward where you are
    if (this.alarm >= 60 && this.hunterCool <= 0) {
      const p = this.farPoint(px, pz, 14)
      if (p) { this.hooks.spawnHunter(p.x, p.z, px, pz); audio.play('beetle_charge_windup', p.x, p.z, { rate: 1.6, volume: 1.4 }) }
      this.hunterCool = 38
    }
    if (this.alarm >= 95 && this.swarmCool <= 0) {
      const p = this.farPoint(px, pz, 10)
      if (p) this.hooks.spawnSwarm(p.x, p.z, 4)
      this.swarmCool = 55
    }

    // Quiet stretches: the dark plays tricks
    if (!anyHunting && this.alarm < 35) {
      this.scareT -= dt
      if (this.scareT <= 0) { this.scare(px, pz); this.scareT = 16 + Math.random() * 22 }
    }
    this.tickEyes(dt, px, pz)

    // HUD mood + hunted edge
    const mood = anyHunting || this.alarm >= 70 ? 'hunting' : this.alarm >= 30 ? 'restless' : 'quiet'
    if (mood !== this.mood) {
      this.mood = mood
      this.moodEl.className = `mood ${mood}`
      this.moodEl.textContent = mood === 'hunting' ? 'The colony is hunting you' : mood === 'restless' ? 'The colony is restless' : 'The colony is quiet'
    }
    this.hunted.style.opacity = String(anyHunting ? 1 : Math.max(0, (this.alarm - 50) / 50) * 0.6)
  }

  // An open tile at least `minDist` (path) from the player, unseen — preferring
  // the furthest such tunnel
  private farPoint(px: number, pz: number, minDist: number): { x: number; z: number } | null {
    this.maze.setGoal(px, pz)
    let best: { x: number; z: number } | null = null, bd = 0
    for (let k = 0; k < 60; k++) {
      const [cx, cy] = [Math.floor(this.maze.rand() * 15), Math.floor(this.maze.rand() * 9)]
      const x = this.maze.cellX(cx), z = this.maze.cellZ(cy)
      if (this.maze.isSolidAt(x, z) || this.vision.canSee(x, z)) continue
      const d = this.maze.goalDistance(x, z)
      if (d === Infinity || d < minDist) continue
      const room = this.maze.roomAt(x, z)
      if (room && (room.role === 'entry' || room.role === 'boss')) continue
      const score = Math.min(d, 26) + Math.random() * 4
      if (score > bd) { bd = score; best = { x, z } }
    }
    return best
  }

  // A tile 4–9 wu away that Webbs can't currently see
  private hiddenNear(px: number, pz: number): { x: number; z: number } | null {
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r
      if (this.maze.isSolidAt(x, z) || this.vision.canSee(x, z)) continue
      return { x: this.maze.tileX(this.maze.tileI(x)), z: this.maze.tileZ(this.maze.tileJ(z)) }
    }
    return null
  }

  private scare(px: number, pz: number): void {
    const p = this.hiddenNear(px, pz)
    if (!p) return
    const pick = Math.random()
    if (pick < 0.35) {
      audio.play('centipede_skitter', p.x, p.z, { volume: 1.3 })                 // something in the wall
    } else if (pick < 0.65) {
      // Eyes, low down, at the edge of sight — they blink and are gone
      const g = new THREE.Group(); g.position.set(p.x, 0.32, p.z)
      for (const s of [-1, 1]) { const e = new THREE.Mesh(this.eyeGeo, this.eyeMat); e.position.x = s * 0.08; g.add(e) }
      g.lookAt(px, 0.32, pz)
      this.scene.add(g)
      this.eyes.push({ g, t: 0, life: 2 + Math.random() * 1.5 })
      audio.play('ant_bite', p.x, p.z, { rate: 0.5, volume: 0.6 })
    } else if (pick < 0.85) {
      audio.impact('heavy', px + (Math.random() - 0.5) * 6, pz + (Math.random() - 0.5) * 6)
      audio.play('rubble_fall', p.x, p.z, { rate: 0.5, volume: 0.9 })              // the ceiling grinds
      this.hooks.shake(0.004, 1.2)
      for (let k = 0; k < 3; k++) this.hooks.dust(px + (Math.random() - 0.5) * 2, pz + (Math.random() - 0.5) * 2, 0x6a5238, 4)
    } else {
      audio.play('beetle_walk', p.x, p.z, { rate: 0.8, volume: 1.0 })              // heavy steps, somewhere close
    }
  }

  private tickEyes(dt: number, px: number, pz: number): void {
    for (let k = this.eyes.length - 1; k >= 0; k--) {
      const e = this.eyes[k]
      e.t += dt
      const near = Math.hypot(e.g.position.x - px, e.g.position.z - pz) < 3.5
      const blink = Math.sin(e.t * 9) > 0.92 ? 0.1 : 1
      e.g.scale.set(1, blink, 1)
      if (e.t > e.life || near) { this.scene.remove(e.g); this.eyes.splice(k, 1) }
    }
  }

  dispose(): void {
    for (const e of this.eyes) this.scene.remove(e.g)
    this.eyes = []
    this.eyeMat.dispose(); this.eyeGeo.dispose()
    this.hud.remove(); this.hunted.remove()
  }
}
