import * as THREE from 'three'
import type { InkOutlinePass } from '../../core/InkOutlinePass'
import { ColonyMaze, TW, TH, TILE, MIN_X, MIN_Z } from './ColonyMaze'

// ─── Colony vision ────────────────────────────────────────────────────────────
// What Webbs can see: rays cast through the tile grid from his position mark
// the tiles in sight (eased so the edge of sight breathes instead of popping),
// and everything ever seen is remembered.  The two maps go to the ink pass as
// textures, which darkens every pixel by the tile under it (InkOutlinePass
// "visOn").  Enemies in unseen tiles vanish into the black — only their eyes
// glow through.

const SIGHT_RANGE = 11     // wu
const RAYS        = 540
const EASE        = 9      // 1/s — how fast tiles fade in/out of sight

export class ColonyVision {
  private maze: ColonyMaze
  private ink: InkOutlinePass
  private target = new Uint8Array(TW * TH)
  private cur    = new Float32Array(TW * TH)
  private visData = new Uint8Array(TW * TH)
  private memData = new Uint8Array(TW * TH)
  private visTex: THREE.DataTexture
  private memTex: THREE.DataTexture
  private lastX = Infinity
  private lastZ = Infinity
  private memDirty = true

  constructor(maze: ColonyMaze, ink: InkOutlinePass) {
    this.maze = maze
    this.ink  = ink
    const tex = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, TW, TH, THREE.RedFormat, THREE.UnsignedByteType)
      t.minFilter = t.magFilter = THREE.LinearFilter
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.needsUpdate = true
      return t
    }
    this.visTex = tex(this.visData)
    this.memTex = tex(this.memData)
    const u = ink.uniforms
    u.tVis.value = this.visTex
    u.tMem.value = this.memTex
    u.gridMin.value.set(MIN_X, MIN_Z)
    u.gridSize.value.set(TW * TILE, TH * TILE)
    u.visLitR.value = 9.5   // the lantern carries ~4 wu clear, then fades into the dark
    u.visOn.value = 1
  }

  // Is this world point in Webbs' sight right now?  (Enemy eyes, scares)
  canSee(x: number, z: number): boolean {
    const i = this.maze.tileI(x), j = this.maze.tileJ(z)
    if (i < 0 || j < 0 || i >= TW || j >= TH) return false
    return this.cur[j * TW + i] > 0.5
  }
  explored(x: number, z: number): boolean {
    const i = this.maze.tileI(x), j = this.maze.tileJ(z)
    if (i < 0 || j < 0 || i >= TW || j >= TH) return false
    return this.memData[j * TW + i] > 0
  }

  update(dt: number, px: number, pz: number): void {
    this.ink.uniforms.visPlayer.value.set(px, pz)
    if (Math.hypot(px - this.lastX, pz - this.lastZ) > 0.08) {
      this.lastX = px; this.lastZ = pz
      this.target.fill(0)
      this.maze.castVision(px, pz, SIGHT_RANGE, RAYS, (idx) => { this.target[idx] = 1 })
      // The tiles he stands on/against are always in sight
      const ci = this.maze.tileI(px), cj = this.maze.tileJ(pz)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj
        if (i >= 0 && j >= 0 && i < TW && j < TH) this.target[j * TW + i] = 1
      }
      for (let k = 0; k < TW * TH; k++) {
        if (this.target[k] && !this.memData[k]) { this.memData[k] = 255; this.memDirty = true }
      }
    }
    const a = 1 - Math.exp(-EASE * dt)
    let changed = false
    for (let k = 0; k < TW * TH; k++) {
      const v = this.cur[k] + (this.target[k] - this.cur[k]) * a
      this.cur[k] = v
      const b = Math.round(v * 255)
      if (b !== this.visData[k]) { this.visData[k] = b; changed = true }
    }
    if (changed) this.visTex.needsUpdate = true
    if (this.memDirty) { this.memTex.needsUpdate = true; this.memDirty = false }
  }

  // Explored tiles as a compact string (one bit per tile) for the save
  serialize(): string {
    let out = ''
    for (let k = 0; k < TW * TH; k += 6) {
      let v = 0
      for (let b = 0; b < 6; b++) if (this.memData[k + b]) v |= 1 << b
      out += String.fromCharCode(48 + v)
    }
    return 'v2:' + out
  }
  restore(s: string): void {
    if (!s.startsWith('v2:')) return     // the old fog canvas doesn't map onto the new maze
    const body = s.slice(3)
    for (let c = 0; c < body.length; c++) {
      const v = body.charCodeAt(c) - 48
      for (let b = 0; b < 6; b++) if (v & (1 << b) && c * 6 + b < TW * TH) this.memData[c * 6 + b] = 255
    }
    this.memDirty = true
  }

  dispose(): void {
    this.ink.uniforms.visOn.value = 0
    this.ink.uniforms.tVis.value = null
    this.ink.uniforms.tMem.value = null
    this.visTex.dispose()
    this.memTex.dispose()
  }
}
