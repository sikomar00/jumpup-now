import { describe, expect, it } from 'vitest'
import { makeEvent, type AppEvent, type EventBody } from '../src/domain/events'
import { MIN_USABLE_DAY_MS, baselineOf, summarizeByDay } from '../src/domain/report'

const MIN = 60_000
const day = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m, 0).getTime()
const ev = (t: number, body: EventBody): AppEvent => makeEvent(body, t)

/** d일 09:00 시작, 작업 workMin분, 총 dayMin분 */
function workday(d: number, dayMin: number, workMin: number, extra: AppEvent[] = []): AppEvent[] {
  const start = day(d, 9)
  return [
    ev(start, { type: 'day_start' }),
    ev(start + 1 * MIN, { type: 'reco_shown', taskId: 'a', source: 'rule' }),
    ev(start + 3 * MIN, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
    ev(start + 3 * MIN + workMin * MIN, { type: 'session_end', taskId: 'a', reason: 'manual' }),
    ...extra,
    ev(start + dayMin * MIN, { type: 'day_end' })
  ]
}

describe('summarizeByDay', () => {
  it('날짜별로 나눠 실질 작업비율을 계산한다', () => {
    const events = [...workday(10, 480, 120), ...workday(11, 400, 200)]
    const days = summarizeByDay(events, day(12, 0))
    expect(days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11'])
    expect(days[0]!.stats.ratio).toBeCloseTo(120 / 480)
    expect(days[1]!.stats.ratio).toBeCloseTo(200 / 400)
    expect(days[0]!.stats.medianStartLatencyMs).toBe(2 * MIN)
  })

  it('하루 시작이 없는 날(heartbeat만 있는 날)은 제외한다', () => {
    const events = [...workday(10, 480, 120), ev(day(11, 10), { type: 'heartbeat' })]
    expect(summarizeByDay(events, day(12, 0)).map((d) => d.date)).toEqual(['2026-10-10'])
  })

  it('목표 연결 평가를 센다', () => {
    const extra = [
      ev(day(10, 12), { type: 'reflection', taskId: 'a', output: '', goalLink: 'yes' }),
      ev(day(10, 13), { type: 'reflection', taskId: 'a', output: '', goalLink: 'no' }),
      ev(day(10, 14), { type: 'reflection', taskId: 'a', output: '' })
    ]
    const [d] = summarizeByDay(workday(10, 480, 120, extra), day(12, 0))
    expect([d!.goalYes, d!.goalRated]).toEqual([1, 2])
  })

  it('종료하지 않은 오늘은 지금까지로 센다', () => {
    const events = [ev(day(10, 9), { type: 'day_start' })]
    const [d] = summarizeByDay(events, day(10, 11))
    expect(d!.stats.availableMs).toBe(120 * MIN)
  })

  it('30분 미만 측정된 날은 기준선에 쓰지 않는 날로 표시한다', () => {
    const [short, long] = summarizeByDay([...workday(10, 20, 5), ...workday(11, 400, 100)], day(12, 0))
    expect(short!.usable).toBe(false)
    expect(long!.usable).toBe(true)
    expect(20 * MIN).toBeLessThan(MIN_USABLE_DAY_MS)
  })
})

describe('baselineOf', () => {
  it('사용 가능한 날만으로 중앙값·평균·합계를 계산한다', () => {
    const stuck = (n: number): AppEvent[] => Array.from({ length: n }, (_, i) => ev(day(10, 10, i), { type: 'checkin', answer: 'stuck' }))
    const events = [
      ...workday(10, 480, 96, stuck(2)), // 20%
      ...workday(11, 400, 160), // 40%
      ...workday(12, 400, 200), // 50%
      ...workday(13, 10, 5) // 측정 10분: 제외
    ]
    const b = baselineOf(summarizeByDay(events, day(14, 0)))
    expect(b.days).toBe(4)
    expect(b.usableDays).toBe(3)
    expect(b.medianRatio).toBeCloseTo(0.4)
    expect(b.meanRatio).toBeCloseTo((0.2 + 0.4 + 0.5) / 3)
    expect(b.totalStuck).toBe(2)
    expect(b.totalSessions).toBe(3)
  })

  it('데이터가 없으면 null이다', () => {
    expect(baselineOf([])).toMatchObject({ days: 0, usableDays: 0, medianRatio: null, meanRatio: null })
  })
})
