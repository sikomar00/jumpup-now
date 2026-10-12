import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/domain/settings'
import { computeStats } from '../src/domain/stats'
import { AppController } from '../src/main/controller'
import { EventStore } from '../src/main/store/eventStore'
import { SettingsStore } from '../src/main/store/settingsStore'
import type { AppSnapshot, Command } from '../src/shared/ipc'

const MIN = 60_000
const H = 60 * MIN
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

describe('체크인·시간 종료·연속 막힘 (M4)', () => {
  function setup() {
    const effects: string[] = []
    const pushes: AppSnapshot[] = []
    let n = 0
    const ctrl = new AppController({
      eventStore: new EventStore(join(dir, 'events')),
      settingsStore: new SettingsStore(join(dir, 'settings.json')),
      now: () => clock,
      newId: () => `t${++n}`,
      onChange: (s) => pushes.push(s),
      onEffect: (e) => effects.push(e.kind === 'rescue' ? `rescue${e.level}` : e.kind)
    })
    ctrl.init()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A', size: 'small' })
    ctrl.dispatch({ type: 'task_add', title: 'B', size: 'large' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    return { ctrl, effects, pushes }
  }
  /** 1초 간격으로 틱을 돌리며 시간을 흘린다(정상 틱이라 소급 정지가 발생하지 않는다). */
  const advance = (ctrl: AppController, minutes: number): void => {
    for (let i = 0; i < minutes * 60; i++) {
      clock += 1000
      ctrl.tick()
    }
  }

  it('10분 경과 시 체크인 효과가 한 번 나온다', () => {
    const { ctrl, effects } = setup()
    advance(ctrl, 9)
    expect(effects).toEqual([])
    advance(ctrl, 1)
    expect(effects).toEqual(['checkin_due'])
    advance(ctrl, 5) // 응답 대기 중에는 중복 알림 없음
    expect(effects).toEqual(['checkin_due'])
  })

  it('틱 중 체크인이 울리면 상태가 푸시되어 응답 대기 상태가 화면에 반영된다', () => {
    const { ctrl, pushes } = setup()
    const before = pushes.length
    advance(ctrl, 10)
    expect(pushes.length).toBe(before + 1)
    expect(pushes.at(-1)!.session.checkinPending).toBe(true)
  })

  it('진행 중 응답은 기록되고 다음 체크인은 20분에 울린다', () => {
    const { ctrl, effects } = setup()
    advance(ctrl, 10)
    ctrl.dispatch({ type: 'answer_checkin', answer: 'ok' })
    advance(ctrl, 10)
    expect(effects).toEqual(['checkin_due', 'checkin_due'])
  })

  it('25분이 되면 시간 종료 효과가 나오고, 마무리하면 timeout으로 끝난다', () => {
    const { ctrl, effects } = setup()
    for (const m of [10, 10]) {
      advance(ctrl, m)
      ctrl.dispatch({ type: 'answer_checkin', answer: 'ok' })
    }
    advance(ctrl, 5)
    expect(effects).toContain('time_up')
    ctrl.dispatch({ type: 'session_end', reason: 'timeout' })
    expect(ctrl.snapshot().session.phase).toBe('reflecting')
  })

  it('막혔어요 1·2회는 대응 효과, 3회 연속이면 휴식 제안과 함께 세션이 정지된다', () => {
    const { ctrl, effects } = setup()
    for (let i = 0; i < 3; i++) {
      advance(ctrl, 10)
      ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    }
    // 계획 시간(25분)이 20분 체크인과 30분 체크인 사이에 끼어든다
    expect(effects).toEqual(['checkin_due', 'rescue1', 'checkin_due', 'rescue2', 'time_up', 'checkin_due', 'suggest_break'])
    const s = ctrl.snapshot()
    expect(s.session.phase).toBe('paused')
    expect(s.session.pauseCause).toBe('user')
    expect(s.stats.stuckCount).toBe(3)
  })

  it('연속 막힘은 세션을 넘어 센다: 한 세션의 체크인은 2번뿐이므로(25분/10분) 다음 세션까지 이어진다', () => {
    const { ctrl, effects } = setup()
    for (let i = 0; i < 2; i++) {
      advance(ctrl, 10)
      ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    }
    ctrl.dispatch({ type: 'session_end', reason: 'manual' })
    ctrl.dispatch({ type: 'save_reflection', output: '' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    advance(ctrl, 10)
    ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    expect(effects.at(-1)).toBe('suggest_break')
    expect(ctrl.snapshot().session.phase).toBe('paused')
  })

  it('"진행 중" 응답이나 새 하루 시작은 연속 막힘을 끊는다', () => {
    const a = setup()
    advance(a.ctrl, 10)
    a.ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    advance(a.ctrl, 10)
    a.ctrl.dispatch({ type: 'answer_checkin', answer: 'ok' })
    expect(a.ctrl.snapshot().session.stuckStreak).toBe(0)

    const b = setup()
    advance(b.ctrl, 10)
    b.ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    b.ctrl.dispatch({ type: 'session_end', reason: 'manual' })
    b.ctrl.dispatch({ type: 'save_reflection', output: '' })
    expect(b.ctrl.snapshot().session.stuckStreak).toBe(1) // 세션이 끝나도 유지
    b.ctrl.dispatch({ type: 'day_end' })
    b.ctrl.dispatch({ type: 'day_start' })
    expect(b.ctrl.snapshot().session.stuckStreak).toBe(0) // 새 하루는 0부터
  })

  function stuckThreeTimes() {
    const made = setup()
    for (let i = 0; i < 3; i++) {
      advance(made.ctrl, 10)
      made.ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })
    }
    return made
  }

  it('연속 막힘 뒤에는 정지된 세션에서도 휴식을 시작할 수 있고, 휴식 중엔 재개할 수 없다', () => {
    const { ctrl } = stuckThreeTimes()
    ctrl.dispatch({ type: 'break_start' })
    expect(ctrl.snapshot().breakOpen).toBe(true)
    expect(() => ctrl.dispatch({ type: 'session_resume' })).toThrow('휴식')
  })

  it('휴식이 끝나면 세션이 정리(회고)되고, 막혔던 항목은 뒤로 밀려 다른 할 일이 추천된다', () => {
    const { ctrl } = stuckThreeTimes()
    ctrl.dispatch({ type: 'break_start' })
    clock += 5 * MIN
    ctrl.dispatch({ type: 'break_end' })
    expect(ctrl.snapshot().session.phase).toBe('reflecting')
    ctrl.dispatch({ type: 'save_reflection', output: '막혔음', cause: 'vague' })
    ctrl.dispatch({ type: 'reco_request' })
    expect(ctrl.snapshot().reco?.task.title).toBe('B') // A는 막혔으므로 B가 먼저
  })

  it('휴식 제안을 거절하고 계속하기를 누르면 세션이 재개된다', () => {
    const { ctrl } = stuckThreeTimes()
    ctrl.dispatch({ type: 'session_resume' })
    expect(ctrl.snapshot().session.phase).toBe('running')
    expect(() => ctrl.dispatch({ type: 'break_start' })).toThrow('세션')
  })

  it('연속 막힘이 아닌 일반 정지 상태에서는 세션 중 휴식을 거부한다', () => {
    const { ctrl } = setup()
    ctrl.dispatch({ type: 'session_pause' })
    expect(() => ctrl.dispatch({ type: 'break_start' })).toThrow('세션')
  })

  it('응답 시간 초과(timeout)는 막힘 카운터를 바꾸지 않고 다음 체크인을 예약한다', () => {
    const { ctrl, effects } = setup()
    advance(ctrl, 10)
    ctrl.dispatch({ type: 'answer_checkin', answer: 'timeout' })
    expect(ctrl.snapshot().stats.stuckCount).toBe(0)
    advance(ctrl, 10)
    expect(effects.filter((e) => e === 'checkin_due')).toHaveLength(2)
  })

  it('대기 중이 아닌 체크인 응답은 조용히 무시된다', () => {
    const { ctrl } = setup()
    expect(() => ctrl.dispatch({ type: 'answer_checkin', answer: 'stuck' })).not.toThrow()
    expect(ctrl.snapshot().stats.stuckCount).toBe(0)
  })

  it('timeScale을 주면 세션·체크인 시간이 그만큼 줄어든다', () => {
    const effects: string[] = []
    let n = 0
    const ctrl = new AppController({
      eventStore: new EventStore(join(dir, 'events')),
      settingsStore: new SettingsStore(join(dir, 'settings.json')),
      now: () => clock,
      newId: () => `s${++n}`,
      onEffect: (e) => effects.push(e.kind),
      timeScale: 60
    })
    ctrl.init()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    for (let i = 0; i < 10; i++) {
      clock += 1000
      ctrl.tick()
    }
    expect(effects).toEqual(['checkin_due']) // 10분이 아니라 10초 만에
  })
})

describe('하루 시작 알림·빠른 추천·설정·요약 (M5)', () => {
  function setup(opts: { applySettings?: (n: Settings, p: Settings) => void; timeScale?: number } = {}) {
    const prompts: { late: boolean }[] = []
    let n = 0
    const ctrl = new AppController({
      eventStore: new EventStore(join(dir, 'events')),
      settingsStore: new SettingsStore(join(dir, 'settings.json')),
      now: () => clock,
      newId: () => `t${++n}`,
      onDayStartPrompt: (info) => prompts.push(info),
      ...(opts.applySettings ? { applySettings: opts.applySettings } : {}),
      ...(opts.timeScale ? { timeScale: opts.timeScale } : {})
    })
    ctrl.init()
    return { ctrl, prompts }
  }
  const tickFor = (ctrl: AppController, sec: number): void => {
    for (let i = 0; i < sec; i++) {
      clock += 1000
      ctrl.tick()
    }
  }

  it('온보딩 전에는 하루 시작 알림을 띄우지 않는다', () => {
    clock = T0 + 10 * MIN // 09:10, 시작 시각(09:00) 이후
    const { ctrl, prompts } = setup()
    tickFor(ctrl, 30)
    expect(prompts).toEqual([])
  })

  it('지정 시각 이후 앱을 켜면 "늦었다"로 한 번만 알린다', () => {
    clock = T0 + 20 * MIN // 09:20
    const { ctrl, prompts } = setup()
    ctrl.dispatch(onboard) // dayStartTime 09:00
    tickFor(ctrl, 30)
    expect(prompts).toEqual([{ late: true }])
  })

  it('지정 시각 전에는 조용하다가 시각이 되면 알린다', () => {
    clock = T0 - 60_000 // 08:59
    const { ctrl, prompts } = setup()
    ctrl.dispatch(onboard)
    tickFor(ctrl, 30)
    expect(prompts).toEqual([])
    tickFor(ctrl, 60) // 09:00 지남
    expect(prompts).toEqual([{ late: false }])
  })

  it('하루를 시작하면 더 이상 알리지 않고, 종료 후에도 재촉하지 않는다', () => {
    clock = T0 + 20 * MIN
    const { ctrl, prompts } = setup()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'day_start' })
    tickFor(ctrl, 30)
    expect(prompts).toEqual([])
    ctrl.dispatch({ type: 'day_end' })
    tickFor(ctrl, 30)
    expect(prompts).toEqual([])
  })

  it('미루기: 10분 뒤에 다시 알린다 (timeScale 적용)', () => {
    clock = T0 + 20 * MIN
    const { ctrl, prompts } = setup({ timeScale: 60 }) // 10분 → 10초
    ctrl.dispatch(onboard)
    tickFor(ctrl, 10)
    expect(prompts).toHaveLength(1)
    ctrl.snoozeDayStart()
    tickFor(ctrl, 9)
    expect(prompts).toHaveLength(1)
    tickFor(ctrl, 6)
    expect(prompts).toHaveLength(2)
  })

  it('알림 시각을 바꾸면 오늘 이미 알렸어도 새 시각에 다시 알릴 수 있다', () => {
    clock = T0 + 20 * MIN // 09:20
    const { ctrl, prompts } = setup()
    ctrl.dispatch(onboard)
    tickFor(ctrl, 10)
    expect(prompts).toHaveLength(1)
    ctrl.dispatch({ type: 'update_settings', patch: { dayStartTime: '09:15' } })
    tickFor(ctrl, 10)
    expect(prompts).toHaveLength(2)
  })

  it('quickAsk: 하루가 열려 있고 할 일이 있으면 추천을 띄운다, 아니면 아무 일도 없다', () => {
    const { ctrl } = setup()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.quickAsk() // 하루 시작 전
    expect(ctrl.snapshot().reco).toBeNull()
    ctrl.dispatch({ type: 'day_start' })
    ctrl.quickAsk()
    expect(ctrl.snapshot().reco?.task.title).toBe('A')
    const shown = ctrl.snapshot().reco
    ctrl.quickAsk() // 이미 추천이 떠 있으면 바꾸지 않는다
    expect(ctrl.snapshot().reco).toEqual(shown)
  })

  it('quickAsk: 세션 중이거나 휴식 중이면 무시한다', () => {
    const { ctrl } = setup()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'break_start' })
    ctrl.quickAsk()
    expect(ctrl.snapshot().reco).toBeNull()
  })

  it('설정 변경: 값이 저장되고 applySettings에 이전·다음 값이 전달된다', () => {
    const calls: [string, string][] = []
    const { ctrl } = setup({ applySettings: (next, prev) => calls.push([prev.shortcut, next.shortcut]) })
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'update_settings', patch: { shortcut: 'Ctrl+Shift+K', sessionMin: 50 } })
    expect(ctrl.snapshot().settings).toMatchObject({ shortcut: 'Ctrl+Shift+K', sessionMin: 50 })
    expect(calls.at(-1)).toEqual([DEFAULT_SETTINGS.shortcut, 'Ctrl+Shift+K'])
    expect(setup().ctrl.snapshot().settings.sessionMin).toBe(50) // 재시작 후에도 유지
  })

  it('설정 변경: OS 반영(단축키 등록)이 실패하면 저장하지 않는다', () => {
    const { ctrl } = setup({
      applySettings: (next) => {
        if (next.shortcut === 'Bad') throw new Error('단축키를 등록하지 못했어요')
      }
    })
    ctrl.dispatch(onboard)
    expect(() => ctrl.dispatch({ type: 'update_settings', patch: { shortcut: 'Bad' } })).toThrow('등록하지 못했어요')
    expect(ctrl.snapshot().settings.shortcut).toBe(DEFAULT_SETTINGS.shortcut)
    expect(setup().ctrl.snapshot().settings.shortcut).toBe(DEFAULT_SETTINGS.shortcut)
  })

  it('설정 변경: 범위를 벗어난 값과 빈 목표는 거부한다', () => {
    const { ctrl } = setup()
    ctrl.dispatch(onboard)
    expect(() => ctrl.dispatch({ type: 'update_settings', patch: { checkinMin: 0 } })).toThrow('체크인 간격')
    expect(() => ctrl.dispatch({ type: 'update_settings', patch: { sessionMin: 500 } })).toThrow('세션 길이')
    expect(() => ctrl.dispatch({ type: 'update_settings', patch: { dayStartTime: '25:00' } })).toThrow('하루 시작 알림')
    expect(() => ctrl.dispatch({ type: 'update_settings', patch: { goal: '  ' } })).toThrow('목표')
    expect(ctrl.snapshot().settings.checkinMin).toBe(10)
  })

  it('온보딩에서 자동 실행을 켜면 applySettings가 autoLaunch=true로 호출된다', () => {
    const seen: boolean[] = []
    const { ctrl } = setup({ applySettings: (next) => seen.push(next.autoLaunch) })
    ctrl.dispatch({ ...onboard, autoLaunch: true } as Command)
    expect(seen).toEqual([true])
    expect(ctrl.snapshot().settings.autoLaunch).toBe(true)
  })

  it('온보딩에서 자동 실행을 고르지 않으면 꺼진 채로 둔다', () => {
    const seen: boolean[] = []
    const { ctrl } = setup({ applySettings: (next) => seen.push(next.autoLaunch) })
    ctrl.dispatch(onboard)
    expect(seen).toEqual([false])
  })

  it('스냅샷의 오늘 세션 기록에 산출물과 목표 연결이 들어간다', () => {
    const { ctrl } = setup()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
    clock += 12 * MIN
    ctrl.dispatch({ type: 'session_end', reason: 'done' })
    ctrl.dispatch({ type: 'save_reflection', output: '초안 완성', goalLink: 'yes' })
    const { sessions } = ctrl.snapshot()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ taskTitle: 'A', workMs: 12 * MIN, output: '초안 완성', goalLink: 'yes', endReason: 'done' })
  })

  it('setNotice는 안내 문구를 올리고 푸시한다', () => {
    const pushes: AppSnapshot[] = []
    const ctrl = new AppController({
      eventStore: new EventStore(join(dir, 'events')),
      settingsStore: new SettingsStore(join(dir, 'settings.json')),
      now: () => clock,
      onChange: (s) => pushes.push(s)
    })
    ctrl.init()
    ctrl.setNotice('단축키 등록 실패')
    expect(pushes.at(-1)?.notice).toBe('단축키 등록 실패')
  })
})

describe('측정 왜곡 방지: 자리 비움·절전·하루 경계 (회귀)', () => {
  function setup() {
    const effects: string[] = []
    let n = 0
    const ctrl = new AppController({
      eventStore: new EventStore(join(dir, 'events')),
      settingsStore: new SettingsStore(join(dir, 'settings.json')),
      now: () => clock,
      newId: () => `t${++n}`,
      onEffect: (e) => effects.push(e.kind === 'idle_pause' ? `idle_pause:${e.reason}` : e.kind)
    })
    ctrl.init()
    ctrl.dispatch(onboard)
    ctrl.dispatch({ type: 'task_add', title: 'A' })
    ctrl.dispatch({ type: 'day_start' })
    return { ctrl, effects }
  }
  const startSession = (ctrl: AppController): void => {
    ctrl.dispatch({ type: 'reco_request' })
    ctrl.dispatch({ type: 'session_start' })
  }
  /**
   * 1초 틱으로 시간을 흘린다. 체크인 토스트는 30초 뒤 응답 없이 사라진다고 가정하고(answer='timeout'),
   * present=true면 토스트가 뜨자마자 '진행 중'으로 응답한다.
   */
  function elapse(ctrl: AppController, effects: string[], minutes: number, present: boolean): void {
    let dueAt: number | null = null
    let seen = effects.filter((e) => e === 'checkin_due').length
    for (let i = 0; i < minutes * 60; i++) {
      clock += 1000
      ctrl.tick()
      const count = effects.filter((e) => e === 'checkin_due').length
      if (count > seen) {
        seen = count
        dueAt = clock
        if (present) {
          ctrl.dispatch({ type: 'answer_checkin', answer: 'ok' })
          dueAt = null
        }
      }
      if (dueAt !== null && clock - dueAt >= 30_000) {
        try { ctrl.dispatch({ type: 'answer_checkin', answer: 'timeout' }) } catch { /* 이미 정지 */ }
        dueAt = null
      }
    }
  }

  it('A) 세션을 켜 둔 채 자리를 비워도 작업 시간이 몇 시간씩 부풀지 않는다', () => {
    const { ctrl, effects } = setup()
    startSession(ctrl)
    elapse(ctrl, effects, 30, true) // 30분 정상 작업 (체크인마다 응답)
    elapse(ctrl, effects, 4 * 60, false) // 이후 4시간 자리 비움
    const s = ctrl.snapshot()
    expect(s.session.phase).toBe('paused')
    expect(s.session.pauseCause).toBe('idle')
    // 마지막 응답(30분) 뒤 첫 무응답 체크인(40분)까지만 센다 — 최대 한 체크인 간격(10분) 과대 계상
    expect(s.stats.workMs).toBeGreaterThanOrEqual(30 * MIN)
    expect(s.stats.workMs).toBeLessThanOrEqual(41 * MIN)
    expect(effects).toContain('idle_pause:checkin')
  })

  it('A-2) 자리 비움으로 멈춘 뒤 "계속 일하고 있었어요"로 이어가면 그 구간이 인정된다', () => {
    const { ctrl, effects } = setup()
    startSession(ctrl)
    elapse(ctrl, effects, 30, true)
    elapse(ctrl, effects, 30, false) // 40분에 소급 정지가 일어남
    expect(ctrl.snapshot().session.pauseCause).toBe('idle')
    ctrl.dispatch({ type: 'session_resume', credit: true })
    clock += 5 * MIN
    // 정지가 없었던 것처럼 이어진다: 약 60+5분
    expect(ctrl.snapshot().stats.workMs).toBeGreaterThanOrEqual(64 * MIN)
  })

  it('C) 25분 세션을 시작하고 방치해도 시간 종료 알림을 놓치면 25분 시점에서 멈춘다', () => {
    const { ctrl, effects } = setup()
    startSession(ctrl)
    elapse(ctrl, effects, 25, true) // 25분 (체크인 응답, 시간 종료 알림 발생)
    expect(effects).toContain('time_up')
    ctrl.dispatch({ type: 'time_up_expired' }) // 토스트가 응답 없이 사라짐
    clock += 3 * H // 그 뒤 3시간 방치
    ctrl.tick()
    const s = ctrl.snapshot()
    expect(s.session.pauseCause).toBe('idle')
    expect(s.stats.workMs).toBeGreaterThanOrEqual(25 * MIN)
    expect(s.stats.workMs).toBeLessThan(27 * MIN)
  })

  it('B-1) 하루 종료 없이 같은 날 긴 절전: 공백은 휴식으로 처리되어 분모에서 빠진다', () => {
    const { ctrl } = setup() // 09:00 시작
    clock += 30 * MIN
    for (let i = 0; i < 5; i++) { clock += 1000; ctrl.tick() }
    const before = ctrl.snapshot().stats.availableMs
    clock += 3 * H // 절전 3시간 (같은 날)
    ctrl.tick()
    clock += 30 * MIN
    const s = ctrl.snapshot()
    expect(s.breakOpen).toBe(false)
    expect(s.dayOpen).toBe(true)
    // 30분 + 30분만 측정 시간. 공백 3시간은 제외
    expect(s.stats.availableMs).toBeGreaterThanOrEqual(before + 29 * MIN)
    expect(s.stats.availableMs).toBeLessThan(62 * MIN)
    expect(s.stats.breakMs).toBeGreaterThanOrEqual(3 * H)
  })

  it('B-2) 공백이 30분 미만이면 하루 상태를 건드리지 않는다(세션만 소급 정지)', () => {
    const { ctrl } = setup()
    startSession(ctrl)
    for (let i = 0; i < 60; i++) { clock += 1000; ctrl.tick() }
    clock += 10 * MIN
    ctrl.tick()
    const s = ctrl.snapshot()
    expect(s.session.pauseCause).toBe('suspend')
    expect(s.stats.breakMs).toBe(0)
  })

  it('B-3) 자정을 넘기는 긴 공백: 그날은 마지막 활동 시각에 닫히고 안내가 뜬다', () => {
    clock = new Date(2026, 9, 12, 22, 0).getTime()
    const { ctrl } = setup()
    for (let i = 0; i < 30; i++) { clock += 1000; ctrl.tick() } // 22:00:30
    const lastActive = clock
    clock = new Date(2026, 9, 13, 8, 0).getTime() // 다음 날 아침 복귀
    ctrl.tick()
    const s = ctrl.snapshot()
    expect(s.dayOpen).toBe(false)
    expect(s.notice).toContain('22:00')
    expect(s.notice).toContain('끝난 것으로')
    const { events } = new EventStore(join(dir, 'events')).readAll()
    const dayEnd = events.find((e) => e.type === 'day_end')
    expect(dayEnd?.t).toBe(lastActive)
  })

  it('B-4) 자정 공백 중 세션이 열려 있었다면 회고 없이 그 시각에 종료(recovered)하고 idle로 돌아간다', () => {
    clock = new Date(2026, 9, 12, 22, 0).getTime()
    const { ctrl } = setup()
    startSession(ctrl)
    for (let i = 0; i < 30; i++) { clock += 1000; ctrl.tick() }
    clock = new Date(2026, 9, 13, 8, 0).getTime()
    ctrl.tick()
    expect(ctrl.snapshot().session.phase).toBe('idle')
    const { events } = new EventStore(join(dir, 'events')).readAll()
    expect(events.find((e) => e.type === 'session_end')).toMatchObject({ reason: 'recovered' })
    // 어제 하루 기준 작업 시간은 절전 전 30초 수준 — 밤새 흐르지 않았다
    const work = computeStats(events, clock).workMs
    expect(work).toBeLessThan(2 * MIN)
  })

  it('B-5) 새 날 아침에는 이어서 새 하루를 시작할 수 있다', () => {
    clock = new Date(2026, 9, 12, 22, 0).getTime()
    const { ctrl } = setup()
    clock = new Date(2026, 9, 13, 8, 0).getTime()
    ctrl.tick()
    ctrl.dispatch({ type: 'day_start' })
    expect(ctrl.snapshot().dayOpen).toBe(true)
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
