import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { join } from 'node:path'
import { HEARTBEAT_MS } from '../domain/recovery'
import { CHANNELS, type AppSnapshot, type Command, type CommandResult } from '../shared/ipc'
import { AppController } from './controller'
import { EventStore } from './store/eventStore'
import { SettingsStore } from './store/settingsStore'
import { WidgetWindow } from './widget'

// 테스트·개발에서 실제 사용자 데이터와 섞이지 않도록 데이터 경로를 바꿀 수 있다.
if (process.env.JUMPUP_DATA_DIR) app.setPath('userData', process.env.JUMPUP_DATA_DIR)

let mainWindow: BrowserWindow | null = null
let widget: WidgetWindow | null = null
let controller: AppController | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let tickTimer: NodeJS.Timeout | null = null
let lastPhase: AppSnapshot['session']['phase'] = 'idle'

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function onStateChange(snapshot: AppSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.state, snapshot)
  }
  const widgetWin = widget?.window
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send(CHANNELS.state, snapshot)
  widget?.sync(snapshot)

  // 세션이 끝나면 회고를 쓸 수 있도록 메인 창을 앞으로 가져온다.
  if (snapshot.session.phase === 'reflecting' && lastPhase !== 'reflecting') focusMainWindow()
  lastPhase = snapshot.session.phase
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: 'JumpUp Now',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())

  // 외부 URL을 앱 안에서 열지 않는다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function registerIpc(ctrl: AppController): void {
  ipcMain.handle(CHANNELS.snapshot, (): AppSnapshot => ctrl.snapshot())
  ipcMain.handle(CHANNELS.command, (_event, cmd: Command): CommandResult => {
    try {
      ctrl.dispatch(cmd)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '알 수 없는 오류' }
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  app.whenReady().then(() => {
    const userData = app.getPath('userData')
    const ctrl = new AppController({
      eventStore: new EventStore(join(userData, 'events')),
      settingsStore: new SettingsStore(join(userData, 'settings.json')),
      onChange: onStateChange
    })
    controller = ctrl
    ctrl.init()
    registerIpc(ctrl)

    widget = new WidgetWindow({
      getSavedPos: () => ctrl.snapshot().settings.widgetPos,
      onMoved: (pos) => ctrl.saveWidgetPos(pos)
    })

    // 절전 진입 시 세션을 멈춘다. 복귀 후에는 사용자가 직접 이어간다.
    powerMonitor.on('suspend', () => ctrl.suspend())

    heartbeatTimer = setInterval(() => ctrl.heartbeat(), HEARTBEAT_MS)
    tickTimer = setInterval(() => ctrl.tick(), 1000)
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
      // 숨겨진 위젯 창이 남아 있어 window-all-closed가 오지 않으므로 직접 종료한다.
      app.quit()
    })
  })

  // M3: 창을 닫으면 종료한다. 트레이 상주는 M4에서 추가한다.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (tickTimer) clearInterval(tickTimer)
    controller?.heartbeat() // 마지막 활동 시각을 남겨 복구 정확도를 높인다.
    widget?.dispose()
  })
}
