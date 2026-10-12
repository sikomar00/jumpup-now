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

export interface SessionState {
  phase: 'idle' | 'running' | 'paused' | 'reflecting'
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
  timeUpNotified: boolean
  stuckStreak: number
}

export type SessionAction =
  | { type: 'start'; taskId: string; plannedMin: number; checkinMin: number }
  | { type: 'pause'; cause: PauseCause }
  | { type: 'resume' }
  | { type: 'tick' }
  | { type: 'answer_checkin'; answer: CheckinAnswer }
  | { type: 'end'; reason: 'done' | 'timeout' | 'manual' }
  | { type: 'save_reflection'; output: string; goalLink?: GoalLink; cause?: StuckCause }

export type SessionEffect =
  | { kind: 'checkin_due' }
  | { kind: 'time_up' }
  | { kind: 'rescue'; level: 1 | 2 }
  | { kind: 'suggest_break' }

export interface ReduceResult {
  state: SessionState
  events: AppEvent[]
  effects: SessionEffect[]
}

export function initialSessionState(): SessionState {
  return {
    phase: 'idle',
    taskId: null,
    plannedMin: 0,
    activeMs: 0,
    segmentStart: null,
    checkinMs: 0,
    nextCheckinMs: 0,
    checkinPending: false,
    timeUpNotified: false,
    stuckStreak: 0
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
        state: { ...state, phase: 'paused', activeMs: elapsedMs(state, now), segmentStart: null },
        events: [ev({ type: 'session_pause', cause: action.cause })],
        effects: []
      }
    }

    case 'resume': {
      if (state.phase !== 'paused') return none(state)
      return {
        state: { ...state, phase: 'running', segmentStart: now },
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
        next = { ...next, checkinPending: true, nextCheckinMs: state.nextCheckinMs + state.checkinMs }
        effects.push({ kind: 'checkin_due' })
      }
      if (!state.timeUpNotified && elapsed >= state.plannedMin * 60_000) {
        next = { ...next, timeUpNotified: true }
        effects.push({ kind: 'time_up' })
      }
      return { state: next, events: [], effects }
    }

    case 'answer_checkin': {
      if ((state.phase !== 'running' && state.phase !== 'paused') || !state.checkinPending) {
        return none(state)
      }
      const events: AppEvent[] = [ev({ type: 'checkin', answer: action.answer })]
      let next: SessionState = { ...state, checkinPending: false }
      const effects: SessionEffect[] = []

      if (action.answer === 'ok') {
        next = { ...next, stuckStreak: 0 }
      } else if (action.answer === 'stuck') {
        const streak = state.stuckStreak + 1
        if (streak >= STUCK_STREAK_FOR_BREAK) {
          // 연속 막힘: 휴식을 제안하고 세션을 일시정지한다. 카운터는 휴식 후 다시 센다.
          next = { ...next, stuckStreak: 0 }
          if (state.phase === 'running') {
            next = { ...next, phase: 'paused', activeMs: elapsedMs(state, now), segmentStart: null }
            events.push(ev({ type: 'session_pause', cause: 'user' }))
          }
          effects.push({ kind: 'suggest_break' })
        } else {
          next = { ...next, stuckStreak: streak }
          effects.push({ kind: 'rescue', level: streak as 1 | 2 })
        }
      }
      // 'timeout'은 응답 없음이므로 연속 막힘 카운터를 건드리지 않는다.
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
      return { state: initialSessionState(), events: [ev(body)], effects: [] }
    }
  }
}
