import * as THREE from 'three'

const _ray    = new THREE.Raycaster()
const _ndc    = new THREE.Vector2()
const _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class InputManager {
  private keysDown = new Set<string>()
  private keysJustDown = new Set<string>()
  private mousePos = { x: 0, y: 0 }
  private mouseJustDown = false
  private mouseIsDown = false
  private rightMouseJustDown = false
  private rightMouseIsDown  = false
  // Touch / virtual input (see ui/TouchControls)
  private stick: { x: number; y: number } | null = null
  touchActive = false

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) this.keysJustDown.add(e.code)
      this.keysDown.add(e.code)
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })
    // Suppress browser context menu so right-click can be used as a game input
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault() })
    // Stored normalised (0–1 across the canvas as displayed) so picking stays
    // correct when the game container is CSS-scaled to fit the window.
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.mousePos.x = (e.clientX - rect.left) / rect.width
      this.mousePos.y = (e.clientY - rect.top)  / rect.height
    })
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseJustDown = true; this.mouseIsDown = true }
      if (e.button === 2) { this.rightMouseJustDown = true; this.rightMouseIsDown = true }
    })
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseIsDown = false
      if (e.button === 2) this.rightMouseIsDown = false
    })
  }

  // Analog stick in screen space (x right, y down), |v| ≤ 1; null when untouched
  setStick(x: number, y: number): void   { this.stick = { x, y } }
  clearStick(): void                     { this.stick = null }
  getStick(): { x: number; y: number } | null { return this.stick }
  // Virtual keys — on-screen buttons press the same codes the keyboard does
  press(code: string): void {
    if (!this.keysDown.has(code)) this.keysJustDown.add(code)
    this.keysDown.add(code)
  }
  release(code: string): void            { this.keysDown.delete(code) }

  isDown(code: string): boolean          { return this.keysDown.has(code) }
  justDown(code: string): boolean         { return this.keysJustDown.has(code) }
  isMouseDown(): boolean                  { return this.mouseIsDown }
  mouseJustClicked(): boolean             { return this.mouseJustDown }
  rightMouseJustClicked(): boolean        { return this.rightMouseJustDown }
  isRightMouseDown(): boolean             { return this.rightMouseIsDown }

  getMousePos(): { x: number; y: number } { return { ...this.mousePos } }

  // Raycast mouse position to the Y=0 ground plane in world space
  // (scratch objects reused — this runs every frame)
  mouseToWorld(camera: THREE.Camera): THREE.Vector3 {
    _ndc.set(this.mousePos.x * 2 - 1, -this.mousePos.y * 2 + 1)
    _ray.setFromCamera(_ndc, camera)
    const target = new THREE.Vector3()   // callers keep it — the one allocation left
    _ray.ray.intersectPlane(_ground, target)
    return target
  }

  endFrame(): void {
    this.keysJustDown.clear()
    this.mouseJustDown      = false
    this.rightMouseJustDown = false
  }
}
