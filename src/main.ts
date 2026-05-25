import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { InputManager } from './core/InputManager'
import { physicsWorld } from './core/PhysicsWorld'
import { Webbs3D } from './entities/Webbs3D'
import { HomeBaseScene3D } from './scenes/HomeBaseScene3D'
import { AntColonyScene3D } from './scenes/AntColonyScene3D'
import { BossRollerScene3D } from './scenes/BossRollerScene3D'
import { WeaponUseSystem3D } from './systems/WeaponUseSystem3D'
import { WebLauncherSystem3D } from './systems/WebLauncherSystem3D'
import { ZoneTransitionSystem3D } from './systems/ZoneTransitionSystem3D'
import { ParticleBurstSystem3D } from './systems/ParticleBurstSystem3D'
import { WeaponType } from './systems/WeaponSystem'
import { registry } from './core/Registry'
import { HudSystem } from './ui/HudSystem'
import { EquipScreen3D } from './ui/EquipScreen3D'
import { CraftingMenu3D } from './ui/CraftingMenu3D'
import { TextDisplay3D, type TextDisplayData } from './ui/TextDisplay3D'
import { PickupCelebration3D } from './ui/PickupCelebration3D'
import { PickupNotification3D } from './ui/PickupNotification3D'
import { ConsumableSystem } from './systems/ConsumableSystem'
import { saveSystem } from './systems/SaveSystem'

// ─── Renderer ────────────────────────────────────────────────────────────────

const CANVAS_W = 1280
const CANVAS_H = 720

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(CANVAS_W, CANVAS_H)
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setClearColor(0x1a1a2e)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping

document.getElementById('game-container')!.appendChild(renderer.domElement)

// ─── Post-Processing ──────────────────────────────────────────────────────────

const composer = new EffectComposer(renderer)

// ─── Scene ────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x1a1a2e, 0.008)

// ─── Isometric Camera ─────────────────────────────────────────────────────────

const FRUSTUM = 8
const aspect  = CANVAS_W / CANVAS_H

const camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect,  FRUSTUM * aspect,
   FRUSTUM,          -FRUSTUM,
  0.1, 200
)

const CAM_OFFSET = new THREE.Vector3(18, 18, 18)
camera.position.copy(CAM_OFFSET)
camera.lookAt(0, 0, 0)
camera.zoom = 1.6
camera.updateProjectionMatrix()

// Wire composer passes now that camera exists
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(CANVAS_W, CANVAS_H),
  0.35,   // strength — keep subtle so toon look is preserved
  0.4,    // radius
  0.75,   // threshold — only the most emissive objects (portals, pickups) bloom
))

// ─── Shared toon gradient map ─────────────────────────────────────────────────

const gradientData = new Uint8Array([64, 64, 64, 255, 160, 160, 160, 255, 255, 255, 255, 255])
const gradientMap  = new THREE.DataTexture(gradientData, 3, 1, THREE.RGBAFormat)
gradientMap.needsUpdate = true

// ─── Primary lighting (shared across scenes) ──────────────────────────────────

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.0)
dirLight.position.set(10, 20, 10)
dirLight.castShadow = true
dirLight.shadow.mapSize.set(2048, 2048)
dirLight.shadow.camera.near = 0.5
dirLight.shadow.camera.far  = 80
dirLight.shadow.camera.left = dirLight.shadow.camera.bottom = -25
dirLight.shadow.camera.right = dirLight.shadow.camera.top  =  25
scene.add(dirLight)

const fillLight = new THREE.DirectionalLight(0x223366, 0.25)
fillLight.position.set(-8, 6, -8)
scene.add(fillLight)

// ─── Boot: restore save before constructing scenes ───────────────────────────

saveSystem.load()

// ─── Player ───────────────────────────────────────────────────────────────────

const webbs = new Webbs3D(scene, HomeBaseScene3D.SPAWN_X, 0, gradientMap)

// ─── Combat system ────────────────────────────────────────────────────────────

const weaponUseSystem = new WeaponUseSystem3D(scene)
const webLauncher     = new WebLauncherSystem3D(scene)
const particles       = new ParticleBurstSystem3D(scene)
const consumables     = new ConsumableSystem()

// ─── Player point light (zone-aware intensity) ────────────────────────────────

const playerLight = new THREE.PointLight(0xffddaa, 0.1, 4.5)
scene.add(playerLight)

// ─── Registry defaults (new game only) ───────────────────────────────────────

if (!saveSystem.hasSave()) {
  registry.set('legTier', 0)
  registry.set('weaponInventory', [WeaponType.Sword])
  registry.set('craftingInventory', {
    SilkThread: 5, ChitinShard: 5, WebFluid: 4,
  })
}

// ─── Restore saved state into live objects ────────────────────────────────────

{
  const savedHp = registry.get<number>('health')
  if (savedHp !== undefined) webbs.hp = Math.max(1, savedHp)

  if (registry.get<boolean>('webThrowerFound')) webbs.hasWebLauncher = true

  const tier = registry.get<number>('legTier') ?? 0
  webbs.weaponSystem.setLegTier(tier)
  webbs.legs.setLegTier(tier)

  const savedSlots = registry.get<string[]>('weaponSlots')
  if (savedSlots) {
    for (let i = 0; i < savedSlots.length; i++) {
      const wt = savedSlots[i] as WeaponType
      if (wt && wt !== WeaponType.Empty) webbs.weaponSystem.equip(i, wt)
    }
  } else {
    webbs.weaponSystem.equip(0, WeaponType.Sword)
  }

  const savedConsumables = registry.get<Record<string, number>>('consumableInventory')
  if (savedConsumables) consumables.restoreFromSnapshot(savedConsumables)
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const menuOverlay    = document.getElementById('menu-overlay')!
const hud            = new HudSystem()
const equipScreen    = new EquipScreen3D(menuOverlay)
const craftingMenu   = new CraftingMenu3D(menuOverlay)
const textDisplay    = new TextDisplay3D(menuOverlay)
const pickupCelebration = new PickupCelebration3D(menuOverlay, textDisplay)
const pickupNotify   = new PickupNotification3D()

let gamePaused     = true   // stays true until main menu is dismissed
let mainMenuActive = true
equipScreen.onClose  = () => { gamePaused = false }
craftingMenu.onClose = () => {
  registry.set('consumableInventory', consumables.getInventorySnapshot())
  saveSystem.save()
  gamePaused = false
}
textDisplay.onClose  = () => {
  gamePaused = false
  if (pendingTransitionResume) { pendingTransitionResume(); pendingTransitionResume = null }
}
pickupCelebration.onClose = () => { gamePaused = false }

craftingMenu.onFirstDiscover = (wt) => {
  craftingMenu.close()
  pickupCelebration.show(wt)
  gamePaused = true
}

// ─── Narrative text ───────────────────────────────────────────────────────────

const OPENING_INTRO: TextDisplayData = {
  pages: [
    'The Den has been a spider colony\nfor as long as anyone can remember.\n\nSilk roads. Packed chambers.\nEight thousand legs, moving at once.',
    'Three seasons ago, the ants came.\n\nThey tunneled in from the west —\nslow at first, then fast. Six chambers fell.\nThe western passages went dark.',
    'Most of the colony scattered.\nYour family didn\'t.\n\nYou didn\'t either.',
    'You are Webbs.\n\nToday is your birthday.\n\nHead east — your family left something\nfor you at the end of the Den.',
  ],
  title:       '— NO LEG LEFT TO STAND ON —',
  accentColor: '#9966cc',
}

const COLONY_INTRO: TextDisplayData = {
  pages: [
    'The silk markers end here.\n\nPast this point, the ants have carved\ntheir own roads through the dirt.',
    'Whatever drove the colony out still lives\nat the far end of these tunnels.\n\nMove carefully. Trust your web.\n\nAnd watch the walls — they move.',
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

// ─── Zone management ──────────────────────────────────────────────────────────

type ZoneId = 'homeBase' | 'antColony' | 'bossRoller'
type ActiveScene = HomeBaseScene3D | AntColonyScene3D | BossRollerScene3D

let activeScene: ActiveScene = new HomeBaseScene3D(scene, gradientMap)
let currentZone: ZoneId = 'homeBase'
let transitioning = false
let pendingTransitionResume: (() => void) | null = null
let lastActiveSlot = 0   // slot fired by left-click; updated whenever a number key fires

weaponUseSystem.setEnemies((activeScene as HomeBaseScene3D).enemies)
webLauncher.setEnemies((activeScene as HomeBaseScene3D).enemies)
webLauncher.setWallHitTest((x, z) => (activeScene as HomeBaseScene3D).webWallHitTest(x, z))
hud.setZoneLabel('HOME BASE')

async function transitionTo(zone: ZoneId): Promise<void> {
  if (transitioning) return
  transitioning = true
  gamePaused    = true

  registry.set('health', webbs.hp)
  registry.set('weaponSlots', webbs.weaponSystem.getAllSlots())
  registry.set('consumableInventory', consumables.getInventorySnapshot())
  saveSystem.save()

  webLauncher.release()
  weaponUseSystem.stopFlame()

  await ZoneTransitionSystem3D.transition(() => {
    activeScene.destroy()

    switch (zone) {
      case 'homeBase': {
        const s = new HomeBaseScene3D(scene, gradientMap)
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        webLauncher.setWallHitTest((x, z) => s.webWallHitTest(x, z))
        webbs.collisionBody.x = HomeBaseScene3D.SPAWN_X
        webbs.collisionBody.z = 0
        webbs.collisionBody.velocity.x = 0
        webbs.collisionBody.velocity.z = 0
        camera.position.set(HomeBaseScene3D.SPAWN_X + CAM_OFFSET.x, CAM_OFFSET.y, CAM_OFFSET.z)
        hud.setZoneLabel('HOME BASE')
        hud.hideBossHp()
        break
      }
      case 'antColony': {
        const s = new AntColonyScene3D(scene, gradientMap)
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        webLauncher.setWallHitTest((x, z) => s.webWallHitTest(x, z))
        webbs.collisionBody.x = AntColonyScene3D.SPAWN_FROM_HOME_X
        webbs.collisionBody.z = 0
        webbs.collisionBody.velocity.x = 0
        webbs.collisionBody.velocity.z = 0
        camera.position.set(
          AntColonyScene3D.SPAWN_FROM_HOME_X + CAM_OFFSET.x,
          CAM_OFFSET.y,
          CAM_OFFSET.z,
        )
        hud.setZoneLabel('ZONE 1 — ANT COLONY')
        hud.hideBossHp()
        break
      }
      case 'bossRoller': {
        const s = new BossRollerScene3D(scene, gradientMap)
        activeScene = s
        weaponUseSystem.setEnemies(s.enemies)
        webLauncher.setEnemies(s.enemies)
        webLauncher.setWallHitTest((x, z) => s.webWallHitTest(x, z))
        webbs.collisionBody.x = BossRollerScene3D.SPAWN_X
        webbs.collisionBody.z = BossRollerScene3D.SPAWN_Z
        webbs.collisionBody.velocity.x = 0
        webbs.collisionBody.velocity.z = 0
        camera.position.set(
          BossRollerScene3D.SPAWN_X + CAM_OFFSET.x,
          CAM_OFFSET.y,
          BossRollerScene3D.SPAWN_Z + CAM_OFFSET.z,
        )
        hud.setZoneLabel('BOSS CHAMBER')
        break
      }
    }

    currentZone = zone
    const savedHp = registry.get<number>('health')
    if (savedHp !== undefined) webbs.hp = Math.max(1, savedHp)
  })

  if (zone === 'antColony' && !registry.get<boolean>('antColonyFirstVisit')) {
    registry.set('antColonyFirstVisit', true)
    textDisplay.show(COLONY_INTRO)
    gamePaused = true
    await new Promise<void>(resolve => { pendingTransitionResume = resolve })
    return
  }

  transitioning = false
  gamePaused    = false
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMeleeWeapon(wt: WeaponType): boolean {
  return wt === WeaponType.Sword || wt === WeaponType.Axe || wt === WeaponType.BoxingGloves
}

// ─── Combat callbacks ─────────────────────────────────────────────────────────

weaponUseSystem.onOutOfAmmo = () => hud.flashBossMessage('NO THISTLE SEEDS')

// ─── Game Loop ────────────────────────────────────────────────────────────────

const clock        = new THREE.Clock()
const camLookTarget = new THREE.Vector3()
let cameraShakeRemaining = 0
let cameraShakeIntensity = 0

function gameLoop() {
  requestAnimationFrame(gameLoop)
  const delta = Math.min(clock.getDelta(), 0.1)

  // ── HUD tick ─────────────────────────────────────────────────────────────

  hud.tickBossMsg(delta)

  // ── Main menu: render background but skip all game input ─────────────────

  if (mainMenuActive) {
    input.endFrame()
    composer.render()
    return
  }

  // ── Menu input (runs even when paused) ───────────────────────────────────

  if (equipScreen.isOpen)            equipScreen.update(input)
  else if (craftingMenu.isOpen)      craftingMenu.update(input)
  else if (pickupCelebration.isOpen) pickupCelebration.update(input)
  else if (textDisplay.isOpen)       textDisplay.update(input)
  else {
    // ── Dev restart (Backtick) — clears save and reloads ────────────────────
    if (input.justDown('Backquote')) {
      saveSystem.deleteSave()
      window.location.reload()
    }

    if (input.justDown('KeyI')) {
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

    if (input.justDown('KeyE')) {
      if (currentZone === 'homeBase') {
        const hbs = activeScene as HomeBaseScene3D
        if (hbs.nearToothpick(px, pz)) {
          hbs.pickupToothpick()
          registry.set('toothpickCollected', true)
          const inv = registry.get<WeaponType[]>('weaponInventory') ?? []
          if (!inv.includes(WeaponType.BoxingGloves)) inv.push(WeaponType.BoxingGloves)
          registry.set('weaponInventory', inv)
          if (!registry.get<boolean>('tutorialToothpickSeen')) {
            registry.set('tutorialToothpickSeen', true)
            pickupCelebration.show(WeaponType.BoxingGloves, TUTORIAL_TOOTHPICK.pages, TUTORIAL_TOOTHPICK.title, TUTORIAL_TOOTHPICK.accentColor)
            gamePaused = true
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
          webbs.hasWebLauncher = true
          registry.set('webThrowerFound', true)
          if (!registry.get<boolean>('tutorialWebLauncherSeen')) {
            registry.set('tutorialWebLauncherSeen', true)
            pickupCelebration.show(WeaponType.WebLauncher, TUTORIAL_WEB_LAUNCHER.pages, TUTORIAL_WEB_LAUNCHER.title, TUTORIAL_WEB_LAUNCHER.accentColor)
            gamePaused = true
          } else {
            pickupNotify.notify('Web Launcher', 'already found', '#ddeeff')
          }
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
            } else {
              hud.flashBossMessage("IT'S A MIMIC!")
            }
          } else {
            const hpIdx = acs.nearHpModule(px, pz)
            if (hpIdx >= 0) {
              acs.collectHpModule(hpIdx)
              webbs.hp = Math.min(webbs.hpMax, webbs.hp + 25)
              pickupNotify.notify('HP Module', '+25 HP', '#ff4455')
            }
          }
        }
      } else if (canCraft) {
        craftingMenu.show()
        gamePaused = true
      }
    }

    // ── Consumable hotkeys ───────────────────────────────────────────────
    if (input.justDown('KeyC')) {
      const heal = consumables.tryHpPotion()
      if (heal !== null) webbs.hp = Math.min(webbs.hpMax, webbs.hp + heal)
      else hud.flashBossMessage('No HP Potions')
    }
    if (input.justDown('KeyV')) {
      if (consumables.tryTonic() === null) hud.flashBossMessage('No Stamina Tonics')
    }
    if (input.justDown('KeyX')) {
      if (!consumables.tryMaxPotion()) hud.flashBossMessage('No Max Potions')
    }
  }

  // ── HUD (always) ────────────────────────────────────────────────────────

  hud.update(webbs)

  // ── Pause gate ───────────────────────────────────────────────────────────

  if (gamePaused) {
    input.endFrame()
    composer.render()
    return
  }

  // ── Zone exit / portal checks ────────────────────────────────────────────

  if (!transitioning) {
    const px = webbs.collisionBody.x

    if (currentZone === 'homeBase') {
      if ((activeScene as HomeBaseScene3D).checkExitLeft(px)) {
        webbs.collisionBody.velocity.x = Math.max(0, webbs.collisionBody.velocity.x)
        transitionTo('antColony')
      }
    } else if (currentZone === 'antColony') {
      const ac = activeScene as AntColonyScene3D
      if (ac.checkExitRight(px)) transitionTo('homeBase')
      if (ac.checkExitLeft(px))  transitionTo('bossRoller')
    }
  }

  // ── Player update ────────────────────────────────────────────────────────

  webbs.update(delta, input)
  physicsWorld.update(delta)
  webbs.syncPosition()

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
        }
      }
      const tIdx = acs.nearThistle(px, pz)
      if (tIdx >= 0) {
        acs.collectThistle(tIdx)
        const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
        inv['Thistle'] = (inv['Thistle'] ?? 0) + 1
        registry.set('craftingInventory', inv)
        pickupNotify.notify('Thistle seed', '+1', '#cc99ff')
      }
    }
  }

  // ── Enemy / scene update ─────────────────────────────────────────────────

  if (currentZone !== 'bossRoller') {
    activeScene.updateEnemies(delta, webbs.collisionBody.x, webbs.collisionBody.z)

    for (const enemy of (activeScene as HomeBaseScene3D | AntColonyScene3D).enemies) {
      if (enemy.isDead() || enemy.contactCooldown > 0) continue
      const dx = webbs.collisionBody.x - enemy.collisionBody.x
      const dz = webbs.collisionBody.z - enemy.collisionBody.z
      const touchDist = webbs.collisionBody.radius + enemy.config.bodyRadius + 0.05
      if (dx * dx + dz * dz < touchDist * touchDist) {
        webbs.damage(enemy.config.damage)
        enemy.contactCooldown = 0.75
      }
    }
  } else {
    const bs     = activeScene as BossRollerScene3D
    const result = bs.update(delta, webbs, weaponUseSystem, hud, webLauncher.isAttachedToWall())

    if (result === 'victory' && !transitioning) {
      if (bs.pendingLoot) {
        const inv = registry.get<Record<string, number>>('craftingInventory') ?? {}
        for (const [mat, qty] of Object.entries(bs.pendingLoot)) {
          inv[mat] = (inv[mat] ?? 0) + qty
        }
        registry.set('craftingInventory', inv)
        bs.pendingLoot = null
      }
      setTimeout(() => transitionTo('antColony'), 2000)
      transitioning = true
    } else if (result === 'defeat' && !transitioning) {
      webbs.hp = webbs.hpMax
      transitionTo('homeBase')
    }
  }

  // ── Player death (non-boss zones) ────────────────────────────────────────

  if (webbs.hp <= 0 && !transitioning) {
    webbs.hp = webbs.hpMax
    transitionTo('homeBase')
  }

  // ── Weapon attack — left-click fires lastActiveSlot; keys 1-8 fire + select ──

  const aimPos = input.mouseToWorld(camera, CANVAS_W, CANVAS_H)
  const aimDx  = aimPos.x - webbs.collisionBody.x
  const aimDz  = aimPos.z - webbs.collisionBody.z

  if (input.mouseJustClicked()) {
    const activeWeapon = webbs.weaponSystem.getSlot(lastActiveSlot)
    weaponUseSystem.activateWeapon(lastActiveSlot, webbs, { dx: aimDx, dz: aimDz })
    if (currentZone === 'bossRoller' && isMeleeWeapon(activeWeapon)) {
      ;(activeScene as BossRollerScene3D).tryReflect(webbs, aimDx, aimDz)
    }
  }

  // Right-click / Q — Web Launcher
  if (input.rightMouseJustClicked() || input.justDown('KeyQ')) {
    webLauncher.onQPressed(webbs, { dx: aimDx, dz: aimDz })
  }

  const SLOT_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8']

  // FlameBreather: continuous while key held — skip justDown handling for that slot
  let flameKeyHeld = false
  for (let i = 0; i < 8; i++) {
    if (webbs.weaponSystem.getSlot(i) === WeaponType.FlameBreather && input.isDown(SLOT_KEYS[i])) {
      weaponUseSystem.tickFlame(i, webbs, delta)
      lastActiveSlot = i
      flameKeyHeld = true
      break
    }
  }
  if (!flameKeyHeld && weaponUseSystem.isFlameActive()) weaponUseSystem.stopFlame()

  for (let i = 0; i < 8; i++) {
    if (input.justDown(SLOT_KEYS[i])) {
      const slotWeapon = webbs.weaponSystem.getSlot(i)
      if (slotWeapon === WeaponType.FlameBreather) continue
      lastActiveSlot = i   // pressing a number key makes that slot the left-click default
      weaponUseSystem.activateWeapon(i, webbs, { dx: aimDx, dz: aimDz })
      if (currentZone === 'bossRoller' && isMeleeWeapon(slotWeapon)) {
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

  webbs.updateLegs(delta)

  // ── Fog of war ───────────────────────────────────────────────────────────

  if (currentZone === 'antColony') {
    ;(activeScene as AntColonyScene3D).fog.update(
      webbs.collisionBody.x,
      webbs.collisionBody.z,
    )
  }

  // ── Hit particles ────────────────────────────────────────────────────────

  if (weaponUseSystem.lastHitFrame) {
    particles.burst(webbs.group.position, 0xaa8855, 6, 2.5, 0.04)
  }
  particles.update(delta)
  pickupNotify.update(delta)

  // ── Camera follow ────────────────────────────────────────────────────────

  camLookTarget.set(webbs.group.position.x, 0, webbs.group.position.z)
  camera.position.lerp(
    new THREE.Vector3(
      webbs.group.position.x + CAM_OFFSET.x,
      CAM_OFFSET.y,
      webbs.group.position.z + CAM_OFFSET.z
    ),
    0.1
  )
  camera.lookAt(camLookTarget)

  if (cameraShakeRemaining > 0) {
    cameraShakeRemaining -= delta
    const s = cameraShakeIntensity
    camera.position.x += (Math.random() - 0.5) * s
    camera.position.z += (Math.random() - 0.5) * s
  }

  // ── Mouse cursor ─────────────────────────────────────────────────────────

  const worldMouse = input.mouseToWorld(camera, CANVAS_W, CANVAS_H)
  cursorMesh.position.x = worldMouse.x
  cursorMesh.position.z = worldMouse.z

  // ── Player light (zone-aware) ────────────────────────────────────────────

  playerLight.position.set(webbs.group.position.x, 0.7, webbs.group.position.z)
  playerLight.intensity = currentZone === 'antColony' ? 0.8
                        : currentZone === 'bossRoller' ? 0.0
                        : 0.1

  input.endFrame()
  composer.render()
}

// ─── Main Menu ────────────────────────────────────────────────────────────────

const mainMenuEl = (() => {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute; inset:0; background:#0a0a14; z-index:200;',
    'display:flex; flex-direction:column; align-items:center; justify-content:center;',
    'font-family:monospace; transition:opacity 0.4s;',
  ].join('')

  const blinkStyle = document.createElement('style')
  blinkStyle.textContent = '@keyframes mm-blink { 0%,100%{opacity:1} 50%{opacity:0} }'
  document.head.appendChild(blinkStyle)

  const title = document.createElement('div')
  title.style.cssText = 'color:#ffffff; font-size:28px; letter-spacing:4px; text-transform:uppercase; margin-bottom:10px;'
  title.textContent = 'NO LEG LEFT TO STAND ON'

  const sub = document.createElement('div')
  sub.style.cssText = 'color:#5555aa; font-size:13px; letter-spacing:3px; margin-bottom:56px;'
  sub.textContent = 'NoLegs'

  const prompt = document.createElement('div')
  prompt.style.cssText = 'color:#aaaacc; font-size:16px; letter-spacing:2px; animation:mm-blink 1.2s step-end infinite;'
  prompt.textContent = '[ PRESS SPACE TO START ]'

  el.appendChild(title)
  el.appendChild(sub)
  el.appendChild(prompt)
  document.getElementById('game-container')!.appendChild(el)
  return el
})()

// ─── Boot ─────────────────────────────────────────────────────────────────────

gameLoop()

window.addEventListener('keydown', function onSpace(e: KeyboardEvent) {
  if (e.code !== 'Space') return
  window.removeEventListener('keydown', onSpace)

  mainMenuEl.style.opacity = '0'
  setTimeout(() => { mainMenuEl.style.display = 'none' }, 420)
  mainMenuActive = false

  if (!registry.get<boolean>('openingCutsceneSeen')) {
    registry.set('openingCutsceneSeen', true)
    textDisplay.show(OPENING_INTRO)
    // textDisplay.onClose will set gamePaused = false
  } else {
    gamePaused = false
  }
})
