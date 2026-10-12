// 사용자 설정 모델과 검증. 저장 포맷은 main/store/settingsStore.ts가 담당한다.

export interface Settings {
  /** 온보딩에서 입력한 큰 목표 한 줄 */
  goal: string
  /** 목표 실질 작업비율 (%) */
  successTargetPct: number
  /** 하루 시작 알림 시각 "HH:MM" */
  dayStartTime: string
  sessionMin: number
  checkinMin: number
  shortcut: string
  autoLaunch: boolean
  onboarded: boolean
  widgetPos: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: Settings = {
  goal: '',
  successTargetPct: 40,
  dayStartTime: '09:00',
  sessionMin: 25,
  checkinMin: 10,
  shortcut: 'Ctrl+Alt+J',
  autoLaunch: false,
  onboarded: false,
  widgetPos: null
}

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

/** 알 수 없거나 범위를 벗어난 값은 기본값으로 대체한다. */
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pos = r.widgetPos as { x?: unknown; y?: unknown } | null | undefined
  return {
    goal: typeof r.goal === 'string' ? r.goal.slice(0, 200) : d.goal,
    successTargetPct: isNum(r.successTargetPct, 1, 100) ? r.successTargetPct : d.successTargetPct,
    dayStartTime:
      typeof r.dayStartTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.dayStartTime)
        ? r.dayStartTime
        : d.dayStartTime,
    sessionMin: isNum(r.sessionMin, 1, 180) ? r.sessionMin : d.sessionMin,
    checkinMin: isNum(r.checkinMin, 1, 60) ? r.checkinMin : d.checkinMin,
    shortcut: typeof r.shortcut === 'string' && r.shortcut.length > 0 ? r.shortcut : d.shortcut,
    autoLaunch: typeof r.autoLaunch === 'boolean' ? r.autoLaunch : d.autoLaunch,
    onboarded: typeof r.onboarded === 'boolean' ? r.onboarded : d.onboarded,
    widgetPos:
      pos && typeof pos.x === 'number' && typeof pos.y === 'number'
        ? { x: pos.x, y: pos.y }
        : d.widgetPos
  }
}
