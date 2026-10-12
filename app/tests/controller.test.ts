import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppController } from '../src/main/controller'
import { EventStore } from '../src/main/store/eventStore'
import { SettingsStore } from '../src/main/store/settingsStore'
import type { AppSnapshot, Command } from '../src/shared/ipc'

const MIN = 60_000
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime()

let dir: string
let clock: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jumpup-ctrl-'))
  clock = T0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function make(): { ctrl: AppController; pushes: AppSnapshot[] } {
  const pushes: AppSnapshot[] = []
  let n = 0
  const ctrl = new AppController({
    eventStore: new EventStore(join(dir, 'events')),
    settingsStore: new SettingsStore(join(dir, 'settings.json')),
    now: () => clock,
    newId: () => `t${++n}`,
    onChange: (s) => pushes.push(s)
  })
  ctrl.init()
  return { ctrl, pushes }
}

const onboard: Command = {
  type: 'complete_onboarding',
  goal: '포트폴리오 완성',
  successTargetPct: 40,
  dayStartTime: '09:00'
}

describe('온보딩', () => {
  it('목표가 비어 있으면 거부한다', () => {
    const { ctrl } = make()
    expect(() => ctrl.dispatch({ ...onboard, goal: '   ' })).toThrow('목표')
    expect(ctrl.snapshot().settings.onboarded).toBe(false)
  })

  it('완료하면 설정이 저장되고 재시작 후에도 유지된다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    expect(ctrl.snapshot().settings).toMatchObject({ goal: '포트폴리오 완성', onboarded: true })
    expect(make().ctrl.snapshot().settings.onboarded).toBe(true)
  })
})

describe('할 일 → 추천 → 세션 → 회고 한 바퀴', () => {
  it('전체 흐름이 이어지고 실질 작업비율이 계산된다', () => {
    const { ctrl, pushes } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: '개요 쓰기', size: 'small' })
    ctrl.dispatch({ type: 'task_add', title: '자료 읽기' })
    ctrl.dispatch({ type: 'day_start' })

    clock += 2 * MIN
    ctrl.dispatch({ type: 'reco_request' })
    expect(ctrl.snapshot().reco?.task.title).toBe('개요 쓰기')

    clock += 1 * MIN
    ctrl.dispatch({ type: 'session_start' })
    let s = ctrl.snapshot()
    expect(s.session.phase).toBe('running')
    expect(s.reco).toBeNull()
    expect(s.sessionTask?.title).toBe('개요 쓰기')

    clock += 25 * MIN
    ctrl.dispatch({ type: 'session_end', reason: 'done' })
    s = ctrl.snapshot()
    expect(s.session.phase).toBe('reflecting')
    expect(s.tasks.find((t) => t.title === '개요 쓰기')?.done).toBe(true)

    ctrl.dispatch({ type: 'save_reflection', output: '제목 3개', goalLink: 'yes' })
    clock += 2 * MIN
    s = ctrl.snapshot()
    expect(s.session.phase).toBe('idle')
    expect(s.stats.workMs).toBe(25 * MIN)
    expect(s.stats.availableMs).toBe(30 * MIN)
    expect(s.stats.medianStartLatencyMs).toBe(1 * MIN)
    expect(s.stats.sessionCount).toBe(1)
    expect(pushes.length).toBeGreaterThan(5)
  })

  it('하루를 시작하지 않으면 추천·세션을 거부한다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'a' })
    expect(() => ctrl.dispatch({ type: 'reco_request' })).toThrow('하루를 시작')
    expect(() => ctrl.dispatch({ type: 'session_start' })).toThrow('하루를 시작')
  })

  it('추천 없이 세션을 시작할 수 없다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'day_start' })
    expect(() => ctrl.dispatch({ type: 'session_start' })).toThrow('추천')
  })

  it('거절하면 다음 후보가 나오고, 하나뿐이면 같은 항목을 더 작은 첫 행동으로 낸다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A', size: 'small' })
    ctrl.dispatch({ type: 'task_add', title: 'B', size: 'large' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    expect(ctrl.snapshot().reco?.task.title).toBe('A')
    ctrl.dispatch({ type: 'reco_reject' })
    expect(ctrl.snapshot().reco?.task.title).toBe('B')

    const solo = make()
    // 새 저장소가 아니라 같은 디렉터리이므로 B를 지워 후보를 하나로 만든다
    const only = solo.ctrl.snapshot().tasks.find((t) => t.title === 'A')!
    solo.ctrl.dispatch({ type: 'task_delete', id: only.id })
    solo.ctrl.dispatch({ type: 'day_start' })
    solo.ctrl.dispatch({ type: 'reco_request' })
    solo.ctrl.dispatch({ type: 'reco_reject' })
    expect(solo.ctrl.snapshot().reco?.task.title).toBe('B')
    expect(solo.ctrl.snapshot().reco?.firstStep).toContain('2분')
  })

  it('열린 할 일이 없으면 추천은 null', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    expect(ctrl.snapshot().reco).toBeNull()
  })

  it('추천 중인 할 일을 삭제하면 추천이 사라진다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'task_delete', id: ctrl.snapshot().reco!.task.id })
    expect(ctrl.snapshot().reco).toBeNull()
  })
})

describe('하루·휴식 규칙', () => {
  it('세션 중에는 하루 종료·휴식을 거부한다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    expect(() => ctrl.dispatch({ type: 'day_end' })).toThrow('세션')
    expect(() => ctrl.dispatch({ type: 'break_start' })).toThrow('세션')
  })

  it('휴식 시간은 분모에서 빠진다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'day_start' })
    clock += 60 * MIN
    ctrl.dispatch({ type: 'break_start' })
    expect(ctrl.snapshot().breakOpen).toBe(true)
    clock += 30 * MIN
    ctrl.dispatch({ type: 'break_end' })
    clock += 30 * MIN
    ctrl.dispatch({ type: 'day_end' })
    expect(ctrl.snapshot().stats.availableMs).toBe(90 * MIN)
    expect(ctrl.snapshot().dayOpen).toBe(false)
  })

  it('일시정지 시간은 작업 시간에서 빠진다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    clock += 10 * MIN
    ctrl.dispatch({ type: 'session_pause' })
    clock += 40 * MIN
    ctrl.dispatch({ type: 'session_resume' })
    clock += 5 * MIN
    expect(ctrl.snapshot().stats.workMs).toBe(15 * MIN)
  })
})

describe('절전·정지 처리', () => {
  function runningSession() {
    const made = make()
    made.ctrl.dispatch(onboard)
    made.ctrl.dispatch({ type: 'task_add', title: 'A' })
    made.ctrl.dispatch({ type: 'day_start' })
    made.ctrl.dispatch({ type: 'reco_request' })
    made.ctrl.dispatch({ type: 'session_start' })
    return made
  }

  it('suspend()는 실행 중 세션을 절전 원인으로 멈추고, 복귀해도 자동 재개하지 않는다', () => {
    const { ctrl } = runningSession()
    clock += 10 * MIN
    ctrl.suspend()
    let s = ctrl.snapshot()
    expect(s.session.phase).toBe('paused')
    expect(s.session.pauseCause).toBe('suspend')

    clock += 2 * 60 * MIN // 2시간 절전
    ctrl.tick() // 복귀 후 틱: 이미 멈춰 있으므로 아무 일도 없어야 한다
    s = ctrl.snapshot()
    expect(s.session.phase).toBe('paused')
    expect(s.stats.workMs).toBe(10 * MIN)

    ctrl.dispatch({ type: 'session_resume' })
    clock += 5 * MIN
    expect(ctrl.snapshot().stats.workMs).toBe(15 * MIN)
  })

  it('idle·이미 정지된 상태에서 suspend()는 무시한다', () => {
    const { ctrl, pushes } = make()
    ctrl.dispatch(onboard)
    const before = pushes.length
    ctrl.suspend()
    expect(pushes.length).toBe(before)
  })

  it('절전 이벤트를 놓쳐도 틱 간격이 크게 벌어지면 마지막 틱 시각으로 소급해 멈춘다', () => {
    const { ctrl } = runningSession()
    clock += 10 * MIN
    ctrl.tick() // 09:10 마지막 정상 틱
    clock += 3 * 60 * MIN // 이벤트 없이 3시간 정지(절전·최대 절전 등)
    ctrl.tick()
    const s = ctrl.snapshot()
    expect(s.session.phase).toBe('paused')
    expect(s.session.pauseCause).toBe('suspend')
    expect(s.stats.workMs).toBe(10 * MIN) // 정지된 3시간은 작업 시간이 아니다
  })

  it('1초 간격의 정상 틱은 세션을 건드리지 않는다', () => {
    const { ctrl } = runningSession()
    for (let i = 0; i < 5; i++) {
      clock += 1000
      ctrl.tick()
    }
    expect(ctrl.snapshot().session.phase).toBe('running')
  })

  it('위젯 위치를 설정에 저장하고 재시작 후에도 유지한다', () => {
    const { ctrl } = make()
    ctrl.saveWidgetPos({ x: 120, y: 340 })
    expect(make().ctrl.snapshot().settings.widgetPos).toEqual({ x: 120, y: 340 })
  })
})

describe('복구·heartbeat', () => {
  it('열린 하루·세션이 없으면 heartbeat를 기록하지 않는다', () => {
    const { ctrl } = make()
    ctrl.dispatch(onboard)
    ctrl.heartbeat()
    expect(new EventStore(join(dir, 'events')).readAll().events.some((e) => e.type === 'heartbeat')).toBe(false)
  })

  it('세션 중 비정상 종료 후 재시작하면 마지막 heartbeat까지만 반영하고 안내한다', () => {
    const first = make()
    first.ctrl.dispatch(onboard)
    first.ctrl.dispatch({ type: 'task_add', title: 'A' })
    first.ctrl.dispatch({ type: 'day_start' })
    first.ctrl.dispatch({ type: 'reco_request' })
    first.ctrl.dispatch({ type: 'session_start' })
    clock += 10 * MIN
    first.ctrl.heartbeat() // 마지막 생존 시각: 09:10
    clock += 3 * 60 * MIN // 앱이 꺼진 채 3시간 경과

    const second = make()
    const s = second.ctrl.snapshot()
    expect(s.session.phase).toBe('idle')
    expect(s.notice).toContain('09:10')
    expect(s.stats.workMs).toBe(10 * MIN)
    expect(s.breakOpen).toBe(false)

    second.ctrl.dispatch({ type: 'dismiss_notice' })
    expect(second.ctrl.snapshot().notice).toBeNull()
  })
})
