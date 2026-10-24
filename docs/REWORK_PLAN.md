# NoLegs Rework — Priority List

Order agreed: **Physics → Visuals → Combat → Sound.** Items are ranked inside each
phase; do them top-down. ✅ = done in the 2026-10-23 session.

---

## 0. Cleanup ✅

- ✅ Deleted 32 dead source files: every Phaser-era scene, entity, UI and system that
  `main.ts` never reached, plus `SceneManager`, `Controls`, `ChestLootTable`.
  `ColonyRestorationSystem.ts` kept (unwired colony-NPC feature, Phaser-free).
- ✅ Uninstalled `phaser`. Removed the empty `assets/` and `src/assets/` trees and the
  stray `D:dmorganDocumentsGitHubSpiderGamesrcui/` folder.
- ✅ Docs organised: `docs/reference/` (locomotion reference), `docs/archive/`
  (Phaser-era references, session logs, MIGRATION_GAPS, CHANGELOG),
  `docs/audio_consolidation_report.md`. Deleted the stale `LeanMasterContext.txt`.
- ☐ `.claude/worktrees/focused-goldstine-58f3de` is a leftover git worktree (gitignored).
  Developer to remove with `git worktree remove` / `git worktree prune`.

---

## 1. Physics

### Engine decision ✅ — Rapier (`@dimforge/rapier3d-compat` 0.21.0)

| Option | Verdict |
|---|---|
| Hand-rolled circle/AABB solver (old) | Root cause of the failures below. No CCD, no oriented shapes, no queries. |
| **Rapier** | Rust→WASM, actively maintained, CCD, convex hulls/trimesh, ray/shape queries, character controller, deterministic. Best fit for a browser action game. |
| Jolt (WASM) | Comparable power, heavier and less TS-friendly API. |
| cannon-es / ammo.js | Stale or unmaintained. |

### Audit findings → status

| # | Finding (old system) | Effect in game | Status |
|---|---|---|---|
| P1 | Impulses written to `velocity` *after* the physics step; next frame input overwrote velocity wholesale | Contact knockback, boss suction, Roller slam/tail knockback, web player-pull did **nothing** or lasted 1 frame | ✅ New velocity model: `velocity` = intent, `push()` = decaying impulse, `forceVelocity()` = override, `addDrift()` = environmental flow |
| P2 | Den octagon wall panels had no colliders; only an invisible r=50 circle | Walked straight into the visible burrow mounds (they reach in to r≈25–34) | ✅ Panels, posts, rubble are oriented boxes; every mound gets a collider from its real geometry |
| P3 | Props used hand-guessed circles at "0.45 coverage" | Walk half-way into workbench, cabinet, tables | ✅ Furniture colliders generated from mesh footprints (`addFootprint`) |
| P4 | Diagonal colony maze walls used the swept AABB | Large invisible walls next to diagonal stubs | ✅ Oriented segment boxes (`addStaticSegment`) |
| P5 | Circle-vs-AABB skipped when the centre was inside the box; no CCD | Fast moves (dodge, web pull, charges) tunnelled through walls | ✅ Rapier CCD + 5-wu-thick bound walls. Verified: 60 wu/s into den walls, 40 wu/s into colony walls — no tunnelling |
| P6 | Variable timestep (`min(dt, 0.1)`) | Frame-rate-dependent collisions/knockback | ✅ Fixed 60 Hz steps with accumulator + render interpolation (`renderX/renderZ`) |
| P7 | Single global Webbs scale (2.4) tuned for the 5× den | In colony/boss Webbs was 5–7× wider than enemies, wider than corridors, crossed the arena in 1.6 s | ✅ Per-zone creature scale (`ZONE_SCALE`: den 2.4, colony/boss 1.0) with camera frustum scaled to match — same on-screen size everywhere |
| P8 | Physics flat at y=0 while the den floor varies −1.2 … +5.8 | Webbs/feet floated or sank | ✅ Terrain trimesh for ground queries; Webbs body and every foot plant on the real floor. Den central depression removed (props sit at y=0) |
| P9 | Staggered enemies kept their last AI velocity | A beetle hit mid-charge kept charging through its stun | ✅ Stun zeroes locomotion intent |
| P10 | 50/50 overlap split regardless of size | No sense of weight | ✅ Mass-weighted contacts; heavier = `knockbackResist` |
| P11 | `drag` field declared, never used | Pulled enemies slid until stagger ended | ✅ `drag` is the impulse decay rate; web pull uses `forceVelocity` |
| P12 | Web range/speed constants in 1× units | Web was tiny in the den | ✅ Scaled by Webbs' zone scale |

Dev tools added: **F9** collider wireframe overlay; `window.__nolegs` console handle (both dev-only).

### Locomotion rewrite ✅ (`SpiderLegs.ts`, `Webbs3D.ts`)

| # | Finding (old gait) | Fix |
|---|---|---|
| L1 | Leg anchors/roots used yaw **−θ** while the body mesh used **+θ**. The layout is symmetric so it looked roughly right, but each leg (and its weapon) sat on the wrong side of the body after turns — the source of the old "front legs become back legs" reports | One yaw convention (THREE's) for anchors, roots and step targets |
| L2 | Fixed 0.10 s steps at every speed; group waited for threshold *then* for the other group → feet ~0.9 behind at speed, constant over-stretch and emergency steps | Speed-scaled swing (0.17 s crawl → 0.10 s full speed); threshold shrinks with speed so the groups alternate rhythmically (A/B every 6 frames, max 4 legs airborne, duty ≈ 0.6) |
| L3 | Planted feet rotated rigidly with the body every frame (pinwheel) | Feet stay planted; only 55% pivot-slip on hard turns, the rest is taken up by quicker, shorter turn steps. Body yaw capped at 9 rad/s |
| L4 | Linear step lerp with a sine arc | Eased stride (accelerate off, decelerate into the plant) with an early-peaking lift — snappy pick-up, soft set-down; arc height scales with step length |
| L5 | Body height = fixed; no tilt | Body height, pitch and roll from where the feet stand; crouch at speed, dip while a group is airborne; lean into acceleration and toward strikes |
| L6 | Attacks hard-replaced a leg's position | Attack poses blend in/out over the gait foot (≥ 70 / 80 ms), returning to the stance foot |
| L7 | Soft snap teleported drifted feet | Emergency re-plant step instead of a teleport |
| L8 | Idle fidget (groups re-stepping) | Settle steps plant exactly on the anchor, once per group per stop |
| L9 | Velocity set instantly from input | Eased intent: ~60% speed at 50 ms, ~95% at 180 ms, short skid on release |
| L10 | Footsteps on a 0.28 s timer | Footstep audio fires on real tetrapod landings (`legs.onStep`) |

Verified with a fixed-60 fps harness driving `SpiderLegs.update` (heading-independent;
straight walk: 0 over-stretch after the first 6 frames, ≤ 0.07 planted slide).
Known limit: a full-speed 180° reversal still over-stretches for ~0.4 s (reads as a skid).

### Web as a rope ✅ (`WebLauncherSystem3D.ts`, `PhysicsWorld.ts`)

| # | Finding (old web) | Fix |
|---|---|---|
| W1 | Pull = constant 9 wu/s velocity override; player input ignored, stopped dead on release | `physicsWorld.addRope()`: a velocity-level rope constraint inside the fixed step. Reel-in shortens the line (eased up to speed over 0.12 s); sideways input swings around the anchor; 80% of rope-driven velocity carries into a release (fling) |
| W2 | Who-gets-pulled was a hard `knockbackResist ≥ 0.5` switch | Mass-weighted: verified a 1.72 enemy moves 2.85× Webbs, a 15.3 one drags him 3.1× |
| W3 | Wall hits were per-scene AABB/radius guesses (den: an r=50 circle — missed every mound, panel and prop) | Swept-ball `physicsWorld.castBall()` against real colliders; anchors on the hit surface. Scene `webWallHitTest` and colony `mazeWallAabbs` deleted |
| W4 | Wall anchor was a flag that cancelled suction in boss code | The leash is physical — holds Webbs at rope length against a 12 wu/s drag (3× suction). Flag kept for the boss's lethal-range check |
| W5 | Straight 2-point line at fixed y=0.18/0.4 from body centre | 20-point strand from the ventral nozzle: sags with slack, near-straight when taut, twangs on attach; glob flies a shallow arc |
| W6 | Webbs' mass fixed at construction (den scale) → 28 in the colony | Mass follows collider area on `radius` change |

Not wired (pre-existing): `setPickupHitTest` is never called, so pickups can't be webbed yet.

### Enemy shapes + exact contact ✅

Measured every enemy mesh footprint (legs excluded) against its collider:
centipede (mesh ±0.32 long, ball r 0.14), ant worker (±0.2, r 0.09) and the Roller
(±0.78 × ±0.37, r 0.42 — Webbs could walk half into it) were badly undersized.
Elongated enemies now use capsules (`EnemyConfig3D.capsule`) aligned to their body
and turned with `group.rotation.y` each frame; beetle got a short capsule, jumping
spider and nose stay round. Contact damage (main loop + Roller slam/patrol) uses
`physicsWorld.touching()` — exact shape distance — instead of centre-distance radius
sums. Verified: probes stop at 0.58 (centipede nose), 0.41 (side), 0.58 after a 90°
turn, 1.01 / 0.65 (Roller end / side); contact true at the stop point, false when clear.

Weapon hit tests (`WeaponUseSystem3D`) still use centre distance − `bodyRadius`;
moving them onto shape queries belongs to the combat pass.

### Remaining physics work

1. **Den walkable space.** Mounds now (correctly) limit the den to r≈34 of the
   authored 52. Decide in the visual pass: shrink the mounds or accept the smaller
   room and pull the wall panels/lights inward.
2. Remove the legacy `aabb` body path once every wall uses explicit shapes; drop the
   unused squeeze-mode radius.
3. Bundle: Rapier compat embeds WASM as base64 (bundle 5.1 MB / 1.9 MB gz). Optional:
   switch to `@dimforge/rapier3d` + `vite-plugin-wasm` for a smaller, streamed load.

---

## 2. Visuals (in progress)

Decisions (user, 2026-10-23): **perspective iso camera**, **shrink the den mounds**
(walkable den back to ~r50), **procedural but upgraded** (no asset pipeline).

### Done ✅

| # | Change |
|---|---|
| V1 | `core/CameraRig.ts` — perspective iso (FOV 30°, elevation 32°, bearing π/4) replacing the orthographic camera. Framing per unit creature scale (same on-screen Webbs size in every zone), cursor look-ahead, eased zoom, snap on zone entry, distance-scaled shake. One source of truth for the bearing (`CAMERA_YAW`), used by camera-relative WASD and the celebration pose (was hard-coded in 3 files) |
| V2 | Den burrow wall rebuilt: 44 mounds r 5–8 at 1.00–1.06 × R (was 26 at r 14–23). Walkable den now r 47–54 in every direction (was 25–34) |
| V3 | Octagon wall panels were rotated 90° — every 41-wu panel stuck inward radially like a spoke to r≈33 (hidden by the old giant mounds). Now tangent to the ring |
| V4 | `env/ZoneLighting.ts` — one preset per zone: key light (shadow caster; shadow box now follows the player — it was a fixed ±25 box at the origin), hemisphere ambient, player lantern (scaled per zone; boss had none), linear fog keyed to camera distance (exp fog was eating ~64% of the image at the new camera distance), exposure, grade warmth. Applied inside the zone blackout. Per-scene ambient/fill lights removed; accent lights calibrated to physical units with one gain per zone |
| V5 | Den mean luminance 9 → 24–30 /255, near-black 87% → 30–38%, blown highlights < 1% |
| V6 | **Tone mapping was never applied.** three r153+ only tone-maps/sRGB-encodes when drawing straight to the screen; through the composer the game showed raw linear colour (no ACES, no sRGB, exposure had no effect). Added `OutputPass`; rescaled raw shader constants (fog-of-war colour, grade lift) to linear |
| V7 | `env/Materials.ts` — palette of mid-value albedos, procedural tileable textures (dirt, stone, chitin, wood, silk), world-space tri-planar toon surfaces; colony, boss and den earth/walls/floors re-skinned (near-black 0x0e0a06-class paint removed). Crisp Fresnel rim on Webbs (cool), his legs/weapons, and all enemies (warm) |
| V8 | `core/InkOutlinePass.ts` — screen-space ink outlines on everything from scene depth (Laplacian of linear depth, distance-faded), before bloom |
| V9 | Light budget: only the 8 strongest accent point lights near the player stay on (colony has 46); constant visible count → no shader recompiles. Verified 9 visible / 46, 55 programs stable, 60 fps |
| V10 | Responsive: 1280×720 logical layout CSS-scaled to the window; render resolution follows displayed size (pixel ratio capped at 2); mouse picking normalised |
| V11 | Den exit wedge closed (mound gap now matches the doorway); spool stools scaled to den furniture (were 0.7 tall beside 6-wu tables), ring moved clear of the table and the clue cradle |

Luminance after V6–V8 (mean /255, near-black %): den 53–63 / 14–18 %; colony
revealed area ≈ 37–64; boss centre ≈ 21 (pre-lift) — all readable, moods intact.

### Next (visual)

1. **Fog of war vs perspective** — reveal radius/softness were sized for the old
   ortho framing; tune against the new camera (play-feel, needs a human eye).
2. **Proportions pass** — set a size chart (Webbs = 1 body length) for the den's
   remaining props: flat hammock planes read as floating cards from the new angle;
   bottle-cap tables / matchbox / thimble scale vs Webbs.
3. **Character detail** — chitin texture on enemies, Webbs' body texture through the
   shared material system, consistent eye/emissive levels for bloom.
4. **Fine tuning** — per-zone exposure/ambient once props are re-scaled.

## 2b. UI pass ✅ (requested before combat)

One design system for every menu, overlay and HUD element — `src/ui/theme.ts`:
tokens, Fraunces (titles) / Space Grotesk (UI) / JetBrains Mono (keys, numbers),
panels with a silk double-border, keycaps, chips, stat bars, shared motion, reduced-
motion support. `richText()` renders `[Q]`-style tokens as keycaps everywhere.

| Screen | Before | Now |
|---|---|---|
| Title | Flat dark page, two boxes | Over the live den (camera drifts), drawn spider mark, serif logo, keyboard nav |
| Pause | none | `Esc`: Resume · Controls · Sound · Quit to title (replaces the H legend) |
| Opening story | Small box | Cinematic letterbox, large serif, typewriter, page dots |
| Notes / clues / tutorials | Monospace box | Ribbon card, typewriter (`M` finishes the line, then advances), keycaps |
| Discovery | Pop + blink | Rays, medallion pop + shine + ripple, letter-by-letter name, type/range chips, stat bars; variants *found / crafted / gift*; animated exit |
| Workbench | Text list | Recipe cards with Ready/Missing/Tier/Find-it status, ingredient have/need chips, material wallet, weave animation → result pop (first craft → discovery) |
| Equipment | Text list | Leg diagram mirroring the HUD ring (locks, pulse on equip), armory cards with "on legs" badges, detail with stat bars |
| HUD | Monospace bars | Framed bars with numbers, damage ghost bar, low-HP pulse, leg-ring with active-slot highlight, boss bar with ghost, boss callout animation |
| System messages | Everything went through the red boss line | `hud.toast()` (info/warn/danger/good) for status; boss line only for boss callouts |
| Loot feed | 240px cards per pickup | Material names + glyphs, repeats merge into one card with a running ×N |
| XP | A card per gain | Small `+N XP` pop at the counter |
| Zone title | Plain text | "Zone 1" eyebrow + serif name, letter reveal, growing rule |

Also: craft weave and the discovery settle beat run on the game-loop clock (were
timers that could fire late/out of order); text/menus guard overlapping close/show.
Content note: weapon names now match everywhere (Shard Sword, Chitin Axe, Web Glider).

## 3. Combat ✅ (first pass)

Dead or delayed reactions traced to: distance-check contact with a 0.75 s cooldown, hit
reaction as random jitter on the mesh, knockback that overrode AI, and no hit-stop.

| # | Finding | Fix |
|---|---------|-----|
| C1 | Melee hit at the first frame of the swing, from a radius around Webbs — no wind-up, no reach, no arc | `MELEE` profiles in `WeaponUseSystem3D.ts`: each weapon has an active window, reach, blade radius and lunge; `tickSwings` sweeps the blade tip (from `SpiderLegs.strike()`) against collider surfaces (`surfaceDistance`) every frame |
| C2 | No impact feel | Hit-stop (`hitStop()` in main.ts, world at 4 % speed; camera keeps shaking) + `DamageNumbers.ts` (gold WEAK, larger kill, red for damage taken) |
| C3 | Knockback forced velocity and fought the AI | `applyKnockback` is a mass-scaled `push()` impulse + 0.25 s knockback timer; the axe adds its sweep direction |
| C4 | Hit reaction was random mesh jitter | Directional damped-spring flinch (offset + tilt away from the blow) |
| C5 | Any touch hurt — walking into an idle enemy did damage | `dealsContactDamage()`: only attack states hurt (centipede LUNGING, beetle CHARGING, jumping spider LEAP/LAND) |
| C6 | Packs chain-stunned Webbs; hits had no direction | `Webbs3D.damage(amount, {fromX, fromZ})`: shove away from the attacker, 0.6 s invulnerability with blink, returns whether it landed; boss suction kill is `unblockable` |
| C7 | Swings had no weight | `commitAttack()` slows movement during a committed swing (sword 0.45×) |
| C8 | Arrows could hit their shooter and vanished on walls | Shape cast excludes the owner; thistle dart sticks in walls for 2 s |

Verified with a fixed-dt harness plus a live-loop probe. Sword: hits at t≈0.5 of the
swing, weak point on the centipede's head. Axe: hits the left/front/right targets at
t≈0.21/0.42/0.75 and misses targets behind. Toothpick: hits at t≈0.28. An idle enemy
that touches Webbs does no damage; a lunging one hits once, then every ~0.7 s.

Note: the Chitin Axe needs leg tier ≥ 1. At tier 0 `equip()` fails silently and slot 0
keeps its old weapon, so set the tier first in probes.

Open for playtest: per-weapon numbers (active windows, hit-stop lengths, knockback) and
whether enemies need telegraphs (wind-up glow or crouch) before lunges and charges.

## 4. Sound ✅ (engine + mix pass)

Howler is gone; `src/systems/AudioManager.ts` is now a small Web Audio engine with the
same `audio.play()` / `playLoop()` API.

| # | Finding | Fix |
|---|---------|-----|
| S1 | Lazy loading: the first swing or hit of each kind decoded on demand and played late | Every file decodes at boot (one-shots first, long loops last); a one-shot that isn't ready is dropped rather than played late |
| S2 | Many files started late (swing 0.10 s, axe swing 0.18 s, web swing 0.36 s, ground whiff 0.39 s, deaths 0.30 s, celebration swell 0.55 s) | Each buffer is analysed once and leading silence is trimmed automatically (4 ms kept) |
| S3 | Loudness varied by about 48 dB between files (dirt footstep around -49 dBFS RMS, axe-ground thud around -5), so the volume numbers were compensation, not a mix | Normalised to -20 dBFS RMS (up to +24 dB boost, peak-capped), and the registry volumes are now a real mix |
| S4 | No limiter, so stacked hits clipped | Master limiter. Five hits on one frame peak at -1.8 dBFS with about 8.5 dB of gain reduction |
| S5 | Howler 3D panning ignored the 45° camera and used world units, so the den (scale 2.4) sounded 2.4× too spread out | Panning follows the camera's right vector, falloff is measured in creature-scale units, and distance also low-passes the sound |
| S6 | Loops were global per key: one skitter shared by every centipede, and one beetle stopping silenced the others | Loops can be per owner; enemies' loops follow them (`moveOwner` in `syncPosition`) and stop on death or cleanup |
| S7 | Hits had no weight | Synth layer under the sample (`audio.impact`): sub thump by weapon weight, a crack, a bright ting on weak points, a deeper thump on kills and when Webbs is hurt |
| S8 | No sense of place | Per-zone cave reverb (generated impulses: den 0.9 s, colony 1.7 s, boss 2.8 s) set during the zone blackout |
| S9 | Menus and story text played over full-volume ambience | The pause menu muffles the world (the UI stays clear); text and discovery screens lower the ambience; the boss phase roar ducks it |
| S10 | Identical placeholders: all 5 weapon-specific deaths per enemy, boss hit = beetle wind-up, XP combo = title sting | Pitch and tone per key (e.g. axe death −3 st and darker, stab +2 st); boss hit −5 st; XP combo +4 st |
| S11 | `celeb_burst` edit outstanding (+2 st, room) | Done at runtime (rate + reverb send) |
| S12 | Ants and jumping spiders were silent apart from weapon hits | Base-class death sound; the jumping spider gets a coil hiss (telegraph), a leap and a landing |
| S13 | `flame_hit` was never played; mute didn't persist | Flame hits play while the flame touches an enemy (throttled to one every 0.3 s); mute is saved |

Still needs a listen or new source files:
- `bow_draw` (a guitar-string placeholder, darkened for now).
- `beetle_walk` and `footstep_dirt` (very noisy sources; boosted up to +24 dB).
- The identical death samples should eventually be distinct recordings.
- `centipede_idle` is unreferenced, but its 7.6 MB of files still ship in `public/audio`. Safe to delete.

## 5. Deep review (after the four phases) — backlog

Four parallel read-only reviews (physics, rendering, flow/saves, combat) plus runtime
checks. **Fixed during the review:** boss-victory soft-lock (`transitioning` set before
the delayed `transitionTo`), the release-build save-wipe key (Backquote → DEV only),
weapon kills never awarding XP (alive-snapshot taken after weapons ran), 97 den
materials losing tri-planar/rim through `Material.clone()` (`clonePatched()` in
Materials.ts), occluder fades not recompiling when `transparent` flips, suction drift
stacking on high-refresh displays, beetles jittering when spawned outside ±11.5,
frame-rate-dependent dodge distance, decoded audio 125 → 54 MB (long loops cropped).

**Player death ✅ (no penalty, user decision).** Was: HP refilled the same frame and
the fade started at once; the death sound almost never played (flag never reset, and
the HP reset beat `Webbs.update` to it); stamina/energy/lockouts carried over. Now:
killing blow → `startDeath()` in main.ts: 1.3 s beat at 0.3× world time, input and
weapons locked, death sound, legs curl (`SpiderLegs.collapse`), world muffled, slight
push-in → "Webbs limps home — Home Base" card → `Webbs3D.resetAfterDeath()` under the
blackout (HP/stamina/energy full, lockouts and timers cleared). Boss suction defeat uses
the same beat; Webbs can't die after the Roller is beaten. Also: `PhysicsWorld.remove()`
marks bodies `removed` and their setters no-op (touching a freed Rapier body panics the
WASM and poisons every later step).

**Open, in priority order**
1. *Progression — partly done.* Decision (user): **one leg tier per boss**.
   `awardBossLeg(id)` in main.ts counts distinct bosses (`bossesDefeated`, saved),
   raises `legTier`, unlocks slots, toasts; old saves with a beaten Roller migrate to
   tier 1. With one boss, tier 1 (Chitin Axe, Toothpick recipe, slots 3–4) is now
   reachable; tier 2 (Web Glider — aligned to tier 2 in WeaponData — and Flame
   Breather) waits for a second boss. Still open: consumables never obtainable; no
   ending sequence after the Roller. → Both done below.

**Consumables ✅** Workbench has Weapons | Brews tabs (←→). Brews: HP Potion (2 silk +
1 fungus, +40 HP), Stamina Tonic I/II (ant parts + web fluid (+ fungus); attacks at ⅕
stamina for 15/30 s), Max Potion (needs boss Crystal Dust; 10 s untouchable + free
attacks); Tonic III is chest-only. Non-mimic colony chests roll a brew (30 % HP potion,
15 % Tonic I, 5 % Tonic III). HUD strip `src/ui/QuickItems.ts` above the bars (C/V/X,
counts, active timers). Drinking: sound + loot-feed card; HP potion refused at full HP;
nothing while dying. Weapons you own show "Owned" instead of re-crafting (was eating
materials for an invisible duplicate).

**Chapter-one ending ✅** First Roller victory → home ("Ant Tunnels Cleared — Home"),
den built one survivor-level back, Webbs placed at the hearth; the family's return
animates (stool, hammock, hearth, 3 survivors) → `ENDING_TEXT` story → `EndingCard`
(XP / weapons / clues / brews / falls) → Keep exploring or Return to title. Saved as
`endingSeen` (plus `deaths`, `brewsUsed`); later victories go back to the colony.
2. ~~*Combat economy*~~ ✅ `Webbs3D.spendStamina()` (0.6 s regen delay, winded latch)
   and `spendEnergy()` (lockout until 25 %); stagger moved out of `takeDamage` into
   `Enemy3D.stagger()` (scaled by resistance, capped, 0.6 s immunity after) and a
   `superArmor()` hook; knockback AI pause scales with resistance. Sword 24 / Axe 52 /
   Toothpick 10 dmg; tooltips match. Beetle underbelly now from behind. Verified:
   spamming the Toothpick stuns a beetle <20 % of the time and it still charges back.
3. ~~*Boss fight*~~ ✅ Nose out of weapon targeting and collider off (rocks only; the
   suction kill is reachable); phase 2 starts on game time; rocks use contact +
   interpolated positions; web launcher gets the live list; Roller 300 HP, ×1.5 snout,
   0.5 s slam crouch and 0.4 s tail wind-up with a growl, super armor while slamming,
   tail arc fixed (±X), contact hits shove; reflects only on swings that fired.
4. ~~*Saves*~~ ✅ SaveSystem v2 (`version` field + `migrate()`): adds `totalXp`,
   toothpick/tutorial flags, colony fog, `bossesDefeated`; equip screen writes
   `weaponSlots` (was the unread `equippedSlots`). `persist()` in main.ts is the one
   save path — on every overlay close, presentation end, zone change, boss victory, a
   15 s autosave, and tab hide/close (`pagehide`/`visibilitychange`; also grabs the
   colony fog). Never saves on the title screen. New Game calls
   `saveSystem.resetRegistry()` and resets warmth, consumables, leg tier and Webbs.
   No menus during zone fades; one overlay per frame; closing an overlay only unpauses
   if no other is open (`anyOverlayOpen()`). The text box ignores input for 250 ms
   after opening (Space on the title no longer skips the story).
5. ~~*Memory*~~ ✅ `src/core/dispose.ts` (`disposeTree`, `disposeMaterial`) frees
   geometry + materials + textures for whole trees; used by all three zone teardowns,
   boss effects and `Enemy3D.cleanup()`. Session-wide resources carry
   `userData.shared` (gradient map, procedural texture cache, leg fuzz texture — legs
   made 8 textures per rebuild). Measured over 3 den↔colony round trips: geometries
   flat (~330 den / ~590 colony; were 349 → 1113), textures flat at 25 (were 31 → 96).
6. ~~*Load time*~~ ✅ `vite.config.ts` plugin `nolegs:rapier-wasm` cuts the base64
   WASM out of `rapier3d-compat` and serves it as `assets/rapier3d-<hash>.wasm`
   (streamed compile, immutable cache; dev serves `/@rapier/rapier3d.wasm`; Rapier is
   excluded from optimizeDeps so the transform runs). JS 5.19 MB → 1.11 MB; total
   Brotli ≈ 1.07 MB (was ~1.9 MB gzip). Audio preloading starts after the first frame
   and only covers one-shots + den ambience; other loops load on first play.
   `vite preview` launch config ("preview", :4173) for checking the prod build.
7. ~~*Image quality/perf*~~ ✅ `src/core/Quality.ts`: tiers (`low` = coarse pointer,
   ≤4 GB or ≤4 cores; `?quality=low|high` forces): pixel-ratio cap 2 / 1.25, shadow
   map 2048 / 1024, bloom on / off, dynamic resolution on low (−10 % per 2 s below
   ~48 fps to 0.6, +5 % back above ~57 fps). Canvas MSAA off + FXAAPass last. Resize
   coalesced to one fit per frame and only reallocates on a real change. Vignette
   smoothstep fixed. PCFShadowMap. Shadow box texel-snapped (no crawl). Fog of war only
   stamps/uploads after 0.2 wu of movement. Colony walls + trail merged (≈1,060 → 427
   draw calls, derived). Input raycast scratch objects reused.
   **Touch controls ✅** `src/ui/TouchControls.ts` feeds `InputManager` (new
   `setStick()` analog stick + `press()/release()` virtual keys), so gameplay reads the
   same codes. Floating stick (left 46 % × 72 %), Attack (`TouchAttack`, auto-aims the
   nearest enemy within 5 units favouring the front; hold = flame), Web (Q), Dodge
   (Space), Use (E, only when the interact hint shows), Pause (Esc), Equip (I); weapon
   ring slots and brew cards are tappable. Menus: Back → Esc on panels; story text /
   reward cards take a tap (→ Enter) and Skip (→ Space); title/ending buttons are
   clickable as before. HUD re-laid out in touch mode (bars + brews top-left, ring
   top-right, keyboard hints hidden). Turns on at first touch (tries fullscreen +
   landscape lock), off on any key or real mouse move; `?touch=1` forces it. Portrait
   shows a rotate prompt. Targets ≥ ~47 CSS px at 844×390. Verified with synthetic
   touch events — **not yet tried on a real phone.**
8. ~~*AI edges*~~ ✅ Culled colony enemies stand still (velocity zeroed, still synced).
   Centipede wall-hug probes real colliders (`nearestWall`: castBall ahead/left/right)
   and runs along the wall's tangent toward the player. Jumping spider stunned/shoved
   mid-leap drops to RECOVER on the ground. Ants: WINDUP (0.3 s rear-up + mandible
   click `ant_bite`) → BITE (0.14 s snap, the only time they hurt) → RECOVER; measured
   336 ms of tell before damage. Beetle walk loop starts on spawn. Web homing blend is
   per-second (`HOMING_RATE`); a web line snaps when a static wall comes between Webbs
   and the anchor, or when a wall anchor's body is removed (`lineBlocked`). Melee active
   windows use [last t, t] overlap (first frame from t = 0), so 10 fps still lands every
   weapon; 60 fps timing unchanged. (Beetle underbelly was fixed in the combat pass.)

## 6. Onboarding + prop/Webbs art pass ✅

- **Den guide** (`src/systems/DenGuide.ts`): one objective line under the zone label,
  steps search → card → gift → toothpick → workbench weapon → 3 clues → exit; done
  steps (any order) are skipped; a hint toast after 13–18 s on a step, then a bouncing
  marker over the target (+ edge arrow when off screen). Saved as `guideStep`.
  Targets come from `HomeBaseScene3D.guidePoints()`.
- **Props** (`src/env/Props.ts`, idle motion via `tickProps()`): per-material pickup
  models (silk spool, chitin shards, fluid drop, bone, ant leg, fungus, crystals,
  venom gland, thistle) with glow + ground ring (den: faint fading light shaft);
  health berry (colony HP modules); birthday card (doodled front, "17", pressed
  flower, stone base); polka-dot gift with lid, bow, "for W." tag; toothpick stuck in
  a mossy mound; workbench (bark slab on thread-spool legs, loom, needle, thimble,
  silk ball); acorn chests with a hinged cap that eases open and lights the inside —
  mimics show eyes and teeth as they wake. Footprints unchanged (colliders, glint).
- **Webbs** (`src/entities/WebbsBody.ts`): painted abdomen (heart stripe, chevrons,
  spots), grooved carapace, open silk harness with stitches, glossy eyes with cyan
  iris rings, dark chelicerae + fangs, pedipalps, spinnerets, instanced fur. Same
  socket geometry for the legs. `addRim` now honours `material.userData.noRim`.
- Dev: `__nolegs.zoom(z|null)` and `__nolegs.photo([camX,camY,camZ,lookX,lookY,lookZ]|null)`.

**All §5 review items are now addressed.** Open next: playtesting on real devices
(touch feel, auto-aim, mix levels), Chapter Two (the Hive boss → leg tier 2, Web Glider
and Flame Breather), and anything the playtest turns up.
