// 이벤트 로그에서 하루·휴식의 열림 상태를 복원한다.
import { sortByTime, type AppEvent } from './events'

export interface DayState {
  dayOpen: boolean
  breakOpen: boolean
  /** 열린 하루의 시작 시각 */
  dayStartedAt: number | null
}

export function dayState(events: readonly AppEvent[]): DayState {
  let dayOpen = false
  let breakOpen = false
  let dayStartedAt: number | null = null
  for (const e of sortByTime(events)) {
    switch (e.type) {
      case 'day_start':
        if (!dayOpen) {
          dayOpen = true
          dayStartedAt = e.t
        }
        break
      case 'day_end':
        dayOpen = false
        breakOpen = false
        dayStartedAt = null
        break
      case 'break_start':
        if (dayOpen) breakOpen = true
        break
      case 'break_end':
        breakOpen = false
        break
      default:
        break
    }
  }
  return { dayOpen, breakOpen, dayStartedAt }
}
