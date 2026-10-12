import { daysUntil } from '../../domain/recommender'
import type { TaskSize } from '../../domain/events'

export const SIZE_LABEL: Record<TaskSize, string> = { small: '작음', medium: '중간', large: '큼' }

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function hhmm(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function duration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}분`
  return `${Math.floor(min / 60)}시간 ${String(min % 60).padStart(2, '0')}분`
}

export function dueText(due: number, now: number): { text: string; hot: boolean } {
  const d = daysUntil(due, now)
  if (d < 0) return { text: '지남', hot: true }
  if (d === 0) return { text: '오늘', hot: true }
  if (d === 1) return { text: '내일', hot: true }
  return { text: `${d}일 뒤`, hot: false }
}

/** <input type="date"> 값(YYYY-MM-DD)을 그날 23:00 로컬 시각으로 변환 */
export function dateInputToDue(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 0).getTime()
}
