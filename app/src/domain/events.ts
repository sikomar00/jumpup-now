// 이벤트 로그 스키마. 상태는 전부 이 추가 전용 로그에서 복원한다. (기술설계.md §4.1)

export type TaskSize = 'small' | 'medium' | 'large'
export type CheckinAnswer = 'ok' | 'stuck' | 'timeout'
export type GoalLink = 'yes' | 'no' | 'unsure'
export type StuckCause = 'anxiety' | 'vague' | 'tired' | 'distracted' | 'other'
export type PauseCause = 'user' | 'suspend' | 'idle'
export type EndReason = 'done' | 'timeout' | 'manual' | 'recovered'

export type EventBody =
  | { type: 'day_start' }
  | { type: 'day_end' }
  | { type: 'break_start'; reason?: string }
  | { type: 'break_end' }
  | { type: 'reco_shown'; taskId: string; source: 'rule' | 'ai' }
  | { type: 'session_start'; taskId: string; plannedMin: number }
  | { type: 'session_pause'; cause: PauseCause }
  /** credited: 자리 비움으로 멈췄던 구간을 "실제로는 일하고 있었다"며 인정한 재개(멈춘 시각으로 소급) */
  | { type: 'session_resume'; credited?: boolean }
  | { type: 'session_end'; taskId: string; reason: EndReason }
  | { type: 'checkin'; answer: CheckinAnswer }
  | {
      type: 'reflection'
      taskId: string
      output: string
      goalLink?: GoalLink
      cause?: StuckCause
    }
  | { type: 'task_add'; id: string; title: string; due?: number; size?: TaskSize }
  | {
      type: 'task_update'
      id: string
      title?: string
      due?: number | null
      size?: TaskSize | null
    }
  | { type: 'task_done'; id: string }
  | { type: 'task_delete'; id: string }
  | { type: 'heartbeat' }

export const EVENT_SCHEMA_VERSION = 1 as const

/** t: epoch ms, v: 스키마 버전 */
export type AppEvent = EventBody & { t: number; v: typeof EVENT_SCHEMA_VERSION }

export function makeEvent(body: EventBody, t: number): AppEvent {
  return { ...body, t, v: EVENT_SCHEMA_VERSION }
}

const EVENT_TYPES = new Set<string>([
  'day_start',
  'day_end',
  'break_start',
  'break_end',
  'reco_shown',
  'session_start',
  'session_pause',
  'session_resume',
  'session_end',
  'checkin',
  'reflection',
  'task_add',
  'task_update',
  'task_done',
  'task_delete',
  'heartbeat'
])

/** 파일에서 읽은 JSON이 최소한의 이벤트 형태인지 검사한다. */
export function isAppEvent(value: unknown): value is AppEvent {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.t === 'number' &&
    Number.isFinite(e.t) &&
    typeof e.type === 'string' &&
    EVENT_TYPES.has(e.type)
  )
}

export function sortByTime(events: readonly AppEvent[]): AppEvent[] {
  // Array.prototype.sort는 안정 정렬이므로 같은 t의 파일 순서는 유지된다.
  return [...events].sort((a, b) => a.t - b.t)
}
