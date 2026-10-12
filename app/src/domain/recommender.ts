// 규칙 기반 추천. 순수 함수. (기술설계.md §6)
import type { TaskSize } from './events'

export interface RecoTask {
  id: string
  title: string
  due?: number
  size?: TaskSize
}

export interface RecoHistory {
  /** 최근 거절("못 하겠어요")한 할 일 id (최근 3개만 사용) */
  recentRejectedIds: readonly string[]
}

export interface Recommendation {
  task: RecoTask
  firstStep: string
  reason: string
}

const NO_DUE_SCORE = 30
/** 마감이 지난 항목은 어떤 크기 가중치로도 뒤집히지 않도록 크게 앞당긴다. */
const OVERDUE_BONUS = 100
const REJECT_PENALTY = 10
const REJECT_WINDOW = 3
const SIZE_SCORE: Record<TaskSize, number> = { small: 0, medium: 2, large: 4 }
const SIZE_LABEL: Record<TaskSize, string> = { small: '작음', medium: '중간', large: '큼' }

const FIRST_STEP: Record<TaskSize, string> = {
  small: '5분만 하세요.',
  medium: '처음 10분: 제목과 목록부터 적으세요.',
  large: '처음 5분: 가장 작은 부분 하나만 하세요.'
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 마감까지 남은 일수. 0=오늘, 음수=지남 */
export function daysUntil(due: number, now: number): number {
  return Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000)
}

function dueLabel(days: number): string {
  if (days < 0) return '마감 지남'
  if (days === 0) return '마감 오늘'
  if (days === 1) return '마감 내일'
  return `마감 ${days}일 뒤`
}

function score(task: RecoTask, now: number, rejected: ReadonlySet<string>): number {
  let dueScore = NO_DUE_SCORE
  if (task.due !== undefined) {
    const days = daysUntil(task.due, now)
    dueScore = days < 0 ? days - OVERDUE_BONUS : days
  }
  const sizeScore = SIZE_SCORE[task.size ?? 'medium']
  const rejectScore = rejected.has(task.id) ? REJECT_PENALTY : 0
  return dueScore + sizeScore + rejectScore
}

function reasonOf(task: RecoTask, now: number): string {
  const parts: string[] = []
  if (task.due !== undefined) parts.push(dueLabel(daysUntil(task.due, now)))
  if (task.size) parts.push(`크기 ${SIZE_LABEL[task.size]}`)
  return parts.length > 0 ? parts.join(' / ') : '목록 순서'
}

/** 점수가 가장 낮은 할 일 1개. 동점이면 목록(등록) 순서. 후보가 없으면 null. */
export function recommend(
  tasks: readonly RecoTask[],
  now: number,
  history: RecoHistory = { recentRejectedIds: [] }
): Recommendation | null {
  if (tasks.length === 0) return null
  const rejected = new Set(history.recentRejectedIds.slice(-REJECT_WINDOW))
  let best: RecoTask | null = null
  let bestScore = Infinity
  for (const task of tasks) {
    const s = score(task, now, rejected)
    if (s < bestScore) {
      best = task
      bestScore = s
    }
  }
  if (best === null) return null
  return {
    task: best,
    firstStep: FIRST_STEP[best.size ?? 'medium'],
    reason: reasonOf(best, now)
  }
}

/** "막혔어요" 대응 문구. 단계가 오를수록 행동을 더 작게 줄인다. */
export function rescueStep(level: 1 | 2): string {
  return level === 1 ? '그럼 제목 1개만 적으세요. 2분.' : '1분만 하세요. 관련 문서만 여세요.'
}
