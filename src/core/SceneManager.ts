export interface GameScene {
  key: string
  create(): void
  update(delta: number): void
  destroy(): void
  pause(): void
  resume(): void
}

export class SceneManager {
  private scenes = new Map<string, GameScene>()
  private active: GameScene | null = null
  private overlays: GameScene[] = []

  register(scene: GameScene): void {
    this.scenes.set(scene.key, scene)
  }

  start(key: string): void {
    if (this.active) this.active.destroy()
    this.overlays.forEach(o => o.destroy())
    this.overlays = []

    const scene = this.scenes.get(key)
    if (!scene) throw new Error(`SceneManager: unknown scene key "${key}"`)
    scene.create()
    this.active = scene
  }

  // Launch an overlay on top of the active scene (mirrors Phaser scene.launch)
  launch(key: string): void {
    if (this.active) this.active.pause()
    const scene = this.scenes.get(key)
    if (!scene) throw new Error(`SceneManager: unknown scene key "${key}"`)
    scene.create()
    this.overlays.push(scene)
  }

  // Stop the top overlay and resume the scene beneath
  stopOverlay(key: string): void {
    const idx = this.overlays.findIndex(o => o.key === key)
    if (idx === -1) return
    this.overlays[idx].destroy()
    this.overlays.splice(idx, 1)
    if (this.overlays.length === 0 && this.active) this.active.resume()
  }

  update(delta: number): void {
    if (this.overlays.length > 0) {
      this.overlays[this.overlays.length - 1].update(delta)
    } else {
      this.active?.update(delta)
    }
  }

  getActive(): GameScene | null { return this.active }
  isOverlayOpen(key: string): boolean { return this.overlays.some(o => o.key === key) }
}

export const sceneManager = new SceneManager()
