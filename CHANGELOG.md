# Changelog

## [Unreleased] — 2026-05-08

### Fixed

#### EquipScreen crash / "I" key locking the game
The equip screen was trying to read `equipSystemRef` from the registry, which was never populated. This caused a `TypeError` inside `EquipScreen.create()` that crashed the Phaser game loop, effectively freezing the game whenever `I` was pressed. Fixed by switching `EquipScreen` to use `WeaponSystem` (the same instance already attached to Webbs) stored as `weaponSystemRef`. Both `HomeBaseScene` and `AntColonyScene` now register this reference before the player can open the screen.

Also added caller-scene pause on open and resume on close (matching the pattern `CraftingMenu` already used), and a `resume` event listener on each scene that calls `refreshLegColors()` so the leg visuals update the moment the screen closes.

#### Crafting inventory display not updating
The material-count text objects in `CraftingMenu` were created once in `create()` and never refreshed. After crafting, the on-screen counts showed stale values, making it appear that no materials were consumed. Added `invCountTexts` to track those text objects and a `refreshInventoryPanel()` method that updates them — called immediately after each successful craft.

#### `AntColonyScene` crafting side-effects
`AntColonyScene` was launching `CraftingMenu` without setting `callerScene` in the registry, so the menu was pausing `HomeBaseScene` (inactive) instead of `AntColonyScene` (the actual running scene). Also added the missing crafting-inventory sync block to `AntColonyScene`'s `pendingEquip` handler — previously the crafting system's internal Map was never updated after crafting in that zone.

#### Keys 1–8 activating wrong weapon slots (off-by-one)
`activateWeapon(n, ...)` was called with `n` = 1–8 but `WeaponSystem` slots are 0-indexed (0–7). This meant key `1` checked slot 1, slot 0 was never reachable by any key, and key `8` read `slots[8]` (out of bounds, silently returning `undefined`). Fixed to `activateWeapon(n - 1, ...)` in both scenes.

#### Workbench freezes game on second visit
When CraftingMenu closed and the game scene resumed, Phaser replayed the stale E-key state on the first active frame, causing `JustDown(eKey)` to fire again immediately and re-launch CraftingMenu before it had finished stopping. Fixed by adding an `isActive('CraftingMenu')` guard to the workbench interaction check so the launch is skipped on that frame.

#### Weapons can only fire once — cooldown never resets
`WeaponUseSystem.update(delta)` was never called in either scene's update loop, so weapon cooldown timers never decremented. After the first use, a weapon would be permanently locked. Added the missing `weaponUseSystem.update(delta)` call to both `HomeBaseScene` and `AntColonyScene`.

#### Weapon keys unreliable — fired into wrong scene context
Keys 1–8 were bound via `input.keyboard.on('keydown-N', ...)` event listeners. Phaser can flush queued keyboard events to a scene on the frame it resumes from a pause, meaning a keypress made while the scene was paused (e.g. while EquipScreen was open) could fire in the wrong context. Switched to `addKey` + `JustDown` checks inside the scene's `update()` loop — the same pattern used by EquipScreen — so weapon keys are only processed when the scene is actively running.

#### EquipScreen number keys required a separate ENTER press to equip
Pressing a number key (1–8) in the EquipScreen only highlighted the slot — the weapon was not actually assigned until the player also pressed ENTER. This was not obvious and made it appear that weapons could not be mapped. Number keys now equip the currently highlighted inventory weapon to the pressed slot immediately in a single keypress. ENTER still works as a secondary confirm-on-selected-slot action.

#### Locked slots indistinguishable from open ones
Slots 5–8 are locked at leg tier 1 (tiers unlock in pairs: 1–2 at tier 0, 3–4 at tier 1, 5–6 at tier 2, 7–8 at tier 3). These locked slots looked identical to open ones, so attempting to equip to them silently failed with no feedback. Locked slots now display a faint `×` mark and a dimmed ring. Open slots retain the dot/weapon-initial display.

### Changed

#### Craft-to-inventory flow
Crafted weapons now go into `weaponInventory` (the registry list that `EquipScreen` reads) instead of being silently auto-equipped to the first free slot. The intended loop is now explicit:

1. **Craft** at the workbench → weapon appears in inventory
2. Press **I** to open the Equip Screen → assign weapons from the right panel to leg slots on the left
3. Press **1–8** in-game to fire the weapon assigned to that leg slot
