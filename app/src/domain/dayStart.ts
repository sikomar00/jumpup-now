// 하루 시작 알림 시점 판단. 순수 함수. (기술설계.md §5.4)

/** 지정 시각 이후 이만큼이 지나면 "오늘은 시작하지 않는 날"로 보고 더 이상 재촉하지 않는다. */
export const PROMPT_WINDOW_MS = 8 * 60 * 60_000
/** 지정 시각보다 이만큼 이상 늦었으면 "아직 시작 안 했어요" 문구를 쓴다. */
export const LATE_AFTER_MS = 5 * 60_000

export interface DayStartPromptInput {
  now: number
  /** 설정의 하루 시작 알림 시각 "HH:MM" */
  dayStartTime: string
  dayOpen: boolean
  /** 오늘 이미 하루를 시작한 적이 있는가 (이미 종료했어도 true) */
  startedToday: boolean
  /** 오늘 이미 알림을 띄웠다면 그 날짜 키 (dateKey) */
  promptedOn: string | null
  /** "10분 뒤" 미루기 시각 */
  snoozeUntil: number | null
}

export function dateKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function todayAt(now: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h ?? 0, m ?? 0, 0, 0)
  return d.getTime()
}

export function dayStartPrompt(input: DayStartPromptInput): { due: boolean; late: boolean } {
  const no = { due: false, late: false }
  const { now, dayOpen, startedToday, promptedOn, snoozeUntil } = input
  if (dayOpen || startedToday) return no

  const startAt = todayAt(now, input.dayStartTime)
  if (now < startAt || now > startAt + PROMPT_WINDOW_MS) return no

  if (snoozeUntil !== null) {
    if (now < snoozeUntil) return no
  } else if (promptedOn === dateKey(now)) {
    return no
  }
  return { due: true, late: now - startAt >= LATE_AFTER_MS }
}
