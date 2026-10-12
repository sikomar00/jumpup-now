// 도그푸딩 기준선 리포트: 이벤트 로그를 날짜별로 나눠 지표를 계산한다. 순수 함수.
import { sortByTime, type AppEvent } from './events'
import { computeStats, median, type DayStats } from './stats'

const MIN = 60_000
/** 이보다 짧게 측정된 날은 기준선 계산에서 뺀다(앱을 잠깐 켠 날, 테스트한 날). */
export const MIN_USABLE_DAY_MS = 30 * MIN

export interface DayReport {
  /** 로컬 날짜 YYYY-MM-DD */
  date: string
  stats: DayStats
  /** 목표 연결 평가: 예 / 전체 평가 수 */
  goalYes: number
  goalRated: number
  usable: boolean
}

export interface Baseline {
  days: number
  usableDays: number
  /** 사용 가능한 날의 실질 작업비율(0~1) 중앙값·평균 */
  medianRatio: number | null
  meanRatio: number | null
  /** 사용 가능한 날 전체의 착수 지연 중앙값 (ms) */
  medianStartLatencyMs: number | null
  totalStuck: number
  totalSessions: number
}

function dateKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function endOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** 하루 시작(day_start)이 있는 날만 날짜순으로 돌려준다. */
export function summarizeByDay(events: readonly AppEvent[], now: number): DayReport[] {
  const groups = new Map<string, AppEvent[]>()
  for (const e of sortByTime(events)) {
    const key = dateKey(e.t)
    const list = groups.get(key)
    if (list) list.push(e)
    else groups.set(key, [e])
  }

  const out: DayReport[] = []
  for (const [date, list] of groups) {
    if (!list.some((e) => e.type === 'day_start')) continue
    // 닫히지 않은 구간은 그날 끝(또는 지금 중 이른 쪽)까지로 센다.
    const stats = computeStats(list, Math.min(now, endOfDay(list[0]!.t)))
    let goalYes = 0
    let goalRated = 0
    for (const e of list) {
      if (e.type === 'reflection' && e.goalLink) {
        goalRated += 1
        if (e.goalLink === 'yes') goalYes += 1
      }
    }
    out.push({ date, stats, goalYes, goalRated, usable: stats.availableMs >= MIN_USABLE_DAY_MS })
  }
  return out
}

export function baselineOf(days: readonly DayReport[]): Baseline {
  const usable = days.filter((d) => d.usable)
  const ratios = usable.map((d) => d.stats.ratio)
  return {
    days: days.length,
    usableDays: usable.length,
    medianRatio: median(ratios),
    meanRatio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
    medianStartLatencyMs: median(usable.flatMap((d) => d.stats.startLatenciesMs)),
    totalStuck: usable.reduce((s, d) => s + d.stats.stuckCount, 0),
    totalSessions: usable.reduce((s, d) => s + d.stats.sessionCount, 0)
  }
}
