import type { Webbs3D } from '../entities/Webbs3D'
import type { ParticleBurstSystem3D } from './ParticleBurstSystem3D'
import { WeaponType } from './WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'

// Round 7 Issue 1 — pickup presentation timeline:
//   T=0.0s : pause + hide HTML overlay + Webbs starts rotating toward camera (0.3s)
//   T=0.3s : rotation done, legs start lifting (0.4s)
//   T=0.7s : particle burst BEHIND Webbs + secondary burst at item position
//   T=2.5s : pose ends, Webbs settles back (200ms beat)
//   T=2.7s : discovery card fades in (player dismisses with Space/M)
//   ...    : tutorial card (player dismisses)
//   done   : game unpauses

type Phase = 'idle' | 'webbsPose' | 'discoveryCard' | 'tutorialCard' | 'done'

const POSE_DURATION_MS    = 2500
const BURST_DELAY_MS      = 700
const SETTLE_BEAT_MS      = 200

export class PresentationPhase {
  private phase: Phase = 'idle'
  private phaseStartMs = 0
  private burstFired   = false

  onShowDiscoveryCard: ((wt: WeaponType) => void) | null = null
  onShowTutorialCard:  ((wt: WeaponType) => void) | null = null
  onComplete:          (() => void) | null = null
  // Hook for hiding the HTML menu overlay so the player sees pure 3D during Phase 1
  hideOverlay:         (() => void) | null = null

  pendingWeapon: WeaponType | null = null

  start(weapon: WeaponType, webbs: Webbs3D, _particles: ParticleBurstSystem3D): void {
    this.pendingWeapon = weapon
    this.phase         = 'webbsPose'
    this.phaseStartMs  = performance.now()
    this.burstFired    = false

    // CRITICAL — hide the HTML overlay so nothing renders over the 3D Webbs pose.
    this.hideOverlay?.()

    // Webbs handles its own rotation + leg lift via startCelebrationPose()
    // Round 8 Issue 6: pass weapon so the presented item visual is built
    webbs.startCelebrationPose(weapon)
  }

  update(webbs: Webbs3D, particles: ParticleBurstSystem3D): void {
    if (this.phase !== 'webbsPose') return
    const elapsed = performance.now() - this.phaseStartMs

    // T=0.7s — fire particle bursts AFTER the lift completes.
    if (!this.burstFired && elapsed >= BURST_DELAY_MS) {
      this.burstFired = true
      const color = WEAPON_COLORS[this.pendingWeapon!]
      // Camera sits at (+18, _, +18) — "behind" Webbs is the (-X, -Z) direction.
      const behind = webbs.group.position.clone()
      behind.y = 0.7
      behind.x -= 0.4
      behind.z -= 0.4
      particles.burst(behind, color, 32, 5.5, 0.10)
      // Secondary smaller burst at the lifted-item position (in front, toward camera).
      const itemPos = webbs.group.position.clone()
      itemPos.y = 0.9
      itemPos.x += 0.3
      itemPos.z += 0.3
      particles.burst(itemPos, color, 18, 3.5, 0.08)
    }

    // T=2.5s — end the pose, beat for 200ms, then show discovery card.
    if (elapsed >= POSE_DURATION_MS) {
      webbs.endCelebrationPose()
      this.phase = 'discoveryCard'
      const wt = this.pendingWeapon!
      setTimeout(() => { this.onShowDiscoveryCard?.(wt) }, SETTLE_BEAT_MS)
    }
  }

  onDiscoveryCardClosed(): void {
    if (this.phase !== 'discoveryCard') return
    this.phase = 'tutorialCard'
    this.onShowTutorialCard?.(this.pendingWeapon!)
  }

  onTutorialCardClosed(): void {
    if (this.phase !== 'tutorialCard') return
    this.phase         = 'done'
    this.onComplete?.()
    this.pendingWeapon = null
    this.phase         = 'idle'   // ready for next pickup
  }

  isActive(): boolean {
    return this.phase !== 'idle' && this.phase !== 'done'
  }

  isShowingWebbsPose(): boolean {
    return this.phase === 'webbsPose'
  }
}
