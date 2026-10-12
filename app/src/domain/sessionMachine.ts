// 세션 상태 머신. 순수 함수 reduce(state, action, now) → { state, events, effects }.
// 시간은 항상 인자로 받으며, 경과 시간은 타임스탬프 구간 합으로 계산한다. (기술설계.md §5.1)
import {
  makeEvent,
  type AppEvent,
  type CheckinAnswer,
  type EventBody,
  type GoalLink,
  type PauseCause,
  type StuckCause
} from './events'

export const STUCK_STREAK_FOR_BREAK = 3
/**
 * 체크인에 연속으로 이만큼 응답하지 않으면 자리를 비운 것으로 보고, 첫 무응답 시각으로 소급해 정지한다.
 * 체크인 간격이 10분이면 마지막으로 확인된 시점 이후 최대 약 10분이 과대 계상될 수 있다.
 */
export const IDLE_TIMEOUTS_FOR_PAUSE = 2

export interface SessionState {
  phase: 'idle' | 'running' | 'paused' | 'reflecting'
  /** paused일 때만 값이 있다. 절전·유휴로 멈췄는지 사용자가 멈췄는지 UI가 구분한다. */
  pauseCause: PauseCause | null
  taskId: string | null
  plannedMin: number
  /** 현재 구간 이전까지 누적된 작업 시간 */
  activeMs: number
  /** 현재 running 구간의 시작 시각 */
  segmentStart: number | null
  checkinMs: number
  /** 다음 체크인이 울릴 누적 작업 시간 */
  nextCheckinMs: number
  checkinPending: boolean
  /** 현재 응답 대기 중인 체크인이 울린 시각 */
  checkinDueAt: number | null
  timeUpNotified: boolean
  /** 시간 종료 알림이 울린 시각 */
  timeUpAt: number | null
  stuckStreak: number
  /** 연속 무응답 체크인 수 */
  timeoutStreak: number
  /** 연속 무응답이 시작된(첫 무응답 체크인이 울린) 시각 */
  idleSince: number | null
  /** 자리 비움으로 소급 정지한 시각. "시간 인정" 재개에 쓴다. */
  idlePausedAt: number | null
}

export type SessionAction =
  | { type: 'start'; taskId: string; plannedMin: number; checkinMin: number }
  | { type: 'pause'; cause: PauseCause }
  /** credit: 자리 비움 정지 구간을 작업 시간으로 인정하고 이어간다 */
  | { type: 'resume'; credit?: boolean }
  | { type: 'tick' }
  /** 시간 종료 알림에 아무도 응답하지 않았다 → 계획 시간 시점으로 소급 정지 */
  | { type: 'time_up_expired' }
  /** 회고 없이 세션을 버린다(하루 경계를 넘긴 공백 등). at 시각에 recovered로 종료한다. */
  | { type: 'abort'; at: number }
  | { type: 'answer_checkin'; answer: CheckinAnswer }
  | { type: 'end'; reason: 'done' | 'timeout' | 'manual' }
  | { type: 'save_reflection'; output: string; goalLink?: GoalLink; cause?: StuckCause }
  /** 새 하루 시작 등으로 연속 막힘 카운터를 비운다. */
  | { type: 'reset_streak' }

export type SessionEffect =
  | { kind: 'checkin_due' }
  | { kind: 'time_up' }
  | { kind: 'rescue'; level: 1 | 2 }
  | { kind: 'suggest_break' }
  /** 자리를 비운 것으로 보고 since 시각으로 소급해 세션을 멈췄다 */
  | { kind: 'idle_pause'; since: number; reason: 'checkin' | 'time_up' }

export interface ReduceResult {
  state: SessionState
  events: AppEvent[]
  effects: SessionEffect[]
}

export function initialSessionState(): SessionState {
  return {
    phase: 'idle',
    pauseCause: null,
    taskId: null,
    plannedMin: 0,
    activeMs: 0,
    segmentStart: null,
    checkinMs: 0,
    nextCheckinMs: 0,
    checkinPending: false,
    checkinDueAt: null,
    timeUpNotified: false,
    timeUpAt: null,
    stuckStreak: 0,
    timeoutStreak: 0,
    idleSince: null,
    idlePausedAt: null
  }
}

/** since 시각으로 소급해 자리 비움 정지 상태로 만든다. 그 시각까지의 작업 시간만 남긴다. */
function idlePaused(state: SessionState, since: number): SessionState {
  return {
    ...state,
    phase: 'paused',
    pauseCause: 'idle',
    activeMs: elapsedMs(state, since),
    segmentStart: null,
    checkinPending: false,
    timeoutStreak: 0,
    idleSince: null,
    idlePausedAt: since
  }
}

/** 현재까지의 누적 작업 시간 */
export function elapsedMs(state: SessionState, now: number): number {
  if (state.phase === 'running' && state.segmentStart !== null) {
    return state.activeMs + Math.max(0, now - state.segmentStart)
  }
  return state.activeMs
}

const none = (state: SessionState): ReduceResult => ({ state, events: [], effects: [] })

export function reduce(state: SessionState, action: SessionAction, now: number): ReduceResult {
  const ev = (body: EventBody): AppEvent => makeEvent(body, now)

  switch (action.type) {
    case 'start': {
      if (state.phase !== 'idle') return none(state)
      const checkinMs = action.checkinMin * 60_000
      return {
        state: {
          ...initialSessionState(),
          // 25분 세션에 10분 체크인이면 한 세션의 체크인은 2번뿐이라, "연속 막힘"은 세션을 넘어 센다.
          stuckStreak: state.stuckStreak,
          phase: 'running',
          taskId: action.taskId,
          plannedMin: action.plannedMin,
          segmentStart: now,
          checkinMs,
          nextCheckinMs: checkinMs
        },
        events: [
          ev({ type: 'session_start', taskId: action.taskId, plannedMin: action.plannedMin })
        ],
        effects: []
      }
    }

    case 'pause': {
      if (state.phase !== 'running') return none(state)
      return {
        state: {
          ...state,
          phase: 'paused',
          pauseCause: action.cause,
          activeMs: elapsedMs(state, now),
          segmentStart: null
        },
        events: [ev({ type: 'session_pause', cause: action.cause })],
        effects: []
      }
    }

    case 'resume': {
      if (state.phase !== 'paused') return none(state)
      const cleared = { pauseCause: null, timeoutStreak: 0, idleSince: null, idlePausedAt: null }
      if (action.credit && state.idlePausedAt !== null) {
        // 멈춘 시각으로 소급해 이어간다: 정지~지금 구간을 작업 시간으로 인정한다.
        const from = state.idlePausedAt
        return {
          state: { ...state, ...cleared, phase: 'running', segmentStart: from },
          events: [makeEvent({ type: 'session_resume', credited: true }, from)],
          effects: []
        }
      }
      return {
        state: { ...state, ...cleared, phase: 'running', segmentStart: now },
        events: [ev({ type: 'session_resume' })],
        effects: []
      }
    }

    case 'tick': {
      if (state.phase !== 'running') return none(state)
      const elapsed = elapsedMs(state, now)
      let next = state
      const effects: SessionEffect[] = []
      if (!state.checkinPending && elapsed >= state.nextCheckinMs) {
        // 체크인 응답을 기다리는 동안 타이머는 계속 흐른다.
        next = {
          ...next,
          checkinPending: true,
          checkinDueAt: now,
          nextCheckinMs: state.nextCheckinMs + state.checkinMs
        }
        effects.push({ kind: 'checkin_due' })
      }
      if (!state.timeUpNotified && elapsed >= state.plannedMin * 60_000) {
        next = { ...next, timeUpNotified: true, timeUpAt: now }
        effects.push({ kind: 'time_up' })
      }
      return { state: next, events: [], effects }
    }

    case 'time_up_expired': {
      if (state.phase !== 'running' || state.timeUpAt === null) return none(state)
      const since = state.timeUpAt
      return {
        state: idlePaused(state, since),
        events: [makeEvent({ type: 'session_pause', cause: 'idle' }, since)],
        effects: [{ kind: 'idle_pause', since, reason: 'time_up' }]
      }
    }

    case 'abort': {
      if ((state.phase !== 'running' && state.phase !== 'paused') || state.taskId === null) {
        return none(state)
      }
      return {
        state: { ...initialSessionState(), stuckStreak: state.stuckStreak },
        events: [makeEvent({ type: 'session_end', taskId: state.taskId, reason: 'recovered' }, action.at)],
        effects: []
      }
    }

    case 'answer_checkin': {
      if ((state.phase !== 'running' && state.phase !== 'paused') || !state.checkinPending) {
        return none(state)
      }
      const events: AppEvent[] = [ev({ type: 'checkin', answer: action.answer })]
      let next: SessionState = { ...state, checkinPending: false }
      const effects: SessionEffect[] = []

      if (action.answer === 'ok') {
        next = { ...next, stuckStreak: 0, timeoutStreak: 0, idleSince: null }
      } else if (action.answer === 'stuck') {
        next = { ...next, timeoutStreak: 0, idleSince: null }
        const streak = state.stuckStreak + 1
        if (streak >= STUCK_STREAK_FOR_BREAK) {
          // 연속 막힘: 휴식을 제안하고 세션을 일시정지한다. 카운터는 휴식 후 다시 센다.
          next = { ...next, stuckStreak: 0 }
          if (state.phase === 'running') {
            next = {
              ...next,
              phase: 'paused',
              pauseCause: 'user',
              activeMs: elapsedMs(state, now),
              segmentStart: null
            }
            events.push(ev({ type: 'session_pause', cause: 'user' }))
          }
          effects.push({ kind: 'suggest_break' })
        } else {
          next = { ...next, stuckStreak: streak }
          effects.push({ kind: 'rescue', level: streak as 1 | 2 })
        }
      } else if (state.phase === 'running') {
        // 'timeout'은 응답 없음: 연속 막힘 카운터는 건드리지 않되, 연속 무응답이 쌓이면 자리를 비운 것으로 본다.
        const timeouts = state.timeoutStreak + 1
        const since = state.idleSince ?? state.checkinDueAt ?? now
        if (timeouts >= IDLE_TIMEOUTS_FOR_PAUSE) {
          next = idlePaused(next, since)
          events.push(makeEvent({ type: 'session_pause', cause: 'idle' }, since))
          effects.push({ kind: 'idle_pause', since, reason: 'checkin' })
        } else {
          next = { ...next, timeoutStreak: timeouts, idleSince: since }
        }
      }
      return { state: next, events, effects }
    }

    case 'end': {
      if ((state.phase !== 'running' && state.phase !== 'paused') || state.taskId === null) {
        return none(state)
      }
      return {
        state: {
          ...state,
          phase: 'reflecting',
          pauseCause: null,
          activeMs: elapsedMs(state, now),
          segmentStart: null,
          checkinPending: false
        },
        events: [ev({ type: 'session_end', taskId: state.taskId, reason: action.reason })],
        effects: []
      }
    }

    case 'save_reflection': {
      if (state.phase !== 'reflecting' || state.taskId === null) return none(state)
      const body: EventBody = {
        type: 'reflection',
        taskId: state.taskId,
        output: action.output,
        ...(action.goalLink ? { goalLink: action.goalLink } : {}),
        ...(action.cause ? { cause: action.cause } : {})
      }
      return {
        state: { ...initialSessionState(), stuckStreak: state.stuckStreak },
        events: [ev(body)],
        effects: []
      }
    }

    case 'reset_streak':
      return state.stuckStreak === 0 ? none(state) : { state: { ...state, stuckStreak: 0 }, events: [], effects: [] }
  }
}
