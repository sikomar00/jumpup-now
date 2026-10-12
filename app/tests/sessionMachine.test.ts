import { describe, expect, it } from 'vitest'
import {
  elapsedMs,
  initialSessionState,
  reduce,
  type SessionAction,
  type SessionState
} from '../src/domain/sessionMachine'

const MIN = 60_000
const T0 = 1_000_000_000_000

function run(state: SessionState, action: SessionAction, tMin: number) {
  return reduce(state, action, T0 + tMin * MIN)
}

const start = (s = initialSessionState()) =>
  run(s, { type: 'start', taskId: 'a', plannedMin: 25, checkinMin: 10 }, 0).state

describe('SessionMachine — 기본 전이', () => {
  it('idle에서만 시작할 수 있고 session_start 이벤트를 낸다', () => {
    const r = run(initialSessionState(), { type: 'start', taskId: 'a', plannedMin: 25, checkinMin: 10 }, 0)
    expect(r.state.phase).toBe('running')
    expect(r.events.map((e) => e.type)).toEqual(['session_start'])

    const again = run(r.state, { type: 'start', taskId: 'b', plannedMin: 25, checkinMin: 10 }, 1)
    expect(again.events).toEqual([])
    expect(again.state.taskId).toBe('a')
  })

  it('경과 시간은 정지 구간을 제외한 구간 합이다', () => {
    let s = start()
    s = run(s, { type: 'pause', cause: 'user' }, 10).state
    expect(elapsedMs(s, T0 + 50 * MIN)).toBe(10 * MIN)
    s = run(s, { type: 'resume' }, 60).state
    expect(elapsedMs(s, T0 + 65 * MIN)).toBe(15 * MIN)
  })

  it('일시정지 원인을 기억하고 재개·종료 시 지운다', () => {
    let s = start()
    s = run(s, { type: 'pause', cause: 'suspend' }, 5).state
    expect(s.pauseCause).toBe('suspend')
    expect(run(s, { type: 'resume' }, 9).state.pauseCause).toBeNull()
    expect(run(s, { type: 'end', reason: 'manual' }, 9).state.pauseCause).toBeNull()
    expect(start().pauseCause).toBeNull()
  })

  it('연속 막힘으로 정지되면 원인은 user다', () => {
    let s = start()
    for (const t of [10, 20, 30]) {
      s = run(s, { type: 'tick' }, t).state
      s = run(s, { type: 'answer_checkin', answer: 'stuck' }, t).state
    }
    expect(s.pauseCause).toBe('user')
  })

  it('잘못된 전이는 상태·이벤트를 바꾸지 않는다', () => {
    const idle = initialSessionState()
    expect(run(idle, { type: 'pause', cause: 'user' }, 0).events).toEqual([])
    expect(run(idle, { type: 'resume' }, 0).events).toEqual([])
    expect(run(idle, { type: 'end', reason: 'manual' }, 0).events).toEqual([])
    const running = start()
    expect(run(running, { type: 'resume' }, 1).events).toEqual([])
  })

  it('종료 → 회고 저장으로 idle에 돌아가고 회고 이벤트를 낸다', () => {
    let s = start()
    const ended = run(s, { type: 'end', reason: 'done' }, 25)
    s = ended.state
    expect(s.phase).toBe('reflecting')
    expect(ended.events.map((e) => e.type)).toEqual(['session_end'])
    expect(elapsedMs(s, T0 + 999 * MIN)).toBe(25 * MIN)

    const saved = run(s, { type: 'save_reflection', output: '개요 작성', goalLink: 'yes' }, 26)
    expect(saved.state.phase).toBe('idle')
    expect(saved.events[0]).toMatchObject({ type: 'reflection', taskId: 'a', output: '개요 작성', goalLink: 'yes' })
  })

  it('일시정지 중에도 종료할 수 있다', () => {
    let s = start()
    s = run(s, { type: 'pause', cause: 'suspend' }, 5).state
    const r = run(s, { type: 'end', reason: 'manual' }, 30)
    expect(r.state.phase).toBe('reflecting')
    expect(elapsedMs(r.state, T0 + 99 * MIN)).toBe(5 * MIN)
  })
})

describe('SessionMachine — tick(체크인·시간 종료)', () => {
  it('10분 경과 시 체크인을 한 번만 알린다', () => {
    const s = start()
    expect(run(s, { type: 'tick' }, 9).effects).toEqual([])
    const r = run(s, { type: 'tick' }, 10)
    expect(r.effects).toEqual([{ kind: 'checkin_due' }])
    expect(run(r.state, { type: 'tick' }, 11).effects).toEqual([])
  })

  it('체크인 응답 후 다음 체크인은 20분 시점이다', () => {
    let s = run(start(), { type: 'tick' }, 10).state
    s = run(s, { type: 'answer_checkin', answer: 'ok' }, 10).state
    expect(run(s, { type: 'tick' }, 19).effects).toEqual([])
    expect(run(s, { type: 'tick' }, 20).effects).toEqual([{ kind: 'checkin_due' }])
  })

  it('정지된 동안에는 체크인이 울리지 않는다', () => {
    let s = start()
    s = run(s, { type: 'pause', cause: 'user' }, 5).state
    expect(run(s, { type: 'tick' }, 100).effects).toEqual([])
  })

  it('계획 시간(25분)에 time_up을 한 번만 알린다', () => {
    let s = start()
    s = run(s, { type: 'tick' }, 10).state
    s = run(s, { type: 'answer_checkin', answer: 'ok' }, 10).state
    s = run(s, { type: 'tick' }, 20).state
    s = run(s, { type: 'answer_checkin', answer: 'ok' }, 20).state
    const r = run(s, { type: 'tick' }, 25)
    expect(r.effects).toContainEqual({ kind: 'time_up' })
    expect(run(r.state, { type: 'tick' }, 26).effects.some((e) => e.kind === 'time_up')).toBe(false)
  })
})

describe('SessionMachine — 자리 비움(무응답) 감지', () => {
  /** t분에 체크인이 울리게 틱을 돌린다 */
  const due = (s: SessionState, tMin: number) => run(s, { type: 'tick' }, tMin).state

  it('체크인 2번 연속 무응답이면 첫 무응답 시각으로 소급해 자리 비움 정지한다', () => {
    let s = due(start(), 10) // 10분에 첫 체크인
    s = run(s, { type: 'answer_checkin', answer: 'timeout' }, 10.5).state
    expect(s.phase).toBe('running') // 1번은 아직 정지하지 않는다
    s = due(s, 20) // 20분에 두 번째 체크인
    const r = run(s, { type: 'answer_checkin', answer: 'timeout' }, 20.5)

    expect(r.state.phase).toBe('paused')
    expect(r.state.pauseCause).toBe('idle')
    expect(elapsedMs(r.state, T0 + 999 * MIN)).toBe(10 * MIN) // 첫 무응답이 울린 10분까지만
    const pause = r.events.find((e) => e.type === 'session_pause')!
    expect(pause).toMatchObject({ cause: 'idle', t: T0 + 10 * MIN })
    expect(r.effects).toEqual([{ kind: 'idle_pause', since: T0 + 10 * MIN, reason: 'checkin' }])
  })

  it('무응답 사이에 응답이 있으면 연속이 끊긴다 (진행 중·막혔어요 모두)', () => {
    for (const answer of ['ok', 'stuck'] as const) {
      let s = due(start(), 10)
      s = run(s, { type: 'answer_checkin', answer: 'timeout' }, 10.5).state
      s = due(s, 20)
      s = run(s, { type: 'answer_checkin', answer }, 20.2).state
      s = due(s, 30)
      const r = run(s, { type: 'answer_checkin', answer: 'timeout' }, 30.5)
      expect(r.state.phase).toBe('running') // 다시 1번째 무응답일 뿐
      expect(r.state.timeoutStreak).toBe(1)
    }
  })

  it('사용자가 직접 정지한 상태의 무응답은 자리 비움으로 세지 않는다', () => {
    let s = due(start(), 10)
    s = run(s, { type: 'pause', cause: 'user' }, 11).state
    const r = run(s, { type: 'answer_checkin', answer: 'timeout' }, 12)
    expect(r.state.timeoutStreak).toBe(0)
    expect(r.effects).toEqual([])
  })

  it('시간 종료 알림을 아무도 받지 않으면 알림이 울린 계획 시간 시점으로 소급해 정지한다', () => {
    let s = start()
    for (const m of [10, 20]) {
      s = due(s, m)
      s = run(s, { type: 'answer_checkin', answer: 'ok' }, m + 0.1).state
    }
    s = due(s, 25) // 25분 시간 종료
    expect(s.timeUpAt).toBe(T0 + 25 * MIN)
    const r = run(s, { type: 'time_up_expired' }, 26)
    expect(r.state.pauseCause).toBe('idle')
    expect(elapsedMs(r.state, T0 + 999 * MIN)).toBe(25 * MIN)
    expect(r.effects).toEqual([{ kind: 'idle_pause', since: T0 + 25 * MIN, reason: 'time_up' }])
  })

  it('time_up_expired는 실행 중이 아니거나 시간 종료 전이면 무시한다', () => {
    expect(run(start(), { type: 'time_up_expired' }, 5).events).toEqual([]) // 아직 25분 전
    expect(run(initialSessionState(), { type: 'time_up_expired' }, 5).events).toEqual([])
  })

  function idlePausedAt10() {
    let s = due(start(), 10)
    s = run(s, { type: 'answer_checkin', answer: 'timeout' }, 10.5).state
    s = due(s, 20)
    return run(s, { type: 'answer_checkin', answer: 'timeout' }, 20.5).state // 10분으로 소급 정지됨
  }

  it('"계속 일하고 있었어요"(credit)로 이어가면 멈춘 구간을 작업 시간으로 인정한다', () => {
    const paused = idlePausedAt10()
    const r = run(paused, { type: 'resume', credit: true }, 40)
    expect(r.state.phase).toBe('running')
    expect(r.state.pauseCause).toBeNull()
    expect(elapsedMs(r.state, T0 + 40 * MIN)).toBe(40 * MIN) // 정지가 없었던 것처럼
    expect(r.events[0]).toMatchObject({ type: 'session_resume', credited: true, t: T0 + 10 * MIN })
  })

  it('그냥 이어가기는 멈춘 구간을 인정하지 않는다', () => {
    const r = run(idlePausedAt10(), { type: 'resume' }, 40)
    expect(elapsedMs(r.state, T0 + 40 * MIN)).toBe(10 * MIN)
    expect(r.events[0]).toMatchObject({ type: 'session_resume', t: T0 + 40 * MIN })
    expect((r.events[0] as { credited?: boolean }).credited).toBeUndefined()
  })

  it('자리 비움이 아닌 정지에 credit을 줘도 일반 재개로 동작한다', () => {
    const s = run(start(), { type: 'pause', cause: 'user' }, 5).state
    const r = run(s, { type: 'resume', credit: true }, 30)
    expect(elapsedMs(r.state, T0 + 30 * MIN)).toBe(5 * MIN)
  })

  it('재개하면 무응답 연속 카운터가 초기화된다', () => {
    const r = run(idlePausedAt10(), { type: 'resume' }, 40)
    expect(r.state).toMatchObject({ timeoutStreak: 0, idleSince: null, idlePausedAt: null })
  })

  it('abort: 회고 없이 지정 시각에 recovered로 세션을 끝내고 idle로 돌아간다', () => {
    const r = run(start(), { type: 'abort', at: T0 + 7 * MIN }, 50)
    expect(r.state.phase).toBe('idle')
    expect(r.events[0]).toMatchObject({ type: 'session_end', reason: 'recovered', t: T0 + 7 * MIN })
    expect(run(initialSessionState(), { type: 'abort', at: T0 }, 1).events).toEqual([])
  })
})

describe('SessionMachine — 막힘 대응', () => {
  const askAt = (s: SessionState, tMin: number) => run(s, { type: 'tick' }, tMin).state

  it('막혔어요 1·2회는 rescue 단계 1·2를 낸다', () => {
    let s = askAt(start(), 10)
    const r1 = run(s, { type: 'answer_checkin', answer: 'stuck' }, 10)
    expect(r1.effects).toEqual([{ kind: 'rescue', level: 1 }])
    s = askAt(r1.state, 20)
    const r2 = run(s, { type: 'answer_checkin', answer: 'stuck' }, 20)
    expect(r2.effects).toEqual([{ kind: 'rescue', level: 2 }])
  })

  it('3회 연속이면 휴식을 제안하고 세션을 일시정지한다', () => {
    let s = start()
    let last = null as ReturnType<typeof run> | null
    for (const t of [10, 20, 30]) {
      s = askAt(s, t)
      last = run(s, { type: 'answer_checkin', answer: 'stuck' }, t)
      s = last.state
    }
    expect(last!.effects).toEqual([{ kind: 'suggest_break' }])
    expect(last!.events.map((e) => e.type)).toEqual(['checkin', 'session_pause'])
    expect(s.phase).toBe('paused')
    expect(s.stuckStreak).toBe(0)
  })

  it('진행 중 응답은 연속 카운터를 초기화한다', () => {
    let s = askAt(start(), 10)
    s = run(s, { type: 'answer_checkin', answer: 'stuck' }, 10).state
    s = askAt(s, 20)
    s = run(s, { type: 'answer_checkin', answer: 'ok' }, 20).state
    expect(s.stuckStreak).toBe(0)
  })

  it('연속 카운터는 세션 종료·회고·다음 세션 시작을 지나도 유지되고 reset_streak로만 비워진다', () => {
    let s = askAt(start(), 10)
    s = run(s, { type: 'answer_checkin', answer: 'stuck' }, 10).state
    s = run(s, { type: 'end', reason: 'manual' }, 11).state
    s = run(s, { type: 'save_reflection', output: '' }, 12).state
    expect(s.phase).toBe('idle')
    expect(s.stuckStreak).toBe(1)
    s = run(s, { type: 'start', taskId: 'b', plannedMin: 25, checkinMin: 10 }, 13).state
    expect(s.stuckStreak).toBe(1)
    s = run(s, { type: 'end', reason: 'manual' }, 14).state
    s = run(s, { type: 'save_reflection', output: '' }, 15).state
    expect(run(s, { type: 'reset_streak' }, 16).state.stuckStreak).toBe(0)
  })

  it('응답 시간 초과(timeout)는 연속 카운터를 바꾸지 않는다', () => {
    let s = askAt(start(), 10)
    s = run(s, { type: 'answer_checkin', answer: 'stuck' }, 10).state
    s = askAt(s, 20)
    s = run(s, { type: 'answer_checkin', answer: 'timeout' }, 20).state
    expect(s.stuckStreak).toBe(1)
  })

  it('체크인이 대기 중이 아니면 응답을 무시한다', () => {
    const r = run(start(), { type: 'answer_checkin', answer: 'stuck' }, 3)
    expect(r.events).toEqual([])
  })
})
