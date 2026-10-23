# Den Rebuild + Survivors Progression — Session Log
**Date:** 2026-06-01  
**Scaffolds reviewed:** 4 (visual pass, lighting, den geometry, survivors progression)  
**Files created:** 2 (`DenBuilder.ts`, `SurvivorsProgression.ts`)  
**Files modified:** 6 (`Webbs3D.ts`, `SpiderLegs.ts`, `HomeBaseScene3D.ts`, `main.ts`, `SaveSystem.ts`, `SESSION_VISUAL_PASS.md` from prior session)

---

## Part 1 — Visual Pass (Webbs3D + SpiderLegs)

### Applied

| File | Change | Reason |
|------|--------|---------|
| `Webbs3D.ts` | Body: `MeshStandardMaterial` → `MeshToonMaterial` keeping `map`/`bumpMap` | Hybrid: cel-shading bands + fuzzy hair texture. Both properties are supported on `MeshToonMaterial`. |
| `Webbs3D.ts` | Inverted-hull outline (`BackSide` + scale `1.04×`) on ceph and abdomen meshes | Parented as children so outlines follow shudder/damage offsets for free. Own `MeshBasicMaterial` so damage colour-flash doesn't affect them. |
| `Webbs3D.ts` | Primary eye emissive `0x4466aa @ 0.6` → `0x66e0ff @ 2.2` | Above bloom threshold (`0.75`). Icy blue; reads brighter without bloom, glows with it. |
| `Webbs3D.ts` | Secondary eye emissive `0x223355 @ 0.4` → `0x44aadd @ 1.0` | Lifted above threshold for subtle secondary glow. |
| `Webbs3D.ts` | Idle body bob — `idleTime` accumulates, `group.position.y = sin(t*2) * 0.012` | `syncPosition()` only writes X/Z so Y bob survives each physics sync. Amplitude 0.012 wu — reads as alive, invisible unless you look. |
| `SpiderLegs.ts` | Knee: `MeshToonMaterial(0x444444)` → `MeshStandardMaterial({ metalness: 0.9, roughness: 0.25 })` | Near-black PBR reads as machined servo, not painted toon. |
| `SpiderLegs.ts` | Lower segment: `MeshToonMaterial` → `MeshStandardMaterial({ metalness: 0.85, roughness: 0.35 })` | Bionic lower segment. Per-leg instance required — weapon colour is set independently per slot every frame. |
| `SpiderLegs.ts` | Cyan accent ring (`TorusGeometry`, `emissiveIntensity: 1.4`) as child of each knee | Parented → follows IK solver every frame with zero update code. `1.4` is above bloom threshold. |
| `SpiderLegs.ts` | `.color.setHex()` cast: `as MeshToonMaterial` → `as MeshStandardMaterial` on `lower` | Type correctness. Runtime was never broken (`.color` exists on both). |
| `SpiderLegs.ts` | `destroy()`: iterates `leg.knee.children`, disposes ring geometry/material | Rings are children of knee, not direct scene objects — they wouldn't be cleaned up otherwise. |
| `main.ts` | `NearestFilter` on gradient map | **Critical.** Without it the 3-step texture is bilinearly interpolated — toon bands blur into smooth shading, making `MeshToonMaterial` visually identical to `MeshStandardMaterial`. |

### Not Applied

| Scaffold item | Reason |
|---------------|--------|
| `makeRoboticLeg()` static group | Webbs uses full IK legs via `SpiderLegs`. The robotic *look* (metal, servo spheres, accent rings) was applied to the IK segment materials instead — same result, no conflict with the gait solver. |
| Leg idle twitch (`updateWebbsIdle` per-leg rotation) | Directly conflicts with the IK solver. `SpiderLegs.update()` drives each leg's world position every frame; manual `rotation.z` on top produces jitter. The body-bob portion was kept (lives on `group.position.y`, IK doesn't touch it). |
| `makeToonGradient()` from scaffold | The shared `gradientMap` already existed in `main.ts`. Using the scaffold's version would create a second independent gradient — visual inconsistency. Used the existing one. |

---

## Part 2 — Home Base Lighting + Post-Processing

### Applied

| File | Change | Reason |
|------|--------|---------|
| `main.ts` | `dirLight.shadow.bias = -0.0004` | Reduces shadow acne across all zones. Global improvement with no downside. |
| `main.ts` | `GradeVignetteShader` inline + `ShaderPass` added to existing composer | Amber warmth push + corner vignette. Zone-switchable via `warmth` uniform. |
| `main.ts` | Initial fog: `FogExp2(0x000000, 0.008)` → `FogExp2(0x140d0a, 0.015)` | Game opens in homeBase — fog should reflect that atmosphere from the first frame. |
| `main.ts` | `scene.background = new THREE.Color(0x0a0705)` on startup | Warm dark-brown backdrop to match homeBase atmosphere. |
| `main.ts` | Zone atmosphere switching in `transitionTo()` — fog colour/density, `scene.background`, `gradePass.uniforms.warmth` | Keeps each zone visually distinct. AntColony stays cool/dark; bossRoller stays black/minimal. |
| `main.ts` | Lantern flicker in game loop (runs even while paused) | Lights breathe during menu screens. Uses `baseIntensity` cached in `userData` on first tick. |
| `HomeBaseScene3D.ts` | `buildLighting()` replaced: `HemisphereLight` + upgraded `sunCrack` + 4 warm pool lights | Pool lights tracked via `this.add()` → removed by `destroy()` on zone transition. |
| `HomeBaseScene3D.ts` | `warmPools: THREE.PointLight[]` public field | Exposed for the per-frame flicker loop in `main.ts`. |

### Not Applied

| Scaffold item | Reason |
|---------------|--------|
| `buildComposer()` | `main.ts` already had a full `EffectComposer`. Calling it would create a second composer nothing renders through. Passes added to the existing one instead. |
| `OutputPass` | `renderer.toneMapping = THREE.ACESFilmicToneMapping` is already set. `OutputPass` applies tone mapping a second time — double tone-mapping produces overbright artifacts. |
| Fog density `0.035` | Changed to `0.015`. A 4× increase from the prior `0.008` makes ant colony corridors near-opaque past a few world units and turns the boss arena into a fog wall. |
| Bloom `strength: 0.7` | Kept at `0.35`. Doubling strength haloes every emissive object including weapon tips, pickups, and the player light — reads as a lens-flare demo, not cel-shaded. The grade pass adds amber warmth independently; bloom stays conservative. |
| Warm pool lights and grade shader as global | Both scoped per-zone. Pool lights added via `HomeBaseScene3D.buildLighting()` (tracked, cleaned up on destroy). Grade `warmth` uniform set to `0.0` in antColony and bossRoller transitions. |
| `sunCrack.castShadow = true` | The global `dirLight` already casts shadows with a 2048 shadow map. A second shadow-casting directional = a second full shadow map render pass per frame for no visible gain in a den this size. |

---

## Part 3 — Den Geometry Rebuild (DenBuilder.ts)

### Applied (new file: `src/scenes/DenBuilder.ts`)

| Export | What it does | Key decisions |
|--------|--------------|---------------|
| `buildDenMaterials(gradientMap)` | Full material palette — toon for earth/floor/organics, PBR for silk sheen and metal junk | Accepts the **shared** `gradientMap` from `main.ts` so banding is identical across all `MeshToonMaterial` in the scene. |
| `buildDenFloor()` | Polar-grid `BufferGeometry` with terrain displacement: rolling unevenness + raised rim + central depression | Polar grid (not `PlaneGeometry`) keeps the floor circular after Y-displacement. Rim multiplier reduced from scaffold's `0.9` to `0.4` — `0.9` produced a 2.6 wu cliff at the chamber edge. |
| `buildBurrowWalls()` | 26 organic icosahedron mounds at `CHAMBER_R * 0.88–1.04`. Root arcs on ~45% | Exit gap (`π*0.75` – `π*1.25`) matches the octagon panel 3+4 arc exactly. Purely visual — physics octagon wall stays intact underneath. |
| `buildSilkArchitecture()` | Ceiling cables, 7-hammock village (3 torn), funnel web | All 6 cable anchors moved inside `CHAMBER_R * 0.8 ≈ 8.4 wu`. Two torn hammock positions corrected (`(-8,_,9)` → `(-6,_,7)` and `(-10,_,-3)` → `(-8,_,-4)`). `tornHammocks` + `pristineY` stored in `userData` for `SurvivorsProgression`. |
| `buildJunkFurniture()` | Bottle-cap tables, thread-spool stools, matchbox cabinet, thimble pot | Toppled stool tagged `userData.toppled = true` so `rightToppledStool` finds it by tag, not fragile geometry inspection. |
| `buildInventions()` | Spare robotic leg + gears near workbench | Positioned relative to `WB_X/WB_Z` constants (`-5, -7.5`) — scaffold had them at chamber centre. Still-powered accent ring at `emissiveIntensity: 1.6` (above bloom threshold). |
| `buildBirthdayBash()` | Tiered cake with **unlit** candles, torn banner, confetti | Cake tagged `userData.isCake = true`; `userData.candleTops` stores each wick tip position for `_lightCake`. Confetti pre-flagged `transparent: true` so `_tidyConfetti` opacity tween renders correctly. Replaces `buildPartyExtra()`. |
| `buildAttackEvidence()` | Drag marks, claw gouges, dropped toy, scattered food | Drag marks oriented `rotation.z = Math.PI/2 + offset` so they run east-west toward the `-X` exit. Scaffold had them pointing arbitrary positive-Z. Replaces `buildAttackDamage()`. |
| `buildExits()` | 4 blocked tunnels + silk web-bridge approach to west exit | Blocked angles `[0.50, 1.55, 4.55, 5.55]` verified outside `[2.36, 3.93]` (135°–225° exit arc). Web bridge `PlaneGeometry(6, 1.6)` with only `rotation.x` — `rotation.z` not needed, 6 wu dimension already runs east-west after `rotateX`. Replaces `buildBlockedPortal()`. |
| `DenHandles` interface | Typed bag of group references passed to `SurvivorsProgression` | Groups map to specific den sub-systems that heals can target. |

### Changes to `HomeBaseScene3D.ts`

| Change | Reason |
|--------|--------|
| Constructor calls DenBuilder functions, captures return values into `denHandles` | Needed to pass group references to `SurvivorsProgression`. |
| `buildGround()` removed | Replaced by `buildDenFloor()`. |
| `buildBlockedPortal()` removed | Replaced by `buildExits()`. |
| `buildPartyExtra()` removed | Replaced by `buildBirthdayBash()`. |
| `buildAttackDamage()` removed | Replaced by `buildAttackEvidence()`. |
| `buildWalls()` kept | Has physics collision bodies for doorframe posts and stone rubble. Removing it would let players walk through the chamber boundary. Burrow mounds are purely visual dressing on top. |
| `buildBirthdayArea()` kept | Manages the card and gift **gameplay pickup objects** — not atmosphere. |
| `buildDecoration()` kept | Pebbles, twigs, fungi, cobwebs — compatible with new build, not duplicated. |
| `buildExitPortal()` kept | The west portal frame is already well-tuned at the correct position. `buildExits()` adds the silk web-bridge approach and blocked tunnels only. |

### Not Applied (scaffold corrections)

| Scaffold issue | Fix applied |
|----------------|-------------|
| `radius = 22` throughout | Changed to `CHAMBER_R = 10.5` everywhere — the actual chamber radius. |
| Open exit at angle 0 (+X/east) | Corrected to west (`-X`). West exit portal is at `HomeBaseScene3D.LEFT + 0.3 = -10.7`. |
| Floor as `PlaneGeometry(44, 44)` — a visible square | Replaced with polar-grid `BufferGeometry` that stays circular. |
| `buildHomeBaseDen()` master function returning den object | Adapted: individual calls from the constructor, return values collected into `this.denHandles`. Avoids a separate coordination function. |
| Gradient using `THREE.RedFormat` | Changed to accept shared `gradientMap` from `main.ts` (already `RGBAFormat` with `NearestFilter`). |
| `buildBurrowWalls` stacking on existing `buildWalls` without physics | `buildWalls()` kept for collision. Burrow mounds are purely visual additive layer. |
| Invention positions at centre `(1.5, _, 0.5)` | Moved to near workbench `(WB_X + 1.0, _, WB_Z + 0.5) = (-4.0, _, -7.0)`. |

---

## Part 4 — Survivors Progression System

### Applied (new file: `src/systems/SurvivorsProgression.ts`)

| Component | What it does | Key decisions |
|-----------|--------------|---------------|
| `Tweener` class | Numeric property tweens + custom callbacks. `easeInOutQuad`. No external deps. | Inline — no dependency on `@tweenjs/tween.js` (which is a transitive dep, not a direct one). |
| `applyState(level, instant)` | Applies all warmth levels cumulatively. Instant on scene load. | Runs level 1 then level 2 transitions when loading at level 2 — ensures full state is restored. |
| `dispose()` | Removes and cleans up all spawned NPC spiders. | Called from `main.ts` before `activeScene.destroy()` — NPCs added via `scene.add` directly, bypassing the tracked array, so explicit cleanup is required. |
| `rightToppledStool` | Tweens `rotation.z → 0` and `position.y → 0.42` | Finds stool by `userData.toppled` tag (set in `buildJunkFurniture`). Scaffold used `isGroup` which is not a real Three.js property. |
| `repairHammock` | Swaps torn silk to a cloned pristine material, fades opacity up, lerps vertices to `pristineY` | Clones material per hammock so shared `mat.silk` instance isn't dirtied. `pristineY` captured at build time in `buildSilkArchitecture`. |
| `brightenPool` | Tweens pool light intensity, updates `userData.baseIntensity` on done | Flicker loop reads `baseIntensity` as its base — updating it means flickering scales from the new brighter level. |
| `lightCake` | Grows flame meshes from scale `0.001` to `1`, adds one warm `PointLight` | Finds cake via `userData.isCake`. Candle tops stored as local-space `Vector3` array in `userData.candleTops`. Flame material `emissiveIntensity: 3.0` — high enough to bloom. |
| `tidyConfetti` | Clones material per piece, fades opacity to 0 | Confetti pre-flagged `transparent: true` in `buildBirthdayBash` — without that flag, opacity changes are silently ignored by the renderer. |
| `warmAtmosphere` | Tweens `gradePass.uniforms.warmth.value`, stores new base in `scene.userData.homeBaseWarmth` | Storing the base means `transitionTo('homeBase')` reads the right value on re-entry rather than resetting to `0.12`. |
| `spawnReturnGroup` | Spawns colony spiders that walk in from west exit (`x = -12`) | Scaffold spawned from `x = 22` (east). The exit is at `x ≈ -10.7` (west). Survivors return *from the colony*, not from the wrong side of the den. |
| `makeSimpleSpider` | Organic colony spider — round body, plain legs, warm tones | Deliberately distinct from Webbs: no metal legs, no cyan glow, smaller. Visually reads as "family" not "enemy". |

### Changes to `main.ts`

| Change | Reason |
|--------|--------|
| `scene.userData.gradePass = gradePass` | `warmAtmosphere` looks here. Not set in the scaffold — would silently fail. |
| `scene.userData.homeBaseWarmth = 0.12` | Mutable base for zone re-entry. Progression updates it; `transitionTo` reads it. Prevents zone re-entry from hard-resetting warmth. |
| `transitionTo()` atmosphere reads `scene.userData.homeBaseWarmth` | Was hard-coded `0.12`. If progression tweened it to `0.18`, returning to homeBase would reset it back. |
| `denProgression` disposed before `activeScene.destroy()` | Progression holds references to scene objects. Disposing first prevents dangling references. |
| `denProgression` recreated after each new `HomeBaseScene3D` | `HomeBaseScene3D` is destroyed and rebuilt on every zone transition. Progression must be rebuilt against the new scene instance. |
| Boss victory increments `registry.set('bossesBeaten', n+1)` | The count is read by `applyState` on next homeBase entry. No call to `denProgression.onBossDefeated()` here — progression is null during boss fights. |
| `denProgression?.update(delta, t)` in game loop | Runs inside the existing homeBase flicker block where `t` is already defined. |
| `initNewGame()` resets `bossesBeaten: 0`, disposes progression, rebuilds | Otherwise a new game would inherit den warmth from a previous save. |

### Changes to `SaveSystem.ts`

| Change | Reason |
|--------|--------|
| `bossesBeaten: number` added to `SaveData` + `SAVE_FIELDS` | Without `SAVE_FIELDS` entry, the value is never written to localStorage. Without `SaveData` entry, TypeScript errors on registry access. |

### Not Applied (scaffold corrections)

| Scaffold issue | Fix applied |
|----------------|-------------|
| `this.save.bossesBeaten = next` + `this.save.flush()` | SaveSystem has no such API. Boss counter written via `registry.set('bossesBeaten', n)` + `saveSystem.save()` in `main.ts` at victory. |
| `onBossDefeated()` animated transition | Not called at boss defeat because `denProgression` is null during boss fights. State is picked up instantly via `applyState` on homeBase re-entry. Animated "warmth blooms in" is a Phase 2 refinement if desired. |
| `buildHomeBaseDen()` return object with handles | Scaffold assumed a master function. Implemented as: individual builds in the constructor, return values captured, stored on `this.denHandles`. |
| `isGroup` check in `rightToppledStool` | `THREE.Group` has no `isGroup` property. Uses `userData.toppled` tag instead. |
| Confetti opacity fade silently doing nothing | `MeshToonMaterial` defaults `transparent: false` — opacity changes don't render. Fixed by pre-flagging confetti `transparent: true` at build time in `DenBuilder`. |
| NPCs tracked by scene `add` callback | NPCs added via `scene.add` directly, cleaned up by `dispose()` in `SurvivorsProgression`. `dispose()` is called from `main.ts` before `destroy()` on zone exit. |
| `_warmAtmosphere` fighting zone-switching | Fixed with `scene.userData.homeBaseWarmth` mutable variable. Zone transitions read it instead of hard-coding `0.12`. |
| JavaScript throughout | Full TypeScript with typed interfaces, typed Tweener entries, typed DenHandles. |

---

## Compile status
`npx tsc --noEmit` — **clean, zero errors** after all changes.
