const FADE_MS    = 400   // matches CSS transition in index.html
const BUFFER_MS  = 80    // extra wait to ensure CSS animation completes
const TITLE_HOLD = 700   // ms to display zone title during blackout

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getTitleEl(): HTMLDivElement {
  let el = document.getElementById('zone-title-card') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = 'zone-title-card'
    el.style.cssText = [
      'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);',
      'font-family:monospace; font-size:22px; letter-spacing:6px; color:#ccccdd;',
      'text-align:center; pointer-events:none;',
      'transition:opacity 250ms ease; opacity:0;',
    ].join('')
    document.getElementById('transition-overlay')?.appendChild(el)
  }
  return el
}

export class ZoneTransitionSystem3D {
  static async transition(doSwitch: () => void, zoneName?: string): Promise<void> {
    const overlay = document.getElementById('transition-overlay')!
    overlay.style.opacity = '1'
    await delay(FADE_MS + BUFFER_MS)

    doSwitch()
    await delay(16)   // let DOM/Three settle one frame

    if (zoneName) {
      const titleEl = getTitleEl()
      titleEl.textContent = zoneName
      titleEl.style.opacity = '1'
      await delay(TITLE_HOLD)
      titleEl.style.opacity = '0'
      await delay(260)  // wait for title fade-out
    }

    overlay.style.opacity = '0'
    await delay(FADE_MS + BUFFER_MS)
  }
}
