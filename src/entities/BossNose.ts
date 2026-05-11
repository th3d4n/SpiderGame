import Phaser from 'phaser'
import Enemy, { type EnemyConfig, WeakPointZone } from './Enemy'

const OVAL_W = 120
const OVAL_H = 70

export default class BossNose extends Enemy {
  private noseGraphic!: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const cfg: EnemyConfig = {
      health:          80,
      speed:           0,
      damage:          0,
      weakPoints:      [WeakPointZone.Head],
      weakMultiplier:  1.5,
      staggerDuration: 100,
      bodyRadius:      40,
    }
    super(scene, x, y, cfg)
    // Nose is pinned to the ceiling — disable physics movement entirely
    this.pb.setImmovable(true)
    this.pb.setAllowGravity(false)
    this.pb.setVelocity(0, 0)
    this.buildVisuals()
  }

  protected buildVisuals(): void {
    this.noseGraphic = this.scene.add.graphics()
    this.add(this.noseGraphic)
    this.renderNose()
  }

  private renderNose(): void {
    this.noseGraphic.clear()
    this.noseGraphic.fillStyle(0xff9fad, 1)
    this.noseGraphic.fillEllipse(0, 0, OVAL_W, OVAL_H)
    this.noseGraphic.lineStyle(3, 0xcc5577, 1)
    this.noseGraphic.strokeEllipse(0, 0, OVAL_W, OVAL_H)
    this.noseGraphic.fillStyle(0xaa2244, 1)
    this.noseGraphic.fillEllipse(-18, 8, 16, 10)
    this.noseGraphic.fillEllipse( 18, 8, 16, 10)
  }

  // Override knockback so the nose can't slide off the ceiling
  applyKnockback(_vx: number, _vy: number): void {
    this.pb.setVelocity(0, 0)
  }

  update(_time: number, _delta: number): void {
    // Hold position; pb is immovable but velocity may be nudged by collisions
    this.pb.setVelocity(0, 0)
  }
}
