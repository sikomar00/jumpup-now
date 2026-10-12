import { describe, expect, it } from 'vitest'
import { makeEvent, type AppEvent, type EventBody } from '../src/domain/events'
import { GAP_THRESHOLD_MS, recoverEvents } from '../src/domain/recovery'
import { computeStats } from '../src/domain/stats'

const MIN = 60_000
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime()
const at = (min: number, body: EventBody): AppEvent => makeEvent(body, T0 + min * MIN)

describe('recoverEvents', () => {
  it('빈 로그나 최근 활동이 있으면 아무것도 하지 않는다', () => {
    expect(recoverEvents([], T0).events).toEqual([])
    const events = [at(0, { type: 'day_start' }), at(1, { type: 'heartbeat' })]
    expect(recoverEvents(events, T0 + 1 * MIN + GAP_THRESHOLD_MS).events).toEqual([])
  })

  it('정상 종료된 하루는 건드리지 않는다', () => {
    const events = [at(0, { type: 'day_start' }), at(60, { type: 'day_end' })]
    expect(recoverEvents(events, T0 + 600 * MIN)).toEqual({ events: [], notice: null })
  })

  it('열린 세션을 마지막 heartbeat 시각에 recovered로 닫는다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(5, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(17, { type: 'heartbeat' })
    ]
    const r = recoverEvents(events, T0 + 60 * MIN)
    const end = r.events.find((e) => e.type === 'session_end')
    expect(end).toMatchObject({ type: 'session_end', taskId: 'a', reason: 'recovered', t: T0 + 17 * MIN })
    expect(r.notice).toContain('09:17')
  })

  it('같은 날 재실행이면 꺼져 있던 시간을 휴식으로 처리해 분모에서 뺀다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(5, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(15, { type: 'heartbeat' })
    ]
    const now = T0 + 135 * MIN // 2시간 뒤 재실행
    const recovered = [...events, ...recoverEvents(events, now).events]
    const s = computeStats(recovered, now)
    expect(s.workMs).toBe(10 * MIN) // 09:05~09:15
    expect(s.breakMs).toBe(120 * MIN) // 꺼져 있던 09:15~11:15
    expect(s.availableMs).toBe(15 * MIN) // 하루 135분 − 120분
  })

  it('날짜가 바뀌었으면 마지막 활동 시각에 하루를 닫는다', () => {
    const events = [at(0, { type: 'day_start' }), at(300, { type: 'heartbeat' })]
    const tomorrow = new Date(2026, 9, 13, 9, 0).getTime()
    const r = recoverEvents(events, tomorrow)
    expect(r.events).toEqual([expect.objectContaining({ type: 'day_end', t: T0 + 300 * MIN })])
    const s = computeStats([...events, ...r.events], tomorrow)
    expect(s.dayMs).toBe(300 * MIN)
  })

  it('열린 휴식도 닫는다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(10, { type: 'break_start' }),
      at(12, { type: 'heartbeat' })
    ]
    const r = recoverEvents(events, T0 + 100 * MIN)
    expect(r.events.map((e) => e.type)).toEqual(['break_end', 'break_start', 'break_end'])
  })

  it('보정 이벤트는 t 오름차순이다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(5, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(15, { type: 'heartbeat' })
    ]
    const ts = recoverEvents(events, T0 + 200 * MIN).events.map((e) => e.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })
})
