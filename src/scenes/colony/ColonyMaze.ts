// ─── Colony maze ──────────────────────────────────────────────────────────────
// The ant colony's layout as data: a seeded labyrinth on a tile grid, with
// rooms carved into it, plus the queries everything else needs — what's solid,
// line of sight, and pathfinding for the things that hunt you.
//
// Two grids:
//   cells — the maze graph, MCOLS × MROWS.  Each cell is 3×3 open tiles.
//   tiles — the physical grid (TILE wu square).  Cell (cx, cy) owns tiles
//           cx·4+1 … cx·4+3; the tile between two linked cells is opened.
// Tunnels are 2–3 tiles wide (organic pinches narrow some to 2), walls 1 tile.

export const TILE  = 0.8
const PITCH        = 4                       // tiles per cell (3 open + 1 wall)
export const MCOLS = 15
export const MROWS = 9
export const TW    = MCOLS * PITCH + 1       // 61 tiles
export const TH    = MROWS * PITCH + 1       // 37 tiles
export const MIN_X = -TW * TILE / 2          // −24.4
export const MIN_Z = -TH * TILE / 2          // −14.8
export const MAX_X = -MIN_X
export const MAX_Z = -MIN_Z
export const MID_ROW = 4                     // entry + boss portals sit on this cell row

export type RoomRole = 'entry' | 'boss' | 'sac' | 'nest' | 'pit' | 'crystal'
export interface Room {
  role: RoomRole
  cx0: number; cy0: number; cx1: number; cy1: number   // cell bounds (inclusive)
  x: number; z: number                                  // world centre
  w: number; d: number                                  // world size (open interior)
}

interface RoomDef { role: RoomRole; cx0: number; cy0: number; cx1: number; cy1: number; doors: number }
const ROOMS: RoomDef[] = [
  { role: 'entry',   cx0: 13, cy0: 3, cx1: 14, cy1: 5, doors: 2 },
  { role: 'boss',    cx0: 0,  cy0: 3, cx1: 1,  cy1: 5, doors: 2 },
  { role: 'nest',    cx0: 6,  cy0: 3, cx1: 8,  cy1: 5, doors: 4 },
  { role: 'sac',     cx0: 3,  cy0: 0, cx1: 4,  cy1: 1, doors: 2 },
  { role: 'sac',     cx0: 7,  cy0: 7, cx1: 8,  cy1: 8, doors: 2 },
  { role: 'sac',     cx0: 11, cy0: 0, cx1: 12, cy1: 1, doors: 2 },
  { role: 'pit',     cx0: 3,  cy0: 5, cx1: 4,  cy1: 7, doors: 2 },
  { role: 'crystal', cx0: 10, cy0: 6, cx1: 11, cy1: 7, doors: 1 },
]

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const

export class ColonyMaze {
  readonly solid = new Uint8Array(TW * TH)          // 1 = wall
  readonly rooms: Room[] = []
  readonly cellRoom = new Int16Array(MCOLS * MROWS).fill(-1)
  private east  = new Uint8Array(MCOLS * MROWS)      // link to the cell at +x
  private south = new Uint8Array(MCOLS * MROWS)      // link to the cell at +z
  readonly rand: () => number

  constructor(seed = 0x5eed_c010) {
    this.rand = mulberry32(seed)
    this.carve()
    this.braid(0.4)
    this.carveRooms()
    this.connectAll()
    this.buildTiles()
    this.pinch(0.14)
  }

  // ── Generation ──────────────────────────────────────────────────────────────
  private ci(cx: number, cy: number): number { return cy * MCOLS + cx }
  private linked(ax: number, ay: number, bx: number, by: number): boolean {
    if (bx === ax + 1) return !!this.east[this.ci(ax, ay)]
    if (bx === ax - 1) return !!this.east[this.ci(bx, by)]
    if (by === ay + 1) return !!this.south[this.ci(ax, ay)]
    if (by === ay - 1) return !!this.south[this.ci(bx, by)]
    return false
  }
  private setLink(ax: number, ay: number, bx: number, by: number, on: boolean): void {
    const v = on ? 1 : 0
    if (bx === ax + 1) this.east[this.ci(ax, ay)] = v
    else if (bx === ax - 1) this.east[this.ci(bx, by)] = v
    else if (by === ay + 1) this.south[this.ci(ax, ay)] = v
    else if (by === ay - 1) this.south[this.ci(bx, by)] = v
  }
  private neighbours(cx: number, cy: number): Array<[number, number]> {
    const out: Array<[number, number]> = []
    if (cx > 0) out.push([cx - 1, cy]); if (cx < MCOLS - 1) out.push([cx + 1, cy])
    if (cy > 0) out.push([cx, cy - 1]); if (cy < MROWS - 1) out.push([cx, cy + 1])
    return out
  }
  degree(cx: number, cy: number): number {
    return this.neighbours(cx, cy).filter(([x, y]) => this.linked(cx, cy, x, y)).length
  }
  private shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    return a
  }

  // Recursive backtracker: a perfect maze (one path between any two cells)
  private carve(): void {
    const seen = new Uint8Array(MCOLS * MROWS)
    const stack: Array<[number, number]> = [[MCOLS - 1, MID_ROW]]
    seen[this.ci(MCOLS - 1, MID_ROW)] = 1
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1]
      const open = this.shuffle(this.neighbours(cx, cy).filter(([x, y]) => !seen[this.ci(x, y)]))
      if (!open.length) { stack.pop(); continue }
      const [nx, ny] = open[0]
      this.setLink(cx, cy, nx, ny, true)
      seen[this.ci(nx, ny)] = 1
      stack.push([nx, ny])
    }
  }

  // Knock through some dead ends so the maze has loops — you can be cut off,
  // flanked, or circle back to lose a pursuer
  private braid(p: number): void {
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++) {
      if (this.degree(cx, cy) !== 1 || this.rand() > p) continue
      const opts = this.neighbours(cx, cy).filter(([x, y]) => !this.linked(cx, cy, x, y))
      if (!opts.length) continue
      opts.sort((a, b) => this.degree(a[0], a[1]) - this.degree(b[0], b[1]))   // prefer joining another dead end
      this.setLink(cx, cy, opts[0][0], opts[0][1], true)
    }
  }

  private carveRooms(): void {
    ROOMS.forEach((def, ri) => {
      for (let cy = def.cy0; cy <= def.cy1; cy++) for (let cx = def.cx0; cx <= def.cx1; cx++) {
        this.cellRoom[this.ci(cx, cy)] = ri
        if (cx < def.cx1) this.setLink(cx, cy, cx + 1, cy, true)
        if (cy < def.cy1) this.setLink(cx, cy, cx, cy + 1, true)
      }
      // Few doors: rooms are choke points you have to commit to
      const doors: Array<[number, number, number, number]> = []
      for (let cy = def.cy0; cy <= def.cy1; cy++) for (let cx = def.cx0; cx <= def.cx1; cx++) {
        for (const [nx, ny] of this.neighbours(cx, cy)) {
          const inside = nx >= def.cx0 && nx <= def.cx1 && ny >= def.cy0 && ny <= def.cy1
          if (!inside && this.linked(cx, cy, nx, ny)) doors.push([cx, cy, nx, ny])
        }
      }
      this.shuffle(doors).slice(def.doors).forEach(([a, b, c, d]) => this.setLink(a, b, c, d, false))
      const w = (def.cx1 - def.cx0 + 1) * PITCH - 1, dd = (def.cy1 - def.cy0 + 1) * PITCH - 1
      const tx0 = def.cx0 * PITCH + 1, ty0 = def.cy0 * PITCH + 1
      this.rooms.push({
        role: def.role, cx0: def.cx0, cy0: def.cy0, cx1: def.cx1, cy1: def.cy1,
        x: MIN_X + (tx0 + w / 2) * TILE, z: MIN_Z + (ty0 + dd / 2) * TILE, w: w * TILE, d: dd * TILE,
      })
    })
  }

  // Closing doors can strand a region — reopen walls until everything joins up
  private connectAll(): void {
    for (let guard = 0; guard < 200; guard++) {
      const seen = new Uint8Array(MCOLS * MROWS)
      const q: Array<[number, number]> = [[MCOLS - 1, MID_ROW]]
      seen[this.ci(MCOLS - 1, MID_ROW)] = 1
      while (q.length) {
        const [cx, cy] = q.shift()!
        for (const [nx, ny] of this.neighbours(cx, cy)) {
          if (seen[this.ci(nx, ny)] || !this.linked(cx, cy, nx, ny)) continue
          seen[this.ci(nx, ny)] = 1; q.push([nx, ny])
        }
      }
      const frontier: Array<[number, number, number, number]> = []
      for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++) {
        if (!seen[this.ci(cx, cy)]) continue
        for (const [nx, ny] of this.neighbours(cx, cy)) if (!seen[this.ci(nx, ny)]) frontier.push([cx, cy, nx, ny])
      }
      if (!frontier.length) return
      // Prefer corridor-to-corridor joins over extra room doors
      frontier.sort((a, b) => (this.cellRoom[this.ci(a[2], a[3])] >= 0 ? 1 : 0) - (this.cellRoom[this.ci(b[2], b[3])] >= 0 ? 1 : 0))
      const pick = frontier[Math.floor(this.rand() * Math.min(3, frontier.length))]
      this.setLink(pick[0], pick[1], pick[2], pick[3], true)
    }
  }

  private buildTiles(): void {
    this.solid.fill(1)
    const open = (i: number, j: number) => { this.solid[j * TW + i] = 0 }
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++) {
      const i0 = cx * PITCH + 1, j0 = cy * PITCH + 1
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) open(i0 + a, j0 + b)
      if (cx < MCOLS - 1 && this.east[this.ci(cx, cy)])  for (let b = 0; b < 3; b++) open(i0 + 3, j0 + b)
      if (cy < MROWS - 1 && this.south[this.ci(cx, cy)]) for (let a = 0; a < 3; a++) open(i0 + a, j0 + 3)
      // Room interiors: clear the pillar between four room cells
      const r = this.cellRoom[this.ci(cx, cy)]
      if (r >= 0 && cx < MCOLS - 1 && cy < MROWS - 1 &&
          this.cellRoom[this.ci(cx + 1, cy)] === r && this.cellRoom[this.ci(cx, cy + 1)] === r && this.cellRoom[this.ci(cx + 1, cy + 1)] === r) {
        open(i0 + 3, j0 + 3)
      }
    }
    // Portals through the outer wall: home (east) and the Queen's tunnel (west)
    const pj = MID_ROW * PITCH + 1
    for (let b = 0; b < 3; b++) { open(TW - 1, pj + b); open(0, pj + b) }
  }

  // Organic tunnels: randomly fill side tiles of corridors so they wind and
  // pinch to 2 tiles in places.  Never in rooms, doorways or the portal rows.
  private pinch(p: number): void {
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++) {
      if (this.cellRoom[this.ci(cx, cy)] >= 0) continue
      const i0 = cx * PITCH + 1, j0 = cy * PITCH + 1
      const ns = this.linked(cx, cy, cx, cy - 1) || this.linked(cx, cy, cx, cy + 1)
      const ew = this.linked(cx, cy, cx - 1, cy) || this.linked(cx, cy, cx + 1, cy)
      // Only straight runs (a pinch at a bend could close the turn)
      if (ns === ew) continue
      for (const k of [0, 2]) {
        if (this.rand() > p) continue
        if (ew) this.solid[(j0 + k) * TW + i0 + 1] = 1     // fill top/bottom middle tile
        else    this.solid[(j0 + 1) * TW + i0 + k] = 1     // fill left/right middle tile
      }
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  tileI(x: number): number { return Math.floor((x - MIN_X) / TILE) }
  tileJ(z: number): number { return Math.floor((z - MIN_Z) / TILE) }
  tileX(i: number): number { return MIN_X + (i + 0.5) * TILE }
  tileZ(j: number): number { return MIN_Z + (j + 0.5) * TILE }
  isSolid(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= TW || j >= TH) return true
    return this.solid[j * TW + i] === 1
  }
  isSolidAt(x: number, z: number): boolean { return this.isSolid(this.tileI(x), this.tileJ(z)) }
  cellX(cx: number): number { return MIN_X + (cx * PITCH + 2.5) * TILE }
  cellZ(cy: number): number { return MIN_Z + (cy * PITCH + 2.5) * TILE }
  cellOf(x: number, z: number): [number, number] {
    return [Math.max(0, Math.min(MCOLS - 1, Math.floor((x - MIN_X) / (PITCH * TILE)))),
            Math.max(0, Math.min(MROWS - 1, Math.floor((z - MIN_Z) / (PITCH * TILE))))]
  }
  roomAt(x: number, z: number): Room | null {
    const [cx, cy] = this.cellOf(x, z)
    const r = this.cellRoom[this.ci(cx, cy)]
    return r >= 0 ? this.rooms[r] : null
  }
  inRoom(cx: number, cy: number): boolean { return this.cellRoom[this.ci(cx, cy)] >= 0 }

  // Corridor cells (outside rooms) by shape — where the scene puts traps and loot
  deadEnds(): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++)
      if (!this.inRoom(cx, cy) && this.degree(cx, cy) === 1) out.push([cx, cy])
    return out
  }
  straights(): Array<[number, number, 'ns' | 'ew']> {
    const out: Array<[number, number, 'ns' | 'ew']> = []
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++) {
      if (this.inRoom(cx, cy) || this.degree(cx, cy) !== 2) continue
      if (this.linked(cx, cy, cx - 1, cy) && this.linked(cx, cy, cx + 1, cy)) out.push([cx, cy, 'ew'])
      else if (this.linked(cx, cy, cx, cy - 1) && this.linked(cx, cy, cx, cy + 1)) out.push([cx, cy, 'ns'])
    }
    return out
  }
  junctions(): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (let cy = 0; cy < MROWS; cy++) for (let cx = 0; cx < MCOLS; cx++)
      if (!this.inRoom(cx, cy) && this.degree(cx, cy) >= 3) out.push([cx, cy])
    return out
  }
  // The neighbour a dead end opens toward
  openSide(cx: number, cy: number): [number, number] | null {
    for (const [nx, ny] of this.neighbours(cx, cy)) if (this.linked(cx, cy, nx, ny)) return [nx - cx, ny - cy]
    return null
  }

  // Line of sight through open tiles (DDA).  `radius` > 0 also tests two
  // parallel lines either side, so a body that wide fits along it.
  los(x0: number, z0: number, x1: number, z1: number, radius = 0): boolean {
    if (!this.ray(x0, z0, x1, z1)) return false
    if (radius <= 0) return true
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1
    const ox = -dz / l * radius, oz = dx / l * radius
    return this.ray(x0 + ox, z0 + oz, x1 + ox, z1 + oz) && this.ray(x0 - ox, z0 - oz, x1 - ox, z1 - oz)
  }
  private ray(x0: number, z0: number, x1: number, z1: number): boolean {
    let i = this.tileI(x0), j = this.tileJ(z0)
    const ie = this.tileI(x1), je = this.tileJ(z1)
    const dx = x1 - x0, dz = z1 - z0
    const si = Math.sign(dx), sj = Math.sign(dz)
    const tdx = si !== 0 ? TILE / Math.abs(dx) : Infinity
    const tdz = sj !== 0 ? TILE / Math.abs(dz) : Infinity
    let tx = si > 0 ? (MIN_X + (i + 1) * TILE - x0) / dx : si < 0 ? (MIN_X + i * TILE - x0) / dx : Infinity
    let tz = sj > 0 ? (MIN_Z + (j + 1) * TILE - z0) / dz : sj < 0 ? (MIN_Z + j * TILE - z0) / dz : Infinity
    for (let n = 0; n < 200; n++) {
      if (this.isSolid(i, j)) return false
      if (i === ie && j === je) return true
      if (tx < tz) { tx += tdx; i += si } else { tz += tdz; j += sj }
    }
    return true
  }

  // Visible tiles from a point: casts `rays` rays out to `range` wu and calls
  // mark(index) for every open tile crossed and the wall tile that stops it.
  castVision(x: number, z: number, range: number, rays: number, mark: (idx: number) => void): void {
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2
      const dx = Math.cos(a), dz = Math.sin(a)
      let i = this.tileI(x), j = this.tileJ(z)
      const si = Math.sign(dx), sj = Math.sign(dz)
      const tdx = si !== 0 ? TILE / Math.abs(dx) : Infinity
      const tdz = sj !== 0 ? TILE / Math.abs(dz) : Infinity
      let tx = si > 0 ? (MIN_X + (i + 1) * TILE - x) / dx : si < 0 ? (MIN_X + i * TILE - x) / dx : Infinity
      let tz = sj > 0 ? (MIN_Z + (j + 1) * TILE - z) / dz : sj < 0 ? (MIN_Z + j * TILE - z) / dz : Infinity
      let t = 0
      while (t < range) {
        if (i < 0 || j < 0 || i >= TW || j >= TH) break
        mark(j * TW + i)
        if (this.solid[j * TW + i]) break
        if (tx < tz) { t = tx; tx += tdx; i += si } else { t = tz; tz += tdz; j += sj }
      }
    }
  }

  // ── Pathfinding ─────────────────────────────────────────────────────────────
  // A distance field over open tiles (8-way, no corner cutting) toward a goal.
  // The flow toward the player is shared by every chaser and only rebuilt when
  // the player changes tile; one-off goals (a noise, a patrol point) get their
  // own field.
  private flow = new Int32Array(TW * TH)
  private flowGoal = -1

  private buildField(field: Int32Array, gi: number, gj: number): void {
    field.fill(-1)
    if (this.isSolid(gi, gj)) {
      // Goal in a wall (a body hugging it): start from the nearest open tile
      let best = -1, bd = 1e9
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (!this.isSolid(gi + di, gj + dj) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = (gj + dj) * TW + gi + di }
      }
      if (best < 0) return
      gi = best % TW; gj = Math.floor(best / TW)
    }
    const q = new Int32Array(TW * TH)
    let qh = 0, qt = 0
    field[gj * TW + gi] = 0; q[qt++] = gj * TW + gi
    while (qh < qt) {
      const idx = q[qh++], i = idx % TW, j = (idx - i) / TW, d = field[idx]
      for (const [di, dj] of N8) {
        const ni = i + di, nj = j + dj
        if (this.isSolid(ni, nj)) continue
        if (di !== 0 && dj !== 0 && (this.isSolid(i + di, j) || this.isSolid(i, j + dj))) continue
        const nidx = nj * TW + ni
        if (field[nidx] >= 0) continue
        field[nidx] = d + (di !== 0 && dj !== 0 ? 14 : 10)   // ×10 tile units
        q[qt++] = nidx
      }
    }
  }

  setGoal(x: number, z: number): void {
    const gi = this.tileI(x), gj = this.tileJ(z)
    const g = gj * TW + gi
    if (g === this.flowGoal) return
    this.flowGoal = g
    this.buildField(this.flow, gi, gj)
  }

  // Path length (wu) from (x, z) to the current goal, or Infinity if unreachable
  goalDistance(x: number, z: number): number {
    const d = this.flow[this.tileJ(z) * TW + this.tileI(x)]
    return d < 0 ? Infinity : (d / 10) * TILE
  }

  // Steering target toward the goal: follow the field downhill and return the
  // furthest point along it that's still in straight sight (string pulling).
  seek(x: number, z: number, radius: number, field: Int32Array = this.flow): { x: number; z: number; dist: number } | null {
    let i = this.tileI(x), j = this.tileJ(z)
    let d0 = field[j * TW + i]
    if (d0 < 0) {
      // Standing on a wall-edge tile: step to the best open neighbour first
      let best = -1
      for (const [di, dj] of N8) { const v = field[(j + dj) * TW + i + di]; if (v >= 0 && (best < 0 || v < field[best])) best = (j + dj) * TW + i + di }
      if (best < 0) return null
      i = best % TW; j = Math.floor(best / TW); d0 = field[best]
    }
    let tx = this.tileX(i), tz = this.tileZ(j)
    for (let step = 0; step < 14; step++) {
      let best = -1, bv = field[j * TW + i]
      if (bv === 0) break
      for (const [di, dj] of N8) {
        const ni = i + di, nj = j + dj
        if (this.isSolid(ni, nj)) continue
        if (di !== 0 && dj !== 0 && (this.isSolid(i + di, j) || this.isSolid(i, j + dj))) continue
        const v = field[nj * TW + ni]
        if (v >= 0 && v < bv) { bv = v; best = nj * TW + ni }
      }
      if (best < 0) break
      const ni = best % TW, nj = (best - ni) / TW
      const nx = this.tileX(ni), nz = this.tileZ(nj)
      if (step > 0 && !this.los(x, z, nx, nz, radius)) break
      i = ni; j = nj; tx = nx; tz = nz
    }
    return { x: tx, z: tz, dist: (d0 / 10) * TILE }
  }

  // One-off path field toward an arbitrary goal (noise, patrol point, search)
  fieldTo(x: number, z: number): Int32Array {
    const f = new Int32Array(TW * TH)
    this.buildField(f, this.tileI(x), this.tileJ(z))
    return f
  }
  fieldDistance(field: Int32Array, x: number, z: number): number {
    const d = field[this.tileJ(z) * TW + this.tileI(x)]
    return d < 0 ? Infinity : (d / 10) * TILE
  }

  // Merged wall rectangles (greedy), for meshes and colliders
  wallRects(): Array<{ i0: number; j0: number; i1: number; j1: number }> {
    const used = new Uint8Array(TW * TH)
    const out: Array<{ i0: number; j0: number; i1: number; j1: number }> = []
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      if (!this.solid[j * TW + i] || used[j * TW + i]) continue
      let i1 = i
      while (i1 + 1 < TW && this.solid[j * TW + i1 + 1] && !used[j * TW + i1 + 1]) i1++
      let j1 = j
      outer: while (j1 + 1 < TH) {
        for (let k = i; k <= i1; k++) if (!this.solid[(j1 + 1) * TW + k] || used[(j1 + 1) * TW + k]) break outer
        j1++
      }
      for (let jj = j; jj <= j1; jj++) for (let k = i; k <= i1; k++) used[jj * TW + k] = 1
      out.push({ i0: i, j0: j, i1, j1 })
    }
    return out
  }
}
