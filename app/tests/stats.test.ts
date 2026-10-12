import { describe, expect, it } from 'vitest'
import { makeEvent, type AppEvent, type EventBody } from '../src/domain/events'
import { computeStats } from '../src/domain/stats'

const MIN = 60_000
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime() // 로컬 09:00
const at = (min: number, body: EventBody): AppEvent => makeEvent(body, T0 + min * MIN)

describe('computeStats — 실질 작업비율', () => {
  it('세션 구간이 작업 시간, 하루 구간이 분모가 된다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(10, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(35, { type: 'session_end', taskId: 'a', reason: 'timeout' }),
      at(60, { type: 'day_end' })
    ]
    const s = computeStats(events, T0 + 120 * MIN)
    expect(s.workMs).toBe(25 * MIN)
    expect(s.availableMs).toBe(60 * MIN)
    expect(s.ratio).toBeCloseTo(25 / 60)
    expect(s.sessionCount).toBe(1)
  })

  it('일시정지 구간은 작업 시간에서 빠진다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(10, { type: 'session_pause', cause: 'user' }),
      at(20, { type: 'session_resume' }),
      at(25, { type: 'session_end', taskId: 'a', reason: 'done' }),
      at(60, { type: 'day_end' })
    ]
    expect(computeStats(events, T0 + 90 * MIN).workMs).toBe(15 * MIN)
  })

  it('절전(suspend)으로 정지된 구간도 빠진다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(5, { type: 'session_pause', cause: 'suspend' }),
      at(125, { type: 'session_resume' }),
      at(130, { type: 'session_end', taskId: 'a', reason: 'done' }),
      at(200, { type: 'day_end' })
    ]
    expect(computeStats(events, T0 + 300 * MIN).workMs).toBe(10 * MIN)
  })

  it('휴식 구간은 분모에서 빠진다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(60, { type: 'break_start' }),
      at(90, { type: 'break_end' }),
      at(120, { type: 'day_end' })
    ]
    const s = computeStats(events, T0 + 200 * MIN)
    expect(s.dayMs).toBe(120 * MIN)
    expect(s.breakMs).toBe(30 * MIN)
    expect(s.availableMs).toBe(90 * MIN)
  })

  it('하루 구간 밖의 휴식은 분모에 영향을 주지 않는다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(60, { type: 'day_end' }),
      at(70, { type: 'break_start' }),
      at(80, { type: 'break_end' })
    ]
    expect(computeStats(events, T0 + 100 * MIN).availableMs).toBe(60 * MIN)
  })

  it('열린 하루·세션은 now까지로 계산한다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(10, { type: 'session_start', taskId: 'a', plannedMin: 25 })
    ]
    const s = computeStats(events, T0 + 40 * MIN)
    expect(s.workMs).toBe(30 * MIN)
    expect(s.availableMs).toBe(40 * MIN)
  })

  it('하루 종료 시 열린 세션은 그 시각에 닫힌다', () => {
    const events = [
      at(0, { type: 'day_start' }),
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(30, { type: 'day_end' })
    ]
    const s = computeStats(events, T0 + 500 * MIN)
    expect(s.workMs).toBe(30 * MIN)
    expect(s.sessionCount).toBe(1)
  })

  it('하루가 없으면 비율은 0이다', () => {
    expect(computeStats([], T0).ratio).toBe(0)
  })

  it('파일 순서가 뒤섞여도 시간순으로 계산한다', () => {
    const events = [
      at(30, { type: 'session_end', taskId: 'a', reason: 'done' }),
      at(0, { type: 'day_start' }),
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(60, { type: 'day_end' })
    ]
    expect(computeStats(events, T0 + 90 * MIN).workMs).toBe(30 * MIN)
  })
})

describe('computeStats — 착수 지연·이탈', () => {
  it('첫 추천 표시부터 세션 시작까지를 착수 지연으로 센다 (거절 후 재추천 포함)', () => {
    const events = [
      at(0, { type: 'reco_shown', taskId: 'a', source: 'rule' }),
      at(2, { type: 'reco_shown', taskId: 'b', source: 'rule' }),
      at(6, { type: 'session_start', taskId: 'b', plannedMin: 25 }),
      at(31, { type: 'session_end', taskId: 'b', reason: 'timeout' }),
      at(40, { type: 'reco_shown', taskId: 'c', source: 'rule' }),
      at(42, { type: 'session_start', taskId: 'c', plannedMin: 25 })
    ]
    const s = computeStats(events, T0 + 100 * MIN)
    expect(s.startLatenciesMs).toEqual([6 * MIN, 2 * MIN])
    expect(s.medianStartLatencyMs).toBe(4 * MIN)
  })

  it('막혔어요 응답만 이탈로 센다', () => {
    const events = [
      at(0, { type: 'checkin', answer: 'ok' }),
      at(10, { type: 'checkin', answer: 'stuck' }),
      at(20, { type: 'checkin', answer: 'timeout' }),
      at(30, { type: 'checkin', answer: 'stuck' })
    ]
    expect(computeStats(events, T0 + 60 * MIN).stuckCount).toBe(2)
  })
})
