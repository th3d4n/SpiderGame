const FADE_MS   = 400   // matches CSS transition in index.html
const BUFFER_MS = 80    // extra wait to ensure CSS animation completes

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class ZoneTransitionSystem3D {
  // Run doSwitch inside a fade-to-black / fade-back-in envelope.
  static async transition(doSwitch: () => void): Promise<void> {
    const overlay = document.getElementById('transition-overlay')!
    overlay.style.opacity = '1'
    await delay(FADE_MS + BUFFER_MS)
    doSwitch()
    await delay(16)  // let DOM/Three settle one frame
    overlay.style.opacity = '0'
    await delay(FADE_MS + BUFFER_MS)
  }
}
