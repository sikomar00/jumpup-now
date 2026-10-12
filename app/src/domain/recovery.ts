// 비정상 종료 복구. 마지막 이벤트(heartbeat 포함) 시각을 "마지막으로 살아있던 시각"으로 본다.
// (기술설계.md §4.3)
import { makeEvent, sortByTime, type AppEvent } from './events'

export const HEARTBEAT_MS = 30_000
/** heartbeat 3번 연속 누락이면 앱이 꺼져 있었던 것으로 본다. */
export const GAP_THRESHOLD_MS = HEARTBEAT_MS * 3

export interface RecoveryResult {
  /** 로그 끝에 덧붙일 보정 이벤트 (t 오름차순) */
  events: AppEvent[]
  /** 사용자에게 한 줄로 보여줄 안내. 없으면 null */
  notice: string | null
}

function dateKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function clock(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 앱 시작 시 한 번 호출한다. 세션 상태는 메모리에만 있으므로 로그에 열린 세션이 남아 있으면
 * 간격과 무관하게 닫는다. 하루·휴식은 heartbeat가 GAP_THRESHOLD_MS 넘게 끊긴 경우에만 보정한다.
 */
export function recoverEvents(events: readonly AppEvent[], now: number): RecoveryResult {
  const sorted = sortByTime(events)
  const last = sorted[sorted.length - 1]
  if (!last) return { events: [], notice: null }
  const gapped = now - last.t > GAP_THRESHOLD_MS

  let dayOpen = false
  let breakOpen = false
  let sessionTaskId: string | null = null
  for (const e of sorted) {
    switch (e.type) {
      case 'day_start':
        dayOpen = true
        break
      case 'day_end':
        dayOpen = false
        sessionTaskId = null
        break
      case 'break_start':
        breakOpen = true
        break
      case 'break_end':
        breakOpen = false
        break
      case 'session_start':
        sessionTaskId = e.taskId
        break
      case 'session_end':
        sessionTaskId = null
        break
      default:
        break
    }
  }

  const out: AppEvent[] = []
  let notice: string | null = null

  if (sessionTaskId !== null) {
    out.push(makeEvent({ type: 'session_end', taskId: sessionTaskId, reason: 'recovered' }, last.t))
    notice = `이전 세션이 중단되어 ${clock(last.t)}까지만 반영했어요.`
  }
  if (!gapped) return { events: out, notice }
  if (breakOpen) out.push(makeEvent({ type: 'break_end' }, last.t))
  if (dayOpen) {
    if (dateKey(last.t) !== dateKey(now)) {
      // 날짜가 바뀌었으면 마지막 활동 시각에 하루를 닫는다.
      out.push(makeEvent({ type: 'day_end' }, last.t))
    } else {
      // 같은 날 재실행: 앱이 꺼져 있던 시간은 분모에서 제외한다.
      out.push(makeEvent({ type: 'break_start', reason: 'app_closed' }, last.t))
      out.push(makeEvent({ type: 'break_end' }, now))
    }
  }
  return { events: out, notice }
}
