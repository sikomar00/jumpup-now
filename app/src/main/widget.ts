// 상시 위젯 창: 세션이 진행 중(또는 일시정지)일 때만 화면 위에 떠 있다. (기술설계.md §5.3)
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { AppSnapshot } from '../shared/ipc'

export const WIDGET_SIZE = { width: 340, height: 52 } as const
const MARGIN = 24
const SAVE_DEBOUNCE_MS = 400

export interface WidgetDeps {
  /** 저장된 위치. 없거나 화면 밖이면 우하단에 둔다. */
  getSavedPos: () => { x: number; y: number } | null
  onMoved: (pos: { x: number; y: number }) => void
}

/** 저장된 위치가 현재 연결된 어느 화면 안에라도 있는지 확인한다(모니터 분리·해상도 변경 대비). */
export function isVisiblePos(pos: { x: number; y: number }): boolean {
  const rect = { ...pos, ...WIDGET_SIZE }
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return rect.x >= a.x && rect.y >= a.y && rect.x + rect.width <= a.x + a.width && rect.y + rect.height <= a.y + a.height
  })
}

function defaultPos(): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea
  return {
    x: a.x + a.width - WIDGET_SIZE.width - MARGIN,
    y: a.y + a.height - WIDGET_SIZE.height - MARGIN
  }
}

export class WidgetWindow {
  private win: BrowserWindow | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private placing = false

  constructor(private readonly deps: WidgetDeps) {}

  /** 스냅샷에 맞춰 보이거나 숨긴다. */
  sync(snapshot: AppSnapshot): void {
    const active = snapshot.session.phase === 'running' || snapshot.session.phase === 'paused'
    if (active) this.show()
    else this.hide()
  }

  /** 테스트·진단용 */
  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.win?.destroy()
    this.win = null
  }

  private show(): void {
    const win = this.ensure()
    if (!win.isVisible()) {
      this.placing = true
      const saved = this.deps.getSavedPos()
      const pos = saved && isVisiblePos(saved) ? saved : defaultPos()
      win.setPosition(pos.x, pos.y)
      this.placing = false
      win.showInactive() // 작업 중인 창의 포커스를 빼앗지 않는다.
    }
  }

  private hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      ...WIDGET_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'JumpUp Now 위젯',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // 전체 화면 앱 위에도 보이도록 가장 높은 레벨로 올린다. (OS별 동작은 실기기 확인 필요)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    win.on('move', () => {
      if (this.placing) return
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        if (win.isDestroyed()) return
        const [x, y] = win.getPosition()
        if (x !== undefined && y !== undefined) this.deps.onMoved({ x, y })
      }, SAVE_DEBOUNCE_MS)
    })

    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) void win.loadURL(`${devUrl}/widget.html`)
    else void win.loadFile(join(__dirname, '../renderer/widget.html'))
    this.win = win
    return win
  }
}
