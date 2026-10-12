import { describe, expect, it } from 'vitest'
import { foldSessions } from '../src/domain/daySummary'
import { makeEvent, type AppEvent, type EventBody } from '../src/domain/events'
import type { Task } from '../src/domain/tasks'

const MIN = 60_000
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime()
const at = (min: number, body: EventBody): AppEvent => makeEvent(body, T0 + min * MIN)
const tasks: Task[] = [
  { id: 'a', title: '개요 쓰기', done: true, createdAt: 0 },
  { id: 'b', title: '자료 읽기', done: false, createdAt: 0 }
]

describe('foldSessions', () => {
  it('세션별 작업 시간·산출물·목표 연결·원인을 합친다 (일시정지는 제외)', () => {
    const events = [
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(10, { type: 'session_pause', cause: 'user' }),
      at(20, { type: 'session_resume' }),
      at(25, { type: 'session_end', taskId: 'a', reason: 'done' }),
      at(26, { type: 'reflection', taskId: 'a', output: '제목 3개', goalLink: 'yes', cause: 'vague' })
    ]
    const [s] = foldSessions(events, tasks, T0 + 60 * MIN)
    expect(s).toMatchObject({
      taskId: 'a',
      taskTitle: '개요 쓰기',
      workMs: 15 * MIN,
      endReason: 'done',
      output: '제목 3개',
      goalLink: 'yes',
      cause: 'vague'
    })
  })

  it('회고를 쓰지 않았으면 빈 산출물·null 값이다', () => {
    const events = [
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(5, { type: 'session_end', taskId: 'a', reason: 'manual' })
    ]
    expect(foldSessions(events, tasks, T0 + 60 * MIN)[0]).toMatchObject({ output: '', goalLink: null, cause: null })
  })

  it('여러 세션은 각자의 회고를 받는다', () => {
    const events = [
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(10, { type: 'session_end', taskId: 'a', reason: 'manual' }),
      at(11, { type: 'reflection', taskId: 'a', output: '첫째' }),
      at(12, { type: 'session_start', taskId: 'b', plannedMin: 25 }),
      at(30, { type: 'session_end', taskId: 'b', reason: 'timeout' }),
      at(31, { type: 'reflection', taskId: 'b', output: '둘째', goalLink: 'no' })
    ]
    const r = foldSessions(events, tasks, T0 + 60 * MIN)
    expect(r.map((s) => [s.taskTitle, s.output, s.goalLink])).toEqual([
      ['개요 쓰기', '첫째', null],
      ['자료 읽기', '둘째', 'no']
    ])
  })

  it('진행 중인 세션은 endReason이 null이고 지금까지의 시간을 센다', () => {
    const events = [at(0, { type: 'session_start', taskId: 'b', plannedMin: 25 })]
    const [s] = foldSessions(events, tasks, T0 + 7 * MIN)
    expect(s).toMatchObject({ endReason: null, workMs: 7 * MIN })
  })

  it('삭제된 할 일은 대체 제목으로 표시한다', () => {
    const events = [
      at(0, { type: 'session_start', taskId: 'zzz', plannedMin: 25 }),
      at(5, { type: 'session_end', taskId: 'zzz', reason: 'manual' })
    ]
    expect(foldSessions(events, tasks, T0 + 60 * MIN)[0]?.taskTitle).toBe('(삭제된 할 일)')
  })

  it('하루 종료 시 열린 세션은 그 시각에 닫힌다', () => {
    const events = [
      at(0, { type: 'session_start', taskId: 'a', plannedMin: 25 }),
      at(12, { type: 'day_end' })
    ]
    expect(foldSessions(events, tasks, T0 + 99 * MIN)[0]).toMatchObject({ workMs: 12 * MIN, endReason: 'manual' })
  })
})
