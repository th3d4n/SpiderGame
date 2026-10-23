import * as THREE from 'three'
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

// ─── Ink outline pass ─────────────────────────────────────────────────────────
// Screen-space toon outlines for EVERYTHING (characters, props, walls) from the
// depth buffer alone — one cheap full-screen pass instead of per-mesh hulls.
//
// Edge test: the second derivative (Laplacian) of linear depth, relative to the
// pixel's own depth.  Flat and sloped surfaces have a ~zero second derivative,
// so floors seen at a grazing angle stay clean; silhouettes and creases fire.
// Ink fades with distance past the focus point so far geometry doesn't get noisy.
//
// Needs the composer's render targets to carry a DepthTexture (see attachDepth).

const InkShader = {
  uniforms: {
    tDiffuse:    { value: null as THREE.Texture | null },
    tDepth:      { value: null as THREE.Texture | null },
    texel:       { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    cameraNear:  { value: 0.5 },
    cameraFar:   { value: 600 },
    thickness:   { value: 1.25 },     // px
    threshold:   { value: 0.012 },    // relative depth curvature that counts as an edge
    strength:    { value: 0.85 },
    inkColor:    { value: new THREE.Color(0x0b0806) },
    fadeStart:   { value: 30 },       // view-space distance where ink starts to fade
    fadeEnd:     { value: 90 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2  texel;
    uniform float cameraNear, cameraFar, thickness, threshold, strength, fadeStart, fadeEnd;
    uniform vec3  inkColor;
    varying vec2 vUv;

    float lin(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    }

    void main() {
      vec4  base = texture2D(tDiffuse, vUv);
      vec2  o  = texel * thickness;
      float c  = lin(vUv);
      float l  = lin(vUv - vec2(o.x, 0.0)), r = lin(vUv + vec2(o.x, 0.0));
      float dn = lin(vUv - vec2(0.0, o.y)), up = lin(vUv + vec2(0.0, o.y));
      // Relative curvature on both axes; diagonal pair adds coverage at corners
      float lap = abs(l + r - 2.0 * c) + abs(dn + up - 2.0 * c);
      float dl  = lin(vUv - o), ur = lin(vUv + o);
      lap = max(lap, abs(dl + ur - 2.0 * c));
      float edge = smoothstep(threshold, threshold * 2.5, lap / max(c, 1e-3));
      edge *= 1.0 - smoothstep(fadeStart, fadeEnd, c);
      // Background (cleared depth) never inks
      if (texture2D(tDepth, vUv).x >= 1.0) edge = 0.0;
      gl_FragColor = vec4(mix(base.rgb, inkColor, edge * strength), base.a);
    }
  `,
}

export class InkOutlinePass extends Pass {
  readonly uniforms: typeof InkShader.uniforms
  private quad: FullScreenQuad
  private camera: THREE.PerspectiveCamera

  constructor(camera: THREE.PerspectiveCamera) {
    super()
    this.camera = camera
    const mat = new THREE.ShaderMaterial({
      uniforms:       THREE.UniformsUtils.clone(InkShader.uniforms),
      vertexShader:   InkShader.vertexShader,
      fragmentShader: InkShader.fragmentShader,
      depthTest: false, depthWrite: false,
    })
    this.uniforms = mat.uniforms as typeof InkShader.uniforms
    this.uniforms.inkColor.value = new THREE.Color(0x0b0806)
    this.quad = new FullScreenQuad(mat)
  }

  // Ink fades from just past the player to well behind them
  setFocusDistance(d: number): void {
    this.uniforms.fadeStart.value = d * 1.15
    this.uniforms.fadeEnd.value   = d * 2.2
  }

  setSize(width: number, height: number): void {
    this.uniforms.texel.value.set(1 / width, 1 / height)
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value   = readBuffer.texture
    this.uniforms.tDepth.value     = readBuffer.depthTexture
    this.uniforms.cameraNear.value = this.camera.near
    this.uniforms.cameraFar.value  = this.camera.far
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
    this.quad.render(renderer)
  }

  dispose(): void {
    this.quad.dispose()
    ;(this.quad.material as THREE.Material).dispose()
  }

  // Give both composer ping-pong targets a depth texture so the pass can read
  // the scene depth from whichever one RenderPass wrote this frame.
  static attachDepth(...targets: THREE.WebGLRenderTarget[]): void {
    for (const t of targets) {
      if (t.depthTexture) continue
      t.depthTexture = new THREE.DepthTexture(t.width, t.height)
      t.depthTexture.type = THREE.UnsignedIntType
    }
  }
}
