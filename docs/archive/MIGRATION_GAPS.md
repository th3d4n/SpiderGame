# NoLegs — 2D → 3D Migration Gap Report (v2)

Every `.ts` file in the project was read in two passes to produce this report. Pass 2 added: confirmed answers from the developer, the fog shader root cause, the Ant Colony size delta, and several mechanics missed in pass 1 (in-combat stamina penalty, colony intro, dead-end rooms, boss portal randomization, lantern beacons).

Status legend: 🔴 Missing entirely · 🟡 Partial / degraded · ✅ Parity reached · 🔥 Confirmed-priority by developer · 🗑️ Confirmed-delete by developer

---

## TL;DR — What needs work, in priority order

1. 🔥 **Vector weapon icons everywhere + per-leg weapon visual + per-weapon attack animation** *(Q1, Q6)*
2. 🔥 **Fog of war shader is wrong** — unexplored is too transparent, explored is too dark. Fungus orbs need above-fog beacons. *(Q3)*
3. 🔥 **Main Menu + opening 4-page cutscene** *(Q4)*
4. 🔥 **Ant Colony is structurally much smaller in 3D** — 2D had 5 vertical corridor levels, 14 dead-end rooms with spike traps/ambush spawns/mimic chests, randomized boss portal Y. 3D is a single linear corridor. *(Q7, expanded)*
5. 🔥 **Colony NPCs + restoration arc** (NPCs return as bosses are defeated) *(Q2)*
6. 🔥 **Squeeze-through mechanic** *(Q7)*
7. 🔥 **PickupCelebration overlay → TextDisplay tutorial chain on first weapon discovery** *(Q10)*
8. 🔴 PickupNotification slide-up cards
9. 🟡 EquipScreen3D detail panel + keyboard navigation
10. 🟡 HUD ammo counter + controls legend (H)
11. 🟡 Mimic chest vibrate/eye-glow/burst animation
12. 🟡 Enemy weak points (snout, underbelly) and visual tells (centipede windup)
13. 🟡 Zone transition beat screen (zone title card on fade)
14. 🟡 In-combat stamina regen penalty (3D appears to be missing this)
15. 🟡 Colony intro 2-page cutscene on first Ant Colony visit
16. 🗑️ `EquipSystem.ts` — delete *(Q5)*
17. 🗑️ `GameScene.ts` — delete *(Q8)*
18. ⏳ Glider weapon — keep for future levels *(Q9)*

---

## Developer Answers (Confirmed)

| Q | Answer | Implication |
|---|---|---|
| **Q1** | Each weapon needs a unique visual on the leg AND a unique attack animation. | Port `WeaponIcon.ts` to SVG; extend `SpiderLegs.ts` with per-leg weapon model attachments and per-weapon swing/stab/spray animations. |
| **Q2** | Yes — colony restoration arc is still a design goal. | Build `ColonyNPC3D` + wire `ColonyRestorationSystem` into `HomeBaseScene3D` and `main.ts`. |
| **Q3** | Fog should be **almost entirely opaque** when undiscovered (except small glowing fungus orbs visible through it), and only **slightly brighter** when uncovered. | Fix `FogOfWarSystem3D` shader: unexplored alpha → ~0.98, explored alpha → ~0.18. Add above-fog beacon mesh layer for fungus orbs at `renderOrder > fog.renderOrder`. |
| **Q4** | Main menu is needed. | Build `MainMenu3D` DOM overlay + first-launch opening cutscene via `TextDisplay3D`. |
| **Q5** | `EquipSystem.ts` is dead. Equip works via `WeaponSystem` + inventory. | Delete the file. |
| **Q6** | Vector icons preferred; dots are not. | Port `WeaponIcon.drawWeaponIcon()` from Phaser Graphics commands to inline SVG paths; use everywhere dots are. |
| **Q7** | Squeeze-through is wanted. Ant Colony 3D suspected smaller than 2D — needs review. | **Confirmed: it is dramatically smaller.** See §Ant Colony Size below. Implement squeeze-through and rebuild Ant Colony with vertical levels + dead-end rooms. |
| **Q8** | Delete `GameScene.ts`. | Delete. |
| **Q9** | Glider is for future levels. | Leave `WeaponType.Glider` in `WeaponData`. `WeaponUseSystem3D` can keep its case as a no-op or visual flap until vertical traversal exists. |
| **Q10** | First weapon discovery: celebration animation first, then tutorial text. | Build `PickupCelebration3D` overlay. On dismiss, if `tutorialPages` present, chain into `TextDisplay3D`. Trigger from `CraftingMenu3D.tryCraft()` first-time path, and from gift-box discovery in `HomeBaseScene3D`. |

---

## Ant Colony Size Delta (new — confirms Q7 suspicion)

This was the biggest finding from pass 2. The 3D zone is **fundamentally less of a level** than the 2D zone.

| Feature | 2D `AntColonyScene.ts` | 3D `AntColonyScene3D.ts` |
|---|---|---|
| World dimensions | **7500 × 5000 px** (5 horizontal corridor levels stacked vertically) | **40 × 7.2 wu** (single corridor band, no vertical level structure) |
| Corridor levels | **5** (C1 y=440, C2 y=1190, C3 y=2040 entry, C4 y=2890, C5 y=3840) — connected by vertical passages through wall blocks | **1** (z stays within −3.6…+3.6 at all times) |
| Maze walls | Outer perimeter + 5 wall bands (B_TOP, B12, B23, B34, B45, B_BOT) + 9 internal corridor barriers forcing winding navigation | 5 cross-barriers (`MAZE_WALLS`) with single gaps |
| Dead-end rooms | **14**, each randomly typed per run as one of: `spike` (5 spike triangles, instant 20 dmg + knockback on entry), `ambush` (2 centipedes spawn when entered), `mimic` (chest that becomes BeetleTank) | **0** (chests are placed inline in the corridor, no rooms) |
| Spike traps | Yes — red floor tint, spike silhouettes, fire on entry | None |
| Ambush rooms | Yes — `triggerDeadEndAmbush` spawns 2 centipedes on entry | None |
| Boss portal Y | **Randomized per run** from 5 corridor levels (with last-pick exclusion in `lastBossSlot`) | Fixed at z=0 |
| Algae lantern beacons | **80** scattered across the map, each with an above-fog visibility dot pulsing in unison | 8 inline orbs, **no above-fog visibility** |
| Colony intro cutscene | 2-page `TextDisplayScene` on first visit (gated by `antColonyFirstVisit` flag) | None |
| In-combat stamina penalty | `staminaRegenMult = 0.25` when within 300px of any enemy or hit in last 3s, otherwise `0.5` | Not implemented in 3D (Webbs3D handles regen but `main.ts` does not set per-frame multiplier from combat state) |
| Off-screen culling | Disables Phaser physics body beyond 900px from player | Uses `CULL_R = 13 wu` to skip enemy update/sync — visual only, no physics body toggle |

**Recommended action (matches Q7):**
- Expand `AntColonyScene3D` to use the Z axis as multiple corridor "levels" — even with isometric camera you can stack corridors at different X with vertical passages, or treat the world as deeper (extend D from 7.2 to e.g. 28 wu, then carve 5 corridors at z = −12, −6, 0, +6, +12).
- Port `buildDeadEndRooms()` + `drawDeadEndRooms()`: add 14 dead-end pocket geometries with type tagging.
- Implement `checkDeadEndTriggers()`: spike (instant dmg + flash + knockback ring) and ambush (spawn 2 centipedes) trigger types.
- Randomize boss portal position from a slot table; persist `lastBossSlot` in registry.
- Port the colony intro cutscene (`antColonyFirstVisit` registry flag → 2-page `TextDisplay3D`).
- Port the in-combat stamina regen penalty into the per-frame `main.ts` update loop.

---

## Fog of War — Concrete Fix (Q3)

The current `FogOfWarSystem3D.ts` shader sets:

```glsl
gl_FragColor = vec4(0.03, 0.02, 0.0, (1.0 - reveal) * 0.93);
```

with `reveal = max(live, perm * 0.55)`. Problems:
1. **Unexplored max opacity is `0.93`** — never fully opaque, so the world is visible through the fog. Should be ~`0.98`.
2. **Explored areas keep `(1 - 0.55) * 0.93 = 0.41` fog** — too dark. Should be ~`0.10` (mild dim).
3. **No above-fog beacons** — the algae/fungus orbs are below the fog plane (y < 1.95), so they get hidden along with everything else. The 2D version solved this with a `setDepth(60)` ADD-blend Graphics rendered ABOVE the fog.

**Recommended shader change:**

```glsl
// Unexplored: nearly opaque cavern darkness.
// Explored: subtle dim, lifts when player is currently nearby.
float exploredVisibility = perm * 0.90;            // explored leaves only 10% fog
float reveal             = max(live, exploredVisibility);
gl_FragColor = vec4(0.03, 0.02, 0.0, (1.0 - reveal) * 0.98);
```

**Recommended beacon layer:**
- After fog mesh is added (`renderOrder = 10`), spawn a small mesh per fungus orb with `renderOrder = 20`, `material.transparent = true`, `material.depthTest = false`, and `MeshBasicMaterial` color `0x99ffcc` add-blended.
- Position at the same XZ as the underlying fungus orb but at `y = 2.0` (just above the fog plane at `y = 1.95`).
- These render *over* the fog regardless of explored state — they are persistent navigation beacons.

The 2D version had **80 of these** scattered across the colony. Recommend at least 30–40 in the 3D rebuild for similar density.

---

## Section 1 — Entities

### 🟡🔥 `Webbs3D.ts` — Per-weapon leg visuals + per-weapon attack animations (Q1)

**2D had:**
- 8 colored legs, each shaded by the equipped weapon's color (`refreshLegColors()`)
- Per-weapon, per-leg animations: `stab` (toothpick), `swing` (sword), `punch` (boxing gloves), `draw` (web/bow), `flap` (glider), `spray` (flame breather)

**3D has:**
- IK gait via `SpiderLegs.ts` (great for locomotion) — but no weapon attachments and no attack-driven leg animation hooks

**Confirmed direction (Q1):** Both visual identity AND animation per weapon are required.

**How to implement:**
1. Extend `SpiderLegs` with per-leg attachment slots — each leg's tip-bone gets an optional `THREE.Group` child where a weapon model goes:
   - **Sword**: silk-blade extrusion (small flat box with tapered end)
   - **Bow**: short curved cylinder + line for the string
   - **Axe**: small head box on a handle cylinder
   - **Toothpick**: tapered cylinder
   - **Boxing Gloves**: rounded sphere
   - **Glider**: paired thin planes (folded when idle)
   - **Flame Breather**: short tube + nozzle cone
   - **Web Launcher**: small box on the carapace (already exists on Webbs3D)
2. Add `Webbs3D.refreshLegWeapons()` — called when `weaponSystem.equip/unequip` fires. Attaches/detaches the right model per slot, tints the leg segment material with the weapon's `WEAPON_COLORS[wt]`.
3. Add `Webbs3D.playWeaponAnim(slot: number, kind: 'stab' | 'swing' | ...)` — drives a quick IK target offset on just that leg:
   - `stab`: tip darts forward 0.4wu in `facing` direction, back to neutral over 220ms
   - `swing`: arc sweep ±60° in horizontal plane over 280ms
   - `punch`: short straight thrust + impact pause
   - `spray`: leg lifts and points forward, held while firing
   - `flap`: paired wing-leg rotation oscillation
   - `draw`: pullback then snap
4. Hook into `WeaponUseSystem3D.activateWeapon()` and `WebLauncherSystem3D.fire()` to call `playWeaponAnim()` on the slot.

---

### 🟡 `Webbs3D.ts` — Squeeze-through (Q7)

**2D logic** (lines 482-483, also in Webbs.ts):
- `updateSqueezeEffect()` checks distance to nearest wall in ±X and ±Y. When both walls in one axis are within `SQUEEZE_TRIGGER_GAP / 2` (150px), animates Webbs' body radius from `WEBBS_BODY_R_NORMAL` to `WEBBS_BODY_R_SQUEEZE` and scales the visual perpendicular to the squeeze direction.

**3D port:**
- Cast 4 short rays in ±X and ±Z from Webbs' position against the maze walls and `physicsWorld.bounds`. When both rays in one axis hit within ~0.8wu, scale `webbs.group` down to 0.65 on the perpendicular axis (tween over 180ms). Restore to 1.0 when out of the squeeze.
- Important: also reduce `collisionBody.radius` so the squeezed spider actually fits through the narrower physical gap, otherwise the visual is cosmetic.

---

### 🟡 `RollerBoss3D.ts` — Snout weak-point (2× damage)

The 2D `RollerBoss` exposed a snout hitbox dealing 2× when hit by melee. In 3D, the roller is a capsule with a single `collisionBody`. To restore parity:
- Compute snout XZ each frame: `snoutX = collisionBody.x + facingDir * (config.bodyRadius * 0.7)`, `snoutZ = collisionBody.z`.
- In `WeaponUseSystem3D.activateWeapon()`, after computing the hit, also test distance to snout — if within `0.25wu`, multiply damage by 2 and spawn a brighter VFX ring.

### 🟡 `BeetleTank3D.ts` — Underbelly weak-point (1.8× damage) on charge

2D applied 1.8× when hit during the CHARGING state from behind (the shell is exposed there). Port: in `WeaponUseSystem3D`, when target is a `BeetleTank3D` and `isCharging === true`, compute angle between attacker → beetle and beetle's facing — if behind (|dot| > 0.5 reverse), apply 1.8×.

### 🟡 `CentipedeAmbusher3D.ts` — Windup tell on BURSTING

2D animated the eyes (scale ×1.8) and mandibles (spread outward) for ~250ms before the lunge — the reaction window for the player. In 3D, transitions are instant. Port:
- In `CentipedeAmbusher3D.update()`, insert a `WINDUP` substate before `BURSTING`. During windup (250ms), scale the eye spheres and rotate mandible meshes outward via local rotation. Then proceed to BURSTING and the lunge.

### 🔴🔥 `ColonyNPC.ts` → needs `ColonyNPC3D.ts` (Q2 confirmed)

Build a `ColonyNPC3D` class:
- Body: two spheres (thorax + abdomen) with toon material
- 8 legs: 4 per side, simple `LineSegments` or thin cylinders
- Color: dim grey (`0x4a4040`) for early colony states, healthy brown (`0x7a6a5a`) once state ≥ 3
- Name label: floating DOM `<div>` positioned via `THREE.Vector3.project()` each frame, or a `THREE.Sprite` with a canvas-rendered text texture
- Idle drift: random target within ±0.3wu of home every 2–4s, lerp at 0.4 wu/s
- Proximity dialogue: when within 1.5wu of Webbs, show speech bubble (DOM `<div>` with `.position absolute`) for 3s, then 5s cooldown
- Dialogue lines from `ColonyNPC.ts` 2D file (preserve the 5 quotes)

Wire into `HomeBaseScene3D`:
- In constructor, read `registry.get<string[]>('bossesDefeated')` and call `ColonyRestorationSystem.getStateConfig(state)` for the NPC count
- Spawn at hardcoded den positions (e.g. clustered around the cake, gift, and far-left area for varying visual density)
- On `bossesDefeated` change after a transition, refresh

### 🟡 Inline pickups (HP modules, material caches, thistles)

**Missing animations:** idle Y-bob (1.1s sine ±0.05wu), collect burst (scale to 2.2× while fading over 240ms), pulsing emissive halo for HP modules.

**Above-fog beacons** for HP modules: matching the new fog approach (Q3), HP module orbs should render above the fog plane at all times so the player can see them through unexplored areas as small bright dots, exactly like the fungus orbs.

### 🟡 `Pickup.ts` / `WeaponPickup.ts` — Floor item visuals

The 2D versions had material-specific colored orbs with floating labels. In 3D the caches are simple spheres without labels. Acceptable functionally, but a small floating DOM label or `THREE.Sprite` would improve discoverability — especially for the weapon-on-floor case (currently only the toothpick exists as a 3D pickup, hand-built in `HomeBaseScene3D.buildToothpickPickup()`).

### 🟡 `Workbench.ts` — Interaction prompt

3D has the global `HudSystem.setInteractHint()` text. Acceptable as-is — no floating-above-object label needed unless that becomes a priority.

---

## Section 2 — Scenes

### 🔥 Main Menu (Q4) — `MainMenuScene.ts` to `MainMenu3D`

**Needed:**
- A pre-game DOM overlay with title "NO LEG LEFT TO STAND ON" and a blinking "[ PRESS SPACE TO START ]" prompt
- Before launching gameplay on first run, show the 4-page opening cutscene via `TextDisplay3D` using the existing `OPENING_PAGES` array from `MainMenuScene.ts` (4 pages about the ant invasion + Webbs' birthday setup)
- Gate via `registry.get<boolean>('openingCutsceneSeen')` saved to localStorage

**Implementation in `main.ts`:**
- Before the first `requestAnimationFrame`, show the menu overlay
- On Space: if `openingCutsceneSeen === false`, set it true, save, then run `TextDisplay3D` with the opening pages — its `onClose` proceeds to gameplay
- If already true, skip directly to gameplay

### 🟡 Zone Transition Beat — title card on fade

Add to `ZoneTransitionSystem3D.transition()`: inject a DOM `<div>` overlay containing the zone label (e.g. "ZONE 1 — ANT COLONY") + subtitle (e.g. "The western passage.") during the black-out window. Fade in with the overlay, hold 1.2s, fade out as gameplay resumes. Use the 2D `ZONE_BEATS` constants from `ZoneTransitionSystem.ts`.

### 🔥 Ant Colony Rebuild (Q7) — See dedicated section above

### 🗑️ `GameScene.ts` — Delete (Q8)

This is a dev prototype with a grid background and 3 ambushers; not part of the production game flow. Confirmed for deletion.

### `PreloadScene.ts` — Not needed in 3D

Phaser-specific loading bar for assets. Three.js handles asset loading directly in module imports (or `THREE.TextureLoader` with progress callbacks). No port needed. Can be left as-is until the 2D code is fully removed.

---

## Section 3 — Systems

### 🔥 Colony Restoration (Q2)

`ColonyRestorationSystem.ts` is framework-agnostic and already exists. Wire it up:
1. In `HomeBaseScene3D` constructor, read `bossesDefeated` from registry
2. Call `colonyRestorationSystem.getStateConfig(state)` to get `{ npcCount, lights, websRepaired, fireLit, decorations, musicChange }`
3. Conditionally:
   - Spawn `config.npcCount` `ColonyNPC3D` instances
   - If `lights`: add brighter point lights, raise ambient
   - If `websRepaired`: hide the boarded-up portal planks, add intact webs instead of cobwebs
   - If `fireLit`: add a flickering fire mesh near a hearth position
   - If `decorations`: more streamers, party hats, etc.

### 🗑️ `EquipSystem.ts` — Delete (Q5)

Dead code. Equip flow goes through `WeaponSystem.equip()` directly. Delete the file.

### 🟡 In-combat stamina penalty (new finding)

2D `AntColonyScene` (lines 399-408) sets `webbs.staminaRegenMult = 0.25` when:
- Any enemy is within `300px²` (= ~3wu in scaled terms), OR
- A weapon hit landed in the last 3 seconds

Default outside combat: `0.5`.

**3D status:** I do not see this logic anywhere in `main.ts` or `Webbs3D.ts`. Webbs3D has stamina regen but no combat-context multiplier. Port the proximity scan + recent-hit timestamp logic into `main.ts` per-frame update.

### 🟡 Zone Transition entry-direction tracking

2D's `ZoneTransitionSystem.spawnX()` reads the `zoneEntryFrom` registry value to spawn Webbs on the correct side of the new scene. 3D hardcodes spawn X per scene. Currently fine for the linear three-scene layout; revisit when zones branch.

### ✅ Already-good systems

`WebLauncherSystem3D`, `WeaponUseSystem3D`, `ConsumableSystem`, `CraftingSystem`, `WeaponSystem`, `SaveSystem`.

---

## Section 4 — UI

### 🔥 Vector weapon icons (Q6) — Port `WeaponIcon.ts`

The 2D `drawWeaponIcon()` is ~70 lines of Phaser Graphics commands (triangles, arcs, lines). Convert to inline SVG path strings:

```ts
// systems/WeaponIcon3D.ts
export function weaponIconSvg(weapon: WeaponType, color: string, size = 22): string {
  switch (weapon) {
    case WeaponType.Sword:
      return `<svg width="${size}" height="${size}" viewBox="-12 -12 24 24">
        <path d="M-7,-2 L-7,2 L8,0 Z" fill="${color}" stroke="#222" stroke-width="1"/>
        <rect x="-8" y="-4" width="2" height="8" fill="#665533"/>
      </svg>`
    case WeaponType.Bow:
      return `<svg ...>...</svg>`
    // ... one path block per weapon
  }
}
```

Use everywhere `WEAPON_COLORS[wt]` is currently rendered as a CSS dot:
- `HudSystem.buildWeaponRing()` — replace `circle` fill with `<g>` containing the SVG path scaled and positioned at each slot
- `EquipScreen3D.refresh()` — replace `dot.style.background` with `el.innerHTML = weaponIconSvg(wt, color)`
- `CraftingMenu3D` — same in the recipe row
- New `PickupCelebration3D` panel

### 🔥 `PickupCelebration3D` (Q10)

New file: `src/ui/PickupCelebration3D.ts`. Mirrors `TextDisplay3D` as a DOM overlay with:
- Full-screen dim
- Centered panel with a glowing weapon icon (SVG from above) bouncing in via CSS transform scale animation
- Item name in the weapon's color
- Multi-line description (use `WEAPON_DESCRIPTIONS` table from `PickupCelebration.ts`)
- "[ M ] Continue   [ Space ] Skip" hint

Behavior:
- `show(weaponType, tutorialPages?)` displays the celebration
- On dismiss, if `tutorialPages` is non-empty, hand off to `TextDisplay3D` with those pages. Otherwise close.

Hook points:
- `CraftingMenu3D.tryCraft()` — after a successful craft, check `registry.get<WeaponType[]>('discoveredWeapons')`. If this weapon isn't in it, push it, save, and trigger `PickupCelebration3D.show(weapon)`.
- `HomeBaseScene3D` gift-box collect (Web Thrower) — trigger with the Web Thrower's 3-page tutorial.

### 🔴 `PickupNotification3D` — Slide-up cards

New file: `src/ui/PickupNotification3D.ts`. DOM-based queue of bottom-of-screen 240×50 cards. Listen for collect events from the scene (or expose a simple `notify(title, subtitle, color)` API called inline from `main.ts` after each pickup type).

Cards stack queued so multiple rapid pickups don't overlap; each holds 1.8s then fades out.

### 🟡 `EquipScreen3D` — Detail panel + keyboard nav

Add a bottom strip to `EquipScreen3D.buildPanel()`:
- Weapon icon on the left
- Name (color-coded), type, damage, DPS, stamina cost, range, tier
- 2-sentence flavor blurb (use `WEAPON_STATS[wt].blurb` from `WeaponData.ts`)

Add keyboard navigation in `update()`:
- `1-8` direct slot select + equip current weapon
- `ENTER` equip selected weapon to selected slot
- `X` unequip
- `←/→` switch focused panel
- `↑/↓` navigate in focused panel

Match the 2D behavior in `EquipScreen.ts` lines 273-333.

### 🟡 `HudSystem` — Ammo counter + controls legend

**Ammo (thistle) counter:**
- Add `<div id="ammo-panel">` to `index.html` (initially `display: none`)
- In `HudSystem.update()`, check `webbs.weaponSystem.getAllSlots().some(s => s === WeaponType.Bow)` — if true, show panel and display `registry.get<Record<string,number>>('craftingInventory')?.['Thistle'] ?? 0`
- Color red when count is 0

**Controls legend (H key):**
- Add `<div id="controls-legend">` with the same key/action rows as `HUD.ts` (lines 192-228)
- Toggle visibility on `keydown` H — track in a small local listener so it doesn't conflict with `InputManager.justDown`

### 🟡 `CraftingMenu3D` — Hook into PickupCelebration

After successful craft (line 188-202 in `CraftingMenu3D.ts`), wire the first-time discovery flow as described under PickupCelebration3D above. Currently `flash()` is shown in the menu, but no celebration appears.

---

## Section 5 — Mechanics Detail

### 🟡 Mimic chest behavior

2D mimic chest had a 3-phase reveal: idle → vibrating with glowing red eyes → burst on E (red flash + 30dmg + knockback). 3D just spawns a BeetleTank on open with no buildup.

Port:
- Add `wakeRadius = 1.2wu` proximity check in `AntColonyScene3D.updateEnemies()` or a new `updateChests(playerX, playerZ, eJustDown)` method
- On wake: red emissive eyes pulse, chest jitter on group rotation
- On E within `interactRadius = 0.8wu`: spawn the BeetleTank, run a quick red ring burst centered on the chest, hide the chest mesh, apply 30dmg to player

### 🟡 Glider (Q9) — Future-proof, no work now

Keep `WeaponType.Glider` in `WeaponData.ts`. Confirm `WeaponUseSystem3D` has a no-op or visual-only case so it doesn't crash if equipped (briefly tested — needs verification). Implementation deferred until a 3D level introduces gaps / vertical traversal.

### 🟡 Boss Roller fight — Sufficient, with minor gaps

`BossRollerScene3D` is the most complete port in the project. Outstanding items:
- Snout weak-point on the Roller (Section 1)
- The 2D version had additional ground-pound shockwave radial expansion VFX — the 3D has a single shockwave ring, which is good but could use particle sparks for impact
- No music change between phase 1 and phase 2 (the 2D `musicChange` flag in `ColonyRestorationSystem` is partly about this)

### ✅ HomeBaseScene3D — Already strong

Birthday card, gift, toothpick, cake, chairs, streamers, cobwebs, two portals (one boarded). Once colony NPCs are added and the restoration arc visually changes the scene over time, this becomes feature-complete.

---

## Section 6 — Confirmed Deletes

| File | Reason |
|---|---|
| `src/systems/EquipSystem.ts` | Q5 confirmed dead; duplicates `WeaponSystem` equip flow |
| `src/scenes/GameScene.ts` | Q8 confirmed delete; early dev prototype not in game flow |

Optional follow-up once 3D is fully verified working: remove all the remaining 2D-only files (`MainMenuScene.ts`, `BootScene.ts`, `PreloadScene.ts`, `HUD.ts`, `EquipScreen.ts`, `CraftingMenu.ts`, `PickupCelebration.ts`, `TextDisplayScene.ts`, `ZoneTransitionBeat.ts`, `PickupNotification.ts`, `Workbench.ts`, `Chest.ts`, `ColonyNPC.ts`, `HpModule.ts`, `Pickup.ts`, `WeaponPickup.ts`, `WeaponIcon.ts`, `Webbs.ts`, `Enemy.ts`, `BeetleTank.ts`, `BossNose.ts`, `CentipedeAmbusher.ts`, `RollerBoss.ts`, `AntColonyScene.ts`, `HomeBaseScene.ts`, `BossRollerScene.ts`, `WeaponUseSystem.ts`, `WebLauncherSystem.ts`, `ZoneTransitionSystem.ts`, plus the `phaser` dependency from `package.json`).

---

## Section 7 — Implementation Order (Suggested)

A walk through these by impact + dependency order:

**Phase A — Core feel (1–2 sessions):**
1. Fix fog of war shader + add fungus orb above-fog beacons (Q3)
2. Delete `EquipSystem.ts` and `GameScene.ts` (Q5, Q8)
3. Port `WeaponIcon` to SVG, replace dots in HUD + EquipScreen + CraftingMenu (Q6)
4. Add `EquipScreen3D` detail panel + keyboard nav
5. Add HUD ammo counter + controls legend

**Phase B — Discovery loop (1 session):**
6. Build `PickupCelebration3D` (Q10)
7. Build `PickupNotification3D`
8. Wire celebration → tutorial chain on first weapon discovery
9. Add `MainMenu3D` overlay + opening cutscene gating (Q4)

**Phase C — Visual identity (1–2 sessions):**
10. Per-leg weapon model attachments in `SpiderLegs` (Q1)
11. Per-weapon attack animations (`playWeaponAnim`) (Q1)
12. Centipede windup tell, beetle underbelly, roller snout

**Phase D — Ant Colony rebuild (2–3 sessions):**
13. Expand world: 5 z-layered corridor "levels" or vertical maze geometry (Q7)
14. Port 14 dead-end rooms with spike/ambush/mimic types
15. Randomize boss portal across levels
16. 30+ fungus orb lanterns with above-fog beacons
17. Colony intro 2-page cutscene gate
18. In-combat stamina regen penalty
19. Squeeze-through mechanic (Q7)

**Phase E — Colony narrative (1–2 sessions):**
20. Build `ColonyNPC3D` (Q2)
21. Wire `ColonyRestorationSystem` to `HomeBaseScene3D`
22. Add zone transition beat title cards
23. Mimic chest buildup animation

---

*Generated 2026-05-24 from full two-pass source read of all 62 .ts files in the project, with developer answers applied.*
