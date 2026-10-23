# NoLegs — Migration Guide: Phaser 3 → Three.js Isometric Renderer
## Path 2: Keep TypeScript/Vite, Replace Rendering Layer

This document provides complete instructions for migrating the NoLegs spider game from Phaser 3 (flat 2D top-down) to Three.js (3D isometric, Diablo/Hades-style camera). The goal is to keep all game logic intact while dramatically improving the visual presentation.

**Read the companion document `GAME_REFERENCE.md` first** — it contains the full source architecture, every entity, system, scene, and constant in the current codebase.

---

## TABLE OF CONTENTS

1. [Current Architecture Summary](#1-current-architecture-summary)
2. [Target Architecture](#2-target-architecture)
3. [What Carries Over Unchanged](#3-what-carries-over-unchanged)
4. [What Must Be Rebuilt](#4-what-must-be-rebuilt)
5. [Migration Order](#5-migration-order)
6. [Phase A — Foundation](#6-phase-a--foundation)
7. [Phase B — Player Entity (Webbs)](#7-phase-b--player-entity-webbs)
8. [Phase C — Spider Leg Locomotion (Critical)](#8-phase-c--spider-leg-locomotion-critical)
9. [Phase D — World and Environment](#9-phase-d--world-and-environment)
10. [Phase E — Enemies and Combat](#10-phase-e--enemies-and-combat)
11. [Phase F — HUD and UI Overlays](#11-phase-f--hud-and-ui-overlays)
12. [Phase G — Boss Fight](#12-phase-g--boss-fight)
13. [Phase H — Effects, Fog, and Polish](#13-phase-h--effects-fog-and-polish)
14. [Spider Locomotion Algorithm](#14-spider-locomotion-algorithm)
15. [Key Risks and Mitigations](#15-key-risks-and-mitigations)
16. [Reference Links](#16-reference-links)

---

## 1. Current Architecture Summary

| Layer | Current Implementation |
|---|---|
| **Engine** | Phaser 3 (AUTO renderer — WebGL preferred) |
| **Language** | TypeScript (strict, erasableSyntaxOnly — no enum keyword) |
| **Build** | Vite |
| **Deploy** | Cloudflare Pages — `playnoleg.th3dan.com` |
| **Rendering** | All procedural via `Phaser.GameObjects.Graphics` — zero sprite sheets |
| **Physics** | Phaser Arcade (no gravity, circle bodies, collider/overlap) |
| **Scenes** | Phaser Scene system (start/stop/pause/resume/launch for overlays) |
| **State bus** | Phaser `registry` (DataManager) — cross-scene shared state |
| **Camera** | Phaser Camera, zoom 1.15, smooth follow |
| **HUD** | Phaser overlay scenes (HUDScene, EquipScreen, CraftingMenu, etc.) |
| **Canvas** | 1280 × 720, background `#1a1a2e` |
| **Save** | localStorage key `noLegs_save_v1` |

### Critical constraint
TypeScript `erasableSyntaxOnly` is enforced — `enum` keyword is banned. Use `const` objects + type aliases (already the pattern in the existing codebase).

---

## 2. Target Architecture

| Layer | New Implementation |
|---|---|
| **3D Renderer** | Three.js (WebGL2) |
| **Camera** | `OrthographicCamera` angled at ~35° from horizontal, ~45° rotation — classic isometric Diablo angle |
| **Language** | TypeScript (same constraints) |
| **Build** | Vite (unchanged) |
| **Deploy** | Cloudflare Pages (unchanged) |
| **Physics** | Custom 2D collision on the XZ ground plane (see details below) |
| **Scene/State** | Custom SceneManager class replacing Phaser's scene system |
| **State bus** | Custom Registry class (simple Map<string, any> with event emitter) |
| **HUD/UI** | HTML/CSS overlay div on top of the Three.js canvas |
| **Spider rendering** | Procedural 3D leg segments with inverse kinematics |
| **World geometry** | 3D meshes for terrain, walls, and environmental objects |

### Why Three.js and not a full engine

- Stays in the TypeScript/Vite/Cloudflare ecosystem — no toolchain migration
- All existing game logic (systems, configs, data files) can import directly
- Three.js handles the 3D rendering; we build the game layer ourselves (which we already have)
- The existing codebase already does everything "manually" (procedural graphics, manual collision checks, manual distance-based combat) — it's already structured like a custom engine using Phaser only for rendering and input

---

## 3. What Carries Over Unchanged

These files/modules contain pure game logic with no Phaser rendering calls. They can be extracted and reused with minimal changes (mostly removing Phaser type imports):

### Systems (core game logic)
| File | What Changes |
|---|---|
| `src/systems/WeaponSystem.ts` | **Zero changes.** Pure slot/tier logic with no Phaser dependency. |
| `src/systems/CraftingSystem.ts` | **Zero changes.** Pure Map<MaterialType, number> with add/remove/snapshot. |
| `src/systems/ConsumableSystem.ts` | **Minor.** Remove Phaser `time` references; pass delta from game loop instead. |
| `src/systems/SaveSystem.ts` | **Zero changes.** Pure localStorage read/write. |
| `src/systems/ZoneTransitionSystem.ts` | **Moderate.** Remove `cameras.main.fade()` call; replace with custom transition. Keep spawn logic, zone beat data, direction mapping. |
| `src/systems/WeaponUseSystem.ts` | **Moderate.** Combat math (radius checks, cone sweeps, damage, knockback vectors) is pure geometry — keep all of it. Remove Phaser-specific VFX calls (camera shake, particle emitters, generated textures). Replace with Three.js equivalents. |
| `src/systems/WebLauncherSystem.ts` | **Moderate.** Projectile state machine and pull/attach logic is pure. Remove Phaser Graphics line rendering; replace with Three.js line. |

### Config/Data (zero changes)
| File | Notes |
|---|---|
| `src/config/WeaponData.ts` | Weapon colors (as hex numbers), stats, DPS — all reusable |
| `src/config/ChestLootTable.ts` | Weighted random loot — pure math |
| `src/config/Controls.ts` | Key code constants — replace with standard KeyboardEvent.code values |

### Constants and balancing numbers
Every numeric constant in the GAME_REFERENCE.md (speeds, radii, cooldowns, damage values, ranges, stamina costs) carries over directly. The game feel is defined by these numbers, not the renderer.

---

## 4. What Must Be Rebuilt

### 4.1 Rendering (everything visual)

**Current:** All visuals are `Phaser.GameObjects.Graphics` draw calls — `fillCircle`, `fillRect`, `lineStyle`, `lineTo`, `fillPolygon`. Every entity draws itself procedurally.

**New:** Three.js meshes, materials, and geometry. Entities become `THREE.Group` objects containing child meshes.

Specific rebuilds:
- **Webbs body** → `THREE.Mesh` (sphere or stylized body shape) with `MeshToonMaterial` for cel-shaded look
- **Webbs legs** → Procedural `THREE.Line` or `THREE.Mesh` segments with IK solver (see Phase C)
- **Weapon tips** → Small meshes at leg endpoints, colored per weapon type (colors from WeaponData.ts)
- **Enemies** → `THREE.Group` with body mesh + detail meshes (eyes, mandibles, legs)
- **Environment** → Ground plane mesh, wall meshes (extruded rectangles), decorative objects as simple geometry
- **Pickups** → Small emissive meshes with bob animation
- **Projectiles** → Small meshes or line geometry with trail effect

### 4.2 Physics

**Current:** Phaser Arcade — circle bodies, `physics.add.collider()`, `physics.add.overlap()`, `body.setVelocity()`.

**New:** Custom 2D collision system operating on the XZ ground plane. All movement in this game is 2D (no jumping, no verticality in gameplay). The 3D renderer just presents the 2D gameplay from an angled camera.

Implementation:
```typescript
// Collision operates on 2D positions projected to the ground plane
interface CollisionBody {
  x: number;        // world X
  z: number;        // world Z (was Y in Phaser)
  radius: number;   // circle collision
  velocity: { x: number; z: number };
  isStatic: boolean;
  enabled: boolean;
}

class PhysicsWorld {
  bodies: CollisionBody[] = [];
  
  update(delta: number) {
    // Move dynamic bodies
    for (const b of this.bodies) {
      if (b.isStatic || !b.enabled) continue;
      b.x += b.velocity.x * delta;
      b.z += b.velocity.z * delta;
    }
    // Circle-circle collision resolution
    // Circle-AABB for walls (rectangles)
    // World bounds check
  }
}
```

**Critical:** The existing codebase already uses manual distance checks for most combat interactions (contact damage, weapon hit detection, pickup collection). These checks use `dx*dx + dy*dy < r*r` — they translate directly. Just swap `y` for `z` in the 3D coordinate system.

### 4.3 Scene Management

**Current:** Phaser's `Scene` class with `start()`, `stop()`, `pause()`, `resume()`, `launch()` for overlays.

**New:** Custom SceneManager:

```typescript
interface GameScene {
  key: string;
  create(): void;
  update(delta: number): void;
  destroy(): void;
  pause(): void;
  resume(): void;
}

class SceneManager {
  private scenes: Map<string, GameScene>;
  private activeScene: GameScene | null;
  private overlays: GameScene[] = [];
  
  start(key: string): void { /* stop current, create new */ }
  launch(key: string): void { /* add overlay, pause active */ }
  stopOverlay(key: string): void { /* remove overlay, resume active */ }
}
```

### 4.4 State Registry

**Current:** `Phaser.Data.DataManager` (this.registry) — shared key-value store with change events.

**New:** Simple typed registry:

```typescript
class Registry {
  private data = new Map<string, any>();
  private listeners = new Map<string, Set<(value: any) => void>>();
  
  get<T>(key: string): T { return this.data.get(key) as T; }
  set(key: string, value: any): void { /* set + notify listeners */ }
  on(key: string, callback: (value: any) => void): void { /* subscribe */ }
}
```

### 4.5 Input

**Current:** `Phaser.Input.Keyboard` with `JustDown()` checks in `update()`.

**New:** Native browser `KeyboardEvent` + `MouseEvent` with a thin wrapper:

```typescript
class InputManager {
  private keysDown = new Set<string>();
  private keysJustDown = new Set<string>();
  private mousePos = { x: 0, y: 0 };
  private mouseDown = false;
  
  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) this.keysJustDown.add(e.code);
      this.keysDown.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    // Mouse: raycast from camera through mouse position to ground plane
  }
  
  isDown(code: string): boolean { return this.keysDown.has(code); }
  justDown(code: string): boolean { return this.keysJustDown.has(code); }
  endFrame(): void { this.keysJustDown.clear(); }
}
```

**Mouse-to-world conversion** is critical for aiming weapons. In isometric 3D, you must raycast from the camera through the mouse position to the ground plane (Y=0) to get the world-space target:

```typescript
function mouseToWorld(mouseX: number, mouseY: number, camera: THREE.OrthographicCamera): THREE.Vector3 {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(
    (mouseX / canvas.width) * 2 - 1,
    -(mouseY / canvas.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, target);
  return target; // x, z are the world-space position on the ground
}
```

---

## 5. Migration Order

Build in this order. Each phase produces a runnable checkpoint.

```
Phase A — Foundation (game loop, camera, empty ground)
  ↓
Phase B — Webbs entity (body, movement, input)
  ↓
Phase C — Spider leg locomotion with IK (the visual wow moment)
  ↓
Phase D — HomeBaseScene world (ground, walls, objects, workbench)
  ↓
Phase E — Enemies + combat (import weapon/combat systems)
  ↓
Phase F — HUD + UI overlays (HTML/CSS layer)
  ↓
Phase G — AntColonyScene + BossRollerScene
  ↓
Phase H — Fog of war, lighting, particles, polish
```

---

## 6. Phase A — Foundation

### 6.1 Three.js Setup

Replace the Phaser game config in `main.ts` with:

```typescript
import * as THREE from 'three';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 720);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x1a1a2e);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('game-container')!.appendChild(renderer.domElement);

// Isometric Camera
const FRUSTUM = 12;
const aspect = 1280 / 720;
const camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect, FRUSTUM * aspect,
  FRUSTUM, -FRUSTUM,
  0.1, 1000
);

// Classic Diablo isometric angle
// ~35° from horizontal, rotated 45° around Y
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);
camera.zoom = 1.5; // Adjust to taste — higher = closer
camera.updateProjectionMatrix();
```

### 6.2 Game Loop

Replace Phaser's internal loop with `requestAnimationFrame`:

```typescript
const clock = new THREE.Clock();

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const delta = clock.getDelta(); // seconds
  
  // Update game logic
  sceneManager.update(delta);
  inputManager.endFrame();
  
  // Render
  renderer.render(scene, camera);
}

gameLoop();
```

### 6.3 Coordinate System Mapping

**Phaser (2D):** X = right, Y = down. All positions in pixels.

**Three.js (3D isometric):** X = right, Y = up (height), Z = forward/back (depth into screen). Positions in world units.

Mapping:
```
Phaser X → Three.js X (horizontal)
Phaser Y → Three.js Z (depth / what was vertical in top-down)
Three.js Y = height (new axis — used for leg lift, projectile arcs, jump, etc.)
```

**Scale conversion:** The current game uses pixel coordinates (1280×720 canvas, worlds up to 7500×5000). In Three.js, work in world units where 1 unit ≈ 1 meter at spider scale. Convert:
```
SCALE_FACTOR = 0.01  // 100 Phaser pixels = 1 Three.js unit
threeX = phaserX * SCALE_FACTOR
threeZ = phaserY * SCALE_FACTOR
```

Alternatively, define world sizes in Three.js units from scratch and adjust constants accordingly. The exact scale doesn't matter as long as it's consistent.

### 6.4 Ground Plane

```typescript
const groundGeo = new THREE.PlaneGeometry(100, 100);
groundGeo.rotateX(-Math.PI / 2); // Lay flat on XZ plane
const groundMat = new THREE.MeshStandardMaterial({ 
  color: 0x2a1a0a, // Dark earth tone
  roughness: 0.9 
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);
```

### 6.5 Lighting

```typescript
// Ambient — low base light for the forest floor
const ambient = new THREE.AmbientLight(0x334455, 0.4);
scene.add(ambient);

// Directional — main light casting shadows (sun through canopy)
const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

// Point lights can be added per-zone for atmosphere
```

### 6.6 Cel-Shaded Look

For the cel-shaded art style, use `THREE.MeshToonMaterial` which applies stepped shading:

```typescript
// Create a gradient map texture for toon shading steps
const gradientMap = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]),
  3, 1, THREE.RGBAFormat
);
gradientMap.needsUpdate = true;

// Apply to materials
const toonMaterial = new THREE.MeshToonMaterial({
  color: 0x8844cc,
  gradientMap: gradientMap
});
```

Combine with `THREE.OutlineEffect` or custom shader for the bold outlines that define cel-shading.

**Checkpoint A:** An empty brown ground plane viewed from an isometric angle with proper lighting. The camera can be panned with arrow keys. This proves the 3D pipeline works.

---

## 7. Phase B — Player Entity (Webbs)

### 7.1 Body

Replace the `Phaser.GameObjects.Container` with a `THREE.Group`:

```typescript
class Webbs3D {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  legs: SpiderLeg[]; // See Phase C
  
  // Carry over ALL gameplay fields from current Webbs.ts:
  hp = 100; hpMax = 100;
  stamina = 100; maxStamina = 100;
  energy = 100; maxEnergy = 100;
  facingX = 0; facingZ = 1;
  winded = false;
  maxProtectionActive = false;
  staminaRegenMult = 1.0;
  weaponSystem: WeaponSystem; // Imported unchanged
  
  // Physics body (custom)
  collisionBody: CollisionBody; // radius 22 * SCALE_FACTOR
  
  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    
    // Spider body — slightly flattened sphere
    const bodyGeo = new THREE.SphereGeometry(0.3, 16, 12);
    bodyGeo.scale(1, 0.6, 1); // Flatten vertically
    this.bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshToonMaterial({
      color: 0x554488
    }));
    this.bodyMesh.castShadow = true;
    this.bodyMesh.position.y = 0.4; // Float above ground
    this.group.add(this.bodyMesh);
    
    scene.add(this.group);
  }
}
```

### 7.2 Movement

Translate the existing WASD movement. Current speed is 220 px/s.

```typescript
update(delta: number, input: InputManager) {
  let dx = 0, dz = 0;
  if (input.isDown('KeyW') || input.isDown('ArrowUp'))    dz = -1;
  if (input.isDown('KeyS') || input.isDown('ArrowDown'))  dz =  1;
  if (input.isDown('KeyA') || input.isDown('ArrowLeft'))  dx = -1;
  if (input.isDown('KeyD') || input.isDown('ArrowRight')) dx =  1;
  
  if (dx !== 0 || dz !== 0) {
    const len = Math.sqrt(dx * dx + dz * dz);
    dx /= len; dz /= len;
    this.facingX = dx; this.facingZ = dz;
    
    const speed = this.winded ? SPEED * WINDED_SPEED_MULT : SPEED;
    this.collisionBody.velocity.x = dx * speed * SCALE_FACTOR;
    this.collisionBody.velocity.z = dz * speed * SCALE_FACTOR;
  } else {
    this.collisionBody.velocity.x = 0;
    this.collisionBody.velocity.z = 0;
  }
  
  // Sync 3D position from physics
  this.group.position.x = this.collisionBody.x;
  this.group.position.z = this.collisionBody.z;
  
  // Rotate body to face movement direction
  if (dx !== 0 || dz !== 0) {
    const angle = Math.atan2(dx, dz);
    this.group.rotation.y = angle;
  }
}
```

### 7.3 Camera Follow

```typescript
// In game loop, after Webbs update:
const targetX = webbs.group.position.x;
const targetZ = webbs.group.position.z;
const offset = new THREE.Vector3(20, 20, 20); // Same as initial camera offset

camera.position.lerp(
  new THREE.Vector3(targetX + offset.x, offset.y, targetZ + offset.z),
  0.1 // Smooth follow — matches current 0.1 lerp
);
camera.lookAt(targetX, 0, targetZ);
```

**Checkpoint B:** A cel-shaded sphere moves around a ground plane with WASD, camera follows smoothly from isometric angle. No legs yet — that's next.

---

## 8. Phase C — Spider Leg Locomotion (Critical)

This is the single most important visual improvement in the entire migration. Replace the current "pinwheel" legs with procedurally animated IK legs using an alternating tetrapod gait.

### 8.1 How Real Spiders Walk

Spiders use an **alternating tetrapod gait** — 8 legs divided into two diagonal groups of 4:

```
        FRONT
   L1 -------- R1
    L2 ------ R2
    L3 ------ R3
   L4 -------- R4
        BACK

Group A: R1, L2, R3, L4  (diagonal cross pattern)
Group B: L1, R2, L3, R4  (other diagonal)
```

When moving, Group A plants while Group B swings forward, then they switch. The body is always supported by 4 legs in a stable X pattern.

### 8.2 Leg Structure

Each leg has 3 segments (coxa, femur, tibia) solved by a 2-bone IK chain:

```typescript
interface SpiderLeg {
  index: number;               // 0-7
  side: 'left' | 'right';
  group: 'A' | 'B';           // Gait group
  
  // Attachment point on body (local space)
  rootOffset: THREE.Vector3;
  
  // Anchor: where the foot WANTS to be (local space, projected to ground)
  anchorOffset: THREE.Vector3;
  
  // Current foot world position (where the foot IS)
  footPosition: THREE.Vector3;
  
  // Step state
  isStepping: boolean;
  stepProgress: number;        // 0 to 1
  stepStartPos: THREE.Vector3;
  stepTargetPos: THREE.Vector3;
  
  // Visual segments (Three.js objects)
  upperSegment: THREE.Mesh;    // Coxa-to-knee
  lowerSegment: THREE.Mesh;    // Knee-to-foot
  
  // Weapon attached at foot
  weaponMesh: THREE.Mesh | null;
}
```

### 8.3 Anchor Positions (8 legs)

Define where each leg naturally rests, relative to the body center. These values replace the current `LEG_LENGTH = 40` radial layout:

```typescript
const LEG_ANCHORS = [
  // index, side,  group, rootOffset (on body),        anchorOffset (foot resting pos)
  { i: 0, side: 'left',  group: 'B', root: [-0.25, 0.2,  0.3], anchor: [-0.9, 0,  0.7] },  // L1 front-left
  { i: 1, side: 'right', group: 'A', root: [ 0.25, 0.2,  0.3], anchor: [ 0.9, 0,  0.7] },  // R1 front-right
  { i: 2, side: 'left',  group: 'A', root: [-0.28, 0.15, 0.1], anchor: [-1.0, 0,  0.2] },  // L2
  { i: 3, side: 'right', group: 'B', root: [ 0.28, 0.15, 0.1], anchor: [ 1.0, 0,  0.2] },  // R2
  { i: 4, side: 'left',  group: 'B', root: [-0.28, 0.15,-0.1], anchor: [-1.0, 0, -0.2] },  // L3
  { i: 5, side: 'right', group: 'A', root: [ 0.28, 0.15,-0.1], anchor: [ 1.0, 0, -0.2] },  // R3
  { i: 6, side: 'left',  group: 'A', root: [-0.25, 0.2, -0.3], anchor: [-0.9, 0, -0.7] },  // L4 rear-left
  { i: 7, side: 'right', group: 'B', root: [ 0.25, 0.2, -0.3], anchor: [ 0.9, 0, -0.7] },  // R4 rear-right
];
```

### 8.4 Gait Manager

```typescript
type GaitPhase = 'IDLE' | 'GROUP_A_STEPPING' | 'GROUP_B_STEPPING';

class GaitManager {
  phase: GaitPhase = 'IDLE';
  stepDuration = 0.12; // seconds per step
  stepHeight = 0.15;   // world units vertical arc
  stepThreshold = 0.3; // distance before foot needs to move
  overshoot = 0.15;    // how far ahead of anchor to place new target

  update(delta: number, legs: SpiderLeg[], bodyPosition: THREE.Vector3, 
         bodyRotation: number, movementDir: THREE.Vector2) {
    
    // 1. Update anchor world positions
    for (const leg of legs) {
      const anchor = leg.anchorOffset.clone();
      // Rotate anchor by body rotation
      const cos = Math.cos(bodyRotation);
      const sin = Math.sin(bodyRotation);
      const wx = bodyPosition.x + anchor.x * cos - anchor.z * sin;
      const wz = bodyPosition.z + anchor.x * sin + anchor.z * cos;
      leg.anchorWorldPos = new THREE.Vector3(wx, 0, wz);
    }
    
    // 2. Check which legs want to step
    for (const leg of legs) {
      const dist = leg.footPosition.distanceTo(leg.anchorWorldPos);
      leg.wantsToStep = dist > this.stepThreshold;
    }
    
    // 3. Gait state machine
    const groupA = legs.filter(l => l.group === 'A');
    const groupB = legs.filter(l => l.group === 'B');
    
    if (this.phase === 'IDLE') {
      if (groupA.some(l => l.wantsToStep)) {
        this.startGroupStep(groupA, movementDir);
        this.phase = 'GROUP_A_STEPPING';
      } else if (groupB.some(l => l.wantsToStep)) {
        this.startGroupStep(groupB, movementDir);
        this.phase = 'GROUP_B_STEPPING';
      }
    }
    
    if (this.phase === 'GROUP_A_STEPPING') {
      this.updateStepping(groupA, delta);
      if (groupA.every(l => !l.isStepping)) this.phase = 'IDLE';
    }
    
    if (this.phase === 'GROUP_B_STEPPING') {
      this.updateStepping(groupB, delta);
      if (groupB.every(l => !l.isStepping)) this.phase = 'IDLE';
    }
  }
  
  startGroupStep(group: SpiderLeg[], moveDir: THREE.Vector2) {
    for (const leg of group) {
      leg.isStepping = true;
      leg.stepProgress = 0;
      leg.stepStartPos = leg.footPosition.clone();
      // Target = anchor + overshoot in movement direction
      leg.stepTargetPos = leg.anchorWorldPos.clone();
      leg.stepTargetPos.x += moveDir.x * this.overshoot;
      leg.stepTargetPos.z += moveDir.y * this.overshoot;
      // TODO: Raycast down to find actual ground height at target
      leg.stepTargetPos.y = 0; // Ground level
    }
  }
  
  updateStepping(group: SpiderLeg[], delta: number) {
    for (const leg of group) {
      if (!leg.isStepping) continue;
      leg.stepProgress += delta / this.stepDuration;
      if (leg.stepProgress >= 1) {
        leg.stepProgress = 1;
        leg.isStepping = false;
        leg.footPosition.copy(leg.stepTargetPos);
      } else {
        // Lerp horizontal + sin arc vertical
        leg.footPosition.lerpVectors(leg.stepStartPos, leg.stepTargetPos, leg.stepProgress);
        leg.footPosition.y = Math.sin(leg.stepProgress * Math.PI) * this.stepHeight;
      }
    }
  }
}
```

### 8.5 Two-Bone IK Solver

For each leg, solve the knee/joint position given root and foot:

```typescript
function solveTwoBoneIK(
  root: THREE.Vector3,      // Where leg attaches to body
  target: THREE.Vector3,    // Foot position
  upperLength: number,      // Length of upper leg segment
  lowerLength: number,      // Length of lower leg segment
  poleHint: THREE.Vector3   // Direction the "knee" should point (outward from body)
): THREE.Vector3 {          // Returns knee/joint position
  
  const rootToTarget = target.clone().sub(root);
  const dist = Math.min(rootToTarget.length(), upperLength + lowerLength - 0.001);
  
  // Law of cosines for knee angle
  const cosAngle = (upperLength * upperLength + dist * dist - lowerLength * lowerLength)
                   / (2 * upperLength * dist);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  
  // Direction from root to target
  const dir = rootToTarget.normalize();
  
  // Rotate dir by angle around the pole axis to find knee position
  const axis = new THREE.Vector3().crossVectors(dir, poleHint).normalize();
  const kneeDir = dir.clone().applyAxisAngle(axis, angle);
  
  return root.clone().add(kneeDir.multiplyScalar(upperLength));
}
```

### 8.6 Rendering Leg Segments

For each leg each frame, after IK solve:

```typescript
function renderLeg(leg: SpiderLeg, root: THREE.Vector3, knee: THREE.Vector3, foot: THREE.Vector3) {
  // Upper segment: cylinder from root to knee
  positionCylinder(leg.upperSegment, root, knee, 0.04); // radius 0.04
  
  // Lower segment: cylinder from knee to foot
  positionCylinder(leg.lowerSegment, knee, foot, 0.03);  // slightly thinner
  
  // Weapon mesh at foot position
  if (leg.weaponMesh) {
    leg.weaponMesh.position.copy(foot);
  }
}

function positionCylinder(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  mesh.position.copy(mid);
  mesh.scale.set(radius, length / 2, radius); // CylinderGeometry default height = 2
  mesh.lookAt(end); // Orient along the segment direction
  mesh.rotateX(Math.PI / 2); // Cylinder default is Y-up
}
```

### 8.7 Leg Tier Visuals

Current leg tiers (Wood → Metal) should change the leg material:

```typescript
const LEG_TIER_MATERIALS = {
  0: new THREE.MeshToonMaterial({ color: 0x8B6914 }), // Wood — brown
  1: new THREE.MeshToonMaterial({ color: 0x808080 }), // Stone — grey
  2: new THREE.MeshToonMaterial({ color: 0x505050 }), // Iron — dark grey
  3: new THREE.MeshToonMaterial({ color: 0xC0C0C0 }), // Metal — silver
};
```

**Checkpoint C:** The spider walks around with 8 legs that plant and lift in the alternating tetrapod pattern. Each leg has visible joints and weapon-colored tips. This is the moment the game goes from "prototype" to "wow."

---

## 9. Phase D — World and Environment

### 9.1 HomeBaseScene Rebuild

Current world: 2560 × 720 px, floor at Y=660.

New: 3D environment with ground mesh, wall geometry, and decorative objects.

```typescript
class HomeBaseWorld {
  create(scene: THREE.Scene) {
    // Ground — textured earth/dirt plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(25.6, 7.2).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0x5a3a1a })
    );
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Walls — extruded rectangles along edges
    // Spider-scale objects: giant leaves, twig structures, pebble boulders
    // Workbench: 3D model (table + tools)
    // Birthday area: card, gift box as 3D objects
    // Web decorations: THREE.Line with catenary curves
    // Exit portal: glowing frame with particle effect
  }
}
```

### 9.2 AntColonyScene Rebuild

Current: 7500 × 5000 px, 5 corridor levels, wall blocks, 14 dead-end rooms.

The corridor-based maze translates well to 3D. Walls become extruded blocks with height. The underground setting benefits enormously from 3D lighting — torches casting dynamic shadows down corridors.

Key changes:
- Wall blocks become `THREE.BoxGeometry` meshes with earthen textures
- Corridors have a floor mesh and ceiling mesh (the player sees through the ceiling via the isometric camera, but walls occlude properly)
- Fog of war becomes a shader effect or semi-transparent overlay mesh that reveals around the player (see Phase H)
- Lantern beacons become `THREE.PointLight` objects that actually illuminate the tunnels

### 9.3 Spider-Scale Environmental Objects

This is where 3D pays off. Objects that were flat colored rectangles in 2D become:
- Pebbles → rounded `THREE.IcosahedronGeometry` boulders
- Twigs → `THREE.CylinderGeometry` logs
- Leaves → flat `THREE.PlaneGeometry` with leaf-shaped alpha texture
- Water droplets → reflective spheres
- Silk webs → `THREE.Line` catenary curves between objects
- Bottle caps, acorn shells → found-object geometry

**Checkpoint D:** HomeBaseScene is fully playable in 3D. Walk around, interact with workbench, pick up items, read birthday card. The space feels like a place.

---

## 10. Phase E — Enemies and Combat

### 10.1 Enemy Base Class

Mirror the current `Enemy` class but with Three.js rendering:

```typescript
class Enemy3D {
  group: THREE.Group;
  collisionBody: CollisionBody;
  config: EnemyConfig; // Same config interface — reuse directly
  
  // All combat logic from current Enemy.ts carries over:
  // takeDamage(), applyKnockback(), addStuckThistle(), loot rolling
}
```

### 10.2 CentipedeAmbusher in 3D

The state machine (HIDING → BURSTING → CHASING with TRACKING/WINDUP/LUNGING/RECOVERING) is pure logic — import directly. Visual rebuild:
- Body: segmented cylinders tapering from head
- Mandibles: small cone meshes that animate open/close
- Burst animation: scale tween + particle dirt explosion (Three.js particle system)
- Eyes: small emissive red spheres

### 10.3 BeetleTank in 3D

Same AI logic (horizontal patrol, charge at 290px/s). Visual rebuild:
- Shell: flattened ellipsoid with dark green toon material
- Eyes: red emissive dots
- Legs: 6 small stubs (can use simplified IK or just animated positions)
- Armor spike: cone on top of shell
- Charge animation: lean forward + dust trail particles

### 10.4 Weapon Hit Detection

**Critical:** All combat math in `WeaponUseSystem.ts` is 2D geometry (radius checks, cone sweeps using `Math.atan2`). This translates directly — just operate on the XZ plane:

```typescript
// Current Phaser (2D):
const dx = enemy.x - webbs.x;
const dy = enemy.y - webbs.y;
const dist = Math.sqrt(dx*dx + dy*dy);

// Three.js (3D, but combat on XZ plane):
const dx = enemy.group.position.x - webbs.group.position.x;
const dz = enemy.group.position.z - webbs.group.position.z;
const dist = Math.sqrt(dx*dx + dz*dz);
```

Weapon swing VFX: replace Phaser arc graphics with Three.js `THREE.RingGeometry` segments or custom shader trails.

**Checkpoint E:** Walk into the Ant Colony, encounter enemies, fight them with weapons. All combat systems operational.

---

## 11. Phase F — HUD and UI Overlays

### 11.1 HTML/CSS Overlay (recommended approach)

Render the HUD as HTML elements positioned over the Three.js canvas. This is cleaner and more performant than rendering UI in 3D:

```html
<div id="game-container" style="position: relative; width: 1280px; height: 720px;">
  <canvas id="game-canvas"></canvas>
  <div id="hud-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
    <div id="zone-label">HOME BASE</div>
    <div id="hp-bar">HP <div class="bar red"></div> 100/100</div>
    <div id="stamina-bar">STAM <div class="bar yellow"></div></div>
    <div id="energy-bar">ENRG <div class="bar blue"></div></div>
    <div id="weapon-ring"><!-- SVG circle with 8 slots --></div>
    <div id="controls-panel"><!-- Key bindings --></div>
  </div>
  <div id="menu-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
    <!-- CraftingMenu, EquipScreen, TextDisplay rendered here -->
  </div>
</div>
```

### 11.2 Weapon Ring

The HUD weapon ring (8 slots in a circle) is currently drawn with Phaser Graphics. Rebuild as an SVG element in the HTML overlay — same circle geometry at `SLOT_RING_R=55`, same slot circle radius, same weapon icon colors from `WEAPON_COLORS`.

### 11.3 Menu Overlays

CraftingMenu, EquipScreen, TextDisplayScene, PickupCelebration — these are UI-only scenes. Rebuild as HTML/CSS panels that show/hide. The game loop pauses the active scene when a menu is visible (same pattern as current `scene.pause()` / `scene.resume()`).

**Checkpoint F:** Full HUD visible during gameplay. Can open CraftingMenu at workbench, open EquipScreen with I, see weapon ring update when equipping. All overlay text (cutscenes, tutorials) functional.

---

## 12. Phase G — Boss Fight

### 12.1 BossRollerScene

Current: 1280 × 720 single-screen arena, no scrolling.

New: A contained 3D arena. The isometric camera is fixed (no follow, or minimal follow) showing the full space.

**Phase 1 — The Nose:**
- BossNose is a 3D snout model protruding from the ceiling
- Rocks are small `THREE.SphereGeometry` or `THREE.DodecahedronGeometry` that fall with physics
- Suction effect: particle system pulling toward nose + player force
- Rock reflection: same melee-swing-near-rock check, but rock now ricochets in 3D space toward the nose
- Web anchor: player shoots web at wall — strand visible as `THREE.Line`

**Phase 2 — The Roller:**
- RollerBoss: large body mesh (oblong sphere with snout), toon-shaded
- Body slam: charge animation with motion blur trail
- Ground pound: shockwave ring expands on the ground (`THREE.RingGeometry` with animated scale)
- Tail swipe: arc mesh that sweeps
- Death: topple animation (rotation) then fade

### 12.2 Boss HP Bars

Render as HTML overlay elements (same as HUD approach). Position above the 3D arena.

**Checkpoint G:** Full boss fight playable in 3D. Both phases, all attacks, victory/death routing.

---

## 13. Phase H — Effects, Fog, and Polish

### 13.1 Fog of War (AntColonyScene)

Replace `RenderTexture` erase approach with a shader-based fog:

**Approach:** A full-world black plane at a height just below the camera. A custom shader makes it transparent in a radius around the player, with permanently revealed areas tracked in a texture.

```typescript
// Fog plane covering the ant colony
const fogGeo = new THREE.PlaneGeometry(75, 50).rotateX(-Math.PI / 2);
const fogMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: {
    playerPos: { value: new THREE.Vector2(0, 0) },
    revealRadius: { value: 3.0 }, // 300px * SCALE_FACTOR
    revealTexture: { value: revealRenderTarget.texture },
  },
  // Vertex/fragment shaders that combine:
  // - Real-time circle reveal around player
  // - Permanent reveal stored in revealTexture
});
const fogPlane = new THREE.Mesh(fogGeo, fogMat);
fogPlane.position.y = 2; // Above all world geometry
scene.add(fogPlane);
```

The permanent reveal texture is updated each frame by rendering a white circle at the player's position into a `THREE.WebGLRenderTarget`.

### 13.2 Lighting per Zone

- **HomeBaseScene:** Warm ambient (morning den), soft directional
- **AntColonyScene:** Very dark ambient, point lights at lantern positions (green tint), player carries a faint light
- **BossRollerScene:** Dramatic single spotlight from above, red accent lights

### 13.3 Particle Effects

Three.js doesn't have a built-in particle system as rich as Phaser's, but several approaches work:
- **three-nebula** (npm package) for complex effects
- **Custom point-based particles** using `THREE.Points` with `BufferGeometry`
- For simple effects (weapon sparks, dirt burst, flame): instanced small meshes

### 13.4 Post-Processing

Add post-processing for the cel-shaded look:
```typescript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

// Outline pass for cel-shaded edge detection
// Subtle bloom for emissive objects (pickups, portals, lanterns)
```

**Checkpoint H:** Full game playable with all visual effects. Fog of war reveals tunnels, lighting creates atmosphere, particles sell combat impacts.

---

## 14. Spider Locomotion Algorithm

See the companion document **`Spider_Locomotion_Reference_For_Claude_Code.md`** for:
- Full biological reference (alternating tetrapod gait)
- Complete step-by-step algorithm
- FABRIK IK solver details
- Common mistakes and fixes table
- Links to reference implementations

The algorithm in Phase C above is the implementation-ready version of that reference, adapted to Three.js and this game's specific architecture.

---

## 15. Key Risks and Mitigations

### Risk 1: Performance in AntColonyScene
The Ant Colony has 7500×5000 world with 23 enemies, 50+ wall blocks, 14 rooms, fog of war. In Phaser, this required aggressive optimization (off-screen culling, fog scale, merged graphics).

**Mitigation:** Three.js has built-in frustum culling (objects outside camera view aren't rendered). `THREE.InstancedMesh` for repeated geometry (wall blocks). Level-of-detail for distant objects. The custom physics world inherits the current off-screen disable pattern (`ACTIVE_RADIUS_SQ = 900²`).

### Risk 2: Mouse aiming in isometric view
In 2D, mouse position maps directly to world position. In isometric 3D, the mouse must be raycasted through the camera to the ground plane. If this is imprecise, weapon aiming will feel wrong.

**Mitigation:** Implement `mouseToWorld()` raycaster early (Phase A). Test with a visible ground-plane cursor that follows the mouse. Aim direction for weapons should use the ground-plane intersection, not screen-space direction.

### Risk 3: WebLauncher strand rendering
The web strand (line from Webbs to anchor point) is a core visual element. In Phaser it's a simple line. In isometric 3D it needs to arc naturally.

**Mitigation:** Use `THREE.CatmullRomCurve3` with a midpoint slightly above the straight line to create a natural sag. Update the curve each frame as Webbs moves.

### Risk 4: Combat feel translation
The current game's combat feel (camera shake, hit particles, knockback) is tuned for 2D. In 3D, the same numeric values may feel different.

**Mitigation:** Camera shake translates to small random offsets on the camera position. Hit particles become 3D bursts. Knockback velocities may need retuning once the scale factor is established. Playtest early and often during Phase E.

### Risk 5: Menu/overlay system complexity
The current overlay system (pause active scene, launch overlay, resume on close) is deeply integrated with Phaser's scene lifecycle.

**Mitigation:** Build the custom SceneManager in Phase A with the same pause/resume/launch semantics. The HTML overlay approach for menus actually simplifies this — the Three.js scene just pauses its update loop, and the HTML menu handles its own input.

---

## 16. Reference Links

### Three.js
- Documentation: https://threejs.org/docs/
- Examples: https://threejs.org/examples/
- MeshToonMaterial: https://threejs.org/docs/#api/en/materials/MeshToonMaterial
- OrthographicCamera: https://threejs.org/docs/#api/en/cameras/OrthographicCamera
- Raycaster: https://threejs.org/docs/#api/en/core/Raycaster

### Spider Locomotion
- PhilS94 Unity IK Spider (algorithm reference): https://github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider
- jerejoensuu Procedural Spider: https://github.com/jerejoensuu/procedural-animation
- Alan Zucconi IK Tutorial Series: https://www.alanzucconi.com/2017/04/17/procedural-animations/
- Procedural Spider Animation Step by Step (video): https://www.youtube.com/watch?v=igtK6pSwd1o

### Cel-Shading in Three.js
- Toon shader example: https://threejs.org/examples/#webgl_materials_toon
- Outline effect: https://threejs.org/examples/#webgl_postprocessing_outline

### Packages
```
npm install three @types/three
npm install three-nebula          # Optional: particle system
npm install postprocessing        # Optional: post-processing effects
```

---

## Appendix: File Migration Map

| Current File | Migration Action |
|---|---|
| `src/main.ts` | **Rewrite** — Three.js setup, game loop, SceneManager |
| `src/scenes/BootScene.ts` | **Simplify** — just call SaveSystem.loadIntoRegistry() |
| `src/scenes/PreloadScene.ts` | **Simplify** — loading bar as HTML |
| `src/scenes/MainMenuScene.ts` | **Rebuild** — HTML title screen + same cutscene gate logic |
| `src/scenes/HomeBaseScene.ts` | **Rebuild** — 3D world, keep all game logic |
| `src/scenes/AntColonyScene.ts` | **Rebuild** — 3D maze, keep all game logic and layout constants |
| `src/scenes/BossRollerScene.ts` | **Rebuild** — 3D arena, keep all boss logic |
| `src/scenes/GameScene.ts` | **Delete** — replace with proper death/respawn flow |
| `src/scenes/TextDisplayScene.ts` | **HTML overlay** — same page/advance/skip logic |
| `src/scenes/ZoneTransitionBeat.ts` | **HTML overlay** — same label/subtitle/timing |
| `src/scenes/PickupCelebration.ts` | **HTML overlay** — same data shape |
| `src/ui/HUD.ts` | **HTML overlay** — same layout, same registry reads |
| `src/ui/EquipScreen.ts` | **HTML overlay** — same slot/inventory logic |
| `src/ui/CraftingMenu.ts` | **HTML overlay** — same recipe logic |
| `src/ui/PickupNotification.ts` | **HTML overlay** — same toast pattern |
| `src/ui/WeaponIcon.ts` | **Rebuild** — SVG or Canvas2D icons instead of Phaser Graphics |
| `src/entities/Webbs.ts` | **Rebuild** — Three.js Group + IK legs. Keep all gameplay fields. |
| `src/entities/Enemy.ts` | **Rebuild** — Three.js Group base. Keep all combat logic. |
| `src/entities/CentipedeAmbusher.ts` | **Rebuild** — 3D model. Keep AI state machine. |
| `src/entities/BeetleTank.ts` | **Rebuild** — 3D model. Keep patrol/charge AI. |
| `src/entities/RollerBoss.ts` | **Rebuild** — 3D model. Keep attack states. |
| `src/entities/BossNose.ts` | **Rebuild** — 3D model. Keep HP/damage logic. |
| `src/entities/Workbench.ts` | **Rebuild** — 3D model. Keep proximity/interact logic. |
| `src/entities/Pickup.ts` | **Rebuild** — 3D mesh. Keep collect logic. |
| `src/entities/WeaponPickup.ts` | **Rebuild** — 3D mesh. Keep collect logic. |
| `src/entities/HpModule.ts` | **Rebuild** — 3D mesh. Keep heal logic. |
| `src/entities/Chest.ts` | **Rebuild** — 3D model. Keep mimic/loot logic. |
| `src/systems/WeaponSystem.ts` | **Keep as-is** |
| `src/systems/CraftingSystem.ts` | **Keep as-is** |
| `src/systems/ConsumableSystem.ts` | **Minor edits** — remove Phaser time refs |
| `src/systems/SaveSystem.ts` | **Keep as-is** |
| `src/systems/ZoneTransitionSystem.ts` | **Minor edits** — replace camera fade |
| `src/systems/WeaponUseSystem.ts` | **Moderate edits** — keep combat math, rebuild VFX |
| `src/systems/WebLauncherSystem.ts` | **Moderate edits** — keep state machine, rebuild visuals |
| `src/config/WeaponData.ts` | **Keep as-is** |
| `src/config/ChestLootTable.ts` | **Keep as-is** |
| `src/config/Controls.ts` | **Minor edits** — map to KeyboardEvent.code |

---

*This document plus `GAME_REFERENCE.md` plus `Spider_Locomotion_Reference_For_Claude_Code.md` together provide everything needed to execute the migration. Start at Phase A and build checkpoint by checkpoint.*
