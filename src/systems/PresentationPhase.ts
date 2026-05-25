import type { Webbs3D } from '../entities/Webbs3D'
import type { ParticleBurstSystem3D } from './ParticleBurstSystem3D'
import { WeaponType } from './WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

// Round 6 Issue 1 — three-phase pickup presentation:
//   1. webbsPose      — Webbs lifts the item, 2.5s, NO HTML overlay
//   2. discoveryCard  — HTML card with item icon + name + desc (player-dismissed)
//   3. tutorialCard   — TextDisplay3D tutorial pages (player-dismissed)
// main.ts owns the UI components; this class drives transitions via hooks.

type Phase = 'idle' | 'webbsPose' | 'discoveryCard' | 'tutorialCard' | 'done'

const WEBBS_POSE_DURATION_MS = 2500

export class PresentationPhase {
  private phase: Phase = 'idle'
  private phaseStartMs = 0
  pendingWeapon: WeaponType | null = null

  onShowDiscoveryCard: ((wt: WeaponType) => void) | null = null
  onShowTutorialCard:  ((wt: WeaponType) => void) | null = null
  onComplete:          (() => void) | null = null

  start(weapon: WeaponType, webbs: Webbs3D, particles: ParticleBurstSystem3D): void {
    this.pendingWeapon = weapon
    this.phase         = 'webbsPose'
    this.phaseStartMs  = performance.now()

    webbs.startCelebrationPose()

    const burstPos = webbs.group.position.clone()
    burstPos.y = 0.6
    particles.burst(burstPos, WEAPON_COLORS[weapon], 24, 4.5, 0.08)
  }

  // Drive Phase 1 → Phase 2 transition.  Called every frame from the game loop.
  update(webbs: Webbs3D): void {
    if (this.phase !== 'webbsPose') return
    const elapsed = performance.now() - this.phaseStartMs
    if (elapsed >= WEBBS_POSE_DURATION_MS) {
      webbs.endCelebrationPose()
      this.phase = 'discoveryCard'
      this.onShowDiscoveryCard?.(this.pendingWeapon!)
    }
  }

  onDiscoveryCardClosed(): void {
    if (this.phase !== 'discoveryCard') return
    this.phase = 'tutorialCard'
    this.onShowTutorialCard?.(this.pendingWeapon!)
  }

  onTutorialCardClosed(): void {
    if (this.phase !== 'tutorialCard') return
    this.phase = 'done'
    this.onComplete?.()
    this.pendingWeapon = null
    // Reset for the next pickup
    this.phase = 'idle'
  }

  isActive(): boolean {
    return this.phase !== 'idle' && this.phase !== 'done'
  }

  isShowingWebbsPose(): boolean {
    return this.phase === 'webbsPose'
  }
}
