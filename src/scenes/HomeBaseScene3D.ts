import * as THREE from 'three'
import { physicsWorld } from '../core/PhysicsWorld'
import { registry } from '../core/Registry'
import type { Enemy3D } from '../entities/Enemy3D'

const W      = 22    // world width  (x: -11 … +11)
const D      = 22    // world depth  (z: -11 … +11)
const WALL_H = 1.2

// 11 material pickups distributed across the chamber interior.  Persistent via registry.
// All positions are within radius 7.5 of center so the player can always reach them.
const MATERIAL_PICKUPS = [
  { id: 0,  x:  -5.0, z:  -5.0, mat: 'SilkThread',  qty: 3, color: 0xddeeff },
  { id: 1,  x:   4.0, z:  -5.5, mat: 'ChitinShard',  qty: 2, color: 0x88aa44 },
  { id: 2,  x:   6.0, z:   2.0, mat: 'WebFluid',     qty: 2, color: 0x44aaff },
  { id: 3,  x:  -2.5, z:   6.0, mat: 'SilkThread',   qty: 2, color: 0xddeeff },
  { id: 4,  x:   1.5, z:  -6.5, mat: 'ChitinShard',  qty: 3, color: 0x88aa44 },
  { id: 5,  x:  -6.0, z:   3.0, mat: 'BoneFragment', qty: 2, color: 0xccbbaa },
  { id: 6,  x:   4.0, z:   6.0, mat: 'WebFluid',     qty: 2, color: 0x44aaff },
  { id: 7,  x:  -4.5, z:  -5.5, mat: 'SilkThread',   qty: 2, color: 0xddeeff },
  { id: 8,  x:   6.5, z:  -3.0, mat: 'ChitinShard',  qty: 2, color: 0x88aa44 },
  { id: 9,  x:  -6.5, z:  -2.0, mat: 'BoneFragment', qty: 1, color: 0xccbbaa },
  { id: 10, x:   0.0, z:   6.5, mat: 'WebFluid',     qty: 1, color: 0x44aaff },
] as const

export class HomeBaseScene3D {
  static readonly LEFT   = -W / 2         // -11
  static readonly RIGHT  =  W / 2         // +11
  static readonly BACK   = -D / 2         // -11
  static readonly FRONT  =  D / 2         // +11

  static readonly WORKBENCH_X    = -5.0
  static readonly WORKBENCH_Z    = -7.5
  static readonly CARD_X         =  5.5
  static readonly CARD_Z         =  4.5
  static readonly GIFT_X         =  5.5
  static readonly GIFT_Z         = -3.0
  static readonly TOOTHPICK_X    = -3.0
  static readonly TOOTHPICK_Z    =  8.5
  static readonly OBJ_Z          =  0.0   // legacy compat (unused)
  static readonly SPAWN_X        = -8.5   // west side — returning from colony
  static readonly EXIT_TRIGGER_X = -10.2  // just inside the west portal

  enemies: Enemy3D[] = []

  toothpickAvailable = true
  cardAvailable      = true
  giftAvailable      = true

  private threeScene:     THREE.Scene
  private gradientMap:    THREE.Texture
  private tracked:        THREE.Object3D[] = []
  private toothpickGroup: THREE.Group | null = null
  private giftGroup:      THREE.Group | null = null
  private cardGroup:      THREE.Group | null = null
  private pickupMeshes:   Array<THREE.Group | null> = Array(MATERIAL_PICKUPS.length).fill(null)

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap

    physicsWorld.bounds = {
      minX: HomeBaseScene3D.LEFT  + 0.3,
      maxX: HomeBaseScene3D.RIGHT - 0.3,
      minZ: HomeBaseScene3D.BACK  + 0.3,
      maxZ: HomeBaseScene3D.FRONT - 0.3,
    }
    physicsWorld.circularBound = 10.0   // HomeBase chamber radius — keeps bodies in the circle

    this.buildGround()
    this.buildWalls()
    this.buildWorkbench()
    this.buildBirthdayArea()
    this.buildToothpickPickup()
    this.buildExitPortal()
    this.buildBlockedPortal()
    this.buildDecoration()
    this.buildPartyExtra()
    this.buildMaterialPickups()
    this.buildLighting()

    // Restore pickup state from save — remove objects the player already collected
    if (registry.get<boolean>('toothpickCollected')) this.pickupToothpick()
    if (registry.get<boolean>('webThrowerFound'))    this.collectGift()
    if (registry.get<boolean>('birthdayCardRead'))   { this.cardAvailable = false }
  }

  // ── Ground ──────────────────────────────────────────────────────────────────

  private buildGround(): void {
    // Circular floor (16-sided polygon gives a smooth den feel)
    const R = 10.5
    const mat = new THREE.MeshToonMaterial({ color: 0x3a2010, gradientMap: this.gradientMap })
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(R, 16).rotateX(-Math.PI / 2), mat)
    mesh.receiveShadow = true
    this.add(mesh)

    // Dark ring border just inside the walls
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x281508 })
    const border = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.8, R, 16).rotateX(-Math.PI / 2), borderMat
    )
    border.position.y = 0.004
    this.add(border)

    const patchMat = new THREE.MeshBasicMaterial({ color: 0x2a1808 })
    const patchPositions = [
      [-7, 3.5], [-3, -6], [2, 5], [6, -3], [-5, -2],
      [8, 2], [-8, -5], [0, -8], [4, 8], [-2, 7],
    ]
    for (const [px, pz] of patchPositions) {
      const r = 0.3 + Math.random() * 0.45
      const patch = new THREE.Mesh(new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2), patchMat)
      patch.position.set(px, 0.006, pz)
      this.add(patch)
    }
  }

  // ── Walls ───────────────────────────────────────────────────────────────────

  private buildWalls(): void {
    const wallMat = new THREE.MeshToonMaterial({ color: 0x4a2e18, gradientMap: this.gradientMap })
    const capMat  = new THREE.MeshToonMaterial({ color: 0x5a3a20, gradientMap: this.gradientMap })

    // 8 wall panels forming an octagonal chamber (radius ≈10.8)
    const R = 10.8, N = 8
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2
      const a1 = ((i + 1) / N) * Math.PI * 2
      const mx = Math.cos((a0 + a1) / 2) * R
      const mz = Math.sin((a0 + a1) / 2) * R
      const chord = 2 * R * Math.sin(Math.PI / N) + 0.2

      const panel = new THREE.Mesh(new THREE.BoxGeometry(chord, WALL_H, 0.4), wallMat)
      panel.position.set(mx, WALL_H / 2, mz)
      panel.rotation.y = -(a0 + a1) / 2
      panel.castShadow = true; panel.receiveShadow = true
      this.add(panel)

      const cap = new THREE.Mesh(new THREE.BoxGeometry(chord + 0.1, 0.12, 0.5), capMat)
      cap.position.set(mx, WALL_H + 0.06, mz)
      cap.rotation.y = panel.rotation.y
      this.add(cap)
    }

    // Stone rubble at base of walls
    const stoneMat = new THREE.MeshToonMaterial({ color: 0x3d2514, gradientMap: this.gradientMap })
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + 0.2
      const r = 9.4 + Math.random() * 0.6
      const h = 0.15 + Math.random() * 0.3
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.18), stoneMat)
      stone.position.set(Math.cos(angle) * r, h / 2 + 0.04, Math.sin(angle) * r)
      stone.rotation.y = angle
      stone.castShadow = true
      this.add(stone)
    }
  }

  // ── Workbench ────────────────────────────────────────────────────────────────

  private buildWorkbench(): void {
    const woodMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: this.gradientMap })
    const darkMat = new THREE.MeshToonMaterial({ color: 0x3b2510, gradientMap: this.gradientMap })
    const bx = HomeBaseScene3D.WORKBENCH_X
    const bz = HomeBaseScene3D.WORKBENCH_Z

    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), woodMat)
    top.position.set(bx, 0.52, bz); top.castShadow = true; this.add(top)

    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1)
    for (const [ox, oz] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) {
      const leg = new THREE.Mesh(legGeo, darkMat)
      leg.position.set(bx + ox, 0.25, bz + oz)
      this.add(leg)
    }

    const toolMat = new THREE.MeshToonMaterial({ color: 0x888866, gradientMap: this.gradientMap })
    const tool1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.12), toolMat)
    tool1.position.set(bx - 0.3, 0.62, bz - 0.1); this.add(tool1)
    const tool2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6), toolMat)
    tool2.position.set(bx + 0.2, 0.73, bz + 0.1); tool2.rotation.z = 0.3; this.add(tool2)

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
    )
    glow.position.set(bx, 0.01, bz); this.add(glow)

    const wbLight = new THREE.PointLight(0x88ffcc, 0.6, 2.5)
    wbLight.position.set(bx, 0.9, bz)
    this.add(wbLight)
  }

  // ── Birthday area ────────────────────────────────────────────────────────────

  private buildBirthdayArea(): void {
    // ── Birthday card (east-north wall) ────────────────────────────────────
    const cardGroup = new THREE.Group()
    const cardMat = new THREE.MeshToonMaterial({ color: 0xeeddbb, gradientMap: this.gradientMap })
    const cardLine = new THREE.MeshToonMaterial({ color: 0xcc4444, gradientMap: this.gradientMap })
    const cx = HomeBaseScene3D.CARD_X, ccz = HomeBaseScene3D.CARD_Z
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.04), cardMat)
    card.position.set(cx, 0.28, ccz)
    card.rotation.y = 0.15; card.castShadow = true
    cardGroup.add(card)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.05), cardLine)
    stripe.position.set(cx, 0.38, ccz + 0.01)
    stripe.rotation.y = 0.15; cardGroup.add(stripe)
    const cardGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.4, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xcc8844, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    )
    cardGlow.position.set(cx, 0.01, ccz); cardGroup.add(cardGlow)
    this.cardGroup = cardGroup
    this.threeScene.add(cardGroup); this.tracked.push(cardGroup)

    // ── Gift box (east-south wall) ──────────────────────────────────────────
    const giftGroup = new THREE.Group()
    const giftMat   = new THREE.MeshToonMaterial({ color: 0xdd4488, gradientMap: this.gradientMap })
    const ribbonMat = new THREE.MeshToonMaterial({ color: 0xffee44, gradientMap: this.gradientMap })
    const gx = HomeBaseScene3D.GIFT_X, gz = HomeBaseScene3D.GIFT_Z

    const gift = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), giftMat)
    gift.position.set(gx, 0.28, gz); gift.castShadow = true; giftGroup.add(gift)
    const ribH = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.09, 0.09), ribbonMat)
    ribH.position.set(gx, 0.28, gz); giftGroup.add(ribH)
    const ribV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.57, 0.09), ribbonMat)
    ribV.position.set(gx, 0.28, gz); giftGroup.add(ribV)
    for (const angle of [0, Math.PI / 2]) {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 12), ribbonMat)
      bow.position.set(gx, 0.62, gz)
      bow.rotation.x = Math.PI / 2; bow.rotation.z = angle; giftGroup.add(bow)
    }
    const giftGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.48, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    )
    giftGlow.position.set(gx, 0.01, gz); giftGroup.add(giftGlow)
    this.giftGroup = giftGroup
    this.threeScene.add(giftGroup); this.tracked.push(giftGroup)

    const bdLight = new THREE.PointLight(0xff88cc, 0.5, 4.5)
    bdLight.position.set(gx - 1.5, 1.2, (ccz + gz) / 2)
    this.add(bdLight)
  }

  // ── Toothpick pickup ─────────────────────────────────────────────────────────

  private buildToothpickPickup(): void {
    const bx = HomeBaseScene3D.TOOTHPICK_X
    const bz = HomeBaseScene3D.TOOTHPICK_Z

    const group = new THREE.Group()
    group.position.set(bx, 0, bz)

    const stickMat = new THREE.MeshToonMaterial({ color: 0xccaa66, gradientMap: this.gradientMap })
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 6), stickMat)
    stick.position.set(0, 0.38, 0); stick.rotation.z = 0.25; stick.castShadow = true
    group.add(stick)

    const tipMat = new THREE.MeshToonMaterial({ color: 0x886644, gradientMap: this.gradientMap })
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), tipMat)
    tip.position.set(0.06, 0.64, 0); tip.rotation.z = 0.25; group.add(tip)

    const glowMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xddcc88, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    )
    glowMesh.position.set(0, 0.01, 0); group.add(glowMesh)

    const light = new THREE.PointLight(0xddcc88, 0.5, 1.8)
    light.position.set(0, 0.6, 0); group.add(light)

    this.threeScene.add(group)
    this.tracked.push(group)
    this.toothpickGroup = group
  }

  // ── Exit portal (left — to Ant Colony) ───────────────────────────────────────

  private buildExitPortal(): void {
    const px = HomeBaseScene3D.LEFT + 0.3
    const pz = 0

    const frameMat = new THREE.MeshToonMaterial({
      color: 0x44ddff, gradientMap: this.gradientMap,
      emissive: new THREE.Color(0x006688), emissiveIntensity: 0.8,
    })

    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.12), frameMat)
    barH.position.set(px, 0.8, pz - 0.95); this.add(barH)
    const barH2 = barH.clone(); barH2.position.set(px, 0.8, pz + 0.95); this.add(barH2)
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 2.0), frameMat)
    barV.position.set(px, 1.56, pz); this.add(barV)
    const barV2 = barV.clone(); barV2.position.set(px, 0.06, pz); this.add(barV2)

    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    )
    fill.position.set(px, 0.8, pz); fill.rotation.y = Math.PI / 2; this.add(fill)

    const portalLight = new THREE.PointLight(0x44ddff, 1.0, 3.5)
    portalLight.position.set(px + 0.3, 0.8, pz)
    this.add(portalLight)

    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x88eeff })
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), arrowMat)
      arrow.position.set(px + 0.35 + i * 0.12, 0.55, pz)
      this.add(arrow)
    }
  }

  // ── Blocked portal (right — future zone, sealed) ─────────────────────────────

  private buildBlockedPortal(): void {
    const px = HomeBaseScene3D.RIGHT - 0.3
    const pz = 0

    // Dormant frame — dark gray, no emissive glow
    const frameMat = new THREE.MeshToonMaterial({ color: 0x3a3030, gradientMap: this.gradientMap })
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.12), frameMat)
    barH.position.set(px, 0.8, pz - 0.95); this.add(barH)
    const barH2 = barH.clone(); barH2.position.set(px, 0.8, pz + 0.95); this.add(barH2)
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 2.0), frameMat)
    barV.position.set(px, 1.56, pz); this.add(barV)
    const barV2 = barV.clone(); barV2.position.set(px, 0.06, pz); this.add(barV2)

    // Planks nailed across the opening
    const plankMat = new THREE.MeshToonMaterial({ color: 0x4a2e18, gradientMap: this.gradientMap })
    for (const [pz2, angle] of [[0.3, 0.18], [-0.3, -0.22], [0.0, 0.06]] as [number, number][]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.7), plankMat)
      plank.position.set(px, 0.5 + Math.abs(pz2) * 0.8, pz + pz2)
      plank.rotation.y = angle; this.add(plank)
    }

    // Cobweb over the sealed portal
    this.buildCobweb(px + 0.05, pz + 0.1, 0.8)

    // Rubble pile at base
    const rubbleMat = new THREE.MeshToonMaterial({ color: 0x3d2514, gradientMap: this.gradientMap })
    for (const [rx, rz, rs] of [[-0.15, -0.3, 0.12], [0.05, 0.25, 0.09], [-0.08, 0.0, 0.14]] as [number, number, number][]) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rs, 0), rubbleMat)
      rock.position.set(px + rx, rs * 0.5, pz + rz); this.add(rock)
    }
  }

  // ── Environmental decoration ─────────────────────────────────────────────────

  private buildDecoration(): void {
    const pebbleMat = new THREE.MeshToonMaterial({ color: 0x5a4530, gradientMap: this.gradientMap })
    const twigMat   = new THREE.MeshToonMaterial({ color: 0x6b4a1e, gradientMap: this.gradientMap })
    const fungMat   = new THREE.MeshToonMaterial({ color: 0x88aa44, gradientMap: this.gradientMap })
    const capMat    = new THREE.MeshToonMaterial({ color: 0xcc5522, gradientMap: this.gradientMap })

    const pebbleData: [number, number, number][] = [
      [-7, 4.5, 0.18], [-4, -7, 0.14], [2, 6, 0.22],
      [6, -4, 0.16], [-2, -5, 0.20], [8, 3, 0.15],
      [-8, -4, 0.19], [3, -9, 0.13], [-1, 8, 0.17],
      [0, 5, 0.16], [-5, 7, 0.12],
    ]
    for (const [px, pz, r] of pebbleData) {
      const pebble = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), pebbleMat)
      pebble.position.set(px, r * 0.6, pz)
      pebble.rotation.set(Math.random(), Math.random(), Math.random())
      pebble.castShadow = true; this.add(pebble)
    }

    for (const [tx, tz, tl, tr] of [[-6, -3, 2.2, 0.2], [3, 7, 1.8, -0.4], [7, -6, 2.0, 0.6]] as [number,number,number,number][]) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, tl, 8), twigMat)
      twig.position.set(tx, 0.07, tz)
      twig.rotation.z = Math.PI / 2; twig.rotation.y = tr
      twig.castShadow = true; this.add(twig)
    }

    for (const [fx, fz] of [[-8, 7], [-9, -6], [7, 7], [8, -7], [-1, -9]] as [number,number][]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.28, 7), fungMat)
      stem.position.set(fx, 0.14, fz); stem.castShadow = true; this.add(stem)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat)
      cap.position.set(fx, 0.3, fz); cap.castShadow = true; this.add(cap)
    }

    // Cobwebs in alcove corners
    this.buildCobweb(-9.5,  9.5, 0.9)
    this.buildCobweb( 9.5, -9.5, 0.7)
    this.buildCobweb(-9.5, -9.5, 0.6)
  }

  // ── Party decorations (extra birthday atmosphere) ────────────────────────────

  private buildPartyExtra(): void {
    const gm = this.gradientMap

    // Birthday cake — near the gift
    const cakeX = HomeBaseScene3D.GIFT_X - 1.5
    const cakeZ = HomeBaseScene3D.GIFT_Z - 1.5
    const cakeMat   = new THREE.MeshToonMaterial({ color: 0xeeaacc, gradientMap: gm })
    const icingMat  = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gm })
    const candleMat = new THREE.MeshToonMaterial({ color: 0xffee44, gradientMap: gm })
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.20, 12), cakeMat)
    bottom.position.set(cakeX, 0.10, cakeZ); bottom.castShadow = true; this.add(bottom)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 12), cakeMat)
    top.position.set(cakeX, 0.29, cakeZ); top.castShadow = true; this.add(top)
    const icing = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.03, 12), icingMat)
    icing.position.set(cakeX, 0.395, cakeZ); this.add(icing)
    for (const [cx, cz2] of [[-0.08, -0.06], [0.06, 0.08], [-0.04, 0.10]] as [number,number][]) {
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.10, 5), candleMat)
      candle.position.set(cakeX + cx, 0.45, cakeZ + cz2); this.add(candle)
    }

    // Knocked-over chair — box segments at an angle
    const chairMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: gm })
    const chX = -7.5, chZ = -2.5
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.5), chairMat)
    seat.position.set(chX, 0.15, chZ); seat.rotation.z = 1.3; seat.castShadow = true; this.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.06), chairMat)
    back.position.set(chX + 0.1, 0.15, chZ + 0.28); back.rotation.z = 1.3; this.add(back)
    for (const [lx, lz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]] as [number,number][]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), chairMat)
      leg.position.set(chX + lz, 0.1, chZ + lx); leg.rotation.z = 1.3; this.add(leg)
    }

    // Silk streamers — radially arranged around chamber
    const streamerColors = [0xff6688, 0x88eecc, 0xffee44, 0x88aaff]
    for (let i = 0; i < 6; i++) {
      const color = streamerColors[i % streamerColors.length]
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
      const angle = (i / 6) * Math.PI * 2
      const r = 8.5
      const geo = new THREE.BoxGeometry(0.06, 0.04, 2.0)
      const s   = new THREE.Mesh(geo, mat)
      s.position.set(Math.cos(angle) * r, WALL_H * 0.85, Math.sin(angle) * r)
      s.rotation.y = -angle
      this.add(s)
    }
  }

  // ── Material pickup orbs ──────────────────────────────────────────────────────

  private buildMaterialPickups(): void {
    const collected = registry.get<number[]>('pickupsCollected_HomeBaseScene') ?? []
    for (const p of MATERIAL_PICKUPS) {
      if (collected.includes(p.id)) continue

      const g = new THREE.Group()
      g.position.set(p.x, 0, p.z)

      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 6),
        new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 1.2 }),
      )
      orb.position.y = 0.30; g.add(orb)

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.36, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      )
      glow.position.y = 0.01; g.add(glow)

      // Light beam rising from orb — draws the eye from across the room
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
      )
      beam.position.y = 0.85; g.add(beam)

      this.threeScene.add(g)
      this.tracked.push(g)
      this.pickupMeshes[p.id] = g
    }
  }

  // ── Material pickup API ───────────────────────────────────────────────────────

  nearMaterialPickup(px: number, pz: number): typeof MATERIAL_PICKUPS[number] | null {
    const collected = registry.get<number[]>('pickupsCollected_HomeBaseScene') ?? []
    for (const p of MATERIAL_PICKUPS) {
      if (collected.includes(p.id)) continue
      const dx = px - p.x, dz = pz - p.z
      if (dx * dx + dz * dz < 0.5 * 0.5) return p
    }
    return null
  }

  collectMaterialPickup(id: number): void {
    const collected = registry.get<number[]>('pickupsCollected_HomeBaseScene') ?? []
    if (!collected.includes(id)) collected.push(id)
    registry.set('pickupsCollected_HomeBaseScene', collected)

    const mesh = this.pickupMeshes[id]
    if (mesh) {
      this.threeScene.remove(mesh)
      const idx = this.tracked.indexOf(mesh)
      if (idx !== -1) this.tracked.splice(idx, 1)
      this.pickupMeshes[id] = null
    }
  }

  private buildCobweb(x: number, z: number, scale: number): void {
    const webMat = new THREE.LineBasicMaterial({ color: 0xaaaacc, transparent: true, opacity: 0.5 })
    const spokes = 7
    const rings  = 3
    const pts: THREE.Vector3[] = []

    for (let s = 0; s < spokes; s++) {
      const angle = (s / spokes) * Math.PI * 2
      for (let r = 1; r <= rings; r++) {
        const r0 = (r - 1) / rings * scale
        const r1 = r       / rings * scale
        const a0 = (s / spokes) * Math.PI * 2
        const a1 = ((s + 1) % spokes / spokes) * Math.PI * 2
        pts.push(
          new THREE.Vector3(x + Math.cos(a0) * r0 * 0.6, WALL_H - r * 0.2,  z + Math.sin(a0) * r0),
          new THREE.Vector3(x + Math.cos(a0) * r1 * 0.6, WALL_H - r * 0.22, z + Math.sin(a0) * r1)
        )
        pts.push(
          new THREE.Vector3(x + Math.cos(a0) * r1 * 0.6, WALL_H - r * 0.22, z + Math.sin(a0) * r1),
          new THREE.Vector3(x + Math.cos(a1) * r1 * 0.6, WALL_H - r * 0.22, z + Math.sin(a1) * r1)
        )
      }
      pts.push(
        new THREE.Vector3(x, WALL_H, z),
        new THREE.Vector3(x + Math.cos(angle) * scale * 0.6, WALL_H * 0.35, z + Math.sin(angle) * scale)
      )
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    this.add(new THREE.LineSegments(geo, webMat))
  }

  // ── Lighting ──────────────────────────────────────────────────────────────────

  private buildLighting(): void {
    this.add(new THREE.AmbientLight(0x553322, 0.3))
    const sunCrack = new THREE.DirectionalLight(0xffcc88, 0.45)
    sunCrack.position.set(8, 10, -5)
    this.add(sunCrack)
    // Warm center lamp — makes chamber feel inhabited
    const centerLight = new THREE.PointLight(0xffaa44, 0.3, 14)
    centerLight.position.set(0, 2.0, 0)
    this.add(centerLight)
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  checkExitLeft(playerX: number): boolean {
    return playerX < HomeBaseScene3D.EXIT_TRIGGER_X
  }

  nearWorkbench(playerX: number, playerZ: number): boolean {
    const dx = playerX - HomeBaseScene3D.WORKBENCH_X
    const dz = playerZ - HomeBaseScene3D.WORKBENCH_Z
    return dx * dx + dz * dz < 0.7 * 0.7
  }

  nearToothpick(playerX: number, playerZ: number): boolean {
    if (!this.toothpickAvailable) return false
    const dx = playerX - HomeBaseScene3D.TOOTHPICK_X
    const dz = playerZ - HomeBaseScene3D.TOOTHPICK_Z
    return dx * dx + dz * dz < 0.7 * 0.7
  }

  nearBirthdayCard(playerX: number, playerZ: number): boolean {
    if (!this.cardAvailable) return false
    const dx = playerX - HomeBaseScene3D.CARD_X
    const dz = playerZ - HomeBaseScene3D.CARD_Z
    return dx * dx + dz * dz < 0.8 * 0.8
  }

  nearGift(playerX: number, playerZ: number): boolean {
    if (!this.giftAvailable) return false
    const dx = playerX - HomeBaseScene3D.GIFT_X
    const dz = playerZ - HomeBaseScene3D.GIFT_Z
    return dx * dx + dz * dz < 0.8 * 0.8
  }

  webWallHitTest(x: number, z: number): boolean {
    // Circular chamber (radius ≈10.5) — test if outside the chamber
    return x * x + z * z > 10.0 * 10.0
  }

  pickupToothpick(): void {
    this.toothpickAvailable = false
    if (this.toothpickGroup) {
      this.threeScene.remove(this.toothpickGroup)
      this.toothpickGroup.traverse(o => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose()
      })
      // Remove from tracked so destroy() doesn't double-remove
      const idx = this.tracked.indexOf(this.toothpickGroup)
      if (idx !== -1) this.tracked.splice(idx, 1)
      this.toothpickGroup = null
    }
  }

  collectCard(): void {
    this.cardAvailable = false
    if (this.cardGroup) {
      this.threeScene.remove(this.cardGroup)
      const idx = this.tracked.indexOf(this.cardGroup)
      if (idx !== -1) this.tracked.splice(idx, 1)
      this.cardGroup = null
    }
  }

  collectGift(): void {
    this.giftAvailable = false
    if (this.giftGroup) {
      this.threeScene.remove(this.giftGroup)
      const idx = this.tracked.indexOf(this.giftGroup)
      if (idx !== -1) this.tracked.splice(idx, 1)
      this.giftGroup = null
    }
  }

  // ── Enemy lifecycle (no enemies in HomeBase) ──────────────────────────────────

  updateEnemies(_delta: number, _px: number, _pz: number): void {}

  // ── Destroy ───────────────────────────────────────────────────────────────────

  destroy(): void {
    for (const obj of this.tracked) {
      this.threeScene.remove(obj)
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose()
    }
    this.tracked = []
    this.toothpickGroup = null
    physicsWorld.bounds         = null
    physicsWorld.circularBound  = null
  }

  // ── Helper ────────────────────────────────────────────────────────────────────

  private add(obj: THREE.Object3D): void {
    this.tracked.push(obj)
    this.threeScene.add(obj)
  }
}
