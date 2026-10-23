const FADE_MS    = 400   // matches the #transition-overlay CSS transition
const BUFFER_MS  = 80    // extra wait to ensure the fade completes
const TITLE_HOLD = 1300  // ms the zone title card holds during the blackout

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const STYLE = /* css */`
#zone-title-card { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 12px; pointer-events:none; opacity:0; }
#zone-title-card.on { opacity:1; }
#zone-title-card .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 6px; color: #ffb35c; text-transform: uppercase; opacity:0; }
#zone-title-card .name { font-family: var(--nl-display); font-size: 56px; font-weight: 600; color: #f6eee2; letter-spacing: 1px; }
#zone-title-card .name span { display:inline-block; opacity:0; white-space:pre; }
#zone-title-card .rule { width: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(232,214,186,.55), transparent); }
#zone-title-card.on .eyebrow { animation: nl-up 500ms var(--nl-ease) 120ms both; }
#zone-title-card.on .name span { animation: nl-letter 520ms var(--nl-ease) both; }
#zone-title-card.on .rule { animation: nl-zt-rule 900ms var(--nl-ease) 200ms both; }
#zone-title-card.leave { opacity: 0; transition: opacity 300ms ease-in; }
@keyframes nl-zt-rule { to { width: 420px } }
`

// "ZONE 1  —  ANT COLONY" → eyebrow "Zone 1", name "Ant Colony"; "HOME BASE" → name only
function splitTitle(raw: string): { eyebrow: string; name: string } {
  const parts = raw.split(/\s*[—–-]\s*/).filter(Boolean)
  const tc = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  return parts.length > 1 ? { eyebrow: tc(parts[0]), name: tc(parts.slice(1).join(' ')) } : { eyebrow: '', name: tc(raw) }
}

function getTitleEl(): HTMLDivElement {
  let el = document.getElementById('zone-title-card') as HTMLDivElement | null
  if (!el) {
    if (!document.getElementById('nl-zt-style')) {
      const st = document.createElement('style'); st.id = 'nl-zt-style'; st.textContent = STYLE
      document.head.appendChild(st)
    }
    el = document.createElement('div')
    el.id = 'zone-title-card'
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
      const el = getTitleEl()
      const { eyebrow, name } = splitTitle(zoneName)
      el.className = ''
      el.innerHTML = `<div class="eyebrow">${eyebrow}</div><div class="name">${
        [...name].map((c, i) => `<span style="animation-delay:${180 + i * 40}ms">${c}</span>`).join('')
      }</div><div class="rule"></div>`
      void el.offsetWidth
      el.classList.add('on')
      await delay(TITLE_HOLD)
      el.classList.add('leave')
      await delay(300)
      el.className = ''
    }

    overlay.style.opacity = '0'
    await delay(FADE_MS + BUFFER_MS)
  }
}
