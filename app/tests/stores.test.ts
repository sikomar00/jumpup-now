import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeEvent } from '../src/domain/events'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/domain/settings'
import { foldTasks, openTasks } from '../src/domain/tasks'
import { EventStore } from '../src/main/store/eventStore'
import { SettingsStore } from '../src/main/store/settingsStore'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jumpup-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('EventStore', () => {
  it('추가한 이벤트를 시간순으로 읽는다', () => {
    const store = new EventStore(join(dir, 'events'))
    store.append(makeEvent({ type: 'day_end' }, 2000))
    store.append(makeEvent({ type: 'day_start' }, 1000))
    const { events, skipped } = store.readAll()
    expect(events.map((e) => e.type)).toEqual(['day_start', 'day_end'])
    expect(skipped).toBe(0)
  })

  it('월별 파일로 나뉘어 저장된다', () => {
    const store = new EventStore(join(dir, 'events'))
    store.append(makeEvent({ type: 'heartbeat' }, new Date(2026, 8, 30, 12).getTime()))
    store.append(makeEvent({ type: 'heartbeat' }, new Date(2026, 9, 1, 12).getTime()))
    expect(readdirSync(join(dir, 'events')).sort()).toEqual(['2026-09.jsonl', '2026-10.jsonl'])
    expect(store.readAll().events).toHaveLength(2)
  })

  it('손상된 줄은 건너뛰고 개수를 알려준다', () => {
    const eventsDir = join(dir, 'events')
    const store = new EventStore(eventsDir)
    const t = new Date(2026, 9, 12, 9).getTime()
    store.append(makeEvent({ type: 'day_start' }, t))
    appendFileSync(join(eventsDir, '2026-10.jsonl'), '{"t": 1, "type": "bogus"}\nnot json\n')
    store.append(makeEvent({ type: 'day_end' }, t + 1000))
    const { events, skipped } = store.readAll()
    expect(events.map((e) => e.type)).toEqual(['day_start', 'day_end'])
    expect(skipped).toBe(2)
  })

  it('개행 없이 잘린 마지막 줄 뒤에 추가해도 새 이벤트가 살아있다', () => {
    const eventsDir = join(dir, 'events')
    const t = new Date(2026, 9, 12, 9).getTime()
    new EventStore(eventsDir).append(makeEvent({ type: 'day_start' }, t))
    // 비정상 종료로 잘린 줄 시뮬레이션: 개행 없는 불완전 JSON
    appendFileSync(join(eventsDir, '2026-10.jsonl'), '{"t": 5, "type": "heart')

    const reopened = new EventStore(eventsDir) // 앱 재시작
    reopened.append(makeEvent({ type: 'day_end' }, t + 1000))
    const { events, skipped } = reopened.readAll()
    expect(events.map((e) => e.type)).toEqual(['day_start', 'day_end'])
    expect(skipped).toBe(1)
  })
})

describe('SettingsStore', () => {
  it('파일이 없으면 기본값을 돌려준다', () => {
    expect(new SettingsStore(join(dir, 's', 'settings.json')).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('저장 후 다시 읽으면 같은 값이고 임시 파일이 남지 않는다', () => {
    const file = join(dir, 'settings.json')
    const store = new SettingsStore(file)
    store.update({ goal: '포트폴리오 완성', successTargetPct: 50, onboarded: true })
    expect(new SettingsStore(file).load()).toMatchObject({
      goal: '포트폴리오 완성',
      successTargetPct: 50,
      onboarded: true
    })
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('손상된 파일은 기본값으로 복구한다', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{ broken')
    expect(new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('범위를 벗어난 값은 기본값으로 대체한다', () => {
    const s = normalizeSettings({ checkinMin: -5, sessionMin: 9999, dayStartTime: '25:99', successTargetPct: 'x' })
    expect(s.checkinMin).toBe(DEFAULT_SETTINGS.checkinMin)
    expect(s.sessionMin).toBe(DEFAULT_SETTINGS.sessionMin)
    expect(s.dayStartTime).toBe(DEFAULT_SETTINGS.dayStartTime)
    expect(s.successTargetPct).toBe(DEFAULT_SETTINGS.successTargetPct)
  })

  it('저장 파일은 사람이 읽을 수 있는 JSON이다', () => {
    const file = join(dir, 'settings.json')
    new SettingsStore(file).update({ goal: '목표' })
    expect(JSON.parse(readFileSync(file, 'utf8')).goal).toBe('목표')
  })
})

describe('foldTasks', () => {
  it('추가·수정·완료·삭제를 로그에서 복원한다', () => {
    const e = (t: number, body: Parameters<typeof makeEvent>[0]) => makeEvent(body, t)
    const tasks = foldTasks([
      e(1, { type: 'task_add', id: 'a', title: '개요', due: 5000, size: 'small' }),
      e(2, { type: 'task_add', id: 'b', title: '자료 읽기' }),
      e(3, { type: 'task_add', id: 'c', title: '삭제될 것' }),
      e(4, { type: 'task_update', id: 'a', title: '개요 쓰기', due: null, size: 'medium' }),
      e(5, { type: 'task_done', id: 'b' }),
      e(6, { type: 'task_delete', id: 'c' })
    ])
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(tasks[0]).toMatchObject({ title: '개요 쓰기', size: 'medium', done: false })
    expect(tasks[0]!.due).toBeUndefined()
    expect(tasks[1]!.done).toBe(true)
    expect(openTasks(tasks).map((t) => t.id)).toEqual(['a'])
  })
})
