// JSONL 이벤트 로그 저장소. 월별 파일(YYYY-MM.jsonl)에 한 줄씩 추가한다. (기술설계.md §4.1)
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isAppEvent, sortByTime, type AppEvent } from '../../domain/events'

export interface ReadResult {
  events: AppEvent[]
  /** 파싱하지 못해 건너뛴 줄 수 (손상된 줄) */
  skipped: number
}

function monthFile(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`
}

export class EventStore {
  private readonly verified = new Set<string>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  append(event: AppEvent): void {
    const file = join(this.dir, monthFile(event.t))
    const prefix = this.needsNewline(file) ? '\n' : ''
    appendFileSync(file, `${prefix}${JSON.stringify(event)}\n`, 'utf8')
  }

  appendAll(events: readonly AppEvent[]): void {
    for (const e of events) this.append(e)
  }

  /** 모든 월 파일을 시간순으로 읽는다. 손상된 줄은 건너뛴다. */
  readAll(): ReadResult {
    const events: AppEvent[] = []
    let skipped = 0
    const files = readdirSync(this.dir)
      .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
      .sort()
    for (const f of files) {
      const text = readFileSync(join(this.dir, f), 'utf8')
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const parsed: unknown = JSON.parse(line)
          if (isAppEvent(parsed)) events.push(parsed)
          else skipped += 1
        } catch {
          skipped += 1
        }
      }
    }
    return { events: sortByTime(events), skipped }
  }

  /**
   * 비정상 종료로 마지막 줄이 개행 없이 잘렸다면, 다음 이벤트가 그 줄에 붙지 않도록
   * 파일마다 처음 추가할 때 한 번만 끝 문자를 확인한다.
   */
  private needsNewline(file: string): boolean {
    if (this.verified.has(file)) return false
    this.verified.add(file)
    if (!existsSync(file)) return false
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      if (size === 0) return false
      const buf = Buffer.alloc(1)
      readSync(fd, buf, 0, 1, size - 1)
      return buf[0] !== 0x0a
    } finally {
      closeSync(fd)
    }
  }
}
