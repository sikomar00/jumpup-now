// 도그푸딩 기준선 리포트 CLI.
//   npm run report                    → %APPDATA%\JumpUp Now\events 를 읽는다
//   npm run report -- <이벤트 폴더>   → 다른 폴더(예: 백업)를 읽는다
// 읽기 전용이다. 앱이 실행 중이어도 안전하다(로그는 추가 전용).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { baselineOf, summarizeByDay } from '../src/domain/report'
import { EventStore } from '../src/main/store/eventStore'

const dir = process.argv[2] ?? join(process.env.APPDATA ?? '', 'JumpUp Now', 'events')
if (!existsSync(dir)) {
  console.error(`이벤트 폴더가 없습니다: ${dir}\n앱을 한 번도 실행하지 않았거나 경로가 다릅니다. 경로를 인자로 넘겨 주세요.`)
  process.exit(1)
}

const { events, skipped } = new EventStore(dir).readAll()
const days = summarizeByDay(events, Date.now())
const base = baselineOf(days)

const pct = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`)
const hm = (ms: number): string => {
  const min = Math.round(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m` : `${min}m`
}
const lat = (ms: number | null): string => (ms === null ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : hm(ms))

console.log(`읽은 폴더: ${dir}`)
console.log(`이벤트 ${events.length}개${skipped ? ` (손상된 줄 ${skipped}개 건너뜀)` : ''}, 기록된 날 ${days.length}일\n`)

if (days.length === 0) {
  console.log('아직 하루 시작 기록이 없습니다.')
  process.exit(0)
}

console.log('날짜        실질작업  측정시간  비율  착수지연  막힘  세션  목표✓   기준선 포함')
for (const d of days) {
  const s = d.stats
  console.log(
    [
      d.date.padEnd(11),
      hm(s.workMs).padStart(8),
      hm(s.availableMs).padStart(9),
      pct(s.ratio).padStart(5),
      lat(s.medianStartLatencyMs).padStart(8),
      String(s.stuckCount).padStart(5),
      String(s.sessionCount).padStart(5),
      (d.goalRated ? `${d.goalYes}/${d.goalRated}` : '—').padStart(6),
      d.usable ? '   예' : '   아니오(30분 미만)'
    ].join(' ')
  )
}

console.log('\n── 기준선 (측정 30분 이상인 날만) ──')
console.log(`사용 가능한 날: ${base.usableDays}일 / 전체 ${base.days}일`)
console.log(`실질 작업비율  중앙값 ${pct(base.medianRatio)}, 평균 ${pct(base.meanRatio)}   (앱 도입 전 자가 추정: 약 20%)`)
console.log(`착수 지연 중앙값: ${lat(base.medianStartLatencyMs)}`)
console.log(`막혔어요 합계 ${base.totalStuck}회 / 세션 ${base.totalSessions}개`)
if (base.usableDays < 5) console.log('\n※ 사용 가능한 날이 5일 미만입니다. 기준선으로 쓰기에는 이릅니다.')
