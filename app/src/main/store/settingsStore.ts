// 설정 JSON 저장소. 임시 파일에 쓴 뒤 rename으로 원자적으로 교체한다.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../../domain/settings'

export class SettingsStore {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true })
  }

  /** 파일이 없거나 손상되었으면 기본값을 돌려준다. */
  load(): Settings {
    if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS }
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(settings: Settings): void {
    const next = normalizeSettings(settings)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  update(patch: Partial<Settings>): Settings {
    const next = normalizeSettings({ ...this.load(), ...patch })
    this.save(next)
    return next
  }
}
