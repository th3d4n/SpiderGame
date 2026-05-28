import type { InputManager } from '../core/InputManager'
import { audio } from '../systems/AudioManager'

export interface TextDisplayData {
  pages:        string[]
  title?:       string
  accentColor?: string  // CSS color string, default '#7777ff'
}

export class TextDisplay3D {
  private overlay:   HTMLElement
  private panel:     HTMLDivElement
  private titleEl:   HTMLDivElement
  private pageEl:    HTMLDivElement
  private counterEl: HTMLDivElement
  private pages: string[] = []
  private pageIndex = 0

  isOpen  = false
  onClose?: () => void

  constructor(menuOverlay: HTMLElement) {
    this.overlay = menuOverlay

    this.panel = document.createElement('div')
    this.panel.style.cssText = [
      'display:none; position:absolute; top:50%; left:50%;',
      'transform:translate(-50%,-50%);',
      'width:460px; padding:24px 32px 20px;',
      'background:#0d0d1a; border:1.5px solid #7777ff;',
      'font-family:monospace; color:#ccccdd;',
    ].join('')

    this.titleEl = document.createElement('div')
    this.titleEl.style.cssText = 'color:#7777ff; font-size:11px; letter-spacing:2px; margin-bottom:14px; text-align:center;'

    this.pageEl = document.createElement('div')
    this.pageEl.style.cssText = 'font-size:13px; line-height:1.7; min-height:80px; text-align:center; white-space:pre-wrap;'

    this.counterEl = document.createElement('div')
    this.counterEl.style.cssText = 'color:#445566; font-size:10px; text-align:center; margin-top:16px;'

    const hint = document.createElement('div')
    hint.style.cssText = 'color:#334455; font-size:10px; text-align:center; margin-top:8px;'
    hint.textContent = '[ M ] Continue   [ Space ] Skip'

    this.panel.appendChild(this.titleEl)
    this.panel.appendChild(this.pageEl)
    this.panel.appendChild(this.counterEl)
    this.panel.appendChild(hint)
    menuOverlay.appendChild(this.panel)
  }

  show(data: TextDisplayData): void {
    this.pages     = data.pages
    this.pageIndex = 0
    const accent = data.accentColor ?? '#7777ff'
    this.panel.style.borderColor = accent
    this.titleEl.style.color = accent
    this.titleEl.textContent = data.title ?? ''
    this.panel.style.display = 'block'
    this.overlay.style.display = 'block'
    this.isOpen = true
    this.showPage(0)
  }

  update(input: InputManager): void {
    if (!this.isOpen) return
    if (input.justDown('KeyM')) {
      if (this.pageIndex < this.pages.length - 1) { this.showPage(this.pageIndex + 1); audio.play('ui_text_advance') }
      else this.close()
    }
    if (input.justDown('Space')) this.close()
  }

  close(): void {
    this.panel.style.display = 'none'
    this.overlay.style.display = 'none'
    this.isOpen = false
    this.onClose?.()
  }

  private showPage(i: number): void {
    this.pageIndex = i
    this.pageEl.textContent = this.pages[i]
    this.counterEl.textContent = `${i + 1} / ${this.pages.length}`
  }
}
