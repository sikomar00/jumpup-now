// 하루 요약용: 이벤트 로그에서 세션별 기록(작업 시간·산출물·목표 연결·원인)을 복원한다.
import { sortByTime, type AppEvent, type EndReason, type GoalLink, type StuckCause } from './events'
import type { Task } from './tasks'

export interface SessionSummary {
  taskId: string
  taskTitle: string
  startedAt: number
  /** 일시정지를 뺀 실제 작업 시간 */
  workMs: number
  /** 아직 진행 중이면 null */
  endReason: EndReason | null
  output: string
  goalLink: GoalLink | null
  cause: StuckCause | null
}

export function foldSessions(
  events: readonly AppEvent[],
  tasks: readonly Task[],
  now: number
): SessionSummary[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]))
  const out: SessionSummary[] = []

  let cur: SessionSummary | null = null
  let paused = false
  let activeSince = 0
  /** 종료됐지만 회고를 아직 못 받은 세션 (회고는 세션 종료 뒤에 도착한다) */
  let awaitingReflection: SessionSummary | null = null

  const close = (t: number, reason: EndReason): void => {
    if (!cur) return
    if (!paused) cur.workMs += Math.max(0, t - activeSince)
    cur.endReason = reason
    awaitingReflection = cur
    cur = null
    paused = false
  }

  for (const e of sortByTime(events)) {
    switch (e.type) {
      case 'session_start':
        cur = {
          taskId: e.taskId,
          taskTitle: titles.get(e.taskId) ?? '(삭제된 할 일)',
          startedAt: e.t,
          workMs: 0,
          endReason: null,
          output: '',
          goalLink: null,
          cause: null
        }
        out.push(cur)
        paused = false
        activeSince = e.t
        break
      case 'session_pause':
        if (cur && !paused) {
          cur.workMs += Math.max(0, e.t - activeSince)
          paused = true
        }
        break
      case 'session_resume':
        if (cur && paused) {
          paused = false
          activeSince = e.t
        }
        break
      case 'session_end':
        close(e.t, e.reason)
        break
      case 'day_end':
        close(e.t, 'manual')
        break
      case 'reflection': {
        // 클로저(close)에서 대입되는 변수라 TS가 null로 좁히므로 타입을 명시한다.
        const target = awaitingReflection as SessionSummary | null
        if (target && target.taskId === e.taskId) {
          target.output = e.output
          target.goalLink = e.goalLink ?? null
          target.cause = e.cause ?? null
          awaitingReflection = null
        }
        break
      }
      default:
        break
    }
  }
  // 진행 중인 세션은 지금까지의 작업 시간을 보여준다.
  const open = cur as SessionSummary | null
  if (open && !paused) open.workMs += Math.max(0, now - activeSince)
  return out
}
