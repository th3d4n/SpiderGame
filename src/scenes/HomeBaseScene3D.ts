import * as THREE from 'three'
import { physicsWorld, type CollisionBody } from '../core/PhysicsWorld'
import { registry } from '../core/Registry'
import type { Enemy3D } from '../entities/Enemy3D'
import { audio } from '../systems/AudioManager'
import { DEN_SCALE, PROP_SCALE } from '../env/denScale'
import { buildAntColonyEntrance } from '../env/AntColonyEntrance'
import {
  buildDenMaterials,
  type DenMaterials,
  buildDenFloor,
  buildBurrowWalls,
  buildSilkArchitecture,
  buildJunkFurniture,
  buildInventions,
  buildBirthdayBash,
  buildAttackEvidence,
  buildExits,
  type DenHandles,
} from './DenBuilder'

const W      = 110   // world width  (x: -55 … +55)  — 22 × DEN_SCALE
const D      = 110   // world depth  (z: -55 … +55)
const WALL_H = 6.0   // octagon wall height — 1.2 × DEN_SCALE

// Round 6 Issue 9: procedural dirt/wall noise textures for organic surface variation
function createNoiseTexture(
  size: number,
  baseR: number, baseG: number, baseB: number,
  amplitude: number,
  repeat = 4,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const n = Math.random() * amplitude
    data[i * 4 + 0] = Math.min(255, baseR + n)
    data[i * 4 + 1] = Math.min(255, baseG + n * 0.6)
    data[i * 4 + 2] = Math.min(255, baseB + n * 0.3)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.needsUpdate = true
  return tex
}

// 11 material pickups distributed across the chamber interior.  Persistent via registry.
// All positions are within radius 7.5 of center so the player can always reach them.
// Pickups are part of the home cluster — positions ×LIFE_SCALE (≈2.08).
// Their geometry stays Webbs-sized (see buildMaterialPickups — no size scaling).
const MATERIAL_PICKUPS = [
  { id: 0,  x: -10.4,  z: -10.4,  mat: 'SilkThread',  qty: 3, color: 0xddeeff },
  { id: 1,  x:   8.32, z: -11.44, mat: 'ChitinShard',  qty: 2, color: 0x88aa44 },
  { id: 2,  x:  12.48, z:   4.16, mat: 'WebFluid',     qty: 2, color: 0x44aaff },
  { id: 3,  x:  -5.2,  z:  12.48, mat: 'SilkThread',   qty: 2, color: 0xddeeff },
  { id: 4,  x:   3.12, z: -13.52, mat: 'ChitinShard',  qty: 3, color: 0x88aa44 },
  { id: 5,  x: -12.48, z:   6.24, mat: 'BoneFragment', qty: 2, color: 0xccbbaa },
  { id: 6,  x:   8.32, z:  12.48, mat: 'WebFluid',     qty: 2, color: 0x44aaff },
  { id: 7,  x:  -9.36, z: -11.44, mat: 'SilkThread',   qty: 2, color: 0xddeeff },
  { id: 8,  x:  13.52, z:  -6.24, mat: 'ChitinShard',  qty: 2, color: 0x88aa44 },
  { id: 9,  x: -13.52, z:  -4.16, mat: 'BoneFragment', qty: 1, color: 0xccbbaa },
  { id: 10, x:   0.0,  z:  13.52, mat: 'WebFluid',     qty: 1, color: 0x44aaff },
] as const

export class HomeBaseScene3D {
  static readonly LEFT   = -W / 2         // -11
  static readonly RIGHT  =  W / 2         // +11
  static readonly BACK   = -D / 2         // -11
  static readonly FRONT  =  D / 2         // +11

  // Interactables/props live in the LIFE cluster (× LIFE_SCALE ≈ 2.08), NOT the
  // full den radius — keeps the home intimate inside the big room.
  static readonly WORKBENCH_X    = -10.4   // -5.0  × LIFE_SCALE
  static readonly WORKBENCH_Z    = -15.6   // -7.5  × LIFE_SCALE
  static readonly CARD_X         =  11.44  //  5.5  × LIFE_SCALE
  static readonly CARD_Z         =   9.36  //  4.5  × LIFE_SCALE
  static readonly GIFT_X         =  11.44  //  5.5  × LIFE_SCALE
  static readonly GIFT_Z         =  -6.24  // -3.0  × LIFE_SCALE
  static readonly TOOTHPICK_X    =  -6.24  // -3.0  × LIFE_SCALE
  static readonly TOOTHPICK_Z    =  17.68  //  8.5  × LIFE_SCALE
  static readonly OBJ_Z          =   0.0   // legacy compat (unused)
  static readonly SPAWN_X        = -17.68  // -8.5  × LIFE_SCALE — spawn inside the home
  static readonly EXIT_TRIGGER_X = -50.5   // stays at full den scale (the real exit)
  static readonly INTERACT_R     =   3.5   // proximity radius for E-prompts + glint

  enemies:           Enemy3D[]           = []
  warmPools:         THREE.PointLight[]  = []   // exposed for per-frame flicker in main.ts
  denHandles!:       DenHandles               // exposed for SurvivorsProgression
  antEntranceGroup!: THREE.Group              // exposed for CameraOccluder registration
  exitTriggerX:      number = HomeBaseScene3D.EXIT_TRIGGER_X  // updated by buildAntColonyEntrance

  toothpickAvailable = true
  cardAvailable      = true
  giftAvailable      = true

  // Three-clue struggle trail (center → path → threshold). Found-state persists via registry.
  private clues: Array<{ x: number; z: number; text: string }> = [
    { x: -4.16, z:  6.24,
      text: "The little one's cradle. Still warm. Whatever came, it went for the smallest first." },
    { x:  8.32, z: -4.16,
      text: "Silk, but not ours — spun to bind, not to rest. They wrapped the colony like prey and dragged them off." },
    { x: -48.96, z: 0,
      text: "A bristle — coarse, barbed, the length of my leg. No spider sheds this. Whatever took them went this way. So do I." },
  ]

  private threeScene:     THREE.Scene
  private gradientMap:    THREE.Texture
  private tracked:        THREE.Object3D[] = []
  private toothpickGroup: THREE.Group | null = null
  private giftGroup:      THREE.Group | null = null
  private cardGroup:      THREE.Group | null = null
  private pickupMeshes:   Array<THREE.Group | null> = Array(MATERIAL_PICKUPS.length).fill(null)
  private staticBodies:   CollisionBody[] = []   // stones + doorframe posts

  // Proximity glint — interactables ramp emissive as Webbs nears.
  private glinters: Array<{
    x: number; z: number
    mat: THREE.MeshStandardMaterial | THREE.MeshToonMaterial
    available?: () => boolean
  }> = []

  constructor(threeScene: THREE.Scene, gradientMap: THREE.Texture) {
    this.threeScene  = threeScene
    this.gradientMap = gradientMap

    audio.playLoop('amb_homebase')   // Round 10 — peaceful den ambience

    physicsWorld.bounds = {
      minX: HomeBaseScene3D.LEFT  + 0.3,
      maxX: HomeBaseScene3D.RIGHT - 0.3,
      minZ: HomeBaseScene3D.BACK  + 0.3,
      maxZ: HomeBaseScene3D.FRONT - 0.3,
    }
    physicsWorld.circularBound = 50.0   // HomeBase chamber radius (10.0 × DEN_SCALE)

    // Build the shared material palette (uses the scene's gradientMap for
    // consistent toon banding) and bind the tracked add helper once.
    const denMat = buildDenMaterials(this.gradientMap)
    const add    = this.add.bind(this)

    // ── Terrain & structure ───────────────────────────────────────────────────
    buildDenFloor(denMat, add)
    this.buildWalls()                              // physics octagon + doorframe + glow
    const walls = buildBurrowWalls(denMat, add)    // organic visual mounds over physics walls

    // ── Gameplay objects (positions unchanged) ────────────────────────────────
    this.buildWorkbench()
    this.buildBirthdayArea()         // card + gift pickup objects — keep untouched
    this.buildToothpickPickup()
    // Fix 3: replace old flat portal frame with sculpted entrance
    const ent = buildAntColonyEntrance(denMat, add)
    this.exitTriggerX     = ent.triggerX
    this.antEntranceGroup = ent.group

    // ── Environmental dressing ────────────────────────────────────────────────
    this.buildDecoration()           // pebbles, twigs, fungi, cobwebs — kept
    const silk   = buildSilkArchitecture(denMat, add)
    const junk   = buildJunkFurniture(denMat, add)
    const invent = buildInventions(denMat, add)
    const bash   = buildBirthdayBash(denMat, add)
    const attack = buildAttackEvidence(denMat, add)
    const exits  = buildExits(denMat, add)

    // Collect handles for SurvivorsProgression (must be set before scene is returned)
    this.denHandles = { mat: denMat, walls, silk, junk, invent, bash, attack, exits }

    this.buildMaterialPickups()
    this.buildClues(denMat)
    this.buildLighting()

    // Restore pickup state from save — remove objects the player already collected
    if (registry.get<boolean>('toothpickCollected')) this.pickupToothpick()
    if (registry.get<boolean>('webThrowerFound'))    this.collectGift()
    if (registry.get<boolean>('birthdayCardRead'))   { this.cardAvailable = false }
  }

  // ── Walls ───────────────────────────────────────────────────────────────────

  private buildWalls(): void {
    // Round 6 Issue 9: textured walls with dirt-noise diffuse map
    const wallTex = createNoiseTexture(64, 74, 46, 24, 36, 4)
    const wallMat = new THREE.MeshToonMaterial({
      color: 0xffffff, map: wallTex, gradientMap: this.gradientMap,
    })
    const capMat  = new THREE.MeshToonMaterial({ color: 0x5a3a20, gradientMap: this.gradientMap })

    // 8-panel octagon.  Panels 3 (135°–180°) and 4 (180°–225°) are SKIPPED to create
    // a symmetric 90° doorway centered exactly on the west vertex where the exit stands.
    const R = 53.5, N = 8   // 10.8 × DEN_SCALE
    const EXIT_PANELS = new Set([3, 4])   // two panels flanking the 180° west vertex

    for (let i = 0; i < N; i++) {
      if (EXIT_PANELS.has(i)) continue   // doorway opening — no panel here

      const a0 = (i / N) * Math.PI * 2
      const a1 = ((i + 1) / N) * Math.PI * 2
      const mx = Math.cos((a0 + a1) / 2) * R
      const mz = Math.sin((a0 + a1) / 2) * R
      const chord = 2 * R * Math.sin(Math.PI / N) + 0.2

      const panel = new THREE.Mesh(new THREE.BoxGeometry(chord, WALL_H, 2.0), wallMat)  // 0.4 × DEN_SCALE
      panel.position.set(mx, WALL_H / 2, mz)
      panel.rotation.y = -(a0 + a1) / 2
      panel.castShadow = true; panel.receiveShadow = true
      this.add(panel)

      const cap = new THREE.Mesh(new THREE.BoxGeometry(chord + 0.5, 0.6, 2.5), capMat)  // 0.1/0.12/0.5 × DEN_SCALE
      cap.position.set(mx, WALL_H + 0.06, mz)
      cap.rotation.y = panel.rotation.y
      this.add(cap)
    }

    // Doorframe — visual frame for the west exit opening
    const frameMat = new THREE.MeshToonMaterial({
      color: 0x88aaff, gradientMap: this.gradientMap,
      emissive: new THREE.Color(0x224488), emissiveIntensity: 0.6,
    })
    // Two vertical posts at the north/south edges of the doorway (z = ±22.3 ≈ ±4.5 × DEN_SCALE)
    const post1 = new THREE.Mesh(new THREE.BoxGeometry(1.0, WALL_H, 1.0), frameMat)
    post1.position.set(-49.5, WALL_H / 2, -22.3)
    this.add(post1)
    const post2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, WALL_H, 1.0), frameMat)
    post2.position.set(-49.5, WALL_H / 2,  22.3)
    this.add(post2)
    this.staticBodies.push(physicsWorld.add({
      x: -49.5, z: -22.3, radius: 0.89,   // 0.18 × DEN_SCALE
      velocity: { x: 0, z: 0 }, isStatic: true, enabled: true,
    }))
    this.staticBodies.push(physicsWorld.add({
      x: -49.5, z:  22.3, radius: 0.89,
      velocity: { x: 0, z: 0 }, isStatic: true, enabled: true,
    }))
    // Lintel across the top
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 45.5), frameMat)
    lintel.position.set(-49.5, WALL_H, 0)
    this.add(lintel)
    // Exit glow light
    const exitLight = new THREE.PointLight(0x88aaff, 1.4, 30.0)
    exitLight.position.set(-52.0, 4.0, 0)
    this.add(exitLight)

    // Stone rubble at base of walls (skip arc near the doorway: avoid 150°–210°)
    const stoneMat = new THREE.MeshToonMaterial({ color: 0x3d2514, gradientMap: this.gradientMap })
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + 0.2
      const angleDeg = (angle * 180 / Math.PI) % 360
      if (angleDeg >= 135 && angleDeg <= 225) continue
      const r  = (9.4 + Math.random() * 0.6) * DEN_SCALE   // 46.5 + rand * 3.0
      const h  = (0.15 + Math.random() * 0.3) * DEN_SCALE
      const sx = Math.cos(angle) * r
      const sz = Math.sin(angle) * r
      const stone = new THREE.Mesh(new THREE.BoxGeometry(4.0, h, 0.89), stoneMat)
      stone.position.set(sx, h / 2 + 0.04, sz)
      stone.rotation.y = angle
      stone.castShadow = true
      this.add(stone)
      this.staticBodies.push(physicsWorld.add({
        x: sx, z: sz, radius: 1.58,   // 0.32 × DEN_SCALE
        velocity: { x: 0, z: 0 }, isStatic: true, enabled: true,
      }))
    }
  }

  // ── Workbench ────────────────────────────────────────────────────────────────

  private buildWorkbench(): void {
    const woodMat = new THREE.MeshToonMaterial({ color: 0x5c3d1e, gradientMap: this.gradientMap })
    const darkMat = new THREE.MeshToonMaterial({ color: 0x3b2510, gradientMap: this.gradientMap })
    const bx = HomeBaseScene3D.WORKBENCH_X
    const bz = HomeBaseScene3D.WORKBENCH_Z

    const P = PROP_SCALE
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4*P, 0.12*P, 0.9*P), woodMat)
    top.position.set(bx, 0.52*P, bz); top.castShadow = true; this.add(top)

    const legGeo = new THREE.BoxGeometry(0.1*P, 0.5*P, 0.1*P)
    for (const [ox, oz] of [[-0.6*P, -0.35*P], [0.6*P, -0.35*P], [-0.6*P, 0.35*P], [0.6*P, 0.35*P]]) {
      const leg = new THREE.Mesh(legGeo, darkMat)
      leg.position.set(bx + ox, 0.25*P, bz + oz)
      this.add(leg)
    }

    const toolMat = new THREE.MeshToonMaterial({ color: 0x888866, gradientMap: this.gradientMap })
    const tool1 = new THREE.Mesh(new THREE.BoxGeometry(0.25*P, 0.08*P, 0.12*P), toolMat)
    tool1.position.set(bx - 0.3*P, 0.62*P, bz - 0.1*P); this.add(tool1)
    const tool2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03*P, 0.04*P, 0.3*P, 6), toolMat)
    tool2.position.set(bx + 0.2*P, 0.73*P, bz + 0.1*P); tool2.rotation.z = 0.3; this.add(tool2)

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.6*P, 0.75*P, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
    )
    glow.position.set(bx, 0.01, bz); this.add(glow)

    const wbLight = new THREE.PointLight(0x88ffcc, 0.6, 12.4)  // 2.5 × DEN_SCALE
    wbLight.position.set(bx, 0.9*P, bz)
    this.add(wbLight)

    this.addGlint(bx, bz, woodMat)
  }

  // ── Birthday area ────────────────────────────────────────────────────────────

  private buildBirthdayArea(): void {
    // ── Birthday card (east-north wall) ────────────────────────────────────
    const cardGroup = new THREE.Group()
    const cardMat = new THREE.MeshToonMaterial({ color: 0xeeddbb, gradientMap: this.gradientMap })
    const cardLine = new THREE.MeshToonMaterial({ color: 0xcc4444, gradientMap: this.gradientMap })
    const cx = HomeBaseScene3D.CARD_X, ccz = HomeBaseScene3D.CARD_Z
    const P = PROP_SCALE
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.35*P, 0.5*P, 0.04*P), cardMat)
    card.position.set(cx, 0.28*P, ccz)
    card.rotation.y = 0.15; card.castShadow = true
    cardGroup.add(card)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.35*P, 0.06*P, 0.05*P), cardLine)
    stripe.position.set(cx, 0.38*P, ccz + 0.01*P)
    stripe.rotation.y = 0.15; cardGroup.add(stripe)
    const cardGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.3*P, 0.4*P, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xcc8844, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    )
    cardGlow.position.set(cx, 0.01, ccz); cardGroup.add(cardGlow)
    this.cardGroup = cardGroup
    this.threeScene.add(cardGroup); this.tracked.push(cardGroup)
    this.addGlint(cx, ccz, cardMat, () => this.cardAvailable)

    // ── Gift box (east-south wall) ──────────────────────────────────────────
    const giftGroup = new THREE.Group()
    const giftMat   = new THREE.MeshToonMaterial({ color: 0xdd4488, gradientMap: this.gradientMap })
    const ribbonMat = new THREE.MeshToonMaterial({ color: 0xffee44, gradientMap: this.gradientMap })
    const gx = HomeBaseScene3D.GIFT_X, gz = HomeBaseScene3D.GIFT_Z

    const gift = new THREE.Mesh(new THREE.BoxGeometry(0.55*P, 0.55*P, 0.55*P), giftMat)
    gift.position.set(gx, 0.28*P, gz); gift.castShadow = true; giftGroup.add(gift)
    const ribH = new THREE.Mesh(new THREE.BoxGeometry(0.57*P, 0.09*P, 0.09*P), ribbonMat)
    ribH.position.set(gx, 0.28*P, gz); giftGroup.add(ribH)
    const ribV = new THREE.Mesh(new THREE.BoxGeometry(0.09*P, 0.57*P, 0.09*P), ribbonMat)
    ribV.position.set(gx, 0.28*P, gz); giftGroup.add(ribV)
    for (const angle of [0, Math.PI / 2]) {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1*P, 0.035*P, 6, 12), ribbonMat)
      bow.position.set(gx, 0.62*P, gz)
      bow.rotation.x = Math.PI / 2; bow.rotation.z = angle; giftGroup.add(bow)
    }
    const giftGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.35*P, 0.48*P, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    )
    giftGlow.position.set(gx, 0.01, gz); giftGroup.add(giftGlow)
    this.giftGroup = giftGroup
    this.threeScene.add(giftGroup); this.tracked.push(giftGroup)
    this.addGlint(gx, gz, giftMat, () => this.giftAvailable)

    const bdLight = new THREE.PointLight(0xff88cc, 0.5, 22.3)   // 4.5 × DEN_SCALE
    bdLight.position.set(gx - 1.5*P, 1.2*P, (ccz + gz) / 2)
    this.add(bdLight)
  }

  // ── Toothpick pickup ─────────────────────────────────────────────────────────

  private buildToothpickPickup(): void {
    const bx = HomeBaseScene3D.TOOTHPICK_X
    const bz = HomeBaseScene3D.TOOTHPICK_Z

    const group = new THREE.Group()
    group.position.set(bx, 0, bz)

    const stickMat = new THREE.MeshToonMaterial({ color: 0xccaa66, gradientMap: this.gradientMap })
    // Weapon pickup — geometry stays Webbs-sized; only position is clustered.
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

    const light = new THREE.PointLight(0xddcc88, 0.5, 4.5)
    light.position.set(0, 0.6, 0); group.add(light)

    this.threeScene.add(group)
    this.tracked.push(group)
    this.toothpickGroup = group
    this.addGlint(bx, bz, stickMat, () => this.toothpickAvailable)
  }

  // ── Environmental decoration ─────────────────────────────────────────────────

  private buildDecoration(): void {
    const pebbleMat = new THREE.MeshToonMaterial({ color: 0x5a4530, gradientMap: this.gradientMap })
    const twigMat   = new THREE.MeshToonMaterial({ color: 0x6b4a1e, gradientMap: this.gradientMap })
    const fungMat   = new THREE.MeshToonMaterial({ color: 0x88aa44, gradientMap: this.gradientMap })
    const capMat    = new THREE.MeshToonMaterial({ color: 0xcc5522, gradientMap: this.gradientMap })

    // Positions ×DEN_SCALE, radii ×PROP_SCALE
    const pebbleData: [number, number, number][] = [
      [-34.7, 22.3, 0.67], [-19.8, -34.7, 0.52], [9.9, 29.7, 0.82],
      [29.7, -19.8, 0.59], [-9.9, -24.75, 0.74], [39.6, 14.85, 0.56],
      [-39.6, -19.8, 0.71], [14.85, -44.6, 0.48], [-4.95, 39.6, 0.63],
      [0, 24.75, 0.59], [-24.75, 34.65, 0.45],
    ]
    for (const [px, pz, r] of pebbleData) {
      const pebble = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), pebbleMat)
      pebble.position.set(px, r * 0.6, pz)
      pebble.rotation.set(Math.random(), Math.random(), Math.random())
      pebble.castShadow = true; this.add(pebble)
    }

    // Positions ×DEN_SCALE, lengths ×PROP_SCALE, radii ×PROP_SCALE
    for (const [tx, tz, tl, tr] of [[-29.7, -14.85, 8.15, 0.2], [14.85, 34.65, 6.68, -0.4], [34.65, -29.7, 7.43, 0.6]] as [number,number,number,number][]) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, tl, 8), twigMat)
      twig.position.set(tx, 0.07, tz)
      twig.rotation.z = Math.PI / 2; twig.rotation.y = tr
      twig.castShadow = true; this.add(twig)
    }

    // Positions ×DEN_SCALE, sizes ×PROP_SCALE
    for (const [fx, fz] of [[-39.6, 34.65], [-44.6, -29.7], [34.65, 34.65], [39.6, -34.65], [-4.95, -44.6]] as [number,number][]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.04, 7), fungMat)
      stem.position.set(fx, 0.52, fz); stem.castShadow = true; this.add(stem)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.67, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat)
      cap.position.set(fx, 1.11, fz); cap.castShadow = true; this.add(cap)
    }

    // Cobwebs in alcove corners — positions ×DEN_SCALE, scale ×PROP_SCALE
    this.buildCobweb(-47.0,  47.0, 0.9 * PROP_SCALE)
    this.buildCobweb( 47.0, -47.0, 0.7 * PROP_SCALE)
    this.buildCobweb(-47.0, -47.0, 0.6 * PROP_SCALE)
  }

  // ── Attack damage (Round 6 Issue 9) ───────────────────────────────────────────
  // Replaced by buildAttackEvidence() in DenBuilder — kept as tombstone comment.

  // ── Material pickup orbs ──────────────────────────────────────────────────────

  private buildMaterialPickups(): void {
    const collected = registry.get<number[]>('pickupsCollected_HomeBaseScene') ?? []
    for (const p of MATERIAL_PICKUPS) {
      if (collected.includes(p.id)) continue

      const g = new THREE.Group()
      g.position.set(p.x, 0, p.z)

      // Pickup geometry stays Webbs-sized (NOT scaled) — only the position clusters.
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
      if (dx * dx + dz * dz < 2.5 * 2.5) return p   // 0.5 × DEN_SCALE
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

  // ── Clue trail — three struggle clues: who / how / what took the colony ───────
  private buildClues(mat: DenMaterials): void {
    // Clue 0 — Overturned Cradle (center, by the hearth)
    {
      const c = this.clues[0]
      const g = new THREE.Group(); g.position.set(c.x, 0, c.z)
      const bowlMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.6, side: THREE.DoubleSide })
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bowlMat)
      bowl.rotation.z = Math.PI / 2          // tipped on its side
      bowl.position.set(0, 0.45, 0); bowl.castShadow = true
      g.add(bowl)
      const toy = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.30, 10), mat.acornCap)
      toy.position.set(0.55, 0.15, 0.2); toy.rotation.z = 2.2; toy.castShadow = true
      g.add(toy)
      this.add(g)
      this.addGlint(c.x, c.z, bowlMat)
    }
    // Clue 1 — Drag-Sac (midway, aligned with the drag marks toward the exit)
    {
      const c = this.clues[1]
      const g = new THREE.Group(); g.position.set(c.x, 0, c.z)
      const sacMat = new THREE.MeshStandardMaterial({ color: 0xcabfa8, roughness: 0.7, transparent: true, opacity: 0.9 })
      const sac = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), sacMat)
      sac.scale.set(0.7, 0.7, 1.7)           // elongated, torn cocoon
      sac.position.y = 0.4; sac.rotation.y = 0.5; sac.castShadow = true
      g.add(sac)
      this.add(g)
      this.addGlint(c.x, c.z, sacMat)
    }
    // Clue 2 — Snagged Bristle (the threshold, at the ant entrance mouth)
    {
      const c = this.clues[2]
      const g = new THREE.Group(); g.position.set(c.x, 0, c.z)
      const brMat = new THREE.MeshStandardMaterial({ color: 0xb8a890, roughness: 0.5, metalness: 0.1 })
      const bristle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.05, 1.6, 6), brMat)
      bristle.position.set(0, 1.0, 0); bristle.rotation.set(0.5, 0, 0.7)   // snagged at an angle
      bristle.castShadow = true
      g.add(bristle)
      this.add(g)
      this.addGlint(c.x, c.z, brMat)
    }
  }

  // Returns clue index near the player, or -1.  Mirrors the near* interactables.
  nearClue(px: number, pz: number): number {
    const r = HomeBaseScene3D.INTERACT_R
    for (let i = 0; i < this.clues.length; i++) {
      const dx = px - this.clues[i].x, dz = pz - this.clues[i].z
      if (dx * dx + dz * dz < r * r) return i
    }
    return -1
  }

  clueText(i: number): string { return this.clues[i]?.text ?? '' }

  // ── Proximity glint helpers ───────────────────────────────────────────────────
  // emissive ramps 0 → 0.6 as Webbs closes to interact range. 0.6 stays below the
  // bloom-halo threshold so props glint (findable) without glowing.
  private addGlint(
    x: number, z: number,
    mat: THREE.MeshStandardMaterial | THREE.MeshToonMaterial,
    available?: () => boolean,
  ): void {
    mat.emissive = new THREE.Color(0xffd9a0)
    mat.emissiveIntensity = 0
    this.glinters.push({ x, z, mat, available })
  }

  // Call every frame from the homeBase loop.
  updateGlints(px: number, pz: number): void {
    const NEAR = HomeBaseScene3D.INTERACT_R * 2.5
    for (const gl of this.glinters) {
      if (gl.available && !gl.available()) { gl.mat.emissiveIntensity = 0; continue }
      const dx = px - gl.x, dz = pz - gl.z
      const d  = Math.sqrt(dx * dx + dz * dz)
      const t  = Math.max(0, Math.min(1, 1 - d / NEAR))
      gl.mat.emissiveIntensity = t * 0.6
    }
  }

  private buildLighting(): void {
    // Cool hemisphere ambient — lifted so the dark reads as cozy-dim, not can't-see
    this.add(new THREE.HemisphereLight(0x3a4a6a, 0x100808, 0.30))

    // Warm directional crack — light filtering through a gap in the ceiling.
    // No shadows here: the global dirLight in main.ts handles shadow casting.
    const sunCrack = new THREE.DirectionalLight(0xffd9a0, 0.6)
    sunCrack.position.set(-6, 12, 4)
    this.add(sunCrack)

    // Warm pool point lights — pooled where family life is (the LIFE cluster).
    // Positions ×LIFE_SCALE so they light the re-anchored props; ranges widened
    // for the larger room. Quadratic decay keeps the dark owning the gaps.
    const pools: THREE.PointLight[] = []
    const pool = (x: number, y: number, z: number, intensity: number, dist: number, color = 0xffaa55) => {
      const p = new THREE.PointLight(color, intensity, dist, 2)
      p.position.set(x, y, z)
      pools.push(p)
      this.add(p)
    }
    pool(0,      3,  0,      8,   24)            // central hearth / hub
    pool(-14.56, 4, -6.24,   5.5, 18)           // lantern near workbench
    pool(12.48,  4,  8.32,   5.5, 18)           // lantern near gift corner
    pool(6.24,   2.5, -12.48, 4,  14, 0xff7733) // dim ember near attacked corner

    this.warmPools = pools
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  checkExitLeft(playerX: number): boolean {
    return playerX < this.exitTriggerX
  }

  nearWorkbench(playerX: number, playerZ: number): boolean {
    const dx = playerX - HomeBaseScene3D.WORKBENCH_X
    const dz = playerZ - HomeBaseScene3D.WORKBENCH_Z
    return dx * dx + dz * dz < HomeBaseScene3D.INTERACT_R ** 2
  }

  nearToothpick(playerX: number, playerZ: number): boolean {
    if (!this.toothpickAvailable) return false
    const dx = playerX - HomeBaseScene3D.TOOTHPICK_X
    const dz = playerZ - HomeBaseScene3D.TOOTHPICK_Z
    return dx * dx + dz * dz < HomeBaseScene3D.INTERACT_R ** 2
  }

  nearBirthdayCard(playerX: number, playerZ: number): boolean {
    if (!this.cardAvailable) return false
    const dx = playerX - HomeBaseScene3D.CARD_X
    const dz = playerZ - HomeBaseScene3D.CARD_Z
    return dx * dx + dz * dz < HomeBaseScene3D.INTERACT_R ** 2
  }

  nearGift(playerX: number, playerZ: number): boolean {
    if (!this.giftAvailable) return false
    const dx = playerX - HomeBaseScene3D.GIFT_X
    const dz = playerZ - HomeBaseScene3D.GIFT_Z
    return dx * dx + dz * dz < HomeBaseScene3D.INTERACT_R ** 2
  }

  webWallHitTest(x: number, z: number): boolean {
    // Circular chamber — test if outside (radius 50 ≈ 10.0 × DEN_SCALE)
    return x * x + z * z > 50.0 * 50.0
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
    audio.stopLoop('amb_homebase')
    for (const obj of this.tracked) {
      this.threeScene.remove(obj)
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose()
    }
    for (const body of this.staticBodies) physicsWorld.remove(body)
    this.staticBodies   = []
    this.tracked        = []
    this.glinters       = []
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
