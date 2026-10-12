// main ↔ renderer 계약. 타입과 채널 이름만 담는다(런타임 의존 없음).
import type { GoalLink, StuckCause, TaskSize } from '../domain/events'
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
  | { type: 'session_end'; reason: 'done' | 'manual' }
  | { type: 'save_reflection'; output: string; goalLink?: GoalLink; cause?: StuckCause }
  | { type: 'dismiss_notice' }

export type CommandResult = { ok: true } | { ok: false; error: string }

export const CHANNELS = {
  snapshot: 'app:snapshot',
  command: 'app:command',
  state: 'app:state'
} as const

/** preload가 window.api로 노출하는 표면 */
export interface RendererApi {
  getSnapshot(): Promise<AppSnapshot>
  command(cmd: Command): Promise<CommandResult>
  /** 상태 변경 푸시 구독. 반환값은 구독 해제 함수 */
  onState(listener: (snapshot: AppSnapshot) => void): () => void
}
