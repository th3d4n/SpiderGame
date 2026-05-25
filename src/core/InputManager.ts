import * as THREE from 'three'

export class InputManager {
  private keysDown = new Set<string>()
  private keysJustDown = new Set<string>()
  private mousePos = { x: 0, y: 0 }
  private mouseJustDown = false
  private mouseIsDown = false
  private rightMouseJustDown = false
  private rightMouseIsDown  = false

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
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.mousePos.x = e.clientX - rect.left
      this.mousePos.y = e.clientY - rect.top
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

  isDown(code: string): boolean          { return this.keysDown.has(code) }
  justDown(code: string): boolean         { return this.keysJustDown.has(code) }
  isMouseDown(): boolean                  { return this.mouseIsDown }
  mouseJustClicked(): boolean             { return this.mouseJustDown }
  rightMouseJustClicked(): boolean        { return this.rightMouseJustDown }
  isRightMouseDown(): boolean             { return this.rightMouseIsDown }

  getMousePos(): { x: number; y: number } { return { ...this.mousePos } }

  // Raycast mouse position to the Y=0 ground plane in world space
  mouseToWorld(camera: THREE.OrthographicCamera, canvasW: number, canvasH: number): THREE.Vector3 {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2(
      (this.mousePos.x / canvasW) * 2 - 1,
      -(this.mousePos.y / canvasH) * 2 + 1
    )
    raycaster.setFromCamera(ndc, camera)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const target = new THREE.Vector3()
    raycaster.ray.intersectPlane(groundPlane, target)
    return target
  }

  endFrame(): void {
    this.keysJustDown.clear()
    this.mouseJustDown      = false
    this.rightMouseJustDown = false
  }
}
