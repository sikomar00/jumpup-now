// 지표 계산. 입력은 이벤트 로그뿐이며 시간은 인자로 주입한다. (기술설계.md §4.2)
import { sortByTime, type AppEvent } from './events'

type Interval = readonly [start: number, end: number]

export interface DayStats {
  /** 실질 작업 시간 (세션 구간 − 일시정지 구간) */
  workMs: number
  /** 하루 시작~종료 구간 합 */
  dayMs: number
  /** 하루 구간 안에 포함된 휴식 시간 */
  breakMs: number
  /** 분모: dayMs − breakMs */
  availableMs: number
  /** workMs / availableMs (0~1로 제한) */
  ratio: number
  /** 추천 표시 → 세션 시작까지의 지연 */
  startLatenciesMs: number[]
  medianStartLatencyMs: number | null
  stuckCount: number
  sessionCount: number
}

/** open/close 이벤트 쌍을 구간으로 만든다. 닫히지 않은 구간은 now까지로 본다. */
function pairIntervals(
  events: readonly AppEvent[],
  open: AppEvent['type'],
  close: AppEvent['type'],
  now: number
): Interval[] {
  const out: Interval[] = []
  let start: number | null = null
  for (const e of events) {
    if (e.type === open) {
      if (start === null) start = e.t
    } else if (e.type === close && start !== null) {
      out.push([start, Math.max(start, e.t)])
      start = null
    }
  }
  if (start !== null) out.push([start, Math.max(start, now)])
  return out
}

function totalLength(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0)
}

function overlapLength(a: readonly Interval[], b: readonly Interval[]): number {
  let sum = 0
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      const lo = Math.max(as, bs)
      const hi = Math.min(ae, be)
      if (hi > lo) sum += hi - lo
    }
  }
  return sum
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function computeStats(events: readonly AppEvent[], now: number): DayStats {
  const sorted = sortByTime(events)

  // 작업 시간: 세션 구간에서 일시정지 구간을 뺀다. 하루 종료 시 열린 세션은 닫는다.
  let sessionOpen = false
  let paused = false
  let activeSince = 0
  let workMs = 0
  let sessionCount = 0
  let stuckCount = 0
  const startLatenciesMs: number[] = []
  let pendingReco: number | null = null

  const closeSession = (t: number): void => {
    if (!sessionOpen) return
    if (!paused) workMs += Math.max(0, t - activeSince)
    sessionOpen = false
    paused = false
  }

  for (const e of sorted) {
    switch (e.type) {
      case 'reco_shown':
        if (pendingReco === null) pendingReco = e.t
        break
      case 'session_start':
        if (pendingReco !== null) startLatenciesMs.push(Math.max(0, e.t - pendingReco))
        pendingReco = null
        if (!sessionOpen) {
          sessionOpen = true
          paused = false
          activeSince = e.t
        }
        break
      case 'session_pause':
        if (sessionOpen && !paused) {
          workMs += Math.max(0, e.t - activeSince)
          paused = true
        }
        break
      case 'session_resume':
        if (sessionOpen && paused) {
          paused = false
          activeSince = e.t
        }
        break
      case 'session_end':
        if (sessionOpen) sessionCount += 1
        closeSession(e.t)
        break
      case 'day_end':
        if (sessionOpen) sessionCount += 1
        closeSession(e.t)
        break
      case 'checkin':
        if (e.answer === 'stuck') stuckCount += 1
        break
      default:
        break
    }
  }
  if (sessionOpen && !paused) workMs += Math.max(0, now - activeSince)

  const days = pairIntervals(sorted, 'day_start', 'day_end', now)
  const breaks = pairIntervals(sorted, 'break_start', 'break_end', now)
  const dayMs = totalLength(days)
  const breakMs = overlapLength(days, breaks)
  const availableMs = Math.max(0, dayMs - breakMs)
  const ratio = availableMs > 0 ? Math.min(1, workMs / availableMs) : 0

  return {
    workMs,
    dayMs,
    breakMs,
    availableMs,
    ratio,
    startLatenciesMs,
    medianStartLatencyMs: median(startLatenciesMs),
    stuckCount,
    sessionCount
  }
}
