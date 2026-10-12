// e2e: 자리 비움 감지 — 체크인 무응답 2회 → 소급 정지 토스트, "시간 인정" 이어가기, 시간 종료 무응답 → 정지, 끝내기.
// JUMPUP_TIME_SCALE=60 (체크인 10분 → 10초, 25분 세션 → 25초).
// 사용법: npm run build && npm run e2e:idle
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { launchOptions, mode } from './launch.mjs'

const dataDir = mkdtempSync(join(tmpdir(), 'jumpup-e2e-idle-'))
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'jumpup-shots')
mkdirSync(shots, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ goal: '포트폴리오 완성', successTargetPct: 40, dayStartTime: '23:59', sessionMin: 25, checkinMin: 10, onboarded: true })
)

console.log(`실행 대상: ${mode()}`)
const errors = []
const log = (m) => console.log(`✓ ${m}`)
const tid = (page, id) => page.getByTestId(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let app
try {
  app = await electron.launch(launchOptions({ JUMPUP_DATA_DIR: dataDir, JUMPUP_TIME_SCALE: '60' }))
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForLoadState('domcontentloaded')

  const toastPage = async () => {
    for (let i = 0; i < 100; i++) {
      const w = app.windows().find((p) => p.url().includes('toast.html'))
      if (w) { await w.waitForLoadState('domcontentloaded'); return w }
      await sleep(100)
    }
    throw new Error('토스트 창이 열리지 않았습니다')
  }
  const waitToast = async (id, timeout = 30000) => {
    const t = await toastPage()
    await tid(t, id).waitFor({ state: 'visible', timeout })
    return t
  }
  const widgetPage = () => app.windows().find((p) => p.url().includes('widget.html'))
  const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`) })
  const timerSec = async () => {
    const [mm, ss] = (await tid(page, 'timer').innerText()).split(':').map(Number)
    return mm * 60 + ss
  }

  // 준비
  await tid(page, 'home-before-day').waitFor()
  await page.getByRole('button', { name: '하루 시작' }).click()
  await tid(page, 'open-tasks').click()
  await tid(page, 'task-title').fill('글 초안 쓰기')
  await tid(page, 'task-title').press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-item"]').length === 1)
  await tid(page, 'back').click()
  await tid(page, 'ask').click()
  await tid(page, 'start').click()
  await tid(page, 'session').waitFor()
  log('준비 완료: 세션 시작 (시간 ×60) — 이후 체크인 토스트를 일부러 무시한다')

  // ── 1) 체크인 2번 무응답 → 자리 비움 정지 토스트 ─────────────────
  const idleToast = await waitToast('toast-idle', 40000)
  const msg = await tid(idleToast, 'toast-msg').innerText()
  assert.match(msg, /체크인 응답이 없어 멈췄어요/)
  await shot(idleToast, 'idle-1-toast')
  await tid(page, 'idle-note').waitFor()
  const w = widgetPage()
  assert.ok(w, '위젯이 떠 있다')
  await tid(w, 'widget-resume').waitFor()
  assert.match(await w.locator('.n').innerText(), /자리 비움/)
  assert.equal(await tid(w, 'widget-resume').innerText(), '이어가기')
  await shot(w, 'idle-2-widget')
  await shot(page, 'idle-3-session-idle')
  const frozen = await timerSec()
  await sleep(1500)
  assert.equal(await timerSec(), frozen, '자리 비움 정지 중에는 타이머가 멈춘다')
  assert.ok(frozen >= 8 && frozen <= 14, `첫 무응답 시각(≈10초)으로 소급해 멈췄다: ${frozen}s`)
  log(`체크인 2회 무응답 → ${frozen}초 시점으로 소급 정지, 토스트·위젯·메인 화면에 표시`)

  // ── 2) "계속 일하고 있었어요(시간 인정)" ───────────────────────
  await tid(idleToast, 'toast-idle-credit').click()
  await tid(page, 'pause').waitFor() // 다시 실행 중
  const credited = await timerSec()
  assert.ok(credited >= 20, `멈춘 구간이 인정되어 정지 없이 흐른 것처럼 이어진다: ${credited}s (인정 안 하면 ≈${frozen}s)`)
  log(`시간 인정 이어가기 → 타이머 ${frozen}s → ${credited}s (멈춘 구간 포함)`)

  // ── 3) 시간 종료 알림 무응답 → 계획 시간 시점으로 소급 정지 → 끝내기 ──
  const timeUp = await waitToast('toast-timeup', 20000)
  assert.match(await tid(timeUp, 'toast-msg').innerText(), /25분 지났어요/)
  const idle2 = await waitToast('toast-idle', 15000) // 시간 종료 토스트가 만료(≈3초)되면 자리 비움 정지
  assert.match(await tid(idle2, 'toast-msg').innerText(), /25분이 지난/)
  await shot(idle2, 'idle-4-timeup-idle')
  const frozen2 = await timerSec()
  assert.ok(frozen2 >= 24 && frozen2 <= 28, `계획 시간(25초) 시점으로 소급 정지: ${frozen2}s`)
  log(`시간 종료 알림 무응답 → 계획 시간(${frozen2}초) 시점으로 소급 정지`)

  await tid(idle2, 'toast-idle-end').click()
  await tid(page, 'reflection').waitFor()
  log('끝내기 → 회고 화면으로 이동')
  await tid(page, 'save-rest').click()
  await tid(page, 'home-break').waitFor()
  await page.getByRole('button', { name: '휴식 끝' }).click()
  await tid(page, 'day-end').click()
  await tid(page, 'summary').waitFor()
  await tid(page, 'back').click()
  await app.close()
  app = null

  // ── 이벤트 로그 ─────────────────────────────────────────────
  const file = readdirSync(join(dataDir, 'events'))[0]
  const events = readFileSync(join(dataDir, 'events', file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const pauses = events.filter((e) => e.type === 'session_pause').map((e) => e.cause)
  assert.deepEqual(pauses, ['idle', 'idle'], `자리 비움 정지 2회: ${pauses}`)
  const resume = events.find((e) => e.type === 'session_resume')
  assert.equal(resume?.credited, true, '시간 인정 재개가 기록된다')
  const answers = events.filter((e) => e.type === 'checkin').map((e) => e.answer)
  assert.deepEqual(answers.slice(0, 2), ['timeout', 'timeout'])
  log(`이벤트 로그: 정지 ${pauses.join('·')}, 재개 credited=true, 체크인 ${answers.join('·')}`)

  assert.deepEqual(errors, [], `렌더러 오류 없음: ${errors.join(' | ')}`)
  log('렌더러 콘솔·페이지 오류 없음')
  console.log(`\nPASS — 스크린샷: ${shots}`)
} catch (err) {
  console.error('\nFAIL —', err)
  console.error('errors:', errors)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    console.warn(`임시 폴더를 지우지 못했습니다: ${dataDir}`)
  }
}
