import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js'
import { detectQualityTier, QUALITY, DynamicResolution } from './core/Quality'
import { InkOutlinePass } from './core/InkOutlinePass'
import { CameraOccluder } from './env/CameraOccluder'
import { CameraRig } from './core/CameraRig'
import { ZoneLighting } from './env/ZoneLighting'
import { InputManager } from './core/InputManager'
import { physicsWorld } from './core/PhysicsWorld'
import { Webbs3D } from './entities/Webbs3D'
import { Enemy3D } from './entities/Enemy3D'
import { audio, type ImpactKind } from './systems/AudioManager'
import { HomeBaseScene3D } from './scenes/HomeBaseScene3D'
import { AntColonyScene3D } from './scenes/AntColonyScene3D'
import { BossRollerScene3D } from './scenes/BossRollerScene3D'
import { WeaponUseSystem3D } from './systems/WeaponUseSystem3D'
import { WebLauncherSystem3D } from './systems/WebLauncherSystem3D'
import { ZoneTransitionSystem3D } from './systems/ZoneTransitionSystem3D'
import { ParticleBurstSystem3D } from './systems/ParticleBurstSystem3D'
import { PresentationPhase } from './systems/PresentationPhase'
import { XPSystem } from './systems/XPSystem'
import { WeaponType } from './systems/WeaponSystem'
import { registry } from './core/Registry'
import { HudSystem } from './ui/HudSystem'
import { EquipScreen3D } from './ui/EquipScreen3D'
import { CraftingMenu3D } from './ui/CraftingMenu3D'
import { TextDisplay3D, type TextDisplayData } from './ui/TextDisplay3D'
import { PickupCelebration3D } from './ui/PickupCelebration3D'
import { warmWeaponThumbs } from './ui/WeaponPreview'
import { PickupNotification3D } from './ui/PickupNotification3D'
import { ConsumableSystem, ConsumableType, CONSUMABLE_NAMES, CONSUMABLE_INFO } from './systems/ConsumableSystem'
import { QuickItems } from './ui/QuickItems'
import { EndingCard } from './ui/EndingCard'
import { TouchControls, type TouchMenuMode } from './ui/TouchControls'
import { DenGuide } from './systems/DenGuide'
import { tickProps } from './env/Props'
import { saveSystem } from './systems/SaveSystem'
import { SurvivorsProgression } from './systems/SurvivorsProgression'
import { installTheme } from './ui/theme'
import { TitleMenu, PauseMenu } from './ui/Menus'
import { DamageNumbers } from './ui/DamageNumbers'

installTheme()   // one stylesheet for every menu, overlay and HUD element

// Rapier ships as WASM — it must finish loading before any scene builds colliders.
await physicsWorld.init()

// ─── Renderer ────────────────────────────────────────────────────────────────

const CANVAS_W = 1280
const CANVAS_H = 720

const qualityTier = detectQualityTier()
const quality     = QUALITY[qualityTier]

// No MSAA on the canvas: everything is drawn into the composer's targets, so
// the canvas only ever receives the final full-screen quad — its MSAA buffer
// cost memory/bandwidth and smoothed nothing.  FXAA (last pass) does the job.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setSize(CANVAS_W, CANVAS_H)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio))
renderer.setClearColor(0x000000)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap   // PCFSoft is deprecated in r184 (falls back to PCF anyway)
renderer.toneMapping = THREE.ACESFilmicToneMapping

document.getElementById('game-container')!.appendChild(renderer.domElement)

// ─── Post-Processing ──────────────────────────────────────────────────────────

const composer = new EffectComposer(renderer)

// ─── Scene ────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene()
// Fog, background and exposure come from the zone lighting preset (env/ZoneLighting).

// ─── Camera (perspective iso rig — see core/CameraRig.ts) ────────────────────

const rig    = new CameraRig(CANVAS_W / CANVAS_H, 2.4)
const camera = rig.camera

// ─── Warm grade + vignette shader ────────────────────────────────────────────
// warmth uniform is zone-switched in transitionTo(): 0.12 for homeBase, 0 elsewhere.
// Tone mapping + sRGB output happen in the final OutputPass.  (three r153+ only
// applies renderer.toneMapping when drawing straight to the screen — through the
// composer the game was displaying raw linear colour: no ACES, no sRGB encode,
// everything far darker than authored, and toneMappingExposure did nothing.)
const GradeVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    warmth:   { value: 0.12 },   // start warm — game opens in home base
    vignette: { value: 0.85 },   // corner darkening strength
    lift:     { value: 0.0025 }, // keep blacks from crushing fully (linear — ≈ 0.05 after sRGB encode)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float warmth, vignette, lift;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.r += warmth * 0.6 * c.r;
      c.b -= warmth * 0.4 * c.b;
      c.rgb += lift;
      vec2 d = vUv - 0.5;
      // (edge0 < edge1 — the reversed form is undefined in GLSL ES and some mobile drivers flip it)
      float v = 1.0 - smoothstep(vignette * 0.35, 0.8, dot(d, d) * 2.4);
      c.rgb *= mix(1.0, v, 0.9);
      gl_FragColor = c;
    }
  `,
}

// Wire composer passes now that camera exists
composer.addPass(new RenderPass(scene, camera))
// Toon ink outlines on everything, from scene depth (before bloom so ink stays crisp)
InkOutlinePass.attachDepth(composer.renderTarget1, composer.renderTarget2)
const inkPass = new InkOutlinePass(camera)
inkPass.uniforms.thickness.value = 1.25 * Math.min(window.devicePixelRatio, 2)
composer.addPass(inkPass)
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(CANVAS_W, CANVAS_H),
  0.35,   // strength — keep subtle so toon look is preserved
  0.4,    // radius
  0.75,   // threshold — only the most emissive objects (portals, pickups) bloom
)
bloomPass.enabled = quality.bloom
composer.addPass(bloomPass)
const gradePass = new ShaderPass(GradeVignetteShader)
composer.addPass(gradePass)
composer.addPass(new OutputPass())
composer.addPass(new FXAAPass())   // after tone mapping/sRGB, where FXAA expects its input

// ─── Fit to window ────────────────────────────────────────────────────────────
// The game keeps its 1280×720 logical layout (HUD is authored in those pixels);
// the container is CSS-scaled to fit the window and the render resolution
// follows the displayed size (capped) so it stays crisp without overdrawing.
// Render scale = min(dpr × CSS scale, tier cap) × dynamic-resolution factor.
const dynamicRes = new DynamicResolution(quality.minScale, () => fitToWindow())
let fittedK = -1, fittedPr = -1
function fitToWindow(): void {
  const vw = document.documentElement.clientWidth  || window.innerWidth
  const vh = document.documentElement.clientHeight || window.innerHeight
  const k  = Math.min(vw / CANVAS_W, vh / CANVAS_H)
  const pr = Math.min(window.devicePixelRatio * k, quality.maxPixelRatio) * dynamicRes.scale
  if (k !== fittedK) {
    fittedK = k
    document.getElementById('game-container')!.style.transform = `scale(${k})`
  }
  if (Math.abs(pr - fittedPr) < 1e-3) return   // render targets only reallocate on a real change
  fittedPr = pr
  renderer.setPixelRatio(pr)
  composer.setPixelRatio(pr)
  composer.setSize(CANVAS_W, CANVAS_H)
  inkPass.uniforms.thickness.value = 1.25 * pr
}
// resize, ResizeObserver and visualViewport often fire together — fit once per frame
let fitQueued = false
function requestFit(): void {
  if (fitQueued) return
  fitQueued = true
  requestAnimationFrame(() => { fitQueued = false; fitToWindow() })
}
window.addEventListener('resize', requestFit)
new ResizeObserver(requestFit).observe(document.documentElement)   // catches resizes the event misses
window.visualViewport?.addEventListener('resize', requestFit)
fitToWindow()
// Expose to SurvivorsProgression for warmth tweening
scene.userData.gradePass      = gradePass
scene.userData.homeBaseWarmth = 0.12   // mutable; updated by SurvivorsProgression on warmth steps

// ─── Shared toon gradient map ─────────────────────────────────────────────────

const gradientData = new Uint8Array([64, 64, 64, 255, 160, 160, 160, 255, 255, 255, 255, 255])
const gradientMap  = new THREE.DataTexture(gradientData, 3, 1, THREE.RGBAFormat)
gradientMap.userData.shared = true   // every toon material in every zone uses it
// NearestFilter is REQUIRED — LinearFilter blurs the bands back into smooth shading
gradientMap.minFilter     = THREE.NearestFilter
gradientMap.magFilter     = THREE.NearestFilter
gradientMap.generateMipmaps = false
gradientMap.needsUpdate   = true

// ─── Primary lighting (shared across scenes) ──────────────────────────────────

// Key light (shadow box follows the player — it used to be a fixed ±25 box at the
// origin, so most of the 104-wu den had no shadows), ambient, player lantern, fog
// and exposure — all per zone, from one preset table.
const lighting = new ZoneLighting(scene, renderer, quality.shadowMap).apply('homeBase', 2.4, scene.userData.homeBaseWarmth as number)

// ─── Boot: restore save before constructing scenes ───────────────────────────

saveSystem.load()

// ─── Player ───────────────────────────────────────────────────────────────────

// Creature scale per zone.  Each zone is authored at its own world scale — the den
// was enlarged 5× (DEN_SCALE) while the colony and boss arena keep the original
// units their corridors, enemies and attack ranges were tuned for.  A single global
// Webbs scale made him 5–7× wider than colony enemies and wider than the corridors.
const ZONE_SCALE = { homeBase: 2.4, antColony: 1.0, bossRoller: 1.0 } as const

function applyZoneScale(zone: keyof typeof ZONE_SCALE): void {
  const s = ZONE_SCALE[zone]
  webbs.setScale(s)
  rig.setScale(s)   // view distance follows creature scale → same on-screen size
}

const webbs = new Webbs3D(scene, HomeBaseScene3D.SPAWN_X, 0, gradientMap, ZONE_SCALE.homeBase)

// Dev-only console handle for physics/visual debugging (stripped from prod builds).
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__nolegs = { webbs, physicsWorld, camera, rig, scene, renderer, composer, inkPass, audio, quality: { tier: qualityTier, ...quality }, dynamicRes }
}

// Dev-only collider overlay — F9 toggles a wireframe of every physics shape so
// collider-vs-visual mismatches are visible while playtesting.
const physicsDebug = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }),
)
physicsDebug.frustumCulled = false
physicsDebug.renderOrder   = 999
physicsDebug.visible       = false
scene.add(physicsDebug)
if (import.meta.env.DEV) {
  window.addEventListener('keydown', e => { if (e.code === 'F9') physicsDebug.visible = !physicsDebug.visible })
}
function updatePhysicsDebug(): void {
  if (!physicsDebug.visible) return
  const { vertices, colors } = physicsWorld.debugLines()
  physicsDebug.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  physicsDebug.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
}
webbs.group.renderOrder = 10   // renders above transparent corridor walls

// ─── Combat system ────────────────────────────────────────────────────────────

const weaponUseSystem = new WeaponUseSystem3D(scene)
const webLauncher     = new WebLauncherSystem3D(scene)
if (import.meta.env.DEV) {
  Object.assign((window as unknown as Record<string, object>).__nolegs, { webLauncher, weaponUseSystem, enemies: () => activeScene.enemies, goto: (z: ZoneId) => transitionTo(z), scene3d: () => activeScene, zoom: (z: number | null) => { devZoom = z }, photo: (v: number[] | null) => { devPhoto = v } })
}
const particles       = new ParticleBurstSystem3D(scene)
const consumables     = new ConsumableSystem()


// ─── Registry defaults (new game only) ───────────────────────────────────────

if (!saveSystem.hasSave()) {
  registry.set('legTier', 0)
  registry.set('weaponInventory', [])      // new game: no weapons yet
  registry.set('craftingInventory', {
    SilkThread: 5, ChitinShard: 5, WebFluid: 4,
  })
}

// ─── Restore saved state into live objects ────────────────────────────────────

{
  const savedHp = registry.get<number>('health')
  if (savedHp !== undefined) webbs.hp = Math.max(1, savedHp)

  if (registry.get<boolean>('webThrowerFound')) webbs.hasWebLauncher = true

  // Saves from before legs-per-boss: a beaten Roller is worth its leg
  if (!registry.get<string[]>('bossesDefeated') && (registry.get<number>('bossesBeaten') ?? 0) > 0) {
    registry.set('bossesDefeated', ['roller'])
    registry.set('bossesBeaten', 1)
    registry.set('legTier', Math.max(1, registry.get<number>('legTier') ?? 0))
  }

  const tier = registry.get<number>('legTier') ?? 0
  webbs.weaponSystem.setLegTier(tier)
  webbs.legs.setLegTier(tier)

  const savedSlots = registry.get<string[]>('weaponSlots')
  if (savedSlots) {
    for (let i = 0; i < savedSlots.length; i++) {
      const wt = savedSlots[i] as WeaponType
      if (wt && wt !== WeaponType.Empty) webbs.weaponSystem.equip(i, wt)
    }
  }

  const savedConsumables = registry.get<Record<string, number>>('consumableInventory')
  if (savedConsumables) consumables.restoreFromSnapshot(savedConsumables)
}

// ─── Death ────────────────────────────────────────────────────────────────────
function startDeath(): void {
  dyingT = 0
  registry.set('deaths', (registry.get<number>('deaths') ?? 0) + 1)
  webbs.startDying()
  webLauncher.release()
  weaponUseSystem.stopFlame()
  hud.flashDamageVignette()
  cameraShakeRemaining = 0.3
  cameraShakeIntensity = 0.02
}

// ─── Touch ────────────────────────────────────────────────────────────────────
// Which control set the touch layer shows this frame.
function touchMode(): TouchMenuMode {
  if (mainMenuActive || endingCard.isOpen) return 'hidden'              // their buttons are tappable
  if (textDisplay.isOpen)       return 'text'                            // tap = next, Skip = close
  if (pickupCelebration.isOpen) return 'card'                            // tap = dismiss
  if (equipScreen.isOpen || craftingMenu.isOpen || pauseMenu.isOpen) return 'panel'   // Back = Esc
  if (gamePaused || transitioning || dyingT >= 0 || endingPhase !== 'none') return 'hidden'
  return 'play'
}

// Touch has no cursor: aim at the closest enemy within reach, favouring ones
// in front of Webbs; with nothing near, aim where he's facing.
const AUTO_AIM_RANGE = 5   // creature-scale units
const _touchAim = new THREE.Vector3()
function touchAimPoint(): THREE.Vector3 {
  const x = webbs.collisionBody.x, z = webbs.collisionBody.z, s = webbs.scale
  const fl = Math.hypot(webbs.facingX, webbs.facingZ) || 1
  const fx = webbs.facingX / fl, fz = webbs.facingZ / fl
  let bx = 0, bz = 0, best = Infinity
  for (const e of (activeScene as { enemies: Enemy3D[] }).enemies) {
    if (e.isDead() || !e.collisionBody.enabled) continue
    const dx = e.collisionBody.x - x, dz = e.collisionBody.z - z
    const d = Math.hypot(dx, dz)
    if (d > AUTO_AIM_RANGE * s) continue
    const score = d * (1.6 - (dx * fx + dz * fz) / (d || 1))   // near and in front wins
    if (score < best) { best = score; bx = e.collisionBody.x; bz = e.collisionBody.z }
  }
  return best < Infinity ? _touchAim.set(bx, 0, bz) : _touchAim.set(x + fx * 3 * s, 0, z + fz * 3 * s)
}

// ─── Brews ────────────────────────────────────────────────────────────────────
function drank(type: ConsumableType, effect: string): void {
  audio.play('potion_drink')
  pickupNotify.notify(CONSUMABLE_NAMES[type], effect, CONSUMABLE_INFO[type].color)
  registry.set('brewsUsed', (registry.get<number>('brewsUsed') ?? 0) + 1)
}

// What else a (non-mimic) chest holds: often a heal, sometimes a tonic, and
// rarely the Tonic III that can't be brewed.
function rollChestBrew(): ConsumableType | null {
  const r = Math.random()
  if (r < 0.30) return ConsumableType.HpPotion
  if (r < 0.45) return ConsumableType.StaminaTonicI
  if (r < 0.50) return ConsumableType.StaminaTonicIII
  return null
}

// ─── Ending ───────────────────────────────────────────────────────────────────
// Runs under the arrival blackout: Webbs stands by the hearth; the den is one
// survivor-level "colder" so tickEnding() can play the family's return.
function startEnding(): void {
  pendingEnding = false
  endingPhase   = 'warming'
  endingT       = 0
  endingWarmed  = false
  webbs.placeAt(-5.5, 2.5)
  webbs.group.rotation.y = Math.PI / 2   // facing the hearth and the returning family
  rig.snapTo(-5.5, 2.5)
}

function tickEnding(dt: number): void {
  endingT += dt
  gamePaused = true
  if (!endingWarmed && endingT >= 1.4 && !transitioning) {
    endingWarmed = true
    denProgression?.applyState(registry.get<number>('bossesBeaten') ?? 1, false)   // stool, hammock, hearth, family
    audio.play('celeb_swell')
  }
  if (endingT >= 5.0 && !transitioning) {
    endingPhase = 'story'
    textDisplay.show(ENDING_TEXT)
  }
}

function showEndingCard(): void {
  endingPhase = 'card'
  const unique = new Set(registry.get<string[]>('weaponInventory') ?? [])
  if (registry.get<boolean>('webThrowerFound')) unique.add('WebLauncher')
  endingCard.show({
    xp:         xpSystem.total,
    weapons:    unique.size,
    clues:      (registry.get<number[]>('cluesFoundIds') ?? []).length,
    cluesTotal: 3,
    brews:      registry.get<number>('brewsUsed') ?? 0,
    falls:      registry.get<number>('deaths') ?? 0,
  })
}
// ─── Bosses → legs ────────────────────────────────────────────────────────────
// Each distinct boss beaten grows Webbs one leg tier (unlocking two weapon slots
// and that tier's weapons).  Counted by boss id so re-fighting can't farm tiers;
// `bossesBeaten` (read by the den's survivor progression) follows the same count.
function awardBossLeg(bossId: string): void {
  const beaten = registry.get<string[]>('bossesDefeated') ?? []
  if (beaten.includes(bossId)) return
  beaten.push(bossId)
  registry.set('bossesDefeated', beaten)
  registry.set('bossesBeaten', beaten.length)
  const tier = Math.min(3, beaten.length)
  if (tier <= (registry.get<number>('legTier') ?? 0)) return
  registry.set('legTier', tier)
  webbs.weaponSystem.setLegTier(tier)
  webbs.legs.setLegTier(tier)
  hud.toast(`A new leg grows — leg tier ${tier}. Two more weapon slots, and new recipes at the workbench.`, 'good', 5200)
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const menuOverlay    = document.getElementById('menu-overlay')!
const hud            = new HudSystem()
if (import.meta.env.DEV) Object.assign((window as unknown as Record<string, object>).__nolegs, { hud, consumables, ui: () => ({ craftingMenu, presentation, pickupCelebration, textDisplay, equipScreen, pauseMenu }) })
const equipScreen    = new EquipScreen3D(menuOverlay)
const craftingMenu   = new CraftingMenu3D(menuOverlay)
craftingMenu.consumables = consumables
const quickItems     = new QuickItems()

// Secret code: type "pppsssttt" to stop taking damage, "off" to undo it
let cheatKeys = ''
window.addEventListener('keydown', e => {
  if (e.repeat || e.key.length !== 1) return
  cheatKeys = (cheatKeys + e.key.toLowerCase()).slice(-9)
  if (cheatKeys.endsWith('pppsssttt') && !webbs.godMode) {
    webbs.godMode = true; cheatKeys = ''
    hud.toast('Pssst… Webbs is invulnerable. Type OFF to turn it back off.', 'good', 4200)
  } else if (cheatKeys.endsWith('off') && webbs.godMode) {
    webbs.godMode = false; cheatKeys = ''
    hud.toast('Invulnerability off — you can be hurt again.', 'warn', 3600)
  }
})
const endingCard     = new EndingCard(document.getElementById('game-container')!)
endingCard.onKeepExploring = () => {
  endingPhase = 'none'
  registry.set('endingSeen', true)
  persist()
  gamePaused = anyOverlayOpen()
  hud.toast('The den is warmer now. The tunnels are yours to explore.', 'good', 4200)
}
endingCard.onTitle = () => {
  registry.set('endingSeen', true)
  persist(true)
  window.location.reload()
}
const textDisplay    = new TextDisplay3D(menuOverlay)
const pickupCelebration = new PickupCelebration3D(menuOverlay, textDisplay)
const pickupNotify   = new PickupNotification3D()
const presentation   = new PresentationPhase()
// Round 7 Issue 1: hide the HTML overlay during Phase 1 so the player sees pure 3D.
presentation.hideOverlay = () => { menuOverlay.style.display = 'none' }

// Write live state into the registry and save.  Called on overlay closes, zone
// changes, the autosave tick and when the tab is hidden/closed — not only on zone
// changes as before, so a closed tab no longer loses pickups, XP or equips.
let saveSuppressed = false   // the dev wipe sets this so pagehide can't re-save
function persist(leaving = false): void {
  if (mainMenuActive || saveSuppressed) return
  // The colony's explored-map canvas is only serialised on zone teardown; when
  // the tab is closing, grab it now (toDataURL is a few ms — not every autosave).
  if (leaving && currentZone === 'antColony') {
    const fog = (activeScene as AntColonyScene3D).fog.serialize()
    if (fog) registry.set('fogReveal_antColony', fog)
  }
  registry.set('health', webbs.isDying || webbs.hp <= 0 ? webbs.hpMax : webbs.hp)   // deaths cost nothing
  registry.set('weaponSlots', webbs.weaponSystem.getAllSlots())
  registry.set('consumableInventory', consumables.getInventorySnapshot())
  registry.set('totalXp', xpSystem.total)
  saveSystem.save()
}
window.addEventListener('pagehide', () => persist(true))
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true) })
const AUTOSAVE_EVERY = 15   // s of play
let autosaveT = 0

// True while any overlay owns the screen — closing one must not unpause
// the game under another.
function anyOverlayOpen(): boolean {
  return equipScreen.isOpen || craftingMenu.isOpen || textDisplay.isOpen || pickupCelebration.isOpen ||
         pauseMenu.isOpen || presentation.isActive() || endingCard.isOpen || endingPhase !== 'none'
}

let gamePaused     = true   // stays true until main menu is dismissed
let mainMenuActive = true
equipScreen.onClose  = () => { persist(); gamePaused = anyOverlayOpen() }
craftingMenu.onClose = () => {
  persist()
  // A first-ever craft hands off to the discovery presentation — stay paused
  if (!presentation.isActive()) gamePaused = false
}
const pauseMenu = new PauseMenu(menuOverlay, {
  isMuted:     () => audio.isMuted(),
  toggleSound: () => toggleSound(),
  quitToTitle: () => {
    persist(true)
    window.location.reload()
  },
})
pauseMenu.onClose = () => { gamePaused = anyOverlayOpen() }
textDisplay.onClose  = () => {
  if (presentation.isActive()) {
    presentation.onTutorialCardClosed()
    return
  }
  if (endingPhase === 'story') { showEndingCard(); return }
  persist()   // story beats (card read, clue found) count as progress
  gamePaused = anyOverlayOpen()
  if (pendingTransitionResume) {
    transitioning = false   // Round 6 Issue 2: clear stuck transition flag
    pendingTransitionResume()
    pendingTransitionResume = null
  }
}
// Round 6 Issue 1: discovery card closing → advance to tutorial phase (or finish)
pickupCelebration.onClose = () => {
  if (presentation.isActive()) {
    presentation.onDiscoveryCardClosed()
  } else {
    gamePaused = false; celebZoom = false; webbs.endCelebrationPose()
  }
}

// Wire the three-phase presentation hooks
presentation.onShowDiscoveryCard = (wt, variant) => {
  // Phase 2 — purely the discovery card; no tutorial chained inside this overlay.
  audio.play('celeb_burst')   // Round 10
  pickupCelebration.show(wt, variant)
}
presentation.onShowTutorialCard = (wt) => {
  audio.play('celeb_tutorial')   // Round 10
  // Phase 3 — show the tutorial pages for this weapon if any.
  const tutorial = wt === WeaponType.BoxingGloves ? TUTORIAL_TOOTHPICK
                 : wt === WeaponType.WebLauncher  ? TUTORIAL_WEB_LAUNCHER
                 : null
  if (tutorial) textDisplay.show(tutorial)
  else presentation.onTutorialCardClosed()
}
presentation.onComplete = () => {
  persist()   // a found/crafted/gifted item is saved the moment its reveal ends
  gamePaused = false
  celebZoom  = false
}

// Round 8 Issue 7: first-time crafting closes the menu and routes through the
// full presentation phase (Webbs lift pose → discovery card → tutorial).
craftingMenu.onFirstDiscover = (wt) => {
  craftingMenu.close()
  gamePaused  = true
  celebZoom   = true
  audio.play('crafting_complete')
  presentation.start(wt, webbs, particles, 'crafted')
  xpSystem.award('craft')
}

// ─── Narrative text ───────────────────────────────────────────────────────────

const OPENING_INTRO: TextDisplayData = {
  pages: [
    'Webbs was born wrong.',
    'The colony called him broken.\n\nEight legs.\nNone of them his.',
    'His mother built him legs.\n\nChitin and thread.\nSilk wrapped tight around hollow bone.',
    'He made them better.\n\nEvery moult, he rebuilt.\nEvery season, they moved faster.',
    'Today is Molt Day.\n\nHe is seventeen moults old.\nHis mother left something for him at the Den.',
    'They never got the chance to see.',
  ],
  title:       '— NO LEG LEFT TO STAND ON —',
  accentColor: '#c8a8ff',
  style:       'story',
}

// Chapter-one ending — plays once, back in the den after the Roller falls.
const ENDING_TEXT: TextDisplayData = {
  pages: [
    'The tunnels are quiet now.\n\nWhatever fed on them\nhas crawled back into the dark.',
    'Webbs follows the silk markers home.\n\nSomeone has walked them since.\nThey are brighter than he left them.',
    'Three of them are waiting in the Den.\n\nThey look at his legs for a long time.\nNone of them say "broken".',
    'Someone has righted the stool.\nSomeone has mended the hammock.\n\nThe hearth is lit.',
    'His mother is not among them.',
    'The smallest one presses a thread into his leg —\nher silk, spun to rest, not to bind.\n\nIt runs on, deeper. Toward the Hive.',
    'Eight legs.\nAll of them his.\n\nHe goes on.',
  ],
  title:       '— HOME, FOR NOW —',
  accentColor: '#ffb35c',
  style:       'story',
}

const COLONY_INTRO: TextDisplayData = {
  pages: [
    'The silk markers end here.\n\nPast this point the ants have dug a maze\nin the dark, and they hunt what wanders in.',
    'The way west — the Queen\'s tunnel — is sealed\nwith resin. Three pheromone sacs hold it shut,\ndeep in the colony.\n\nBurst them. The colony will know when you do.',
    'Stay out of sight. Listen.\nIf they see you, run — and don\'t run\ninto a dead end.',
  ],
  title:       '— ZONE 1: ANT COLONY —',
  accentColor: '#66aa44',
}

const BIRTHDAY_CARD_TEXT: TextDisplayData = {
  pages: [
    '"Happy moult day.\n\nFrom someone who still counts them."',
    'The card is old. The ink is smeared.\nBut the handwriting is steady.\n\nYou didn\'t know anyone still tracked it.',
    'Most spiders stop counting moults after the third.\n\nYou stopped at twelve.\nThe note says seventeen.',
    'There\'s a pressed flower inside — dried flat,\nstill faintly purple.\n\nYou don\'t recognise the species.',
    'You hold it a moment longer than you mean to.\n\nThen you fold it back up\nand keep moving.',
  ],
  title:       '— BIRTHDAY CARD —',
  accentColor: '#cc8844',
}

const TUTORIAL_TOOTHPICK: TextDisplayData = {
  pages: [
    'You found a Toothpick Stabber.\n\nA thin spike, light as a pin.\nFast and cheap on stamina, but short range.\n\nPress [I] to open your equipment screen\nand assign it to a weapon slot.',
  ],
  title:       '— ITEM FOUND: TOOTHPICK —',
  accentColor: '#ddccaa',
}

const TUTORIAL_WEB_LAUNCHER: TextDisplayData = {
  pages: [
    'You found a Web Launcher.\n\nFires a sticky silk strand.\nPress [Q] to fire it — it anchors to walls,\npulls light enemies toward you, and\nyou toward heavy ones.\n\nQ again to release.',
  ],
  title:       '— GIFT OPENED —',
  accentColor: '#ddeeff',
}

// ─── Mouse-to-world cursor ────────────────────────────────────────────────────

const cursorMesh = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.22, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
)
cursorMesh.position.y = 0.02
scene.add(cursorMesh)

// ─── Input ────────────────────────────────────────────────────────────────────

const input = new InputManager(renderer.domElement)
const touch          = new TouchControls(document.getElementById('game-container')!, input)
quickItems.onUse = (k) => { const code = `Key${k}`; input.press(code); requestAnimationFrame(() => input.release(code)) }
hud.onSlotTap = (i) => { if (webbs.weaponSystem.isSlotUnlocked(i)) { lastActiveSlot = i; audio.play('ui_hover') } }

// ─── Colony lock ──────────────────────────────────────────────────────────────
// Webbs won't leave the den until he has read all three clues (the last one
// lies right at the tunnel mouth).  A soft wall just short of the exit trigger
// stops him walking further west and says why.  Saves that already reached the
// colony stay unlocked.
const COLONY_LOCK_MARGIN = 2.0   // wu east of the exit trigger — still inside clue 2's E radius
const COLONY_LOCK_MSG    = "You don't know enough about what's out there to leave yet. Go look for more clues."
let   colonyLockToastT   = 0

function colonyUnlocked(): boolean {
  return (registry.get<number[]>('cluesFoundIds') ?? []).length >= 3
      || !!registry.get<boolean>('antColonyFirstVisit')
      || (registry.get<string[]>('bossesDefeated') ?? []).length > 0
}

function holdAtColonyMouth(dt: number): void {
  if (colonyLockToastT > 0) colonyLockToastT -= dt
  if (currentZone !== 'homeBase' || transitioning || colonyUnlocked()) return
  const wallX = (activeScene as HomeBaseScene3D).exitTriggerX + COLONY_LOCK_MARGIN
  const b = webbs.collisionBody
  if (b.x > wallX + 0.4 || b.velocity.x >= 0) return
  b.velocity.x = 0
  if (colonyLockToastT <= 0) { hud.toast(COLONY_LOCK_MSG, 'info', 4600); colonyLockToastT = 6 }
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
// Play happens close in (PLAY_ZOOM) so the details read.  The wheel / a pinch
// can push in to ZOOM_MAX or pull out as far as the old default view (ZOOM_MIN);
// a moment after the player lets go, the view drifts slowly back to PLAY_ZOOM
// on its own, from either side.  A new session starts at the wide view, so the
// same drift is the opening slow push-in on Webbs.  `userZoom` stays separate
// from the celebration/death overrides (see tickZoom).
const ZOOM_MAX       = 5.0    // most zoomed-IN (the closest the game has ever allowed)
const PLAY_ZOOM      = 3.75   // default playing view; players can push in to ZOOM_MAX or pull out
const CELEB_ZOOM     = 5.5    // discoveries push in past the normal max for a close-up
const ZOOM_MIN       = 2.0    // most zoomed-OUT = the previous default framing
const ZOOM_STEP      = 0.15
const ZOOM_HOLD      = 1.6    // s after the last zoom input before drifting back
const ZOOM_RETURN    = 0.8    // 1/s — slow ease back to PLAY_ZOOM (~4 s to settle)
let   userZoom       = ZOOM_MIN
let   zoomHoldT      = 0.6    // the opening push-in starts shortly after play begins

// The boss arena is played wide: the anteater fills the back wall
const _camFocus = new THREE.Vector3()
function zoneZoomCap(): number { return currentZone === 'bossRoller' ? 2.5 : Infinity }

function nudgeZoom(next: number): void {
  userZoom  = THREE.MathUtils.clamp(next, ZOOM_MIN, ZOOM_MAX)
  zoomHoldT = ZOOM_HOLD
}
window.addEventListener('wheel', (e: WheelEvent) => {
  if (mainMenuActive) return
  e.preventDefault()
  const dir = e.deltaY > 0 ? -1 : 1   // wheel up = zoom in
  nudgeZoom(userZoom + dir * ZOOM_STEP)
}, { passive: false })
touch.onPinch = (ratio) => { if (!mainMenuActive) nudgeZoom(userZoom * ratio) }   // fingers apart = closer

// Per frame during play: hold, then ease back toward the close play view
function driftZoom(dt: number): void {
  if (zoomHoldT > 0) { zoomHoldT -= dt; return }
  userZoom += (PLAY_ZOOM - userZoom) * (1 - Math.exp(-ZOOM_RETURN * dt))
}

// ─── Zone management ──────────────────────────────────────────────────────────

type ZoneId = 'homeBase' | 'antColony' | 'bossRoller'
type ActiveScene = HomeBaseScene3D | AntColonyScene3D | BossRollerScene3D

let activeScene: ActiveScene = new HomeBaseScene3D(scene, gradientMap)
lighting.calibrateAccents('homeBase')
let currentZone: ZoneId = 'homeBase'
let transitioning = false
let pendingTransitionResume: (() => void) | null = null
let lastActiveSlot = 0   // slot fired by left-click; updated whenever a number key fires

// Camera occluder — fades ANY tall den geometry that blocks the view of Webbs.
// Recreated with each HomeBaseScene3D instance.
let cameraOccluder: CameraOccluder | null = new CameraOccluder(camera)
for (const m of (activeScene as HomeBaseScene3D).getOccluderMeshes()) cameraOccluder.register(m)

// Den progression — tracks survivors returning after boss defeats.
// Recreated each time HomeBaseScene3D is created; disposed on zone exit.
// First-visit objectives in the den (see systems/DenGuide); den-only
let denGuide: DenGuide | null = null
function startDenGuide(): void {
  denGuide?.dispose()
  denGuide = new DenGuide(scene)
  denGuide.onHint = (text) => hud.toast(text, 'info', 5600)
}
let denProgression: SurvivorsProgression | null = new SurvivorsProgression(
  (activeScene as HomeBaseScene3D).denHandles,
  scene,
  (activeScene as HomeBaseScene3D).warmPools,
)
denProgression.applyState(registry.get<number>('bossesBeaten') ?? 0)
startDenGuide()
// Weapon icons are renders of the 3D models — draw them once the game is up
window.setTimeout(warmWeaponThumbs, 1500)

weaponUseSystem.setEnemies((activeScene as HomeBaseScene3D).enemies)
webLauncher.setEnemies((activeScene as HomeBaseScene3D).enemies)
hud.setZoneLabel('HOME BASE')

async function transitionTo(zone: ZoneId, opts: { title?: string; onSwitch?: () => void } = {}): Promise<void> {
  if (transitioning) return
  transitioning = true
  gamePaused    = true

  persist()

  webLauncher.release()
  webLauncher.clearWraps()
  weaponUseSystem.stopFlame()

  const ZONE_TITLES: Record<ZoneId, string> = {
    homeBase:   'HOME BASE',
    antColony:  'ZONE 1  —  ANT COLONY',
    bossRoller: 'ZONE 2  —  THE ANTEATER',
  }
  await ZoneTransitionSystem3D.transition(() => {
    // Dispose zone-specific systems before tearing down the scene
    if (currentZone === 'homeBase') { denProgression?.dispose(); denProgression = null; denGuide?.dispose(); denGuide = null }
    activeScene.destroy()

    switch (zone) {
      case 'homeBase': {
        const s = new HomeBaseScene3D(scene, gradientMap)
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        applyZoneScale('homeBase')
        webbs.placeAt(HomeBaseScene3D.SPAWN_X, 0)
        rig.snapTo(HomeBaseScene3D.SPAWN_X, 0)
        hud.setZoneLabel('HOME BASE')
        hud.hideBossHp()
        webbs.floorType = 'dirt'
        // Rebuild per-scene systems for the new HomeBaseScene3D instance
        cameraOccluder = new CameraOccluder(camera)
        for (const m of s.getOccluderMeshes()) cameraOccluder.register(m)
        denProgression = new SurvivorsProgression(s.denHandles, scene, s.warmPools)
        startDenGuide()
        denProgression.applyState(Math.max(0, (registry.get<number>('bossesBeaten') ?? 0) - (pendingEnding ? 1 : 0)))
        break
      }
      case 'antColony': {
        const s = new AntColonyScene3D(scene, gradientMap, inkPass)
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        const fromBoss = currentZone === 'bossRoller'
        const spawnX   = fromBoss ? AntColonyScene3D.SPAWN_FROM_BOSS_X : AntColonyScene3D.SPAWN_FROM_HOME_X
        const spawnZ   = fromBoss ? s.getBossPortalZ() : 0
        applyZoneScale('antColony')
        webbs.placeAt(spawnX, spawnZ)
        rig.snapTo(spawnX, spawnZ)
        hud.setZoneLabel('ZONE 1 — ANT COLONY')
        hud.hideBossHp()
        webbs.floorType = 'stone'
        break
      }
      case 'bossRoller': {
        const s = new BossRollerScene3D(scene, gradientMap)
        s.releaseWeb = () => webLauncher.release()
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        applyZoneScale('bossRoller')
        webbs.placeAt(BossRollerScene3D.SPAWN_X, BossRollerScene3D.SPAWN_Z)
        rig.snapTo(BossRollerScene3D.SPAWN_X, BossRollerScene3D.SPAWN_Z)
        registry.set('bossPortalZ', undefined)   // next colony visit re-randomizes portal
        hud.setZoneLabel('BOSS CHAMBER')
        webbs.floorType = 'stone'
        break
      }
    }

    currentZone = zone
    // Zone atmosphere (lights, fog, background, exposure, warm grade) — applied
    // during the blackout so the fade-in already shows the new zone's light.
    lighting.apply(zone, ZONE_SCALE[zone],
      zone === 'homeBase' ? (scene.userData.homeBaseWarmth as number) ?? 0.12 : undefined)
    lighting.calibrateAccents(zone)
    audio.setRoom(zone)
    const savedHp = registry.get<number>('health')
    if (savedHp !== undefined) webbs.hp = Math.max(1, savedHp)
    opts.onSwitch?.()   // runs under the blackout
  }, opts.title ?? ZONE_TITLES[zone])


  if (zone === 'antColony' && !registry.get<boolean>('antColonyFirstVisit')) {
    registry.set('antColonyFirstVisit', true)
    textDisplay.show(COLONY_INTRO)
    gamePaused = true
    await new Promise<void>(resolve => { pendingTransitionResume = resolve })
    return
  }

  transitioning = false
  gamePaused    = anyOverlayOpen()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMeleeWeapon(wt: WeaponType): boolean {
  return wt === WeaponType.Sword || wt === WeaponType.Axe || wt === WeaponType.BoxingGloves
}

// Round 6 Issue 8 / Round 8 Issue 6: smooth zoom lerp toward celebration override.
// Celebration zoom bumped 2.8 → 4.2 so the presented item is clearly readable.
function tickZoom(delta: number): void {
  rig.zoomTarget = devZoom ?? (celebZoom ? Math.max(CELEB_ZOOM, userZoom) : dyingT >= 0 ? Math.min(userZoom * 1.3, ZOOM_MAX * 1.15) : Math.min(userZoom, zoneZoomCap()))
  rig.tickZoom(delta)
}

// ─── Round 8 Issue 8: XP system + HUD counter ────────────────────────────────
const xpSystem  = new XPSystem()
const xpValueEl = document.getElementById('xp-value')!
xpSystem.total = registry.get<number>('totalXp') ?? 0
xpValueEl.textContent = String(xpSystem.total)
xpSystem.onGain = (amount, source) => {
  xpValueEl.textContent = String(xpSystem.total)
  hud.xpPop(amount)
  // Round 10 — XP gain SFX: combo if a kill chain is rolling, otherwise small.
  if (source === 'kill' || source === 'boss_kill') audio.play('xp_gain_combo')
  else                                              audio.play('xp_gain_small')
}

// ─── Combat callbacks ─────────────────────────────────────────────────────────

weaponUseSystem.onOutOfAmmo = () => hud.toast('Out of thistle seeds — gather more in the colony', 'warn')

// Round 9 Issue 4 — splatter particles fire from the weapon system on hit.
// ─── Hit feel ─────────────────────────────────────────────────────────────────
// Hit-stop: the world nearly freezes for a few frames on impact (the camera keeps
// shaking through it) — the single biggest "it connected" cue.
const HIT_STOP_SCALE = 0.04
let   hitStopT       = 0
function hitStop(seconds: number): void { hitStopT = Math.max(hitStopT, seconds) }
const damageNumbers = new DamageNumbers()
// Synth weight under the sampled hit, by weapon
const IMPACT_WEIGHT: Partial<Record<WeaponType, ImpactKind>> = {
  [WeaponType.Sword]: 'medium', [WeaponType.Axe]: 'heavy',
  [WeaponType.BoxingGloves]: 'light', [WeaponType.Bow]: 'light',
}
weaponUseSystem.onHit = (e) => {
  hitStop(e.hitStop)
  audio.impact(e.kill ? 'kill' : e.weak ? 'weak' : IMPACT_WEIGHT[e.weapon] ?? 'light', e.x, e.z)
  damageNumbers.spawn(e.x, e.y + 0.4 * webbs.scale, e.z, e.damage, { weak: e.weak, kill: e.kill })
}

weaponUseSystem.onSpawnHitParticles = (x, y, z, color, count) => {
  particles.burst(new THREE.Vector3(x, y, z), color, count, 3.0, 0.06)
}

// Round 9b — global death-particle hook: ichor splatter (fast outward) for
// regular kills, smoke (slow upward drift) for burn deaths.
Enemy3D.onDeathParticles = (x, y, z, color, count, kind) => {
  const pos = new THREE.Vector3(x, y, z)
  if (kind === 'smoke') particles.smokeBurst(pos, color, count)
  else                  particles.burst(pos, color, count, 3.5, 0.06)
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

const clock        = new THREE.Clock()
let cameraShakeRemaining = 0
let cameraShakeIntensity = 0

// Round 9b — global camera shake hook (boss death scenes call this).
// Death-scene values were authored as world-unit jitter for the old ortho camera;
// the rig scales shake by view distance, so they're normalised here.
Enemy3D.onCameraShake = (intensity, duration) => {
  cameraShakeIntensity = intensity * 0.25
  cameraShakeRemaining = duration
  hitStop(0.08)
}

// Round 10 — Audio mute toggle wiring.
const audioToggle = document.getElementById('audio-toggle') as HTMLButtonElement | null
function toggleSound(): void {
  if (audio.isMuted()) audio.unmute()
  else                 audio.mute()
  if (audioToggle) audioToggle.textContent = audio.isMuted() ? 'SOUND OFF' : 'SOUND ON'
}
audioToggle?.addEventListener('click', toggleSound)
if (audioToggle) audioToggle.textContent = audio.isMuted() ? 'SOUND OFF' : 'SOUND ON'   // mute persists
let celebZoom        = false   // true while pickup celebration is open
let audioMuffled     = false
let victoryPending   = false   // boss beaten; the exit transition is queued
// Death beat: on the killing blow the world drops to slow motion while Webbs
// curls up, then fades to a "limps home" card.  No penalty — he wakes in the
// den with everything refilled.
const DEATH_BEAT  = 1.3    // s (real time) before the fade starts
const DEATH_SLOW  = 0.3    // world time scale during the beat
const DEATH_CARD  = 'Webbs limps home  —  Home Base'
let   dyingT      = -1
let   devZoom: number | null = null   // dev console close-ups (__nolegs.zoom)
let   devPhoto: number[] | null = null   // [camX, camY, camZ, lookX, lookY, lookZ]
// Chapter-one ending: 'warming' (den comes back to life around Webbs) →
// 'story' (ENDING_TEXT) → 'card' (EndingCard).  Plays once (`endingSeen`).
let endingPhase: 'none' | 'warming' | 'story' | 'card' = 'none'
let endingT       = 0
let endingWarmed  = false
let pendingEnding = false   // set by the boss victory; the den is built one step colder
let audioHushed      = false
const menuFocus      = new THREE.Vector3()
let energyWasDepleted = false

function gameLoop() {
  requestAnimationFrame(gameLoop)
  const rawDelta = Math.min(clock.getDelta(), 0.1)
  if (quality.dynamicRes) dynamicRes.sample(rawDelta)
  let delta = rawDelta
  if (hitStopT > 0) { hitStopT -= rawDelta; delta = rawDelta * HIT_STOP_SCALE }
  if (!mainMenuActive && !gamePaused && !transitioning) driftZoom(rawDelta)
  autosaveT += rawDelta
  if (autosaveT >= AUTOSAVE_EVERY && !gamePaused && !transitioning && dyingT < 0) { autosaveT = 0; persist() }
  if (endingPhase === 'warming') tickEnding(rawDelta)
  if (dyingT >= 0) {
    dyingT += rawDelta
    delta *= DEATH_SLOW
    if (dyingT >= DEATH_BEAT && !transitioning) {
      webbs.hp = webbs.hpMax   // saved as full health: dying costs nothing
      void transitionTo('homeBase', { title: DEATH_CARD, onSwitch: () => { webbs.resetAfterDeath(); dyingT = -1 } })
    }
  }

  // ── HUD tick ─────────────────────────────────────────────────────────────

  hud.tickBossMsg(delta)

  // Mix state: pause menu muffles the world; story/discovery screens sit the
  // ambience back so their stings and text read.
  const muffled = pauseMenu.isOpen || dyingT >= 0
  if (muffled !== audioMuffled) { audioMuffled = muffled; audio.setMuffled(muffled) }
  const hushed = textDisplay.isOpen || pickupCelebration.isOpen || presentation.isActive() || dyingT >= 0
  if (hushed !== audioHushed) { audioHushed = hushed; audio.setAmbienceLevel(hushed ? 0.45 : 1) }

  // ── Lantern flicker + den progression ────────────────────────────────────────
  if (currentZone === 'homeBase') {
    const t = clock.elapsedTime
    for (let i = 0; i < (activeScene as HomeBaseScene3D).warmPools.length; i++) {
      const p = (activeScene as HomeBaseScene3D).warmPools[i]
      const base = p.userData.baseIntensity ?? (p.userData.baseIntensity = p.intensity)
      p.intensity = base * (0.9 + Math.sin(t * 9 + i * 2.3) * 0.05 + Math.sin(t * 23 + i) * 0.03)
    }
    denProgression?.update(delta, t)
    cameraOccluder?.update(webbs.group.position, delta)
    ;(activeScene as HomeBaseScene3D).updateGlints(webbs.group.position.x, webbs.group.position.z)
  }

  // ── Main menu: render background but skip all game input ─────────────────

  if (mainMenuActive) {
    // Slow drift across the den behind the title menu
    const t = clock.elapsedTime * 0.06
    menuFocus.set(Math.cos(t) * 14 - 4, 0, Math.sin(t) * 10)
    rig.update(delta, menuFocus)
    lighting.update(menuFocus.x, 0, menuFocus.z, webbs.scale, rig.viewDistance, delta)
    input.endFrame()
    composer.render()
    return
  }

  // ── Presentation phase tick (runs even when paused) ─────────────────────
  // Round 7 Issue 1: drive the Webbs-lifts-item phase timer + transition to UI.
  presentation.update(webbs, particles)
  if (webbs.celebratingPose) {
    webbs.updateLegs(0)        // celebration pose every frame while paused
    particles.update(delta)    // particle burst must animate through pause
  }
  // Camera zoom must ease even when paused so the celebration close-up is visible
  tickZoom(delta)

  // ── Menu input (runs even when paused) ───────────────────────────────────

  if (endingCard.isOpen)             endingCard.update(input)
  else if (equipScreen.isOpen)       equipScreen.update(input)
  else if (craftingMenu.isOpen)      craftingMenu.update(input)
  else if (pickupCelebration.isOpen) pickupCelebration.update(input, delta)
  else if (textDisplay.isOpen)       textDisplay.update(input)
  else if (pauseMenu.isOpen)         pauseMenu.update(input)
  else if (!celebZoom && dyingT < 0 && !transitioning) {
    if (input.justDown('Escape')) {
      pauseMenu.show()
      gamePaused = true
    }

    // ── Dev restart (Backtick) — clears save and reloads (dev builds only:
    // the key sits next to the slot-1 hotkey) ───────────────────────────────
    if (import.meta.env.DEV && input.justDown('Backquote')) {
      saveSuppressed = true
      saveSystem.deleteSave()
      window.location.reload()
    }

    if (input.justDown('KeyI') && !gamePaused) {
      equipScreen.show(webbs)
      gamePaused = true
    }

    // ── Interact hint + E-key actions ────────────────────────────────────
    const px = webbs.collisionBody.x
    const pz = webbs.collisionBody.z
    const canCraft =
      (currentZone === 'homeBase'  && (activeScene as HomeBaseScene3D).nearWorkbench(px, pz)) ||
      (currentZone === 'antColony' && (activeScene as AntColonyScene3D).nearWorkbench(px, pz))

    let hintText = ''
    if (currentZone === 'homeBase') {
      const hbs = activeScene as HomeBaseScene3D
      if      (hbs.nearToothpick(px, pz))    hintText = '[E] pick up Toothpick'
      else if (hbs.nearBirthdayCard(px, pz)) hintText = '[E] read Birthday Card'
      else if (hbs.nearGift(px, pz))         hintText = '[E] open Gift'
      else if (hbs.nearClue(px, pz) >= 0)    hintText = '[E] investigate'
      else if (canCraft)                     hintText = '[E] use Workbench'
    } else if (currentZone === 'antColony') {
      const acs = activeScene as AntColonyScene3D
      if      (canCraft)                      hintText = '[E] use Workbench'
      else if (acs.nearChest(px, pz) >= 0)    hintText = '[E] open chest'
      else if (acs.nearHpModule(px, pz) >= 0) hintText = '[E] HP Module (+25 HP)'
    } else if (canCraft) {
      hintText = '[E] use Workbench'
    }
    hud.setInteractHint(hintText)

    if (input.justDown('KeyE') && !gamePaused) {
      if (currentZone === 'homeBase') {
        const hbs = activeScene as HomeBaseScene3D
        if (hbs.nearToothpick(px, pz)) {
          hbs.pickupToothpick()
          xpSystem.award('rare_pickup')
          registry.set('toothpickCollected', true)
          const inv = registry.get<WeaponType[]>('weaponInventory') ?? []
          if (!inv.includes(WeaponType.BoxingGloves)) inv.push(WeaponType.BoxingGloves)
          registry.set('weaponInventory', inv)
          if (!registry.get<boolean>('tutorialToothpickSeen')) {
            registry.set('tutorialToothpickSeen', true)
            // Round 6 Issue 1: three-phase presentation kicks off Webbs's lift pose
            gamePaused = true; celebZoom = true
            presentation.start(WeaponType.BoxingGloves, webbs, particles)
          } else {
            pickupNotify.notify('Toothpick Stabber', 'weapon found', '#ddccaa')
          }
        } else if (hbs.nearBirthdayCard(px, pz) && hbs.cardAvailable) {
          hbs.collectCard()
          registry.set('birthdayCardRead', true)
          textDisplay.show(BIRTHDAY_CARD_TEXT)
          gamePaused = true
        } else if (hbs.nearGift(px, pz) && hbs.giftAvailable) {
          hbs.collectGift()
          xpSystem.award('rare_pickup')
          webbs.hasWebLauncher = true
          registry.set('webThrowerFound', true)
          if (!registry.get<boolean>('tutorialWebLauncherSeen')) {
            registry.set('tutorialWebLauncherSeen', true)
            // Round 6 Issue 1: three-phase presentation kicks off Webbs's lift pose
            gamePaused = true; celebZoom = true
            presentation.start(WeaponType.WebLauncher, webbs, particles, 'gift')
          } else {
            pickupNotify.notify('Web Launcher', 'already found', '#ddeeff')
          }
        } else if (hbs.nearClue(px, pz) >= 0) {
          const clueIdx = hbs.nearClue(px, pz)
          const found = registry.get<number[]>('cluesFoundIds') ?? []
          if (!found.includes(clueIdx)) {
            found.push(clueIdx)
            registry.set('cluesFoundIds', found)
            saveSystem.save()
            xpSystem.award('pickup')
          }
          textDisplay.show({ pages: [hbs.clueText(clueIdx)], title: '— A CLUE —', accentColor: '#ffd9a0' })
          gamePaused = true
        } else if (canCraft) {
          craftingMenu.show()
          gamePaused = true
        }
      } else if (currentZone === 'antColony') {
        const acs = activeScene as AntColonyScene3D
        if (canCraft) {
          craftingMenu.show()
          gamePaused = true
        } else {
          const chestIdx = acs.nearChest(px, pz)
          if (chestIdx >= 0) {
            const result = acs.openChest(chestIdx)
            if (result.kind === 'loot') {
              const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
              inv[result.mat] = (inv[result.mat] ?? 0) + result.qty
              registry.set('craftingInventory', inv)
              pickupNotify.notify(result.mat, `×${result.qty}`, '#88aa44')
              audio.play('pickup_notify')
              xpSystem.award('pickup')
              const brew = rollChestBrew()
              if (brew) {
                consumables.addConsumable(brew, 1)
                pickupNotify.notify(CONSUMABLE_NAMES[brew], '×1', CONSUMABLE_INFO[brew].color)
              }
            } else {
              hud.toast("It's a mimic!", 'danger')
            }
          } else {
            const hpIdx = acs.nearHpModule(px, pz)
            if (hpIdx >= 0) {
              acs.collectHpModule(hpIdx)
              webbs.hp = Math.min(webbs.hpMax, webbs.hp + 25)
              pickupNotify.notify('HP Module', '+25 HP', '#ff4455')
              xpSystem.award('pickup')
            }
          }
        }
      } else if (canCraft) {
        craftingMenu.show()
        gamePaused = true
      }
    }

    // ── Round 8 Issue 3: SPACE — backward dodge leap ────────────────────
    if (input.justDown('Space')) {
      webbs.startDodgeLeap()
    }

    // ── Consumable hotkeys ───────────────────────────────────────────────
    if (dyingT < 0 && input.justDown('KeyC')) {
      if (consumables.getAmount(ConsumableType.HpPotion) <= 0) hud.toast('No HP potions — brew them at a workbench', 'warn')
      else if (webbs.hp >= webbs.hpMax) hud.toast('Already at full health', 'info')
      else {
        const heal = consumables.tryHpPotion() ?? 0
        webbs.hp = Math.min(webbs.hpMax, webbs.hp + heal)
        drank(ConsumableType.HpPotion, `+${heal} HP`)
      }
    }
    if (dyingT < 0 && input.justDown('KeyV')) {
      const next = consumables.getAmount(ConsumableType.StaminaTonicIII) > 0 ? ConsumableType.StaminaTonicIII
                 : consumables.getAmount(ConsumableType.StaminaTonicII)  > 0 ? ConsumableType.StaminaTonicII
                 : ConsumableType.StaminaTonicI
      const ms = consumables.tryTonic()
      if (ms === null) hud.toast('No stamina tonics — brew them at a workbench', 'warn')
      else drank(next, `${Math.round(ms / 1000)} s of light swings`)
    }
    if (dyingT < 0 && input.justDown('KeyX')) {
      if (!consumables.tryMaxPotion()) hud.toast('No max potions — they need Crystal Dust', 'warn')
      else drank(ConsumableType.MaxPotion, '10 s untouchable')
    }
  }

  // ── HUD (always) ────────────────────────────────────────────────────────
  hud.setActiveSlot(lastActiveSlot)

  hud.update(webbs)
  quickItems.update(consumables)
  tickProps(performance.now() / 1000)   // pickup bob/spin, glows
  if (denGuide && currentZone === 'homeBase') {
    denGuide.setVisible(touchMode() === 'play')   // 'play' = nothing else owns the screen (any device)
    denGuide.update(gamePaused ? 0 : rawDelta, { x: webbs.collisionBody.x, z: webbs.collisionBody.z },
      (activeScene as HomeBaseScene3D).guidePoints(), camera, webbs.scale)
  }
  touch.update({ mode: touchMode(), weapon: webbs.weaponSystem.getSlot(lastActiveSlot), interact: hud.currentInteract, web: webbs.hasWebLauncher })

  // ── Pause gate ───────────────────────────────────────────────────────────

  if (gamePaused) {
    input.endFrame()
    composer.render()
    return
  }

  // ── Zone exit / portal checks ────────────────────────────────────────────

  if (!transitioning && dyingT < 0) {
    const px = webbs.collisionBody.x

    if (currentZone === 'homeBase') {
      const hbs = activeScene as HomeBaseScene3D
      if (hbs.checkExitLeft(px)) {
        webbs.collisionBody.velocity.x = Math.max(0, webbs.collisionBody.velocity.x)
        // Something (a dodge, a web pull) carried him past the soft wall: put him back
        if (!colonyUnlocked()) webbs.placeAt(hbs.exitTriggerX + COLONY_LOCK_MARGIN, webbs.collisionBody.z)
        else transitionTo('antColony')
      }
    } else if (currentZone === 'antColony') {
      const ac = activeScene as AntColonyScene3D
      if (ac.checkExitRight(px)) transitionTo('homeBase')
      if (ac.checkExitLeft(px))  transitionTo('bossRoller')
    }
  }

  // ── Player update ────────────────────────────────────────────────────────

  webbs.update(delta, input)
  holdAtColonyMouth(delta)
  physicsWorld.update(delta)
  webbs.syncPosition()

  // Listener follows the player; panning uses the camera's right vector, and
  // distance is measured in creature-scale units (den 2.4, colony 1.0).
  {
    const m = camera.matrixWorld.elements
    audio.setListener(webbs.collisionBody.x, webbs.collisionBody.z, m[0], m[2], webbs.scale)
  }

  // Low-HP heartbeat: loop while HP < 30%, stop otherwise.
  const hpFrac = webbs.hp / webbs.hpMax
  if (hpFrac < 0.30 && hpFrac > 0) audio.playLoop('heartbeat_low_hp')
  else                              audio.stopLoop('heartbeat_low_hp')

  // Energy-depleted one-shot
  if (webbs.energy <= 0 && !energyWasDepleted) {
    energyWasDepleted = true
    audio.play('energy_depleted')
  } else if (webbs.energy > 0) {
    energyWasDepleted = false
  }

  // ── Consumable tick + per-frame buffs ────────────────────────────────────

  consumables.tick(delta * 1000)
  weaponUseSystem.staminaDrainMult = consumables.getStaminaDrainMult()
  webbs.maxProtectionActive        = consumables.isMaxProtActive()
  webbs.staminaRegenMult = currentZone === 'antColony'
    ? (webbs.isInCombat() ? 0.25 : 0.5)
    : 1.0

  // ── Walk-over pickups ────────────────────────────────────────────────────

  {
    const px = webbs.collisionBody.x
    const pz = webbs.collisionBody.z
    if (currentZone === 'homeBase') {
      const pick = (activeScene as HomeBaseScene3D).nearMaterialPickup(px, pz)
      if (pick) {
        const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
        inv[pick.mat] = (inv[pick.mat] ?? 0) + pick.qty
        registry.set('craftingInventory', inv)
        ;(activeScene as HomeBaseScene3D).collectMaterialPickup(pick.id)
        pickupNotify.notify(pick.mat, `×${pick.qty}`, '#aabbcc')
        audio.play('pickup_notify')
        xpSystem.award('pickup')
      }
    } else if (currentZone === 'antColony') {
      const acs = activeScene as AntColonyScene3D
      const cache = acs.nearMaterialCache(px, pz)
      if (cache) {
        acs.collectCache(cache)
        if (cache.mat && cache.qty) {
          const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
          inv[cache.mat] = (inv[cache.mat] ?? 0) + cache.qty
          registry.set('craftingInventory', inv)
          pickupNotify.notify(cache.mat, `×${cache.qty}`, '#88aa44')
          audio.play('pickup_notify')
          xpSystem.award('pickup')
        }
      }
      const tIdx = acs.nearThistle(px, pz)
      if (tIdx >= 0) {
        acs.collectThistle(tIdx)
        const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
        inv['Thistle'] = (inv['Thistle'] ?? 0) + 1
        registry.set('craftingInventory', inv)
        pickupNotify.notify('Thistle seed', '+1', '#cc99ff')
        audio.play('pickup_notify')
        xpSystem.award('pickup')
      }
    }
  }

  // Snapshot who is alive BEFORE weapons run, so this frame's weapon kills
  // count for XP (taking it after the weapon section missed every one).
  const enemiesBefore = currentZone !== 'bossRoller'
    ? (activeScene as HomeBaseScene3D | AntColonyScene3D).enemies.filter(e => !e.isDead())
    : []

  // ── Weapon attack — runs BEFORE enemy AI so hit detection sees this frame's swing ──

  const aimPos = input.touchActive ? touchAimPoint() : input.mouseToWorld(camera)
  const aimDx  = aimPos.x - webbs.collisionBody.x
  const aimDz  = aimPos.z - webbs.collisionBody.z

  if (dyingT < 0 && (input.mouseJustClicked() || input.justDown('TouchAttack'))) {
    const activeWeapon = webbs.weaponSystem.getSlot(lastActiveSlot)
    const fired0 = weaponUseSystem.shotsFired
    weaponUseSystem.activateWeapon(lastActiveSlot, webbs, { dx: aimDx, dz: aimDz })
    // Rock reflects ride on a swing that actually happened (not on cooldown/winded)
    if (weaponUseSystem.shotsFired > fired0 && currentZone === 'bossRoller' && isMeleeWeapon(activeWeapon)) {
      ;(activeScene as BossRollerScene3D).tryReflect(webbs, aimDx, aimDz)
    }
  }

  // Right-click / Q — Web Launcher
  if (dyingT < 0 && (input.rightMouseJustClicked() || input.justDown('KeyQ'))) {
    webLauncher.onQPressed(webbs, { dx: aimDx, dz: aimDz })
  }

  const SLOT_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8']

  // FlameBreather: continuous while key held — skip justDown handling for that slot
  let flameKeyHeld = false
  for (let i = 0; i < 8; i++) {
    const flameHeld = input.isDown(SLOT_KEYS[i]) || (i === lastActiveSlot && input.isDown('TouchAttack'))
    if (dyingT < 0 && webbs.weaponSystem.getSlot(i) === WeaponType.FlameBreather && flameHeld) {
      weaponUseSystem.tickFlame(i, webbs, delta)
      lastActiveSlot = i
      flameKeyHeld = true
      break
    }
  }
  if (!flameKeyHeld && weaponUseSystem.isFlameActive()) weaponUseSystem.stopFlame()

  for (let i = 0; i < 8; i++) {
    if (dyingT < 0 && input.justDown(SLOT_KEYS[i])) {
      const slotWeapon = webbs.weaponSystem.getSlot(i)
      if (slotWeapon === WeaponType.FlameBreather) continue
      lastActiveSlot = i   // pressing a number key makes that slot the left-click default
      const fired0 = weaponUseSystem.shotsFired
      weaponUseSystem.activateWeapon(i, webbs, { dx: aimDx, dz: aimDz })
      if (weaponUseSystem.shotsFired > fired0 && currentZone === 'bossRoller' && isMeleeWeapon(slotWeapon)) {
        ;(activeScene as BossRollerScene3D).tryReflect(webbs, aimDx, aimDz)
      }
    }
  }

  weaponUseSystem.update(delta)
  webLauncher.update(webbs, delta)

  // Pick up shake request from weapon system
  if (weaponUseSystem.lastShakeDuration > 0) {
    cameraShakeRemaining = weaponUseSystem.lastShakeDuration
    cameraShakeIntensity = weaponUseSystem.lastShakeIntensity
    weaponUseSystem.lastShakeDuration  = 0
    weaponUseSystem.lastShakeIntensity = 0
  }

  // ── Enemy / scene update ─────────────────────────────────────────────────

  if (currentZone !== 'bossRoller') {
    activeScene.updateEnemies(delta, webbs.collisionBody.x, webbs.collisionBody.z)

    // Detect kills (alive previously, now dead) and award XP.  The colony
    // reports its own (trap and pit kills count too) — see its 'kill' events.
    if (currentZone !== 'antColony') {
      for (const e of enemiesBefore) {
        if (e.isDead()) xpSystem.award('kill')
      }
    }

    for (const enemy of (activeScene as HomeBaseScene3D | AntColonyScene3D).enemies) {
      if (enemy.isDead() || enemy.contactCooldown > 0) continue
      if (enemy.staggerTimer > 0)   continue   // Round 6 Issue 3: stunned enemies do no contact damage
      if (enemy.knockbackTimer > 0) continue   // ditto — knockbacked enemies are flailing
      if (!enemy.dealsContactDamage()) continue  // only real attacks (lunge, charge, leap) hurt
      if (physicsWorld.touching(webbs.collisionBody, enemy.collisionBody, 0.05)) {
        enemy.contactCooldown = 0.75
        const landed = webbs.damage(enemy.config.damage, { fromX: enemy.collisionBody.x, fromZ: enemy.collisionBody.z })
        if (landed) {
          hud.flashDamageVignette()
          cameraShakeRemaining = 0.16
          cameraShakeIntensity = 0.012
          hitStop(0.07)
          audio.impact('hurt', webbs.collisionBody.x, webbs.collisionBody.z)
          damageNumbers.spawn(webbs.collisionBody.x, webbs.group.position.y + 0.9 * webbs.scale, webbs.collisionBody.z,
            enemy.config.damage, { hurt: true })
        }
      }
    }
  } else {
    const bs     = activeScene as BossRollerScene3D
    bs.webOnTongue = !!bs.tongueEnemy && webLauncher.attachedEnemy() === bs.tongueEnemy
    const result = bs.update(delta, webbs, weaponUseSystem, hud, webLauncher.isAttachedToWall())
    webLauncher.setEnemies(bs.enemies)   // the boss swaps its list between phases

    if (result === 'victory' && !transitioning && !victoryPending) {
      xpSystem.award('boss_kill')
      awardBossLeg('roller')
      if (bs.pendingLoot) {
        const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
        for (const [mat, qty] of Object.entries(bs.pendingLoot)) {
          inv[mat] = (inv[mat] ?? 0) + qty
        }
        registry.set('craftingInventory', inv)
        bs.pendingLoot = null
      }
      persist()   // after the loot lands
      // Let the victory beat play, then leave.  (transitionTo() sets
      // `transitioning` itself — setting it here made the call a no-op.)
      victoryPending = true
      setTimeout(() => {
        victoryPending = false
        if (!registry.get<boolean>('endingSeen')) {
          pendingEnding = true
          void transitionTo('homeBase', { title: 'Ant Tunnels Cleared  —  Home', onSwitch: startEnding })
        } else {
          void transitionTo('antColony')
        }
      }, 2000)
    } else if (result === 'defeat' && !transitioning && !victoryPending && dyingT < 0) {
      startDeath()
    }
  }

  // ── Player death (non-boss zones) ────────────────────────────────────────

  // The boss is already beaten: nothing left in the arena gets to kill him
  if (victoryPending && webbs.hp <= 0) webbs.hp = 1
  if (webbs.hp <= 0 && !transitioning && dyingT < 0) startDeath()

  webbs.updateLegs(delta)

  // ── Fog of war ───────────────────────────────────────────────────────────

  if (currentZone === 'antColony') {
    const acs = activeScene as AntColonyScene3D
    const wb = webbs.collisionBody
    acs.tickVisuals(delta, wb.x, wb.z, wb.radius, (vx, vz) => wb.addDrift(vx, vz))
    acs.updateWallOcclusion(camera, new THREE.Vector3(wb.x, 0, wb.z))
    webbs.terrainMult = acs.slowAt(wb.x, wb.z)
    if (weaponUseSystem.lastHitFrame) acs.noise('hit', wb.x, wb.z)

    // Traps, sacs and the seal report back here
    for (const ev of acs.takeEvents()) {
      if (ev.kind === 'hurt') {
        if (dyingT >= 0) continue
        const landed = webbs.damage(ev.amount, { fromX: ev.fromX, fromZ: ev.fromZ })
        if (landed) {
          hud.flashDamageVignette()
          audio.impact('hurt', wb.x, wb.z)
          damageNumbers.spawn(wb.x, webbs.group.position.y + 0.9 * webbs.scale, wb.z, ev.amount, { hurt: true })
          if (ev.label) hud.toast(ev.label, 'danger', 1600)
        }
      } else if (ev.kind === 'shake') {
        cameraShakeRemaining = Math.max(cameraShakeRemaining, ev.time)
        cameraShakeIntensity = Math.max(cameraShakeIntensity, ev.amount)
      } else if (ev.kind === 'dust') {
        particles.burst(new THREE.Vector3(ev.x, 0.4, ev.z), ev.color, ev.count, 1.6, 0.05)
      } else if (ev.kind === 'sac') {
        xpSystem.award('rare_pickup')
        hud.toast(ev.remaining > 0
          ? `The sac bursts. A scream runs through the tunnels — they're coming.  (${ev.remaining} left)`
          : 'The last sac bursts. Far to the west, the resin seal tears open.', 'danger', 5200)
        persist()
      } else if (ev.kind === 'sealOpen') {
        audio.play('celeb_swell')
      } else if (ev.kind === 'kill') {
        xpSystem.award('kill')
      } else if (ev.kind === 'heal') {
        if (webbs.hp < webbs.hpMax) {
          webbs.hp = Math.min(webbs.hpMax, webbs.hp + ev.amount)
          damageNumbers.spawn(wb.x, webbs.group.position.y + 0.9 * webbs.scale, wb.z, ev.amount, { heal: true })
        }
        pickupNotify.notify('Nectar', `+${ev.amount} HP`, '#ff6677')
        audio.play('potion_drink', wb.x, wb.z)
        particles.burst(new THREE.Vector3(ev.x, 0.3, ev.z), 0xff6677, 10, 1.4, 0.04)
      }
    }
  } else {
    webbs.terrainMult = 1
  }

  // ── Hit particles ────────────────────────────────────────────────────────

  if (weaponUseSystem.lastHitFrame) {
    particles.burst(webbs.group.position, 0xaa8855, 6, 2.5, 0.04)
  }
  particles.update(delta)
  pickupNotify.update(delta)

  // ── Camera follow ────────────────────────────────────────────────────────

  // Follow with a lean toward the cursor; zoom target follows the celebration
  // override or the wheel (rig.update eases both, plus any shake).
  rig.zoomTarget = devZoom ?? (celebZoom ? Math.max(CELEB_ZOOM, userZoom) : dyingT >= 0 ? Math.min(userZoom * 1.3, ZOOM_MAX * 1.15) : Math.min(userZoom, zoneZoomCap()))
  if (cameraShakeRemaining > 0) {
    rig.shake(cameraShakeIntensity, cameraShakeRemaining)
    cameraShakeRemaining = 0
  }
  const camFocus = currentZone === 'bossRoller' ? (activeScene as BossRollerScene3D).focus(webbs.group.position, _camFocus) : webbs.group.position
  rig.update(rawDelta, camFocus, aimPos)
  if (devPhoto) {   // dev console close-up camera (__nolegs.photo)
    camera.position.set(devPhoto[0], devPhoto[1], devPhoto[2])
    camera.lookAt(devPhoto[3], devPhoto[4], devPhoto[5])
  }
  damageNumbers.update(camera, CANVAS_W, CANVAS_H)
  inkPass.setFocusDistance(rig.viewDistance)
  lighting.update(webbs.group.position.x, webbs.group.position.y, webbs.group.position.z, webbs.scale, rig.viewDistance, delta)

  // ── Mouse cursor ─────────────────────────────────────────────────────────

  const worldMouse = input.mouseToWorld(camera)
  cursorMesh.position.x = worldMouse.x
  cursorMesh.position.z = worldMouse.z


  updatePhysicsDebug()
  input.endFrame()
  composer.render()
}

// ─── Title Menu ───────────────────────────────────────────────────────────────

function dismissTitleMenu(): void {
  mainMenuActive = false
}

function initNewGame(): void {
  audio.play('ui_title_new_game')
  // Wipe save + reset all in-memory state
  saveSystem.deleteSave()
  saveSystem.resetRegistry()   // every saved field, not just the ones listed below
  registry.set('legTier', 0)
  registry.set('bossesDefeated', [])
  webbs.weaponSystem.setLegTier(0)
  webbs.legs.setLegTier(0)
  consumables.restoreFromSnapshot({})
  scene.userData.homeBaseWarmth = 0.12   // the den's survivor warmth starts cold again
  registry.set('weaponInventory', [])
  registry.set('craftingInventory', { SilkThread: 5, ChitinShard: 5, WebFluid: 4 })
  registry.set('openingCutsceneSeen', false)
  registry.set('webThrowerFound', false)
  registry.set('toothpickCollected', false)
  registry.set('birthdayCardRead', false)
  registry.set('tutorialToothpickSeen', false)
  registry.set('tutorialWebLauncherSeen', false)
  registry.set('antColonyFirstVisit', false)
  registry.set('pickupsCollected_HomeBaseScene', [])   // Bug 13: clear collected pickups
  registry.set('bossesBeaten', 0)
  registry.set('cluesFoundIds', [])
  registry.set('totalXp', 0)                            // Round 8 Issue 8: reset XP
  xpSystem.reset()
  xpValueEl.textContent = '0'
  webbs.hasWebLauncher = false
  for (let i = 0; i < 8; i++) webbs.weaponSystem.unequip(i)
  webbs.resetAfterDeath()   // full reset: HP, stamina, energy, lockouts

  // Bug 1: destroy the stale scene (built at page-load against old registry state)
  // and rebuild a fresh HomeBaseScene3D so all pickups and objects appear correctly.
  webLauncher.release()
  webLauncher.clearWraps()
  weaponUseSystem.stopFlame()
  denProgression?.dispose(); denProgression = null
  denGuide?.dispose(); denGuide = null
  activeScene.destroy()
  const freshHbs = new HomeBaseScene3D(scene, gradientMap)
  lighting.apply('homeBase', ZONE_SCALE.homeBase, scene.userData.homeBaseWarmth as number)
  lighting.calibrateAccents('homeBase')
  activeScene  = freshHbs
  currentZone  = 'homeBase'
  weaponUseSystem.setEnemies(freshHbs.enemies)
  webLauncher.setEnemies(freshHbs.enemies)
  applyZoneScale('homeBase')
  webbs.placeAt(HomeBaseScene3D.SPAWN_X, 0)
  rig.snapTo(HomeBaseScene3D.SPAWN_X, 0)
  cameraOccluder = new CameraOccluder(camera)
  for (const m of freshHbs.getOccluderMeshes()) cameraOccluder.register(m)
  denProgression = new SurvivorsProgression(freshHbs.denHandles, scene, freshHbs.warmPools)
  startDenGuide()
  denProgression.applyState(0)

  dismissTitleMenu()
  registry.set('openingCutsceneSeen', true)
  textDisplay.show(OPENING_INTRO)
}

function initContinue(): void {
  audio.play('ui_title_continue')
  // User just interacted — AudioContext is now unlocked. The HomeBaseScene3D
  // constructor's playLoop('amb_homebase') call fired before user interaction
  // and was silently dropped, so we must retry it here.
  audio.playLoop('amb_homebase')
  dismissTitleMenu()
  if (!registry.get<boolean>('openingCutsceneSeen')) {
    registry.set('openingCutsceneSeen', true)
    textDisplay.show(OPENING_INTRO)
  } else {
    gamePaused = false
  }
}

new TitleMenu(document.getElementById('game-container')!, {
  hasSave:    saveSystem.hasSave(),
  onNew:      () => initNewGame(),
  onContinue: () => initContinue(),
})

// ─── Boot ─────────────────────────────────────────────────────────────────────

gameLoop()
requestAnimationFrame(() => audio.preload())   // after the first frame: sounds don't compete with the boot download
