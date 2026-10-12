// 토스트 창: 체크인·막힘 대응·휴식 제안·시간 종료를 2탭으로 응답하는 작은 자체 알림. (기술설계.md §5.2)
// Electron 기본 Notification은 버튼 지원이 플랫폼마다 달라서 직접 만든 창을 쓴다.
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { CHANNELS, type AppSnapshot, type ToastAction, type ToastPayload } from '../shared/ipc'
import { isToastStale } from './toastPayload'
import { WIDGET_SIZE } from './widget'

export const TOAST_SIZE = { width: 340, height: 140 } as const
const MARGIN = 24
const GAP_ABOVE_WIDGET = 12

export interface ToastDeps {
  /** 사용자가 버튼을 눌렀을 때 */
  onAction: (action: ToastAction, shown: ToastPayload) => void
  /** 응답 없이 제한 시간이 지났을 때. 체크인이면 '응답 없음'으로 기록하는 데 쓴다. */
  onExpire: (shown: ToastPayload) => void
}

export class ToastManager {
  private win: BrowserWindow | null = null
  private current: ToastPayload | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: ToastDeps) {}

  get currentPayload(): ToastPayload | null {
    return this.current
  }

  /** 테스트·진단용 */
  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  /** 새 토스트가 이전 토스트를 대체한다(체크인 응답 직후 막힘 대응이 바로 이어지는 경우 등). */
  show(payload: ToastPayload): void {
    this.clearTimer()
    this.current = payload
    const win = this.ensure()
    const a = screen.getPrimaryDisplay().workArea
    win.setPosition(
      a.x + a.width - TOAST_SIZE.width - MARGIN,
      a.y + a.height - TOAST_SIZE.height - MARGIN - WIDGET_SIZE.height - GAP_ABOVE_WIDGET
    )
    win.webContents.send(CHANNELS.toastShow, payload)
    win.showInactive() // 작업 중인 창의 포커스를 빼앗지 않는다.

    if ('timeoutMs' in payload) {
      this.timer = setTimeout(() => {
        if (this.current !== payload) return
        this.close()
        this.deps.onExpire(payload)
      }, payload.timeoutMs)
    }
  }

  /** 버튼 응답 처리. 현재 토스트를 닫고 동작을 위임한다. */
  respond(action: ToastAction): void {
    const shown = this.current
    if (!shown) return
    this.close()
    this.deps.onAction(action, shown)
  }

  /** 상태가 바뀌어 더는 의미 없는 토스트를 닫는다. */
  sync(snapshot: AppSnapshot): void {
    if (this.current && isToastStale(this.current, snapshot)) this.close()
  }

  close(): void {
    this.clearTimer()
    this.current = null
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(CHANNELS.toastShow, null)
      this.win.hide()
    }
  }

  dispose(): void {
    this.clearTimer()
    this.win?.destroy()
    this.win = null
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      ...TOAST_SIZE,
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
      focusable: false, // 입력 포커스를 가져가지 않는다. 클릭은 그대로 받는다.
      title: 'JumpUp Now 알림',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) void win.loadURL(`${devUrl}/toast.html`)
    else void win.loadFile(join(__dirname, '../renderer/toast.html'))
    this.win = win
    return win
  }
}
