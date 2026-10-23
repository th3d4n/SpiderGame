# Spider Locomotion Reference — For Claude Code Implementation
## Procedural Animation Using Inverse Kinematics + Alternating Tetrapod Gait

This document provides everything needed to implement realistic spider movement in a game. The current implementation has the spider's legs rotating like a pinwheel. This document describes the correct approach: procedural animation where each leg independently finds footing on the ground and moves in a biologically accurate gait pattern.

---

## PART 1 — HOW REAL SPIDERS WALK

### The Alternating Tetrapod Gait

Real spiders do NOT move all their legs at once or spin them in a cycle. They use an **alternating tetrapod gait**, meaning:

- The 8 legs are divided into **two groups of 4** (two "tetrapods")
- The groups alternate: when Group A's legs are planted on the ground, Group B's legs are swinging forward to their next position, and vice versa
- The groups are arranged in a **diagonal criss-cross pattern** so the spider's center of mass is always supported

### Leg Numbering and Groups

Looking down at the spider from above:

```
        FRONT
   L1 -------- R1
    L2 ------ R2
    L3 ------ R3
   L4 -------- R4
        BACK
```

**Group A (move together):** R1, L2, R3, L4
**Group B (move together):** L1, R2, L3, R4

Notice the diagonal pattern — each group forms an X shape across the body. This keeps the spider balanced at all times because legs on opposite corners are always grounded.

### The Walk Cycle

1. Group A legs are planted on the ground, pushing the body forward
2. Group B legs lift, swing forward to new positions, and plant down
3. Group B legs are now planted, pushing the body forward
4. Group A legs lift, swing forward to new positions, and plant down
5. Repeat

Each leg's swing follows an arc — it lifts up, moves forward, then sets down. It does NOT drag along the ground or rotate in a circle.

### Speed Variation

- **Slow walk:** The groups alternate with clear separation — you can see each group plant before the other lifts
- **Fast run:** The alternation becomes more rapid, with slight overlap between groups. Stride length increases and the body oscillates vertically slightly
- **Duty factor:** At walking speed, each leg is on the ground ~68% of the time. At running speed, this drops closer to 50%

---

## PART 2 — THE PROCEDURAL ANIMATION ALGORITHM

Do NOT use pre-baked animations or rotation-based movement. Use **procedural animation with inverse kinematics (IK)**. Here is the algorithm:

### Core Concepts

1. **Each leg has a "target point" on the ground** — this is where the foot wants to be
2. **Each leg has an "anchor point" in the spider's local space** — this is the ideal resting position relative to the body (think of it as where the leg "wants" to be when standing still)
3. **Inverse Kinematics (IK)** solves the leg joint angles so the foot reaches the target point
4. **A step manager** decides WHEN each leg is allowed to move to a new target

### Step-by-Step Algorithm

#### Step 1: Define Leg Structure

Each leg is a chain of 2-3 segments (bones/joints):
- **Coxa** (hip joint, attached to body)
- **Femur** (upper leg segment)
- **Tibia** (lower leg segment, foot at the tip)

Each segment has a length. The IK solver positions the joints so the tip (foot) reaches the target point.

#### Step 2: Define Anchor Points

For each of the 8 legs, define a default "anchor" position in the spider's local coordinate space. These are offsets from the body center where legs naturally rest:

```
Example anchor offsets (x, z relative to body center):
L1: (-1.2,  1.0)    R1: (1.2,  1.0)
L2: (-1.4,  0.3)    R2: (1.4,  0.3)
L3: (-1.4, -0.3)    R3: (1.4, -0.3)
L4: (-1.2, -1.0)    R4: (1.2, -1.0)
```

These anchors move with the spider body. As the spider moves forward, the anchors shift forward in world space.

#### Step 3: Determine When a Leg Needs to Step

For each leg, continuously measure the distance between the leg's **current foot position** (where it last planted) and its **anchor position** (where it should ideally be).

```
stepDistance = distance(currentFootPosition, anchorWorldPosition)
if stepDistance > stepThreshold:
    leg.wantsToStep = true
```

A leg "wants to step" when it has been left too far behind the moving body.

#### Step 4: The Step Manager — Enforce Alternating Tetrapod Gait

This is the critical part that prevents the pinwheel problem.

```
groupA = [R1, L2, R3, L4]  // diagonal group
groupB = [L1, R2, L3, R4]  // other diagonal group

Rule: Only ONE group can be stepping at a time.
Rule: A group steps only if at least one leg in that group wants to step.
Rule: When a group steps, ALL legs in that group move simultaneously.
Rule: The other group must remain planted until the stepping group finishes.
```

Implementation approach:
```
enum GaitPhase { GROUP_A_STEPPING, GROUP_B_STEPPING, IDLE }

update():
    if currentPhase == IDLE:
        if anyLegInGroupWantsToStep(groupA):
            currentPhase = GROUP_A_STEPPING
            startStepForAllLegs(groupA)
        elif anyLegInGroupWantsToStep(groupB):
            currentPhase = GROUP_B_STEPPING
            startStepForAllLegs(groupB)

    if currentPhase == GROUP_A_STEPPING:
        if allLegsFinishedStepping(groupA):
            currentPhase = IDLE

    if currentPhase == GROUP_B_STEPPING:
        if allLegsFinishedStepping(groupB):
            currentPhase = IDLE
```

#### Step 5: Calculate New Step Target

When a leg steps, calculate WHERE it should step to:

```
newTarget = anchorWorldPosition + (movementDirection * overshootFactor)
```

The overshoot factor places the foot slightly AHEAD of the anchor in the movement direction, so by the time the step finishes, the foot is in a good position.

Then **raycast downward** from this target position to find the actual ground surface:

```
ray = Ray(origin: newTarget + up * rayHeight, direction: down)
hit = raycast(ray)
if hit:
    newTarget = hit.point
```

This makes the legs conform to terrain — stepping on rocks, slopes, edges, etc.

#### Step 6: Animate the Step (Lerp with Arc)

When a leg moves from its old position to its new target, do NOT teleport it. Animate over a short duration (0.1–0.2 seconds) with a vertical arc:

```
stepProgress = elapsed / stepDuration  // 0 to 1

horizontalPosition = lerp(oldFootPos, newFootPos, stepProgress)
verticalOffset = sin(stepProgress * PI) * stepHeight

footPosition = horizontalPosition + (up * verticalOffset)
```

This creates a natural lifting arc — the foot rises, moves forward, and sets back down.

#### Step 7: Solve IK for Each Leg

With the foot position known (either planted or mid-step), solve IK to position the knee/elbow joint:

**Two-Bone IK (simplest, works well for spider legs):**

Given:
- `root` = where the leg connects to the body
- `target` = foot position
- `upperLength` = length of femur segment
- `lowerLength` = length of tibia segment

```
distance = length(target - root)
distance = clamp(distance, abs(upperLength - lowerLength), upperLength + lowerLength)

// Law of cosines to find knee angle
cosAngle = (upperLength² + lowerLength² - distance²) / (2 * upperLength * lowerLength)
kneeAngle = acos(clamp(cosAngle, -1, 1))

// Position the knee using the angle
direction = normalize(target - root)
perpendicular = cross(direction, legNormal)  // legNormal points outward from body
kneePosition = root + rotateAroundAxis(direction * upperLength, perpendicular, kneeAngle)
```

For a more robust solver, use FABRIK (Forward And Backward Reaching Inverse Kinematics) — it's iterative and handles chains of any length.

#### Step 8: Adjust Body Height and Tilt

The spider's body should float at a consistent height above the average foot position:

```
averageFootHeight = average(allFootPositions.y)
targetBodyHeight = averageFootHeight + bodyOffset

// Smoothly adjust body height
body.y = lerp(body.y, targetBodyHeight, deltaTime * smoothSpeed)
```

For body tilt, calculate the average surface normal from all planted feet and tilt the body to match:

```
averageNormal = average(groundNormalsAtEachFoot)
body.rotation = smoothRotateToward(averageNormal)
```

This makes the spider's body lean when walking on slopes.

---

## PART 3 — BODY BOB AND SECONDARY MOTION

### Walking Bob

Real spiders' bodies oscillate slightly up and down during the gait cycle. Add a subtle vertical bob tied to the gait phase:

```
bobOffset = sin(gaitCycleProgress * 2 * PI) * bobAmplitude
body.y += bobOffset
```

Keep `bobAmplitude` small (0.02–0.05 units relative to body size).

### Leg Anticipation

When the spider is about to move, the legs on the leading side can "reach" slightly forward before the body moves. This sells the feeling of intent.

---

## PART 4 — REFERENCE IMPLEMENTATIONS

### Best Open-Source Repositories

**1. PhilS94 — Unity Procedural IK Wall-Walking Spider (C# / Unity)**
https://github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider

- The gold standard for procedural spider animation
- Implements both queue-based stepping AND alternating tetrapod gait
- Includes wall-walking, ceiling-walking, corner navigation
- Smart target calculation with raycasting
- Body height/tilt adjustment
- 270+ stars, well-documented
- NOTE: Now also available as a paid Unity Asset Store package with improvements, but the GitHub repo is still public for learning

**Key architecture from this repo:**
- A single `SpiderController` manages body movement
- Each leg has an `IKChain` that solves joint positions
- A `StepManager` class controls when legs are allowed to step
- The alternating tetrapod gait separates legs into two groups and uses time-windowed stepping

**2. jerejoensuu — Procedural Animation Spider (C# / Unity)**
https://github.com/jerejoensuu/procedural-animation

- Simpler implementation, good for learning
- Uses Daniel Erdmann's Fast IK solver
- Legs are modular — work on any body and in any number
- Each leg has a configurable "stepping area"
- 3 degrees of freedom: forward/backward, sideways, turning

**3. Ruadhan2301 — Spiderbot Procedural Animation Rig (C# / Unity)**
https://github.com/Ruadhan2301/Spiderbot-Procedural-Animation-Rig

- General-case implementation for spider-tank walkers
- Configurable gait patterns including alternating tetrapod
- Gait pattern is defined as a string: "03,12" for paired opposing legs
- Good reference for separating the gait pattern from the animation system

### Video Tutorials

**Full Body IK: Procedural Spider Animation — Step by Step (Unreal Engine)**
https://www.youtube.com/watch?v=igtK6pSwd1o
- March 2025, detailed walkthrough
- Covers: IK rig setup, leg manager creation, height curves, gait synchronization

**Procedural Animation Spider Using Inverse Kinematics (Unity)**
https://www.youtube.com/watch?v=dM4zuivzYQA
- Demonstrates raycasting + IK leg placement
- Shows the final result of procedural stepping on uneven terrain

### Tutorial Series

**Alan Zucconi — Introduction to Procedural Animations**
https://www.alanzucconi.com/2017/04/17/procedural-animations/
- 7-part series covering forward kinematics, inverse kinematics, gradient descent
- Part 7 is specifically about spider legs
- Excellent math explanations with Unity examples

---

## PART 5 — IMPLEMENTATION CHECKLIST

Use this checklist when building the spider movement system:

### Foundation
- [ ] Spider body exists as a game object/entity with position and rotation
- [ ] 8 leg root positions defined relative to the body (where each leg connects)
- [ ] 8 anchor positions defined relative to the body (ideal resting foot positions)
- [ ] Each leg has 2-3 segment lengths defined

### IK Solver
- [ ] Two-bone IK solver implemented (or FABRIK for 3+ bones)
- [ ] Given a root position and target position, solver returns joint positions
- [ ] Solver respects segment lengths (no stretching)
- [ ] Solver handles edge cases (target too far = full extension, target too close = folded)

### Ground Detection
- [ ] Raycast downward from each anchor position finds ground height
- [ ] Ground normal is stored for body tilt calculation
- [ ] Raycasts update each frame (or on a timer for performance)

### Step System
- [ ] Each leg tracks its current planted foot position
- [ ] Each leg calculates distance from current position to anchor position
- [ ] Step threshold defined — when distance exceeds threshold, leg wants to step
- [ ] New step target = anchor position + movement overshoot, raycast to ground
- [ ] Step animation: lerp with sinusoidal vertical arc over 0.1–0.2 seconds

### Gait Manager (CRITICAL — this prevents the pinwheel)
- [ ] Legs divided into Group A (R1, L2, R3, L4) and Group B (L1, R2, L3, R4)
- [ ] Only one group can step at a time
- [ ] When a group steps, all 4 legs in that group move simultaneously
- [ ] The other group remains planted until the stepping group finishes
- [ ] State machine: IDLE → GROUP_A_STEPPING → IDLE → GROUP_B_STEPPING → IDLE

### Body Adjustment
- [ ] Body height = average foot height + offset (smoothly interpolated)
- [ ] Body tilt = derived from average ground normal under feet (smoothly interpolated)
- [ ] Optional: subtle vertical bob tied to gait cycle

### Polish
- [ ] Step speed scales with movement speed
- [ ] Step height scales with movement speed (faster = lower, snappier steps)
- [ ] Idle animation: subtle body breathing/pulsing, occasional small leg adjustments
- [ ] Turning: legs on the outside of the turn take wider steps

---

## PART 6 — COMMON MISTAKES AND FIXES

| Mistake | What It Looks Like | Fix |
|---|---|---|
| All legs move at once | Sliding/skating | Enforce alternating tetrapod gait groups |
| Legs rotate around body | Pinwheel / windmill | Use IK targets on the ground, not rotation-based animation |
| Legs drag on ground | Dead/limp legs | Add vertical arc to step animation (sin curve) |
| Legs penetrate ground | Clipping through terrain | Raycast to find actual ground position for each foot |
| Body floats at fixed height | Doesn't respond to terrain | Derive body height from average foot positions |
| All legs step same direction | Unnatural uniform movement | Each leg calculates its own target from its own anchor position |
| Legs skip/teleport | Jarring movement | Lerp foot position over time instead of instant placement |
| Spider slides when stopped | Feet don't stick | Only move foot targets when the body is actually moving |
| Legs cross over each other | Tangled mess | Ensure anchor positions are properly spaced and step targets use raycasts |

---

## PART 7 — ADAPTATION NOTES FOR THIS GAME

### Webbs Is a Spider with Robotic Legs

The standard spider gait applies, but with modifications:

1. **Robotic legs have visible joints** — the IK segments can be rendered as mechanical parts (pistons, joints, armor plates) rather than organic spider legs
2. **Weapon attachments** — each leg tip holds a weapon. The weapon should inherit the foot's position and rotation but may need an offset so it doesn't clip the ground
3. **Upgrade tiers change visual weight** — Wood legs could have slightly slower, lighter steps. Metal legs could have heavier, more deliberate steps with optional screen shake or dust particles on impact
4. **Eight weapons visible** — from the top-down camera, all 8 legs splaying outward with different weapons attached is the key visual identity. The alternating tetrapod gait will make the weapons visually "dance" as the spider moves, which looks much better than a pinwheel

### Camera Consideration (Top-Down / Isometric)

From a top-down view, the leg movement is especially visible. The alternating tetrapod gait creates a satisfying visual rhythm — you can clearly see the diagonal groups alternating. This is one of the main reasons the gait must be correct; in a side-scrolling game you might get away with simpler animation, but top-down exposes every leg.

---

*Feed this entire document to Claude Code as context when working on the spider movement system. The algorithm in Part 2 and the checklist in Part 5 are the primary implementation guides. The repositories in Part 4 provide working code references.*
