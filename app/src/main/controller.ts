// 앱 상태의 단일 출처. Electron에 의존하지 않으므로 단독으로 테스트할 수 있다.
// 이벤트 로그 + 설정 + 세션 상태 머신을 묶고, 렌더러 명령(Command)을 검증해 적용한다.
import { randomUUID } from 'node:crypto'
import { dayState } from '../domain/dayState'
import {
  makeEvent,
  type AppEvent,
  type EventBody,
  type TaskSize
} from '../domain/events'
import { recommend, rescueStep, type RecoTask } from '../domain/recommender'
import { recoverEvents } from '../domain/recovery'
import {
  initialSessionState,
  reduce,
  type ReduceResult,
  type SessionAction,
  type SessionEffect,
  type SessionState
} from '../domain/sessionMachine'
import { computeStats } from '../domain/stats'
import { foldTasks, openTasks, type Task } from '../domain/tasks'
import type { Settings } from '../domain/settings'
import type { AppSnapshot, Command, RecoView } from '../shared/ipc'
import type { EventStore } from './store/eventStore'
import type { SettingsStore } from './store/settingsStore'

export interface ControllerDeps {
  eventStore: EventStore
  settingsStore: SettingsStore
  now?: () => number
  newId?: () => string
  /** 상태가 바뀔 때마다 호출 (렌더러로 푸시) */
  onChange?: (snapshot: AppSnapshot) => void
  /** 체크인·막힘 대응·휴식 제안 같은 사용자 알림이 필요할 때 호출 (토스트) */
  onEffect?: (effect: SessionEffect) => void
  /**
   * 세션·체크인 시간을 이 값으로 나눈다. 테스트에서 10분 간격을 수 초로 줄이는 용도이며
   * 사용자 설정이 아니다(기본 1).
   */
  timeScale?: number
}

/** 1초 틱 사이가 이만큼 벌어지면 절전·정지가 있었던 것으로 본다. */
const SLEEP_GAP_MS = 60_000
const TITLE_MAX = 200
const OUTPUT_MAX = 500
const SIZES: readonly TaskSize[] = ['small', 'medium', 'large']

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function toRecoTask(task: Task): RecoTask {
  const r: RecoTask = { id: task.id, title: task.title }
  if (task.due !== undefined) r.due = task.due
  if (task.size !== undefined) r.size = task.size
  return r
}

export class AppController {
  private events: AppEvent[] = []
  private settings: Settings
  private session: SessionState = initialSessionState()
  private reco: RecoView | null = null
  private rejected: string[] = []
  private notice: string | null = null
  private lastTickAt: number | null = null
  /** 연속 막힘으로 세션이 정지되어 휴식을 제안한 상태. 이때만 세션 중 휴식을 허용한다. */
  private stuckBreakPending = false
  private readonly now: () => number
  private readonly newId: () => string
  private readonly timeScale: number

  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
    this.timeScale = deps.timeScale && deps.timeScale > 0 ? deps.timeScale : 1
    this.settings = deps.settingsStore.load()
  }

  /** 로그를 읽고 비정상 종료를 보정한다. 앱 시작 시 한 번 호출. */
  init(): void {
    const { events } = this.deps.eventStore.readAll()
    this.events = events
    const recovery = recoverEvents(events, this.now())
    this.record(recovery.events)
    this.notice = recovery.notice
  }

  snapshot(): AppSnapshot {
    const now = this.now()
    const tasks = foldTasks(this.events)
    const ds = dayState(this.events)
    const todayStart = startOfDay(now)
    const from =
      ds.dayOpen && ds.dayStartedAt !== null ? Math.min(ds.dayStartedAt, todayStart) : todayStart
    const stats = computeStats(
      this.events.filter((e) => e.t >= from),
      now
    )
    return {
      now,
      settings: this.settings,
      tasks,
      openTaskCount: openTasks(tasks).length,
      dayOpen: ds.dayOpen,
      breakOpen: ds.breakOpen,
      dayStartedAt: ds.dayStartedAt,
      session: this.session,
      sessionTask: this.session.taskId ? (tasks.find((t) => t.id === this.session.taskId) ?? null) : null,
      reco: this.reco,
      stats,
      notice: this.notice
    }
  }

  /**
   * 절전 진입(powerMonitor 'suspend'). 실행 중인 세션을 일시정지한다.
   * 복귀 시 자동으로 재개하지 않는다 — 자리를 비운 시간을 작업으로 세지 않기 위해 사용자가 이어간다.
   */
  suspend(): void {
    if (this.session.phase !== 'running') return
    this.runSession({ type: 'pause', cause: 'suspend' })
    this.deps.onChange?.(this.snapshot())
  }

  /**
   * 1초마다 호출. 틱 사이가 비정상적으로 벌어졌다면(절전 이벤트를 놓친 경우 등)
   * 마지막으로 살아있던 시각에 일시정지를 소급 기록한다.
   */
  tick(): void {
    const now = this.now()
    const prev = this.lastTickAt
    this.lastTickAt = now
    if (this.session.phase !== 'running') return

    if (prev !== null && now - prev > SLEEP_GAP_MS) {
      this.runSession({ type: 'pause', cause: 'suspend' }, prev)
      this.deps.onChange?.(this.snapshot())
      return
    }
    // 체크인 시각·계획 시간 도달 여부. 상태가 바뀐 경우에만 푸시한다.
    const before = this.session
    this.runSession({ type: 'tick' })
    if (this.session !== before) this.deps.onChange?.(this.snapshot())
  }

  saveWidgetPos(pos: { x: number; y: number }): void {
    this.settings = this.deps.settingsStore.update({ widgetPos: pos })
  }

  /** 30초마다 호출. 하루나 세션이 열려 있을 때만 기록한다. */
  heartbeat(): void {
    const ds = dayState(this.events)
    const active = this.session.phase === 'running' || this.session.phase === 'paused'
    if (ds.dayOpen || active) this.append({ type: 'heartbeat' })
  }

  /** 렌더러 명령을 검증·적용한다. 잘못된 명령은 Error를 던진다(메시지는 사용자에게 보여도 됨). */
  dispatch(cmd: Command): void {
    this.apply(cmd)
    this.deps.onChange?.(this.snapshot())
  }

  // ─────────────────────────────────────────────

  private apply(cmd: Command): void {
    const ds = dayState(this.events)
    switch (cmd.type) {
      case 'complete_onboarding': {
        const goal = String(cmd.goal ?? '').trim()
        if (!goal) throw new Error('목표를 한 줄 입력하세요.')
        this.settings = this.deps.settingsStore.update({
          goal,
          successTargetPct: cmd.successTargetPct,
          dayStartTime: cmd.dayStartTime,
          onboarded: true
        })
        return
      }

      case 'task_add': {
        const title = String(cmd.title ?? '').trim().slice(0, TITLE_MAX)
        if (!title) throw new Error('할 일 제목을 입력하세요.')
        const body: EventBody = { type: 'task_add', id: this.newId(), title }
        if (cmd.due !== undefined && Number.isFinite(cmd.due)) body.due = cmd.due
        if (cmd.size !== undefined && SIZES.includes(cmd.size)) body.size = cmd.size
        this.append(body)
        return
      }

      case 'task_done':
      case 'task_delete': {
        this.requireTask(cmd.id)
        this.append({ type: cmd.type, id: cmd.id })
        if (this.reco?.task.id === cmd.id) this.reco = null
        return
      }

      case 'day_start':
        if (!ds.dayOpen) {
          this.append({ type: 'day_start' })
          this.runSession({ type: 'reset_streak' }) // 어제의 막힘을 오늘로 가져오지 않는다
        }
        return

      case 'day_end':
        if (this.session.phase !== 'idle') throw new Error('진행 중인 세션을 먼저 끝내세요.')
        if (ds.breakOpen) this.append({ type: 'break_end' })
        if (ds.dayOpen) this.append({ type: 'day_end' })
        this.reco = null
        this.rejected = []
        return

      case 'break_start': {
        this.requireDayOpen(ds.dayOpen)
        const stuckBreak = this.session.phase === 'paused' && this.stuckBreakPending
        if (this.session.phase !== 'idle' && !stuckBreak) {
          throw new Error('진행 중인 세션을 먼저 끝내세요.')
        }
        if (!ds.breakOpen) this.append({ type: 'break_start' })
        this.reco = null
        return
      }

      case 'break_end':
        if (ds.breakOpen) this.append({ type: 'break_end' })
        if (this.stuckBreakPending && this.session.phase === 'paused') {
          // 연속 막힘 뒤 휴식을 마쳤다: 세션을 정리(회고)하고, 막혔던 항목은 뒤로 미룬다.
          if (this.session.taskId) this.rejected.push(this.session.taskId)
          this.runSession({ type: 'end', reason: 'manual' })
        }
        this.stuckBreakPending = false
        return

      case 'reco_request':
        this.requireDayOpen(ds.dayOpen)
        if (ds.breakOpen) throw new Error('휴식 중입니다. 휴식을 끝내세요.')
        if (this.session.phase !== 'idle') throw new Error('이미 세션이 진행 중입니다.')
        this.showReco()
        return

      case 'reco_reject': {
        if (!this.reco) return
        const prevId = this.reco.task.id
        this.rejected.push(prevId)
        this.showReco(prevId)
        return
      }

      case 'session_start': {
        this.requireDayOpen(ds.dayOpen)
        if (ds.breakOpen) throw new Error('휴식 중입니다. 휴식을 끝내세요.')
        if (!this.reco) throw new Error('먼저 추천을 받으세요.')
        const taskId = this.reco.task.id
        this.stuckBreakPending = false
        this.runSession({
          type: 'start',
          taskId,
          plannedMin: this.settings.sessionMin / this.timeScale,
          checkinMin: this.settings.checkinMin / this.timeScale
        })
        this.reco = null
        this.rejected = []
        return
      }

      case 'session_pause':
        this.runSession({ type: 'pause', cause: 'user' })
        return

      case 'session_resume':
        if (ds.breakOpen) throw new Error('휴식 중입니다. 휴식을 끝내세요.')
        this.stuckBreakPending = false
        this.runSession({ type: 'resume' })
        return

      case 'answer_checkin':
        if (!['ok', 'stuck', 'timeout'].includes(cmd.answer)) throw new Error('알 수 없는 응답입니다.')
        this.runSession({ type: 'answer_checkin', answer: cmd.answer })
        return

      case 'session_end': {
        const taskId = this.session.taskId
        const before = this.session.phase
        this.stuckBreakPending = false
        this.runSession({ type: 'end', reason: cmd.reason })
        if (cmd.reason === 'done' && taskId && before !== 'idle') {
          this.append({ type: 'task_done', id: taskId })
        }
        return
      }

      case 'save_reflection': {
        const output = String(cmd.output ?? '').trim().slice(0, OUTPUT_MAX)
        this.runSession({
          type: 'save_reflection',
          output,
          ...(cmd.goalLink ? { goalLink: cmd.goalLink } : {}),
          ...(cmd.cause ? { cause: cmd.cause } : {})
        })
        return
      }

      case 'dismiss_notice':
        this.notice = null
        return
    }
  }

  private requireDayOpen(dayOpen: boolean): void {
    if (!dayOpen) throw new Error('먼저 하루를 시작하세요.')
  }

  private requireTask(id: string): void {
    if (!foldTasks(this.events).some((t) => t.id === id)) throw new Error('없는 할 일입니다.')
  }

  private runSession(action: SessionAction, at: number = this.now()): ReduceResult {
    const result = reduce(this.session, action, at)
    this.session = result.state
    this.record(result.events)
    this.emit(result.effects)
    return result
  }

  private emit(effects: readonly SessionEffect[]): void {
    for (const effect of effects) {
      if (effect.kind === 'suggest_break') this.stuckBreakPending = true
      this.deps.onEffect?.(effect)
    }
  }

  private showReco(prevId?: string): void {
    const candidates = openTasks(foldTasks(this.events)).map(toRecoTask)
    const r = recommend(candidates, this.now(), { recentRejectedIds: this.rejected })
    if (!r) {
      this.reco = null
      return
    }
    // 후보가 하나뿐이라 같은 항목이 다시 나오면 첫 행동만 더 작게 줄인다.
    const firstStep = prevId === r.task.id ? rescueStep(1) : r.firstStep
    this.append({ type: 'reco_shown', taskId: r.task.id, source: 'rule' })
    this.reco = { task: r.task, firstStep, reason: r.reason }
  }

  private append(body: EventBody): void {
    this.record([makeEvent(body, this.now())])
  }

  private record(events: readonly AppEvent[]): void {
    if (events.length === 0) return
    this.deps.eventStore.appendAll(events)
    this.events.push(...events)
  }
}
