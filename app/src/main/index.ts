import { app, BrowserWindow, globalShortcut, ipcMain, Menu, powerMonitor, shell, Tray } from 'electron'
import { join } from 'node:path'
import { HEARTBEAT_MS } from '../domain/recovery'
import type { Settings } from '../domain/settings'
import {
  CHANNELS,
  TOAST_ACTIONS,
  type AppSnapshot,
  type Command,
  type CommandResult,
  type ToastAction
} from '../shared/ipc'
import { AppController } from './controller'
import { EventStore } from './store/eventStore'
import { SettingsStore } from './store/settingsStore'
import { ToastManager } from './toast'
import { dayStartToast, toastFor } from './toastPayload'
import { appIcon, trayIcon } from './trayIcon'
import { WidgetWindow } from './widget'

// 테스트·개발에서 실제 사용자 데이터와 섞이지 않도록 데이터 경로를 바꿀 수 있다.
if (process.env.JUMPUP_DATA_DIR) app.setPath('userData', process.env.JUMPUP_DATA_DIR)
// 테스트 전용: 세션·체크인 시간을 N배 빠르게 (예: 60이면 10분 → 10초)
const timeScale = Number(process.env.JUMPUP_TIME_SCALE) || 1
// 테스트 전용: e2e가 트레이·단축키 동작을 호출할 수 있게 훅을 노출한다.
const e2eHooks = process.env.JUMPUP_E2E === '1'
/** 부팅 자동 실행으로 켜졌을 때는 창 없이 트레이로만 시작한다. */
const startHidden = process.argv.includes('--hidden')

let mainWindow: BrowserWindow | null = null
let widget: WidgetWindow | null = null
let toasts: ToastManager | null = null
let tray: Tray | null = null
let controller: AppController | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let tickTimer: NodeJS.Timeout | null = null
let lastPhase: AppSnapshot['session']['phase'] = 'idle'
let quitting = false
let trayHintShown = false

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 전역 단축키·트레이 "지금 뭐 하지?": 추천을 띄우고 창을 앞으로 가져온다. */
function quickAsk(): void {
  controller?.quickAsk()
  focusMainWindow()
}

function onStateChange(snapshot: AppSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.state, snapshot)
  }
  const widgetWin = widget?.window
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send(CHANNELS.state, snapshot)
  widget?.sync(snapshot)
  toasts?.sync(snapshot)

  // 세션이 끝나면 회고를 쓸 수 있도록 메인 창을 앞으로 가져온다.
  if (snapshot.session.phase === 'reflecting' && lastPhase !== 'reflecting') focusMainWindow()
  lastPhase = snapshot.session.phase
}

/** 토스트 버튼을 컨트롤러 명령으로 옮긴다. 실패해도 앱이 죽지 않게 삼킨다(상태는 이미 일관됨). */
function handleToastAction(action: ToastAction): void {
  const ctrl = controller
  if (!ctrl) return
  const send = (cmd: Command): void => {
    try {
      ctrl.dispatch(cmd)
    } catch {
      /* 이미 상태가 바뀐 뒤 늦게 도착한 응답 등은 무시한다 */
    }
  }
  switch (action) {
    case 'ok':
      return send({ type: 'answer_checkin', answer: 'ok' })
    case 'stuck':
      return send({ type: 'answer_checkin', answer: 'stuck' })
    case 'start_break':
      return send({ type: 'break_start' })
    case 'resume_session':
      return send({ type: 'session_resume' })
    case 'finish_session':
      return send({ type: 'session_end', reason: 'timeout' })
    case 'start_day':
      send({ type: 'day_start' })
      return quickAsk()
    case 'snooze':
      return ctrl.snoozeDayStart()
    case 'dismiss':
      return
  }
}

// ── OS 연동: 전역 단축키·자동 실행 ───────────────────────────────

/** 새 단축키를 등록한다. 실패하면 Error를 던지고 기존 등록은 그대로 둔다. */
function registerShortcut(accelerator: string, previous?: string): void {
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, quickAsk)
  } catch {
    throw new Error(`올바르지 않은 단축키입니다: ${accelerator}`)
  }
  if (!ok) {
    throw new Error(`단축키 ${accelerator}를 등록하지 못했어요. 다른 앱이 쓰고 있을 수 있어요.`)
  }
  if (previous && previous !== accelerator) globalShortcut.unregister(previous)
}

/**
 * 부팅 시 자동 실행. 개발·테스트(패키징되지 않은 실행)에서는 electron.exe 자체가
 * 로그인 항목으로 등록되어 버리므로 절대 건드리지 않는다.
 */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] })
}

function applySettings(next: Settings, prev: Settings): void {
  if (next.shortcut !== prev.shortcut) registerShortcut(next.shortcut, prev.shortcut)
  if (next.autoLaunch !== prev.autoLaunch) applyLoginItem(next.autoLaunch)
}

// ── 창·트레이 ──────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: 'JumpUp Now',
    icon: appIcon(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => {
    if (!startHidden) win.show()
  })

  // 닫기(X)는 종료가 아니라 트레이로 내리기: 체크인·위젯·하루 시작 알림이 계속 동작해야 한다.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true
      tray?.displayBalloon({
        title: 'JumpUp Now',
        content: '트레이에서 계속 실행 중입니다. 완전히 끝내려면 트레이 아이콘 → 종료.'
      })
    }
  })

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

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'JumpUp Now 열기', click: focusMainWindow },
    { label: '지금 뭐 하지?', click: quickAsk },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function createTray(): Tray {
  const t = new Tray(trayIcon())
  t.setToolTip('JumpUp Now')
  t.setContextMenu(trayMenu())
  t.on('click', focusMainWindow)
  return t
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
  ipcMain.handle(CHANNELS.toastGet, () => toasts?.currentPayload ?? null)
  ipcMain.on(CHANNELS.toastAction, (_event, action: unknown) => {
    if (typeof action === 'string' && (TOAST_ACTIONS as readonly string[]).includes(action)) {
      toasts?.respond(action as ToastAction)
    }
  })
}

function safeDispatch(ctrl: AppController, cmd: Command): void {
  try {
    ctrl.dispatch(cmd)
  } catch {
    /* 응답 대기가 이미 끝난 경우 */
  }
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
      onChange: onStateChange,
      onEffect: (effect) => toasts?.show(toastFor(effect, ctrl.snapshot(), timeScale)),
      onDayStartPrompt: ({ late }) => toasts?.show(dayStartToast(late, timeScale)),
      applySettings,
      timeScale
    })
    controller = ctrl
    ctrl.init()

    toasts = new ToastManager({
      onAction: (action) => handleToastAction(action),
      // 체크인에 응답하지 않으면 '응답 없음'으로 기록한다(연속 막힘 카운터는 건드리지 않음).
      onExpire: (shown) => {
        if (shown.kind === 'checkin') safeDispatch(ctrl, { type: 'answer_checkin', answer: 'timeout' })
      }
    })
    registerIpc(ctrl)

    widget = new WidgetWindow({
      getSavedPos: () => ctrl.snapshot().settings.widgetPos,
      onMoved: (pos) => ctrl.saveWidgetPos(pos)
    })

    tray = createTray()

    // 저장된 단축키 등록. 실패해도 앱은 계속 쓸 수 있으므로 안내만 띄운다.
    try {
      registerShortcut(ctrl.snapshot().settings.shortcut)
    } catch (err) {
      ctrl.setNotice(`${err instanceof Error ? err.message : '단축키 등록 실패'} 설정에서 바꿀 수 있어요.`)
    }

    // 절전 진입 시 세션을 멈춘다. 복귀 후에는 사용자가 직접 이어간다.
    powerMonitor.on('suspend', () => ctrl.suspend())

    heartbeatTimer = setInterval(() => ctrl.heartbeat(), HEARTBEAT_MS)
    tickTimer = setInterval(() => ctrl.tick(), 1000)
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    if (e2eHooks) {
      ;(globalThis as Record<string, unknown>).__jumpup = {
        quickAsk,
        hasTray: () => !!tray && !tray.isDestroyed(),
        trayLabels: () => trayMenu().items.map((i) => i.label).filter(Boolean),
        shortcutRegistered: (acc: string) => globalShortcut.isRegistered(acc),
        /** 다른 앱이 단축키를 점유한 상황을 재현하기 위해 이 프로세스가 직접 등록한다. */
        occupyShortcut: (acc: string) => globalShortcut.register(acc, () => {}),
        mainVisible: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
      }
    }
  })

  app.on('before-quit', () => {
    quitting = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (tickTimer) clearInterval(tickTimer)
    controller?.heartbeat() // 마지막 활동 시각을 남겨 복구 정확도를 높인다.
    globalShortcut.unregisterAll()
    widget?.dispose()
    toasts?.dispose()
    tray?.destroy()
  })
}
