import type { Webbs3D } from '../entities/Webbs3D'
import type { ParticleBurstSystem3D } from './ParticleBurstSystem3D'
import { WeaponType } from './WeaponSystem'
import { WEAPON_COLORS } from '../config/WeaponData'
import type { DiscoveryVariant } from '../ui/PickupCelebration3D'
import { DiscoveryFX3D, DISCOVERY_FX_SECONDS } from './DiscoveryFX3D'
import { CAMERA_DIR_X, CAMERA_DIR_Z } from '../core/CameraRig'
import { audio } from './AudioManager'
import * as THREE from 'three'

// Pickup presentation timeline:
//   T=0.0s : pause + hide HTML overlay, camera pushes in, Webbs turns to camera
//            (0.3s); DiscoveryFX3D opens a light shaft and the item rises
//   T=0.3s : legs lift to present it
//   T=0.7s : HIT — flash, shockwaves, god rays, particle bursts
//   T=3.0s : item zips away, pose ends, Webbs settles back (200ms beat)
//   T=3.2s : discovery card fades in (player dismisses with Space/M)
//   ...    : tutorial card (player dismisses)
//   done   : game unpauses

type Phase = 'idle' | 'webbsPose' | 'settle' | 'discoveryCard' | 'tutorialCard' | 'done'

const POSE_DURATION_MS    = DISCOVERY_FX_SECONDS * 1000
const BURST_DELAY_MS      = 700
const SETTLE_BEAT_MS      = 200

export class PresentationPhase {
  private phase: Phase = 'idle'
  private phaseStartMs = 0
  private burstFired   = false
  private fx: DiscoveryFX3D | null = null
  private lastMs = 0

  onShowDiscoveryCard: ((wt: WeaponType, variant: DiscoveryVariant) => void) | null = null
  onShowTutorialCard:  ((wt: WeaponType) => void) | null = null
  onComplete:          (() => void) | null = null
  // Hook for hiding the HTML menu overlay so the player sees pure 3D during Phase 1
  hideOverlay:         (() => void) | null = null

  pendingWeapon: WeaponType | null = null
  private pendingVariant: DiscoveryVariant = 'found'

  start(weapon: WeaponType, webbs: Webbs3D, _particles: ParticleBurstSystem3D, variant: DiscoveryVariant = 'found'): void {
    this.pendingWeapon  = weapon
    this.pendingVariant = variant
    this.phase         = 'webbsPose'
    this.phaseStartMs  = performance.now()
    this.burstFired    = false

    // CRITICAL — hide the HTML overlay so nothing renders over the 3D Webbs pose.
    this.hideOverlay?.()

    // Webbs handles his own rotation + leg lift; the item and effects are the FX's
    webbs.startCelebrationPose()
    this.fx?.dispose()
    const scene = webbs.group.parent as THREE.Scene
    this.fx = new DiscoveryFX3D(scene, weapon, webbs.group.position.clone().setY(webbs.group.position.y - 0.0), webbs.scale, webbs.gradient)
    this.lastMs = performance.now()
    audio.play('celeb_swell')
  }

  update(webbs: Webbs3D, particles: ParticleBurstSystem3D): void {
    // Settle beat between the pose and the card — timed on the game loop
    if (this.phase === 'settle') {
      if (performance.now() - this.phaseStartMs >= SETTLE_BEAT_MS) {
        this.phase = 'discoveryCard'
        this.onShowDiscoveryCard?.(this.pendingWeapon!, this.pendingVariant)
      }
      return
    }
    if (this.phase !== 'webbsPose') return
    const now = performance.now()
    const elapsed = now - this.phaseStartMs
    this.fx?.update(Math.min(0.05, (now - this.lastMs) / 1000))
    this.lastMs = now

    // T=0.7s — particle bursts on the hit: behind Webbs and at the item
    if (!this.burstFired && elapsed >= BURST_DELAY_MS) {
      this.burstFired = true
      const color = WEAPON_COLORS[this.pendingWeapon!]
      const s = webbs.scale
      const behind = webbs.group.position.clone()
      behind.x -= CAMERA_DIR_X * 0.4 * s; behind.z -= CAMERA_DIR_Z * 0.4 * s; behind.y += 0.7 * s
      particles.burst(behind, color, 40, 5.5 * s, 0.10 * s)
      const itemPos = webbs.group.position.clone()
      itemPos.x += CAMERA_DIR_X * 0.35 * s; itemPos.z += CAMERA_DIR_Z * 0.35 * s; itemPos.y += 1.15 * s
      particles.burst(itemPos, 0xffffff, 22, 3.5 * s, 0.07 * s)
      audio.play('pickup_notify')
    }

    // T=3.0s — end the pose, beat for 200ms, then show discovery card.
    if (elapsed >= POSE_DURATION_MS) {
      this.fx?.dispose(); this.fx = null
      webbs.endCelebrationPose()
      this.phase        = 'settle'
      this.phaseStartMs = performance.now()
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
