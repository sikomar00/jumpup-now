import { describe, expect, it } from 'vitest'
import { initialSessionState } from '../src/domain/sessionMachine'
import { DEFAULT_SETTINGS } from '../src/domain/settings'
import type { AppSnapshot, ToastPayload } from '../src/shared/ipc'
import {
  CHECKIN_TIMEOUT_MS,
  MIN_TOAST_MS,
  isToastStale,
  toastFor
} from '../src/main/toastPayload'

function snap(over: {
  phase?: AppSnapshot['session']['phase']
  checkinPending?: boolean
  breakOpen?: boolean
  title?: string
}): AppSnapshot {
  return {
    now: 0,
    settings: { ...DEFAULT_SETTINGS, sessionMin: 25 },
    tasks: [],
    openTaskCount: 0,
    dayOpen: true,
    breakOpen: over.breakOpen ?? false,
    dayStartedAt: 0,
    session: {
      ...initialSessionState(),
      phase: over.phase ?? 'running',
      checkinPending: over.checkinPending ?? false
    },
    sessionTask: over.title ? { id: 'a', title: over.title, done: false, createdAt: 0 } : null,
    reco: null,
    stats: {
      workMs: 0, dayMs: 0, breakMs: 0, availableMs: 0, ratio: 0,
      startLatenciesMs: [], medianStartLatencyMs: null, stuckCount: 0, sessionCount: 0
    },
    notice: null
  }
}

describe('toastFor', () => {
  it('체크인은 현재 할 일 제목과 30초 제한을 담는다', () => {
    expect(toastFor({ kind: 'checkin_due' }, snap({ title: '개요 쓰기' }))).toEqual({
      kind: 'checkin',
      taskTitle: '개요 쓰기',
      timeoutMs: CHECKIN_TIMEOUT_MS
    })
  })

  it('막힘 대응은 단계별로 더 작은 행동 문구를 낸다', () => {
    const r1 = toastFor({ kind: 'rescue', level: 1 }, snap({}))
    const r2 = toastFor({ kind: 'rescue', level: 2 }, snap({}))
    expect(r1).toMatchObject({ kind: 'rescue', level: 1 })
    expect((r1 as { step: string }).step).toContain('2분')
    expect((r2 as { step: string }).step).toContain('1분')
  })

  it('연속 막힘은 5분 휴식을 제안하고 자동으로 사라지지 않는다', () => {
    const p = toastFor({ kind: 'suggest_break' }, snap({}))
    expect(p).toEqual({ kind: 'break', minutes: 5 })
    expect('timeoutMs' in p).toBe(false)
  })

  it('시간 종료는 설정된 세션 길이를 보여준다', () => {
    expect(toastFor({ kind: 'time_up' }, snap({}))).toMatchObject({ kind: 'time_up', plannedMin: 25 })
  })

  it('시간 배율을 올려도 최소 표시 시간(3초) 아래로 줄지 않는다', () => {
    const p = toastFor({ kind: 'checkin_due' }, snap({}), 60)
    expect((p as { timeoutMs: number }).timeoutMs).toBe(MIN_TOAST_MS)
    const normal = toastFor({ kind: 'checkin_due' }, snap({}), 1)
    expect((normal as { timeoutMs: number }).timeoutMs).toBe(CHECKIN_TIMEOUT_MS)
  })
})

describe('isToastStale', () => {
  const checkin: ToastPayload = { kind: 'checkin', taskTitle: '', timeoutMs: 1 }
  const rescue: ToastPayload = { kind: 'rescue', level: 1, step: '', timeoutMs: 1 }
  const brk: ToastPayload = { kind: 'break', minutes: 5 }
  const timeUp: ToastPayload = { kind: 'time_up', plannedMin: 25, timeoutMs: 1 }

  it('체크인: 응답 대기 중이면 유효, 응답 후·세션 종료 후엔 무효', () => {
    expect(isToastStale(checkin, snap({ checkinPending: true }))).toBe(false)
    expect(isToastStale(checkin, snap({ checkinPending: false }))).toBe(true)
    expect(isToastStale(checkin, snap({ phase: 'reflecting', checkinPending: true }))).toBe(true)
  })

  it('막힘 대응·시간 종료: 세션이 살아있는 동안만 유효', () => {
    for (const p of [rescue, timeUp]) {
      expect(isToastStale(p, snap({ phase: 'running' }))).toBe(false)
      expect(isToastStale(p, snap({ phase: 'paused' }))).toBe(false)
      expect(isToastStale(p, snap({ phase: 'reflecting' }))).toBe(true)
      expect(isToastStale(p, snap({ phase: 'idle' }))).toBe(true)
    }
  })

  it('휴식 제안: 정지 상태이고 휴식을 시작하기 전까지만 유효', () => {
    expect(isToastStale(brk, snap({ phase: 'paused' }))).toBe(false)
    expect(isToastStale(brk, snap({ phase: 'running' }))).toBe(true) // 계속하기로 재개됨
    expect(isToastStale(brk, snap({ phase: 'paused', breakOpen: true }))).toBe(true) // 휴식 시작됨
  })
})
