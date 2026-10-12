// main ↔ renderer 계약. 타입과 채널 이름만 담는다(런타임 의존 없음).
import type { CheckinAnswer, GoalLink, StuckCause, TaskSize } from '../domain/events'
import type { RecoTask } from '../domain/recommender'
import type { SessionState } from '../domain/sessionMachine'
import type { Settings } from '../domain/settings'
import type { DayStats } from '../domain/stats'
import type { Task } from '../domain/tasks'

export interface RecoView {
  task: RecoTask
  firstStep: string
  reason: string
}

export interface AppSnapshot {
  /** main process 기준 현재 시각 (epoch ms) */
  now: number
  settings: Settings
  tasks: Task[]
  openTaskCount: number
  dayOpen: boolean
  breakOpen: boolean
  dayStartedAt: number | null
  session: SessionState
  /** 세션 중인 할 일 (회고 단계 포함) */
  sessionTask: Task | null
  reco: RecoView | null
  stats: DayStats
  /** 복구 안내 등 일회성 한 줄 메시지 */
  notice: string | null
}

export type Command =
  | { type: 'complete_onboarding'; goal: string; successTargetPct: number; dayStartTime: string }
  | { type: 'task_add'; title: string; due?: number; size?: TaskSize }
  | { type: 'task_done'; id: string }
  | { type: 'task_delete'; id: string }
  | { type: 'day_start' }
  | { type: 'day_end' }
  | { type: 'break_start' }
  | { type: 'break_end' }
  | { type: 'reco_request' }
  | { type: 'reco_reject' }
  | { type: 'session_start' }
  | { type: 'session_pause' }
  | { type: 'session_resume' }
  | { type: 'session_end'; reason: 'done' | 'manual' | 'timeout' }
  | { type: 'answer_checkin'; answer: CheckinAnswer }
  | { type: 'save_reflection'; output: string; goalLink?: GoalLink; cause?: StuckCause }
  | { type: 'dismiss_notice' }

export type CommandResult = { ok: true } | { ok: false; error: string }

/** 토스트 창에 표시할 내용. timeoutMs가 있으면 그 시간 뒤 자동으로 사라진다. */
export type ToastPayload =
  | { kind: 'checkin'; taskTitle: string; timeoutMs: number }
  | { kind: 'rescue'; level: 1 | 2; step: string; timeoutMs: number }
  | { kind: 'break'; minutes: number }
  | { kind: 'time_up'; plannedMin: number; timeoutMs: number }

/** 토스트 버튼이 main에 보내는 동작 */
export const TOAST_ACTIONS = [
  'ok', // 체크인: 진행 중
  'stuck', // 체크인: 막혔어요
  'dismiss', // 닫기 (막힘 대응 확인, 시간 종료 후 "조금 더")
  'start_break', // 휴식 시작
  'resume_session', // 휴식 제안을 거절하고 계속
  'finish_session' // 시간 종료 후 마무리
] as const
export type ToastAction = (typeof TOAST_ACTIONS)[number]

export const CHANNELS = {
  snapshot: 'app:snapshot',
  command: 'app:command',
  state: 'app:state',
  toastGet: 'toast:get',
  toastShow: 'toast:show',
  toastAction: 'toast:action'
} as const

/** preload가 window.api로 노출하는 표면 */
export interface RendererApi {
  getSnapshot(): Promise<AppSnapshot>
  command(cmd: Command): Promise<CommandResult>
  /** 상태 변경 푸시 구독. 반환값은 구독 해제 함수 */
  onState(listener: (snapshot: AppSnapshot) => void): () => void
  /** 토스트 창 전용: 현재 표시할 토스트 */
  getToast(): Promise<ToastPayload | null>
  onToast(listener: (payload: ToastPayload | null) => void): () => void
  toastAction(action: ToastAction): void
}
