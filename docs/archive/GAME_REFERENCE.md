# NoLegs — Complete Game Reference Document
_"No Leg Left to Stand On"_

Generated from full source read of `D:\dmorgan\Documents\GitHub\SpiderGame\src\` as of 2026-05-23.

---

## 1. Project Overview

| Property | Value |
|---|---|
| **Title** | No Leg Left to Stand On (working title: NoLegs) |
| **Engine** | Phaser 3 (AUTO renderer — WebGL preferred) |
| **Language** | TypeScript (strict mode — no unused vars, no type conflicts) |
| **Build tool** | Vite |
| **Deploy target** | Cloudflare Pages — `playnoleg.th3dan.com` |
| **Repo** | github.com/th3d4n/SpiderGame |
| **Canvas size** | 1280 × 720, background `#1a1a2e` |
| **Physics** | Arcade (no gravity, `debug: false`) |

**Player character:** Saudi Webbs — a spider with 8 robotic legs, each can hold one weapon. The visual identity is monospace-font HUD, hand-drawn vector art via `Phaser.GameObjects.Graphics`, no sprite sheets.

**Phase 1 scope:** Home Base + Ant Colony + Boss Roller (dual-phase). Crafting and leg-tier progression. Section 9-11 (save, cutscenes, zone beat, toothpick balance) now implemented.

**TypeScript constraints:**
- Cloudflare strict build: every file must compile clean
- `enum` is banned (`erasableSyntaxOnly`); use `const` objects + type alias
- `Phaser.GameObjects.Container` reserves the `body` property — always use `pb` for the `Phaser.Physics.Arcade.Body` reference on Container-based entities

---

## 2. Scene Pipeline and Flow

### Scene registration order (main.ts)

```
BootScene → PreloadScene → MainMenuScene → HomeBaseScene → AntColonyScene →
GameScene (dev) → BossRollerScene →
HUDScene (overlay) → CraftingMenu (overlay) → EquipScreen (overlay) →
PickupNotification (overlay) → PickupCelebration (overlay) →
TextDisplayScene (overlay) → ZoneTransitionBeat (transition)
```

All scenes registered at game creation. Overlays are `scene.launch()`-ed on top of gameplay scenes and stopped when dismissed. Gameplay scenes are **paused** (not stopped) while an overlay is open, then **resumed** when the overlay closes.

### Startup flow

```
BootScene.create()
  → saveSystem.loadIntoRegistry(registry)   ← restore persisted state
  → scene.start('PreloadScene')

PreloadScene.create()
  → scene.start('MainMenuScene')

MainMenuScene.create()
  → SPACE pressed:
      first time: set openingCutsceneSeen=true, save, launch TextDisplayScene (OPENING_PAGES)
      TextDisplayScene.dismiss() → resumes MainMenuScene → events.once('resume') fires → scene.start('HomeBaseScene')
      returning: scene.start('HomeBaseScene') immediately
```

### Zone-to-zone transitions

All cross-zone navigation runs through `ZoneTransitionSystem.transition()`:

1. Camera fade to black (400 ms)
2. `ZoneTransitionBeat` scene starts (black screen + zone label for ~2 s, skippable)
3. Target scene starts

The entry direction is stored in registry key `zoneEntryFrom` so the new scene knows which edge Webbs entered from and can place the spawn.

### Overlay pattern (menus)

Menus launched with `scene.launch()` while the gameplay scene is `scene.pause()`-ed. On close, menu calls `scene.resume(callerScene)` and `scene.stop()`. HUDScene is put to `sleep()` by EquipScreen to avoid bar overlap.

---

## 3. Every Scene

### BootScene (`src/scenes/BootScene.ts`)
- **Purpose:** First scene — restore save before any gameplay scene reads registry.
- **Key behavior:** Calls `saveSystem.loadIntoRegistry(this.registry)` then immediately starts PreloadScene.
- **No gameplay state.**

### PreloadScene (`src/scenes/PreloadScene.ts`)
- **Purpose:** Asset loading screen (currently no real assets — all graphics are procedural).
- **Draws:** Loading bar (`width: 400, height: 20`), title "NO LEG LEFT TO STAND ON", progress text.
- **Immediately starts MainMenuScene in `create()`.**

### MainMenuScene (`src/scenes/MainMenuScene.ts`)
- **Purpose:** Title screen + opening cutscene gate.
- **OPENING_PAGES:** 4 pages of narrative (the Den, the ant invasion, your family, your birthday).
- **Logic:**
  - First SPACE press: sets `openingCutsceneSeen = true`, saves, launches `TextDisplayScene` with opening pages; callerScene = `'MainMenuScene'`.
  - `events.once('resume')` on MainMenuScene fires when TextDisplayScene dismisses → `scene.start('HomeBaseScene')`.
  - Subsequent SPACE presses: skips to HomeBaseScene directly.
- **Registry reads:** `openingCutsceneSeen`
- **Registry writes:** `openingCutsceneSeen`, `textDisplayData`

### HomeBaseScene (`src/scenes/HomeBaseScene.ts`)
- **World size:** 2560 × 720
- **Floor Y:** 660 (= WORLD_H − 60)
- **Camera:** follows Webbs, `setBounds(0,0,2560,720)`, `setZoom(1.15)`
- **Purpose:** Safe-zone tutorial area. Birthday narrative, first weapon pickup, workbench for crafting, exit left to Ant Colony.
- **Key objects:**
  - `Workbench` at (1820, 620) — opens CraftingMenu on E within 60 px
  - Birthday card at x=2200 (envelope visual), birthday gift at x=2380 (box visual)
  - Toothpick weapon pickup at (1200, 630) with id `'hb-toothpick'`
  - 11 material pickups scattered x=400..2000
- **Birthday sequence:**
  1. Read card → TextDisplayScene (CARD_PAGES, 5 pages), callerScene = HomeBaseScene
  2. After card read, open gift (E) → equip WebLauncher into slot 0 → PickupCelebration + WEB_THROWER_TUTORIAL (4 pages)
  3. Gift requires card to be read first; prompt changes to "Read the card first" otherwise
  4. Guard flags: `cardTextLaunching`, `birthdaySequenceLaunching` prevent double-launch on the same frame
- **Left-exit trigger:** `webbs.x < 100` → `ZoneTransitionSystem.transition(this, 'AntColonyScene', 'left', health)`
- **Pickup collection:** Manual proximity sweep every frame, radius 50 px (body+legs covers). Web launcher pickup uses 24 px radius.
- **Overlay keys:** I → EquipScreen; Q → WebLauncher; 1-8 → weapon slots; click → re-fire active slot toward pointer
- **Syncs registry every frame** (health, stamina, energy, weaponSlots, unlockedSlots, legTier, zoneName='HOME BASE')
- **Saves on workbench open and on left-exit.**

### AntColonyScene (`src/scenes/AntColonyScene.ts`)
- **World size:** 7500 × 5000
- **Camera:** `setZoom(1.15)`, follows Webbs
- **Purpose:** Zone 1. Five-level maze. Enemies, chests, fog of war, boss portal.

#### Corridor layout
| Level | Y band | Y center |
|---|---|---|
| C1 | 300–580 | 440 |
| C2 | 1050–1330 | 1190 |
| C3 | 1900–2180 | 2040 (entry) |
| C4 | 2750–3030 | 2890 |
| C5 | 3700–3980 | 3840 |

Wall blocks between corridor levels (B12, B23, B34, B45) each have 3 main vertical passages (280 px wide) and 2 dead-end stubs per direction. `BOSS_Y_SLOTS = [440, 1190, 2040, 2890, 3840]` — boss portal picks a random one each run, excluding the previous run's slot (stored in registry `lastBossSlot`).

#### Portals
- **Home portal:** x=7390, y=2040 (C3 right edge) — triggers HomeBaseScene transition when Webbs is within 65 px
- **Boss portal:** x=180, y=bossPortalY — triggers BossRollerScene transition

#### Fog of war
- `RenderTexture` at 1/FOG_SCALE (= 10) resolution → 750×500 px, scaled ×10 to fill world
- Depth 51, LINEAR filter on texture source
- `fogEraserGfx` (an off-screen Graphics) casts 48 rays (FOG_RAY_COUNT) per frame in a star pattern, max range 300 px, ray step 14 px. Points that hit a wall cut the ray short. The resulting visibility polygon is drawn into the eraser at fog-texture coordinates (world ÷ FOG_SCALE).
- `fog.erase(fogEraserGfx)` — carves transparent holes into the black fog permanently (cumulative reveal).
- Skip re-erasing if player moved less than 4 px (FOG_MOVE_THRESHOLD_SQ = 4²).
- An ambient 45% black overlay (depth 50) stays over revealed areas to keep the cavern look dark.

#### Above-fog lantern beacons
Single ADD-blend Graphics at depth 60. Every algae lantern position (gathered during `drawBackground()` and `drawGapMarkers()`) is rendered as a small green dot above the fog, visible from inside the shroud. Does NOT illuminate surrounding pixels — just a point of light.

#### Enemy system
- 23 spawn points defined across all 5 corridor levels
- Enemy types: `CentipedeAmbusher` ('centipede') and `BeetleTank` ('beetle')
- Off-screen culling: if enemy is >900 px from player (ACTIVE_RADIUS_SQ = 900²), physics body is disabled (`pb.setEnable(false)`) and update is skipped
- Dead enemies respawn after 22,000 ms; respawn is blocked if spawn point is within 280 px of player
- `events.on('enemyDied', spawnLootAt)` — loot drops at death position; thistles have 70-90% recovery chance per embedded thistle
- Loot despawn: `time.delayedCall(40000, ...)` fades and destroys uncollected drops

#### Dead-end rooms (14 total)
Rooms are typed at create() with randomised assignment:
- `'spike'` — red floor tint, spike silhouettes; triggers 20 damage + knockback on enter
- `'ambush'` — no visible tell; spawns 2 extra CentipedeAmbushers
- `'mimic'` — contains a Chest entity (25% chance it's a mimic)

#### Squeeze-through effect
When Webbs is in a corridor tighter than 300 px (SQUEEZE_TRIGGER_GAP), scale is tweened to 0.65 and body radius shrinks from WEBBS_BODY_R_NORMAL (22) to WEBBS_BODY_R_SQUEEZE (14). Restored to scale 1 when gap opens.

#### In-combat stamina regen (Section 11)
- `lastCombatTime` tracks when a weapon last landed or an enemy was within 300 px
- If `(time - lastCombatTime) < 3000` → in-combat → `webbs.staminaRegenMult = 0.25`
- Else out-of-combat (but still in zone) → `webbs.staminaRegenMult = 0.5`
- Regen multiplier 1.0 is only reached in HomeBaseScene (not wired here)

#### Consumable keys
- **C** → HP Potion (+40 HP)
- **V** → best available Stamina Tonic (I=15s, II=30s, III=60s)
- **X** → Max Potion (full HP+stamina, 10s damage immunity + knockback immunity)

#### Chest system
`Chest.update()` called in `updateChests()` when chest is within ACTIVE_RADIUS_SQ. Returns `{ opened: ChestLoot[] }` or `{ mimicAttack: { damage: 30, angle } }`.

#### On player death
HP reset to max, `cameras.main.fade(700)`, then `scene.start('HomeBaseScene')` after 700 ms.

### GameScene (`src/scenes/GameScene.ts`)
- **Legacy dev sandbox.** 1280×720, 3 CentipedeAmbusher, 1 Workbench at (200,200), boss door trigger at x>1140.
- **Not the primary play path.** Used only by BossRollerScene's `playerDied()` return target (`scene.start('GameScene')`) and `rollerDefeated()` victory path. This is a known stub — see section 15.
- No weapon systems hooked up beyond initial loadout.

### BossRollerScene (`src/scenes/BossRollerScene.ts`)
- **World:** 1280×720 (no scrolling; physics world bounds 0,80 to 1280,600)
- **Camera:** `setZoom(1.0)`, follows Webbs with 0.12 lerp
- **Purpose:** Dual-phase boss fight.

#### Phase 1 — The Nose
- `BossNose` at (640, 72), static on ceiling, 80 HP
- **Rock volleys:** every 3000 ms, 2-3 rocks drop from nose toward player (spread ±0.45×120 px), speed 170-310 px/s, bounce 0.45
- **Suction cycle:** every 20,000 ms:
  - 2000 ms warning ("SUCTION INCOMING")
  - 4000 ms active phase: nose pulls player + rocks at 520 px/s force; anchored (Q) reduces force to 20 px/s
  - Player absorbed if within 150 px of nose while unanchored → instant death (damage = 200)
- **Melee reflection:** any melee weapon (Sword, Axe, BoxingGloves) within 95 px of a rock in a 160° sweep reflects the rock toward the nose (±22° spread). Color changes from brown to orange. Reflected rock hitting nose deals 20 damage.
- **Physical barrier:** invisible static body at y=182, width=360, stops spider from climbing to melee range directly
- Phase ends when BossNose.isDead() → nose tweens off-screen → `startPhase2()`

#### Phase 2 — The Roller
- `RollerBoss` spawns at (300, 360)
- Attacks: `bodySlam` (charge at player, 580 ms), `groundPound` (emit shockwave, 25 damage), `tailSwipe` (117° arc on tail side, 20 damage)
- Player weapons now target the roller
- Defeat → `rollerDefeated()` → shakes, shows "ANT TUNNELS CLEARED!", fades, `scene.start('GameScene')` + sets `antTunnelsClear = true`
- Player death → `scene.start('GameScene')` (see note above — this is a stub)

### HUDScene (`src/ui/HUD.ts`)
- **Overlay scene (never stopped, launched once).** Reads registry every frame.
- **Panels:**
  - **Zone label** (top-left, 220×34): shows `registry.get('zoneName')`
  - **HP bar** (top-right, 200×34): color shifts red→orange→bright-red below 50%/25%
  - **Stamina + Energy bars** (bottom-left): STAM (yellow), ENRG (blue-violet)
  - **Weapon ring** (bottom-center): 8 slot circles at SLOT_RING_R=55 radius, SLOT_R=13, arranged at `(i/8)*2π` — same geometry as Webbs legs
  - **Ammo counter**: visible only when Bow is equipped; shows `craftingInventory.Thistle` count
  - **Controls legend** (bottom-right): H key toggles visibility
- **Slot rendering:** locked slots get `×` (dim), empty unlocked gets `·`, equipped gets weapon icon via `drawWeaponIcon()`

### EquipScreen (`src/ui/EquipScreen.ts`)
- **Overlay scene.** Pauses callerScene; puts HUDScene to sleep.
- **Layout:** Left panel = 8 slot circles at SLOT_RING_R=100 (larger than HUD); Right panel = weapon inventory list; Bottom strip = detail panel.
- **Input:**
  - Arrow keys navigate slots/inventory; Left/Right arrow switches panel focus
  - ENTER equips selected weapon to selected slot
  - 1-8 keys: select that slot and equip immediately if a weapon is selected
  - X: unequip current slot (weapon returns to inventory)
  - I or ESC: close; resumes callerScene, wakes HUDScene
- **Displaced weapon** (slot already occupied) returns to inventory rather than being lost.
- **Registry reads on create:** `weaponSystemRef`, `weaponInventory`, `equipCallerScene`
- **Registry writes on close:** `weaponInventory` (updated in-place)

### CraftingMenu (`src/ui/CraftingMenu.ts`)
- **Overlay scene.** Pauses callerScene. Key: `'CraftingMenu'`.
- **Layout:** 440×380 panel, recipe list (with icons), inventory sidebar (all material counts), cost line, status flash.
- **Input:** Up/Down navigate, SPACE craft, ESC close.
- **On craft:**
  1. Deducts materials from local inventory copy
  2. Pushes crafted weapon to `registry.get('weaponInventory')` and updates `craftingInventory` in registry
  3. Emits `itemCrafted` event for PickupNotification
  4. First craft of a weapon type → launches PickupCelebration (no tutorial pages)
  5. Tracks `discoveredWeapons` in registry
- **findOnly recipes** show in the list but block crafting with "Cannot craft — find this weapon in the world"

### TextDisplayScene (`src/scenes/TextDisplayScene.ts`)
- **Overlay scene.** Pauses `displayData.callerScene`.
- **Data shape:** `{ pages: string[], title?: string, color?: number, callerScene: string }`
- **Read from:** `registry.get('textDisplayData')`
- **Panel:** 460×280, border color = `displayData.color`
- **Advance key:** M (TEXT_ADVANCE_KEY) — next page, or dismiss on last page
- **Skip key:** SPACE (TEXT_SKIP_KEY) — jump to dismiss immediately
- **Dismiss:** `scene.resume(callerScene)`, `scene.stop()`

### ZoneTransitionBeat (`src/scenes/ZoneTransitionBeat.ts`)
- **Full-screen transition.** Not an overlay — it's started (replaces current scene context).
- **Data:** `registry.get('transitionBeatData')` → `{ targetKey, label, subtitle }`
- Fades in label + subtitle, holds 2000 ms (SPACE or M skips), fades out, then `scene.start(targetKey)`.
- Fallback: if no data, `scene.start('HomeBaseScene')`.

### PickupCelebration (`src/scenes/PickupCelebration.ts`)
- **Overlay scene.** Pauses `celeb.callerScene`.
- **Data shape:** `CelebData { itemName, description, color, weaponType?, callerScene, tutorialPages?, tutorialTitle? }`
- **Read from:** `registry.get('celebData')`
- Shows item icon (weapon graphic or gem diamond), name, description. Item has entrance pop (Back.easeOut) + idle bob.
- **Dismiss:** if `tutorialPages` present → launches TextDisplayScene with those pages (TextDisplayScene then resumes callerScene when done). Otherwise resumes callerScene directly.

### PickupNotification (`src/ui/PickupNotification.ts`)
- **Persistent overlay scene.** Launched once, never stopped.
- **Listens to scene events** across all non-HUD/equip scenes: `itemPickedUp`, `itemCrafted`, `chestLooted`.
- Shows a 240×50 card (slide up from bottom, stay 1800 ms, fade out 300 ms). One card visible at a time; others queue.
- Three card types: pickup (material name + "+N"), craft ("Crafted: Name"), chest ("Found: label + qty").

### ZoneTransitionSystem (not a scene — static methods in `src/systems/ZoneTransitionSystem.ts`)
See Section 5.

---

## 4. Every Entity

### Webbs (`src/entities/Webbs.ts`)
**Extends:** `Phaser.GameObjects.Container`

| Constant | Value |
|---|---|
| `PLAYER_MAX_HP` | 100 |
| `WEBBS_BODY_R_NORMAL` | 22 |
| `WEBBS_BODY_R_SQUEEZE` | 14 |
| `SPEED` | 220 px/s |
| `LEG_COUNT` | 8 |
| `LEG_LENGTH` | 40 px |
| `STAMINA_REGEN` | 40 / second |
| `STAMINA_RECOVER_AT` | 0.2 × maxStamina (winded clears here) |
| `WINDED_SPEED_MULT` | 0.65 |
| `REGEN_DELAY_MS` | 6000 ms (grace period before HP regen) |
| `REGEN_RATE` | 2 HP/second |

**Constructor:** `(scene, x, y)` — creates arcade body as circle radius 22, `setCircle(r, -r, -r)` to center it. Builds 8 legs (Line + Arc tip + Container for weapon graphic).

**Public fields:**
- `pb: Phaser.Physics.Arcade.Body` — the arcade body (use this, not `body`)
- `stamina`, `maxStamina` (100/100)
- `energy`, `maxEnergy` (100/100)
- `hp`, `hpMax` (100/100)
- `facingX`, `facingY` — direction of last WASD movement
- `weaponSystem: WeaponSystem`
- `winded: boolean` — true when stamina hit 0; speed reduced until `stamina ≥ 0.2 × maxStamina`
- `maxProtectionActive: boolean` — set by ConsumableSystem; blocks HP loss and knockback
- `staminaRegenMult: number` — set by scene each frame (1.0 normal, 0.5 out-of-combat colony, 0.25 in-combat colony)

**Key methods:**
- `setBodyRadius(r)` — resizes circle body, centered with offset `(-r, -r)`
- `refreshLegColors()` — rebuilds weapon graphics and re-tints each leg based on equipped weapon
- `playWeaponAnim(legSlot, style, durationMs)` — triggers one-shot animation on leg tip. Styles: `'stab'`, `'swing'`, `'punch'`, `'draw'`, `'flap'`, `'spray'`
- `damage(amount)` — respects `maxProtectionActive`; triggers red flash + expanding ring VFX
- `resetHp(amount?)` — resets hp (and damage timer)
- `isDead()` — `hp <= 0`

**Leg visual geometry:** Leg `i` base angle = `(i / 8) × 2π`. While moving: `legAngleOffset += dir × delta × 0.003`. Stretch = `1 + sin(angle*2 + offset*3) × 0.15`. Weapon containers rotate with `angle + extraSpin`.

**Leg colors (default):** [red, orange, yellow, green, cyan, blue, magenta, white]
Overridden by `WEAPON_COLORS[weapon]` when equipped.

**WASD input:** Both arrow keys and WASD. Diagonal movement normalized by ×0.707.

**Body uses `setCollideWorldBounds(true)` and drag `(600,600)` in enemies (Webbs has no drag).**

---

### Enemy (abstract base) (`src/entities/Enemy.ts`)
**Extends:** `Phaser.GameObjects.Container`

**Config interface:**
```typescript
EnemyConfig {
  health, speed, damage, weakPoints: WeakPointZone[],
  weakMultiplier, staggerDuration, bodyRadius,
  knockbackResist?: number,   // default 0
  loot?: LootDrop[]
}
```

**WeakPointZone:** `'Head' | 'Tail' | 'Body' | 'Underbelly'`

**Body setup:** `setCircle(r, -r, -r)`, linear drag `(600, 600)`.

**Combat API:**
- `takeDamage(amount, zone)` — applies weak-point multiplier; on death: rolls loot, emits `'enemyDied'` event with `{ x, y, loot[], stuckThistles }`, calls `onDeath()`
- `applyKnockback(vx, vy)` — scaled by `1 - knockbackResist`
- `addStuckThistle()` — tracks how many thistle arrows are embedded

**Damage popup:** floating `-N` text rises 28 px over 650 ms (Cubic.easeOut), depth 60.

**Default onDeath():** disables physics body, tweens scale to 0.15 and alpha to 0 over 380 ms, then destroys.

**flashDamage():** alpha blinks to 0.2 twice (55 ms each, no tint — container doesn't support setTint).

---

### CentipedeAmbusher (`src/entities/CentipedeAmbusher.ts`)
**Extends:** Enemy

| Stat | Value |
|---|---|
| Health | 30 |
| Speed | 130 px/s |
| Damage | 12 |
| Weak point | Head (×2.0) |
| Stagger duration | 420 ms |
| Body radius | 14 |
| Knockback resist | 0.1 |

**Loot:** ChitinShard×1 (90%), VenomGland×1 (25%), SilkThread×1 (30%)

**States:** `HIDING → BURSTING → CHASING`

- HIDING: dormant (pb disabled), trigger radius 190 px
- BURSTING: `enterBurst()` — dirt particle explosion (upward fan), scale tween 0.05→1 over 585 ms
- CHASING: `ChaseModes: TRACKING → WINDUP → LUNGING → RECOVERING`
  - TRACKING: slow stalk at 70 px/s, turns at 4.5 rad/s
  - WINDUP (320 ms): freezes, eyes flare amber, mandibles spread wider
  - LUNGING (280 ms): flies at 320 px/s toward locked direction
  - RECOVERING (620 ms): stationary

**Visuals:** Head at local (0,0), 3 body segments tapering upward (+Y is behind). Mandibles, amber weak-point dot, red eyes.

---

### BeetleTank (`src/entities/BeetleTank.ts`)
**Extends:** Enemy

| Stat | Value |
|---|---|
| Health | 80 |
| Speed | 48 px/s (patrol) |
| Damage | 20 |
| Weak point | Underbelly (×1.8) |
| Stagger duration | 700 ms |
| Body radius | 26 |
| Knockback resist | 0.65 |

**Loot:** ChitinShard×2 (100%), BoneFragment×1 (70%), ChitinShard×1 (40%)

**AI:** Horizontal patrol (reversing at walls / world edge x>2400 or x<200). When player is within 260 px (CHARGE_RANGE) and cooldown <= 0: charges at 290 px/s for 680 ms, cooldown 3600 ms.

**Visuals:** Dark green ellipse shell, red eyes, heavy mandibles, 6 stubby legs, armor spike.

---

### RollerBoss (`src/entities/RollerBoss.ts`)
**Extends:** Enemy

| Stat | Value |
|---|---|
| Health | 100 |
| Patrol speed | 115 px/s |
| Charge speed | 390 px/s |
| Body radius | 42 |
| Knockback resist | 0.9 |
| Wall bounds | x 100..1180 |

**Loot (all 100%):** CrystalDust×3, BoneFragment×2, VenomGland×2, ChitinShard×3

**Attack states:** `idle | charging | groundPound | tailSwipe`

| Attack | Cooldown | Duration | Effect |
|---|---|---|---|
| bodySlam | 2600 ms | 580 ms | Charge toward player at 390 px/s; `event('bodySlam')` |
| groundPound | 3800 ms | 700 ms windup | `event('groundPoundWindup', x, y)` then `event('groundPoundRelease', x, y)` |
| tailSwipe | 3200 ms | 500 ms | `event('tailSwipe', x, y, facingDir)` |

- `setTarget(x, y)` — called by scene each frame
- `scaleX = facingDir` (−1 to mirror snout left)
- `isSnoutHit(wx, wy)`: snout world-x = `this.x + SNOUT_OFFSET(62) × facingDir`, radius 20+12=32
- **Death override:** topples (angle→90, y+45 over 650 ms), then fades over 800 ms delay 500 ms.

---

### BossNose (`src/entities/BossNose.ts`)
**Extends:** Enemy

| Stat | Value |
|---|---|
| Health | 80 |
| Weak point | Head (×1.5) |
| Body radius | 40 |
| Oval visual | 120×70 px |

- `pb.setImmovable(true)`, `setAllowGravity(false)` — never moves
- `applyKnockback()` overridden to no-op (cannot slide off ceiling)
- `update()` zeroes velocity each frame to prevent nudge drift

---

### Workbench (`src/entities/Workbench.ts`)
**Extends:** `Phaser.GameObjects.Container`

- Visual: outer glow ring (pulsing tween), dark rectangle "table", two legs, "WB" label, proximity prompt
- `update(target, eKey, eJustDown?)`: shows prompt within 60 px, returns `true` when E pressed in range (trigger for scene to open CraftingMenu)

---

### Pickup (`src/entities/Pickup.ts`)
**Extends:** `Phaser.GameObjects.Container`

- **Static arcade body** (circular, radius 14, offset −14,−14)
- **Idle bob tween:** ±4 px over 1200 ms
- `pickupId: number` — set by scene for persistence tracking (−1 = ephemeral loot drop)
- `collect()`: one-shot; calls `craftingSystem.addMaterial()`, emits `'itemPickedUp'`, scale+alpha out tween

**Material colors and labels** defined in file (e.g., SilkThread=0xddddff "Silk Thread", CrystalShard=0x88ccff "Crystal Shard").

---

### WeaponPickup (`src/entities/WeaponPickup.ts`)
**Extends:** `Phaser.GameObjects.Container`

- Static arcade body, radius 16
- `pickupId: string` — unique per-world-instance id (e.g., `'hb-toothpick'`)
- `collect()`: one-shot; appends weapon to `registry.get('weaponInventory')`, emits `'itemCrafted'`
- Idle bob + halo pulse tweens

---

### HpModule (`src/entities/HpModule.ts`)
**Extends:** `Phaser.GameObjects.Container`

- Restores 25 HP (`HP_MODULE_AMOUNT`) on collect
- **Rendering split:**
  - `dot` + `dotCore` are top-level scene objects at `depth 60` with ADD blend — visible through fog as a green point
  - Body (capsule graphic + halos) is inside the container at default depth — only visible after fog cleared
- Bob tween targets `[this, this.dot, this.dotCore]` simultaneously
- `collect()`: kills all tweens, scale+alpha out, then destroys dot/dotCore + container
- Emits `'hpModulePicked'` with `{ amount: 25, x, y }`

---

### Chest (`src/entities/Chest.ts`)
**Extends:** `Phaser.GameObjects.Container`

- `isMimic: boolean` — 25% chance set by scene
- States: `idle → vibrating → open/spent`
- **Normal chest:** E within 80 px → `rollChestLoot(3)` → lid opens, returns `{ opened: ChestLoot[] }`
- **Mimic chest:** wakes at 120 px (eyes glow, vibrate); E within 80 px → red burst flash, hides self, returns `{ mimicAttack: { damage: 30, angle } }`
- Uses `ChestLootTable.rollChestLoot()` — see Section 6

---

## 5. Every System

### WeaponSystem (`src/systems/WeaponSystem.ts`)

8-slot weapon rack with leg tier gating.

**Slot unlock tiers:** `[0, 0, 1, 1, 2, 2, 3, 3]` — tier 0 unlocks slots 0-1, tier 1 unlocks 2-3, etc.

**Key methods:**
- `equip(slot, type)` — returns false if slot locked or tier insufficient
- `unequip(slot)` — sets to Empty
- `canEquip(slot, type)`
- `setLegTier(tier)` — drops weapons from slots that no longer qualify
- `getAllSlots()` — returns copy of all 8 slots
- `getUnlockedSlotCount()` — number of slots accessible at current tier
- `isSlotUnlocked(slot)`

**WeaponType values** (const object, not enum):
`Empty | Sword | Bow | Axe | BoxingGloves | Glider | FlameBreather | WebLauncher`

---

### WeaponUseSystem (`src/systems/WeaponUseSystem.ts`)

Handles firing all combat weapons except WebLauncher.

**Key fields:**
- `enemies: Enemy[]` — set via `setEnemies()`
- `cooldowns: number[8]` — per-slot cooldown timers
- `staminaDrainMult: number` — multiplied onto all stamina costs (from ConsumableSystem)
- `lastHitFrame: boolean` — true for one frame when any weapon landed a hit (read by AntColonyScene for in-combat tracking)

**`activateWeapon(slot, webbs, scene, aim?)`**
- Respects cooldown
- Temporarily overrides `webbs.facingX/Y` if `aim` provided, restores after

**Sword:** radius 70, sweep 90°, damage 18, stamina 10, cooldown 280 ms, knockback 180, shake (80ms, 0.004)

**Axe:** radius 88, sweep 170°, damage 44, stamina 22, cooldown 760 ms, knockback 520, shake (180ms, 0.012)

**BoxingGloves (Toothpick):** radius 90, cone 28°, damage 14, stamina 15, cooldown 220 ms, knockback 200, shake (70ms, 0.006)

**Bow:** speed 320 px/s, damage 22, stamina 12, cooldown 380 ms, consumes 1 Thistle from `craftingInventory`; thistle sticks in enemy on hit (`enemy.addStuckThistle()`); out-of-bounds projectile emits `'thistleDropped'`

**FlameBreather:** continuous; energy drain 2/frame; DPS 18/s (checked every 66 ms), cone 45°, range 120 px; ADD blend particle emitter. Stop via `stopFlame()`.

**Hit VFX textures** (generated once via `generateTexture`): `'hit-ichor'` (green dots), `'hit-chunk'` (dark meat rectangles), `'hit-spark'` (yellow dots)

---

### WebLauncherSystem (`src/systems/WebLauncherSystem.ts`)

Handles the Web Thrower. Always available via Q regardless of slot (as a special override) but also mapped to a slot (slot 0 by default from birthday gift).

**Key constants:**
- Projectile speed: 700 px/s
- Max range: 480 px
- Pull velocity: 900 px/s
- Pull duration: 350 ms
- Idle release: 4500 ms (auto-releases attached-to-wall after this)
- Cooldown: 220 ms
- Stamina cost: 8

**State machine:**
1. Q pressed → fire projectile (small white arc at 700 px/s)
2. Projectile travels, checking: pickup hit test → enemy (<28 px) → wall hit test → max range/out-of-world → recall
3. On attachment: `startPull(webbs)` — applies velocity for 350 ms
4. Enemy pull: if `knockbackResist >= 0.5` (heavy) → player pulls toward enemy; else enemy pulls toward player
5. Pickup pull: translates pickup container directly each frame; auto-collects when within 36 px
6. Wall attachment: player yanked toward wall; stays attached until Q pressed again or 4500 ms idle timeout
7. Q pressed while state exists → `release()` regardless of state
8. `isAttachedToWall()` → true when BossRollerScene uses this as suction anchor

**Scene wiring:**
- `setWallHitTest(fn)` — each scene provides a closure testing its own geometry
- `setPickupHitTest(fn)` — closure to scan material+weapon pickups at a given point
- `setEnemies(list)` — same enemy list as WeaponUseSystem

---

### CraftingSystem (`src/systems/CraftingSystem.ts`)

Simple `Map<MaterialType, number>` with snapshot serialization.

**MaterialType values:**
`SilkThread | ChitinShard | VenomGland | WebFluid | CrystalDust | BoneFragment | Thistle | Stone | Wood | BugPartsAnt | DriedFungus | CrystalShard`

**RECIPES array (6 entries):**

| Recipe | Display name | Materials | Tier | findOnly |
|---|---|---|---|---|
| Sword | Silk Sword | SilkThread×3, ChitinShard×2 | 0 | no |
| Bow | Web Bow | SilkThread×4, WebFluid×2 | 0 | no |
| Axe | Chitin Axe | ChitinShard×4, BoneFragment×2 | 1 | no |
| BoxingGloves | Toothpick Stabber | SilkThread×2, WebFluid×3 | 1 | **yes** |
| Glider | Web Glider | SilkThread×5, WebFluid×4, CrystalDust×1 | 2 | no |
| FlameBreather | Flame Breather | VenomGland×3, CrystalDust×2, ChitinShard×2 | 2 | no |

`findOnly = true` means the recipe shows in the workbench but cannot be crafted — must be found in the world.

**Methods:** `addMaterial()`, `getAmount()`, `canCraft()`, `craft()`, `getInventorySnapshot()`, `restoreFromSnapshot()`

---

### ConsumableSystem (`src/systems/ConsumableSystem.ts`)

**ConsumableType values:** `HpPotion | StaminaTonicI | StaminaTonicII | StaminaTonicIII | MaxPotion`

All Zone 1 consumables are `findOnly` (found in chests only — not craftable yet).

**Effects:**
- `HpPotion`: +40 HP instant
- `StaminaTonicI/II/III`: stamina drain mult = 0.2 for 15s/30s/60s
- `MaxPotion`: full HP+stamina + 10s immunity window (blocks all damage and knockback on Webbs)

**`getStaminaDrainMult()`:** returns 0 if MaxPot active, 0.2 (TONIC_DRAIN_MULT) if tonic active, 1 otherwise.

**Scene integration (AntColonyScene):**
- `tick(delta)` called every frame
- `isMaxProtActive()` → `webbs.maxProtectionActive`
- `getStaminaDrainMult()` → `weaponUseSystem.staminaDrainMult`

---

### SaveSystem (`src/systems/SaveSystem.ts`)

**localStorage key:** `'noLegs_save_v1'`

**Persisted fields (SAVE_FIELDS):**

| Field | Type |
|---|---|
| `health` | number |
| `craftingInventory` | Record\<string, number\> |
| `consumableInventory` | Record\<string, number\> |
| `weaponSlots` | string[] (8 WeaponType values) |
| `legTier` | number |
| `weaponInventory` | string[] (WeaponType[]) |
| `webThrowerFound` | boolean |
| `birthdayCardRead` | boolean |
| `pickupsCollected_HomeBaseScene` | number[] (pickup indices) |
| `weaponPickupsCollected` | string[] (pickup id strings) |
| `openingCutsceneSeen` | boolean |
| `antColonyFirstVisit` | boolean |

**`saveFromRegistry(registry)`** — iterates SAVE_FIELDS, pulls each from registry, JSON-serializes to localStorage. Silent on quota errors.

**`loadIntoRegistry(registry)`** — parses save JSON, sets each present field into registry. Silent on parse errors (corrupt save = fresh start).

**Save trigger points:**
1. MainMenuScene: after player dismisses opening cutscene for first time
2. HomeBaseScene: on workbench open (just before launching CraftingMenu) and on left-exit to AntColonyScene
3. AntColonyScene: on first visit (antColonyFirstVisit flag) and on portal transitions
4. BossRollerScene: does NOT save (session fight)

---

### ZoneTransitionSystem (`src/systems/ZoneTransitionSystem.ts`)

Static methods only.

**`transition(scene, targetKey, exitDir, health?)`**
1. Sets `zoneEntryFrom = OPPOSITE[exitDir]` in registry
2. Sets `health` in registry if provided
3. Sets `transitionBeatData = { targetKey, label, subtitle }` from `ZONE_BEATS` map
4. `cameras.main.fade(400)` then `scene.start('ZoneTransitionBeat')`

**`spawnX(scene, worldW, fallbackX)`** — reads `zoneEntryFrom`:
- `'right'` → spawn at `worldW − 180`
- `'left'` → spawn at `180`
- else → `fallbackX`

**`announceZone(scene, label)`** — scrollFactor 0, depth 100, text fades in (400 ms) then out (500 ms delay 1700 ms).

**ZONE_BEATS map:**
```
HomeBaseScene   → 'HOME BASE'           / 'The Den.'
AntColonyScene  → 'ZONE 1 — ANT COLONY' / 'The western passage.'
BossRollerScene → 'THE BOSS CHAMBER'    / 'The thing at the end of the tunnel.'
```

---

## 6. Config / Data Files

### WeaponData (`src/config/WeaponData.ts`)

**WEAPON_COLORS record:**
```
Empty=0x444444, Sword=0xc0c0c0, Bow=0x8b6914, Axe=0x888888,
BoxingGloves=0xddccaa, Glider=0x87ceeb, FlameBreather=0xff6600, WebLauncher=0xeeeeff
```

**WEAPON_DATA** (`Map<WeaponType, WeaponConfig>`) — display name, damage, staminaCost, type, requiredTier.

**WEAPON_STATS** — per-weapon cooldownMs, range string, blurb text (for EquipScreen detail panel). Note: FlameBreather uses cooldownMs=1000 as a trick so `dpsFor()` returns raw damage value (1000ms CD × 18dmg = 18 DPS label).

**`dpsFor(weapon)`** — `damage / (cooldownMs / 1000)` formatted as `"X.X dps"`. Returns `"—"` for zero-damage or zero-cooldown weapons.

### ChestLootTable (`src/config/ChestLootTable.ts`)

**Material pool** (weighted):
Stone×3(w30), Wood×2(w25), BugPartsAnt×2(w20), DriedFungus×1(w10), SilkThread×2(w25), ChitinShard×2(w20), WebFluid×2(w15), VenomGland×1(w8)

**Consumable pool** (weighted):
HpPotion(w40), StaminaTonicI(w25), StaminaTonicII(w12), StaminaTonicIII(w5), MaxPotion(w3)

**`rollChestLoot(materialCount=3)`** — picks `materialCount` unique materials; 30% chance of 1 consumable. Total weight for materials = 153, consumables = 85.

### Controls (`src/config/Controls.ts`)

```typescript
TEXT_ADVANCE_KEY = Phaser.Input.Keyboard.KeyCodes.M
TEXT_SKIP_KEY    = Phaser.Input.Keyboard.KeyCodes.SPACE
HUD_LEGEND_KEY   = Phaser.Input.Keyboard.KeyCodes.H
```

---

## 7. Registry Keys

All keys are string keys on `this.registry` (Phaser's shared `DataManager`). The registry is the cross-scene communication bus.

| Key | Type | Written by | Read by | Notes |
|---|---|---|---|---|
| `'health'` | number | HomeBaseScene, AntColonyScene, BossRollerScene, ZoneTransitionSystem | HUDScene, all gameplay scenes on init | Player current HP |
| `'healthMax'` | number | gameplay scenes | HUDScene | Player max HP (100) |
| `'stamina'` | number | gameplay scenes (from webbs.stamina) | HUDScene | |
| `'staminaMax'` | number | gameplay scenes | HUDScene | |
| `'energy'` | number | gameplay scenes | HUDScene | |
| `'energyMax'` | number | gameplay scenes | HUDScene | |
| `'zoneName'` | string | gameplay scenes | HUDScene | `'HOME BASE'` / `'ANT COLONY'` / `'ANT COLONY — BOSS'` |
| `'weaponSlots'` | WeaponType[8] | gameplay scenes (from weaponSystem.getAllSlots()) | HUDScene, EquipScreen on open, all scenes on create for loadout restore | |
| `'unlockedSlots'` | number | gameplay scenes | HUDScene | How many slots are accessible |
| `'legTier'` | number | gameplay scenes | all scenes on create, CraftingMenu on create | 0–3 |
| `'weaponInventory'` | WeaponType[] | WeaponPickup.collect(), CraftingMenu.tryCraft(), EquipScreen.close() | EquipScreen on create, all gameplay scenes on create | Unequipped weapons |
| `'weaponSystemRef'` | WeaponSystem | gameplay scenes | EquipScreen (reads the live object) | Live reference — not serialized |
| `'craftingInventory'` | Record\<string,number\> | gameplay scenes, CraftingMenu | CraftingMenu, WeaponUseSystem (bow), HUDScene (ammo count) | Persisted in save |
| `'consumableInventory'` | Record\<string,number\> | AntColonyScene, ConsumableSystem | AntColonyScene on create | Persisted in save |
| `'textDisplayData'` | TextDisplayData | MainMenuScene, HomeBaseScene, AntColonyScene, PickupCelebration, CraftingMenu | TextDisplayScene on create | Consumed once |
| `'celebData'` | CelebData | HomeBaseScene, AntColonyScene, CraftingMenu | PickupCelebration on create | Consumed once |
| `'transitionBeatData'` | `{targetKey, label, subtitle}` | ZoneTransitionSystem | ZoneTransitionBeat on create | |
| `'zoneEntryFrom'` | ExitDir string | ZoneTransitionSystem | ZoneTransitionSystem.spawnX() | `'left'/'right'/'up'/'down'` — spawn side for new zone |
| `'equipCallerScene'` | string | gameplay scenes before launching EquipScreen | EquipScreen on create/close | `'HomeBaseScene'` or `'AntColonyScene'` |
| `'callerScene'` | string | gameplay scenes before launching CraftingMenu | CraftingMenu on create/close | |
| `'openingCutsceneSeen'` | boolean | MainMenuScene | MainMenuScene | Persisted |
| `'antColonyFirstVisit'` | boolean | AntColonyScene | AntColonyScene | Persisted |
| `'birthdayCardRead'` | boolean | HomeBaseScene | HomeBaseScene on create | Persisted |
| `'webThrowerFound'` | boolean | HomeBaseScene | HomeBaseScene on create | Persisted |
| `'pickupsCollected_HomeBaseScene'` | number[] | HomeBaseScene | HomeBaseScene on create | Persisted — pickup indices |
| `'weaponPickupsCollected'` | string[] | HomeBaseScene, gameplay scenes | HomeBaseScene on create | Persisted — pickup id strings |
| `'lastBossSlot'` | number | AntColonyScene | AntColonyScene on create | Index into BOSS_Y_SLOTS (not persisted) |
| `'discoveredWeapons'` | WeaponType[] | CraftingMenu | CraftingMenu | Tracks first-craft celebrations |
| `'antTunnelsClear'` | boolean | BossRollerScene on victory | — | Not yet consumed |

---

## 8. Save System

**Mechanism:** `localStorage.setItem('noLegs_save_v1', JSON.stringify(data))`

**BootScene** calls `saveSystem.loadIntoRegistry(this.registry)` as the very first thing before any scene can read the registry. This ensures all persisted state is available during scene `create()` calls.

**What is saved:**
- Player HP
- Full crafting material counts
- Full consumable counts
- Weapon slot assignments (8 slots as string[])
- Leg tier (0–3)
- Weapon inventory (unequipped weapons)
- `webThrowerFound`, `birthdayCardRead` (birthday sequence progress)
- `pickupsCollected_HomeBaseScene` (array of collected pickup indices 0..10)
- `weaponPickupsCollected` (array of pickup id strings like `'hb-toothpick'`)
- `openingCutsceneSeen`, `antColonyFirstVisit` (one-time flags)

**What is NOT saved:**
- Enemy positions or alive/dead state (enemies always reset)
- Fog-of-war reveal state (fog always starts opaque)
- `lastBossSlot` (boss portal position randomises each session)
- Consumable timers (tonic/max potion duration resets)

**How restore works:**
1. BootScene: `loadIntoRegistry()` hydrates all fields
2. HomeBaseScene/AntColonyScene `create()`: reads `health` from registry → `webbs.resetHp(health)`
3. Reads `legTier` → `webbs.weaponSystem.setLegTier()`
4. Reads `weaponSlots` → calls `weaponSystem.equip(i, slots[i])` for each
5. Reads `craftingInventory` → `craftingSystem.restoreFromSnapshot()`
6. Reads `consumableInventory` → `consumableSystem.restoreFromSnapshot()`
7. Reads `pickupsCollected_HomeBaseScene` → skips creating those pickups
8. Reads `weaponPickupsCollected` → skips creating those weapon pickups

---

## 9. Rendering Conventions

### Depth layers

| Depth | What lives there |
|---|---|
| 0 | Background fill (sky/cave gradient) |
| 1 | Floor slab |
| 2 | Wall blocks (cave fill) |
| 3 | Environmental decoration (webs, hammocks, inventions, food stores) |
| 4 | Birthday area props, blocked exit debris |
| 5 | Open exit portal frame |
| 6 | Exit portal glow strands (ADD blend) |
| 8 | Phase 2 shockwave / tail swipe arc (BossRollerScene) |
| 9 | WebLauncher strand line |
| 10 | Weapon swing graphics, projectiles |
| 11 | Hit particle emitters |
| 12 | Hit slash arc (axe) |
| 20 | Boss HP bars (BossRollerScene) |
| 21 | Player HP bar (BossRollerScene) |
| 30 | Phase text / dead-end trigger flash |
| 40 | HpModule collect ring effect |
| 50 | Underground ambient dim (AntColonyScene) |
| 51 | Fog of war RenderTexture |
| 60 | Above-fog lantern beacons + HpModule above-fog dots (ADD blend) |
| 100 | Zone announce text (scrollFactor 0) |

### Blend modes
- `Phaser.BlendModes.ADD` used for: exit portal web strands, lantern beacons, HpModule dots, flame particle emitter
- CRITICAL: ADD-blend objects force a WebGL batch flush per draw call. In AntColonyScene, all 80+ lantern beacons are drawn into a single Graphics object (one flush), not individual arcs.

### Fog of war details
- RenderTexture dimensions: `WORLD_W / FOG_SCALE × WORLD_H / FOG_SCALE` = `750 × 500` px
- Scaled up ×10 (`setScale(FOG_SCALE)`) to cover world
- `texture.source[0].setFilter(Phaser.Textures.FilterMode.LINEAR)` — blurs the upscale so blocky artifacts disappear
- `fill(0x000000, 1)` — initially fully opaque
- `fog.erase(fogEraserGfx)` — permanently carves transparent holes

### Camera
- All gameplay scenes: `setZoom(1.15)`, smooth follow lerp 0.1/0.1
- BossRollerScene: `setZoom(1.0)`, lerp 0.12/0.12
- MainMenuScene/PreloadScene: no follow
- HUD/overlays: ignore camera (scrollFactor 0 on HUD elements)

---

## 10. Physics Conventions

### Body types
- **Webbs:** dynamic `setCircle(22, -22, -22)`, collide world bounds, no drag
- **Enemies:** dynamic `setCircle(r, -r, -r)`, drag (600, 600), collide world bounds (CentipedeAmbusher: set in scene)
- **Pickups / Workbench / Chest / HpModule:** StaticBody, `setCircle(14, -14, -14)` or `setSize()`
- **Wall blocks (AntColonyScene):** invisible `Rectangle` with `physics.add.existing(body, true)` → static body
- **Nose barrier (BossRollerScene):** `rectangle + physics.add.existing(, true)` → static
- **Bow projectiles:** dynamic body added dynamically via `physics.add.existing(arc)`

### Off-screen culling (AntColonyScene)
```
ACTIVE_RADIUS_SQ = 900 * 900
```
Each frame, per enemy:
- If within range: `pb.setEnable(true)`, call `enemy.update()`
- If out of range: `pb.setEnable(false)`, skip update

This is critical performance. Without it, 23 physics bodies × 50+ wall rects = expensive broadphase even when the player can't see them.

### Collision setup (AntColonyScene)
```
physics.add.collider(webbs, wallGroup)
physics.add.collider(webbs, chestGroup)
physics.add.collider(ref, wallGroup)   // per enemy on spawn
```

Contact damage (enemy hitting Webbs) is manual distance checks, not Arcade overlap — avoids velocity-cancelling friction from overlap callbacks.

---

## 11. Input Conventions

### Universal keys (all scenes)
| Key | Action |
|---|---|
| WASD / Arrow keys | Move Webbs |
| Q | Web Launcher (fire/cancel) |
| 1–8 | Activate weapon in that slot + set as active slot for left-click |
| Left click | Re-fire active slot toward mouse cursor |
| E | Interact (workbench, birthday objects) |
| I | Open EquipScreen |
| H | Toggle HUD controls legend |
| M (TEXT_ADVANCE_KEY) | Advance text page / skip beat screen |
| SPACE (TEXT_SKIP_KEY) | Skip all cutscene pages |

### AntColonyScene-only keys
| Key | Action |
|---|---|
| C | Use HP Potion |
| V | Use best Stamina Tonic |
| X | Use Max Potion |

### EquipScreen-only keys
| Key | Action |
|---|---|
| Arrow Left/Right | Switch panel focus (slots vs inventory) |
| Arrow Up/Down | Navigate within focused panel |
| ENTER | Equip selected weapon to selected slot |
| X | Unequip selected slot |
| I or ESC | Close EquipScreen |
| 1–8 | Select that slot + equip current weapon |

### CraftingMenu keys
| Key | Action |
|---|---|
| Up/Down | Navigate recipe list |
| SPACE | Craft selected recipe |
| ESC | Close |

### Key handling pattern
All gameplay keys use `Phaser.Input.Keyboard.JustDown()` checked in `update()`, not event listeners — this prevents firing while a paused overlay holds the scene. Exception: `keyboard.on('keydown-I', ...)` for overlay launch (fires on key event, not per-frame) — but guarded by `this.scene.isActive('EquipScreen')` check.

---

## 12. Performance Rules Discovered During Development

### 1. Graphics tessellation cost (CRITICAL)
Phaser re-tessellates `Phaser.GameObjects.Graphics` objects every frame in WebGL. Every `fillCircle`, `fillRect`, `fillPolygon` generates triangles that are re-uploaded to the GPU each frame. **Do not put many fillCircle calls in a single large `Graphics` object that persists.**

**Concrete rules in this codebase:**
- Wall clod count capped at `Math.min(6, ...)` per wall block
- Wall speckle count capped at `Math.min(8, ...)`
- Cavern outline vertices use step size `max(2, floor(w/52))` — coarser on large walls
- All lantern beacons rendered in ONE Graphics object (single upload, single flush)

### 2. ADD blend mode flushes
Each game object with `BlendModes.ADD` forces a WebGL batch flush. If you have 80 lanterns as separate `Arc` objects with ADD blend, that's 80 flushes per frame.

**Solution implemented:** Merge all same-blend objects into one Graphics. The lantern beacons (depth 60) are drawn as a single Graphics with ADD blend — one flush for all 80+.

### 3. Fog texture scale
Running fog at `FOG_SCALE = 10` reduces the rendered texture from 37.5 MP (7500×5000) to 375K px — a 100× cost reduction. LINEAR filter on the texture source blurs the ×10 upscale so edges look smooth rather than pixelated.

Do NOT try to run fog at FOG_SCALE = 1 (full resolution). It will tank framerate.

### 4. Physics body enable/disable (off-screen culling)
`pb.setEnable(false)` removes the body from the broadphase entirely. With 23 enemies × 50+ wall bodies, this is essential. Enable/disable is toggled per-frame based on `ACTIVE_RADIUS_SQ = 900²`.

### 5. Loot despawn
Enemy loot drops are scheduled for despawn after 40 seconds (`time.delayedCall(40000, ...)`). Without this, each enemy respawn cycle accumulates permanent bob tweens and StaticBody entries that never clean up.

### 6. HpModule rendering split
HpModule uses a non-ADD halo inside the container (batches normally with other normal-blend objects) and only the tiny above-fog dot uses ADD blend. This keeps the 9 HP modules from generating 18 ADD-blend flushes per frame.

### 7. Colony paused during menus
When CraftingMenu or EquipScreen opens, AntColonyScene is fully paused (`scene.pause()`). This stops all update() calls including enemy AI and fog raycasting — no background work while menu is open.

---

## 13. Known Design Decisions and Why

### WebLauncher in slot 0 vs always-on Q key
The WebLauncher is equipped into slot 0 as a normal weapon. Q is wired to fire it always (checking `webLauncher.onQPressed()`), AND it also responds to the 1-key (slot 0 activation) like any other weapon. This means:
- The Web Thrower is visible in the HUD ring
- It can be unequipped (moved to another slot, or swapped out)
- Q always works as a shortcut regardless of which slot it occupies

**Why:** The birthday gift narrative gives Webbs the Web Thrower in slot 0. Making it "always on" would hide it from the equipment system. The Q shortcut is preserved because the web is foundational to the game feel and players shouldn't have to remember its slot number.

### staminaRegenMult approach (Section 11)
Rather than modifying WeaponUseSystem or giving ConsumableSystem awareness of combat state, a `staminaRegenMult` public field on Webbs is set by the active scene each frame:
- HomeBaseScene: never sets it (defaults to 1.0 from constructor)
- AntColonyScene: 0.5 out-of-combat, 0.25 in-combat
- BossRollerScene: never sets it (defaults to 1.0)

**Why:** Keeps Webbs.update() clean. The scene has all the context (enemy positions, last-hit flag) needed to determine combat state. Pushing that logic into Webbs would require it to hold enemy references.

### Fog resolution (FOG_SCALE = 10)
At scale 10 the fog texture is 750×500 px. At scale 4 it would be 1875×1250 = 2.3 MP — still manageable but the Linear filter on the ×4 upscale gives adequate smoothness at scale 10. Anything below 5 starts showing blocky seams on curved cavern walls.

### Pickup collection by proximity sweep, not Arcade overlap
Using `physics.add.overlap(webbs, pickupGroup, callback)` would only trigger when Webbs' 22px body center overlaps a pickup. Since the spider visually spans ~80px (legs + tips), players expect to collect pickups they "roll over." The manual sweep (radius 50px) matches visual expectations.

### WebLauncher `isEquipped` check in BossRollerScene
BossRollerScene checks `webLauncher.isEquipped(webbs)` before calling `onQPressed()` — if no WebLauncher in any slot, Q fires the legacy "fixed wall anchor" (hardcoded to the wall nearest Webbs). This supports the boss fight even if the player removes the WebLauncher from all slots.

### findOnly for Toothpick Stabber
BoxingGloves (Toothpick) recipe has `findOnly: true`. The weapon must be found as a floor pickup (HomeBaseScene has one at x=1200). The workbench shows the recipe so players know it exists and can see its cost, but cannot craft it. This preserves scarcity for the starter melee weapon.

### Enemy contact damage as manual distance check
Arcade `overlap()` callbacks cancel velocity when resolving — enemy contact would decelerate enemies mid-charge. Manual distance checks + cooldown (750 ms) avoid this.

### BossRollerScene death → GameScene
On player death, BossRollerScene calls `scene.start('GameScene')`. GameScene is a legacy dev sandbox, not a proper "you died" screen. This is a known placeholder — a proper death/respawn flow is still outstanding.

---

## 14. What Has Been Built (Sections 1–11 + Fixes)

### Sections 1–7 (pre-Section 8 commit b927f8a)
- Webbs entity with 8 legs, WASD movement, animation, weapon visuals
- WeaponSystem (8 slots, leg tier gating)
- WeaponUseSystem (Sword, Axe, Bow, Toothpick, FlameBreather)
- WebLauncherSystem (projectile, pull, anchor, recall)
- CraftingSystem (6 recipes)
- ConsumableSystem (5 types)
- HomeBaseScene (full environment, birthday sequence, workbench)
- AntColonyScene (5-level maze, 23 enemies, fog of war, squeeze effect, dead-end rooms, 14 chests, HP modules)
- BossRollerScene (dual-phase: Nose + Roller, suction, rock reflection)
- HUDScene overlay
- EquipScreen overlay
- CraftingMenu overlay
- PickupNotification overlay
- PickupCelebration overlay
- TextDisplayScene overlay
- Enemy base class + CentipedeAmbusher + BeetleTank + RollerBoss + BossNose
- Pickup + WeaponPickup + HpModule + Chest + Workbench entities
- ZoneTransitionSystem
- ChestLootTable + Controls + WeaponData + WeaponIcon configs

### Section 8 — Save System ✓
- SaveSystem with localStorage key `'noLegs_save_v1'`
- 12 persisted fields
- BootScene restore, workbench/transition save triggers

### Section 9 — Cutscene System ✓
- Opening cutscene (4 pages) in MainMenuScene, gated by `openingCutsceneSeen`
- AntColonyScene intro cutscene (2 pages), gated by `antColonyFirstVisit`
- Both fire only once; flags persisted

### Section 10 — Zone Transition Beat ✓
- `ZoneTransitionBeat` scene with black screen, label + subtitle, 2s hold, skippable
- `ZoneTransitionSystem.transition()` routes through it
- Zone labels: HOME BASE / ZONE 1 — ANT COLONY / THE BOSS CHAMBER

### Section 11 — Toothpick Balance ✓
- GLOVES_STAMINA raised to 15 (was effectively lower)
- `staminaRegenMult` field on Webbs
- AntColonyScene sets mult to 0.5 (out-of-combat) or 0.25 (in-combat) each frame
- In-combat defined as: enemy within 300px OR last-hit within 3s

### Performance fixes (commit ae9bc2e, 836797f)
- Wall clod/speckle caps added
- Cavern outline vertex count coarsened
- Lantern beacons merged into single ADD-blend Graphics
- HpModule above-fog dots split from container to minimize ADD flushes
- AntColonyScene paused during menus
- Loot despawn timer (40s)
- Off-screen physics body disable

---

## 15. What Is Still Outstanding

### Appendix A — Environmental Objects (partially done)
The birthday card and gift box are complete. Still missing:

**Dried Fungus clusters:**
- World object in AntColonyScene dead-end rooms
- Material: `MaterialType.DriedFungus`, qty 1–2
- Should glow green-brown (color ~0xb87a30)
- Implementation: add to `pickupDefs`/`surpriseSeeds` array in AntColonyScene.create() at dead-end room center coordinates
- The celebration trigger already exists for CrystalShard in `collectMaterialPickup()`; DriedFungus does not need one

**Crystal Shard world object:**
- Rare floor item somewhere in the maze
- Material: `MaterialType.CrystalShard`
- Triggers PickupCelebration when collected (already wired in `collectMaterialPickup()` — checks `if (p.materialType === MaterialType.CrystalShard)`)
- Implementation: add one or two seeds to `surpriseSeeds` in AntColonyScene at hidden corridor locations

### BossRollerScene death/victory routing (stub)
Currently `playerDied()` and `rollerDefeated()` both call `scene.start('GameScene')` — the legacy dev sandbox. This should route to a proper death screen or back to HomeBaseScene. Not in the brief scope but technically incomplete.

### Wasp Territory Zone
Per Phase 1 scope: a second zone (Wasp Territory) and second boss (Hive). Not yet started.

### Consumable crafting
All consumables are `findOnly` in Zone 1. The brief says craftable in later zones — recipes exist in ConsumableSystem but crafting UI for consumables is not yet wired into CraftingMenu.

### Glider weapon behavior
`WeaponType.Glider` is defined, has an icon, can be crafted (Tier 2), can be equipped in a slot, has an animation ('flap'). However `activateWeapon()` in WeaponUseSystem does not have a case for `WeaponType.Glider` — pressing its slot number does nothing. Flight/traversal behavior not yet implemented.

---

## Quick-Reference Cheat Sheet

### File map
| File | Role |
|---|---|
| `src/main.ts` | Phaser config, scene registration |
| `src/scenes/BootScene.ts` | First scene, save restore |
| `src/scenes/PreloadScene.ts` | Loading bar |
| `src/scenes/MainMenuScene.ts` | Title + opening cutscene |
| `src/scenes/HomeBaseScene.ts` | Zone 0 — safe area |
| `src/scenes/AntColonyScene.ts` | Zone 1 — 7500×5000 maze |
| `src/scenes/BossRollerScene.ts` | Boss fight — 1280×720 |
| `src/scenes/GameScene.ts` | Legacy dev sandbox (currently death/victory target) |
| `src/scenes/TextDisplayScene.ts` | Paginated cutscene overlay |
| `src/scenes/ZoneTransitionBeat.ts` | Black zone-label beat |
| `src/scenes/PickupCelebration.ts` | Item-found celebration overlay |
| `src/ui/HUD.ts` | HUDScene |
| `src/ui/EquipScreen.ts` | EquipScreen overlay |
| `src/ui/CraftingMenu.ts` | CraftingMenu overlay |
| `src/ui/PickupNotification.ts` | Toast notification overlay |
| `src/ui/WeaponIcon.ts` | Shared weapon icon drawing |
| `src/entities/Webbs.ts` | Player entity |
| `src/entities/Enemy.ts` | Abstract enemy base |
| `src/entities/CentipedeAmbusher.ts` | Ambush + lunge enemy |
| `src/entities/BeetleTank.ts` | Charge + patrol enemy |
| `src/entities/RollerBoss.ts` | Phase 2 boss |
| `src/entities/BossNose.ts` | Phase 1 boss |
| `src/entities/Workbench.ts` | Crafting trigger prop |
| `src/entities/Pickup.ts` | Material orb |
| `src/entities/WeaponPickup.ts` | Weapon floor item |
| `src/entities/HpModule.ts` | HP heal orb |
| `src/entities/Chest.ts` | Loot chest / mimic |
| `src/systems/WeaponSystem.ts` | Slot/tier management |
| `src/systems/WeaponUseSystem.ts` | Combat weapon execution |
| `src/systems/WebLauncherSystem.ts` | Web thrower logic |
| `src/systems/CraftingSystem.ts` | Material inventory + recipes |
| `src/systems/ConsumableSystem.ts` | Potion/tonic system |
| `src/systems/SaveSystem.ts` | localStorage persistence |
| `src/systems/ZoneTransitionSystem.ts` | Zone navigation utilities |
| `src/config/WeaponData.ts` | Weapon colors, stats, DPS |
| `src/config/ChestLootTable.ts` | Chest drop rolling |
| `src/config/Controls.ts` | Shared key constants |

### Key numeric constants at a glance
```
HomeBaseScene:  WORLD_W=2560, WORLD_H=720, FLOOR_Y=660
AntColonyScene: WORLD_W=7500, WORLD_H=5000
AntColonyScene: FOG_SCALE=10, FOG_REVEAL_R=300, FOG_RAY_COUNT=48
AntColonyScene: ACTIVE_RADIUS_SQ=810000 (900px), COMBAT_RANGE_SQ=90000 (300px)
AntColonyScene: RESPAWN_MS=22000, CONTACT_COOLDOWN=750
BossRollerScene: W=1280, H=720
BossRollerScene: SUCTION_FORCE=520, SUCTION_INTERVAL=20000, SUCTION_ACTIVE_DUR=4000
BossRollerScene: ROCK_INTERVAL=3000, NOSE_HIT_RADIUS=65
WeaponUseSystem: SWORD_RADIUS=70, AXE_RADIUS=88, GLOVES_RADIUS=90
WebLauncherSystem: PROJECTILE_SPEED=700, MAX_RANGE=480, PULL_VELOCITY=900
```
