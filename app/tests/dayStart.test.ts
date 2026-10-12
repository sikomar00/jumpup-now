import { describe, expect, it } from 'vitest'
import {
  LATE_AFTER_MS,
  PROMPT_WINDOW_MS,
  dateKey,
  dayStartPrompt,
  todayAt,
  type DayStartPromptInput
} from '../src/domain/dayStart'

const MIN = 60_000
const T = new Date(2026, 9, 12, 12, 0, 0).getTime() // 로컬 10/12 12:00
const at = (h: number, m = 0): number => new Date(2026, 9, 12, h, m, 0).getTime()

const base: DayStartPromptInput = {
  now: at(9, 0),
  dayStartTime: '09:00',
  dayOpen: false,
  startedToday: false,
  promptedOn: null,
  snoozeUntil: null
}

describe('dayStartPrompt', () => {
  it('지정 시각 전에는 알리지 않는다', () => {
    expect(dayStartPrompt({ ...base, now: at(8, 59) }).due).toBe(false)
  })

  it('지정 시각이 되면 알린다 (늦지 않음)', () => {
    expect(dayStartPrompt(base)).toEqual({ due: true, late: false })
  })

  it('5분 이상 지났으면 "늦었다"로 표시한다 (앱을 늦게 켠 경우)', () => {
    expect(dayStartPrompt({ ...base, now: at(9, 0) + LATE_AFTER_MS })).toEqual({ due: true, late: true })
    expect(dayStartPrompt({ ...base, now: at(9, 0) + LATE_AFTER_MS - 1 }).late).toBe(false)
  })

  it('이미 하루가 열렸거나 오늘 시작한 적이 있으면 알리지 않는다 (종료 후 재촉 금지)', () => {
    expect(dayStartPrompt({ ...base, dayOpen: true }).due).toBe(false)
    expect(dayStartPrompt({ ...base, startedToday: true }).due).toBe(false)
  })

  it('오늘 이미 알렸으면 다시 알리지 않는다', () => {
    expect(dayStartPrompt({ ...base, promptedOn: dateKey(base.now) }).due).toBe(false)
    // 어제 알린 기록은 영향이 없다
    expect(dayStartPrompt({ ...base, promptedOn: dateKey(base.now - 24 * 60 * MIN) }).due).toBe(true)
  })

  it('지정 시각 8시간이 지나면 더 이상 재촉하지 않는다', () => {
    expect(dayStartPrompt({ ...base, now: at(9, 0) + PROMPT_WINDOW_MS }).due).toBe(true)
    expect(dayStartPrompt({ ...base, now: at(9, 0) + PROMPT_WINDOW_MS + 1 }).due).toBe(false)
  })

  it('미루기(snooze): 시각 전에는 조용하고, 지나면 이미 알렸어도 다시 알린다', () => {
    const snoozeUntil = at(9, 10)
    const snoozed = { ...base, promptedOn: dateKey(base.now), snoozeUntil }
    expect(dayStartPrompt({ ...snoozed, now: at(9, 9) }).due).toBe(false)
    expect(dayStartPrompt({ ...snoozed, now: at(9, 10) }).due).toBe(true)
  })
})

describe('todayAt / dateKey', () => {
  it('오늘 날짜의 HH:MM 시각을 만든다', () => {
    expect(todayAt(T, '09:30')).toBe(at(9, 30))
    expect(todayAt(T, '00:00')).toBe(at(0, 0))
  })

  it('날짜 키는 날이 바뀌면 달라진다', () => {
    expect(dateKey(at(23, 59))).toBe(dateKey(at(0, 1)))
    expect(dateKey(at(23, 59))).not.toBe(dateKey(at(23, 59) + 2 * MIN))
  })
})
