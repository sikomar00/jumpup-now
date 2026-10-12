// e2e: 체크인 토스트 · 막힘 대응 · 연속 막힘 휴식 · 응답 시간 초과 · 시간 종료.
// JUMPUP_TIME_SCALE=60 으로 앱 시간을 60배 빠르게 돌린다(10분 체크인 → 10초, 40분 세션 → 40초).
// 사용법: npm run build && npm run e2e:checkin
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = mkdtempSync(join(tmpdir(), 'jumpup-e2e-checkin-'))
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'jumpup-shots')
mkdirSync(shots, { recursive: true })

// 온보딩을 건너뛰도록 설정을 미리 심는다. 세션 40분 / 체크인 10분 (배율 60 → 40초 / 10초)
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ goal: '포트폴리오 완성', successTargetPct: 40, dayStartTime: '09:00', sessionMin: 40, checkinMin: 10, onboarded: true })
)

const errors = []
const log = (m) => console.log(`✓ ${m}`)
const tid = (page, id) => page.getByTestId(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [appDir],
    cwd: appDir,
    env: { ...process.env, JUMPUP_DATA_DIR: dataDir, JUMPUP_TIME_SCALE: '60' }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForLoadState('domcontentloaded')

  /** 토스트 창의 페이지 (처음 토스트가 뜰 때 만들어진다) */
  const toastPage = async () => {
    for (let i = 0; i < 100; i++) {
      const w = app.windows().find((p) => p.url().includes('toast.html'))
      if (w) {
        await w.waitForLoadState('domcontentloaded')
        return w
      }
      await sleep(100)
    }
    throw new Error('토스트 창이 열리지 않았습니다')
  }
  const toastWin = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('toast.html'))
      return w ? { visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), focused: w.isFocused(), focusable: w.isFocusable() } : null
    })
  const widgetVisible = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('widget.html'))
      return w ? w.isVisible() : null
    })
  const waitToast = async (id, timeout = 25000) => {
    const t = await toastPage()
    await tid(t, id).waitFor({ state: 'visible', timeout })
    return t
  }
  const waitToastGone = async (timeout = 8000) => {
    const t = await toastPage()
    await t.locator('[data-testid^="toast-"]').first().waitFor({ state: 'hidden', timeout })
    for (let i = 0; i < 30 && (await toastWin())?.visible; i++) await sleep(100)
    assert.equal((await toastWin()).visible, false, '토스트 창이 숨겨진다')
  }
  const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`) })

  // ── 준비: 할 일 2개, 하루 시작, 세션 시작 ──────────────────────
  await tid(page, 'home-before-day').waitFor()
  await page.getByRole('button', { name: '하루 시작' }).click()
  await tid(page, 'open-tasks').click()
  for (const title of ['글 초안 쓰기', '자료 정리하기']) {
    await tid(page, 'task-title').fill(title)
    await tid(page, 'task-title').press('Enter')
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-item"]').length === 2)
  await tid(page, 'back').click()
  await tid(page, 'ask').click()
  assert.equal(await tid(page, 'reco-title').innerText(), '글 초안 쓰기')
  await tid(page, 'start').click()
  await tid(page, 'session').waitFor()
  log('준비 완료: 세션 시작 (시간 ×60)')

  // ── 1) 체크인 토스트 → 막혔어요 → 막힘 대응(1단계) ──────────────
  let t = await waitToast('toast-checkin')
  const w1 = await toastWin()
  assert.equal(w1.visible, true)
  assert.equal(w1.alwaysOnTop, true, '토스트는 항상 위')
  assert.equal(w1.focusable, false, '토스트는 포커스를 받지 않는다')
  assert.equal(w1.focused, false)
  assert.equal(await tid(t, 'toast-msg').innerText(), '지금 하던 거 이어가고 있어요?')
  await shot(t, 'm4-1-checkin')
  await tid(t, 'toast-stuck').click()
  t = await waitToast('toast-rescue', 5000)
  assert.match(await tid(t, 'toast-msg').innerText(), /2분/)
  await shot(t, 'm4-2-rescue1')
  await tid(t, 'toast-accept').click()
  await waitToastGone()
  log('체크인 토스트(항상 위·포커스 비침범) → 막혔어요 → 막힘 대응 1단계(2분)')

  // ── 2) 두 번째 막힘 → 2단계(1분) ─────────────────────────────
  t = await waitToast('toast-checkin')
  await tid(t, 'toast-stuck').click()
  t = await waitToast('toast-rescue', 5000)
  assert.match(await tid(t, 'toast-msg').innerText(), /1분/)
  await tid(t, 'toast-accept').click()
  await waitToastGone()
  log('막힘 대응 2단계(1분)로 더 작아짐')

  // ── 3) 세 번째 연속 막힘 → 휴식 제안, 세션 정지 ────────────────
  t = await waitToast('toast-checkin')
  await tid(t, 'toast-stuck').click()
  t = await waitToast('toast-break', 5000)
  assert.match(await tid(t, 'toast-msg').innerText(), /5분 쉬세요/)
  await shot(t, 'm4-3-break')
  await tid(page, 'resume').waitFor() // 메인 창: 세션이 정지됨
  log('3회 연속 막힘 → 5분 휴식 제안, 세션 자동 정지')

  await tid(t, 'toast-start-break').click()
  await tid(page, 'home-break').waitFor()
  await waitToastGone()
  assert.equal(await widgetVisible(), false, '휴식 중에는 위젯을 숨긴다')
  await shot(page, 'm4-4-break-home')
  log('휴식 시작 → 휴식 화면, 토스트·위젯 숨김')

  await page.getByRole('button', { name: '휴식 끝' }).click()
  await tid(page, 'reflection').waitFor()
  await page.getByRole('button', { name: '모호함' }).click() // 막힘이 있었으므로 원인 태그가 보인다
  await tid(page, 'output').fill('시작을 못 했다')
  await shot(page, 'm4-5-reflection-cause')
  await tid(page, 'save-next').click()
  await tid(page, 'reco').waitFor()
  assert.equal(await tid(page, 'reco-title').innerText(), '자료 정리하기', '막혔던 항목은 뒤로 밀리고 다른 할 일이 추천된다')
  log('휴식 후 세션 정리(회고, 원인 태그) → 막혔던 항목 대신 다른 할 일 추천')

  // ── 4) 응답 없는 체크인 → 시간 초과 처리 ───────────────────────
  await tid(page, 'start').click()
  t = await waitToast('toast-checkin')
  const startedWait = Date.now()
  await waitToastGone(8000) // 응답하지 않으면 3초 뒤 스스로 사라진다
  const waited = Date.now() - startedWait
  assert.ok(waited >= 2000 && waited <= 6000, `응답 없는 토스트는 약 3초 뒤 사라짐 (${waited}ms)`)
  log(`응답 없는 체크인 토스트가 ${Math.round(waited / 100) / 10}초 뒤 스스로 사라짐`)

  // ── 5) 진행 중 응답 2번 → 시간 종료 토스트 → 마무리 ─────────────
  t = await waitToast('toast-checkin')
  await tid(t, 'toast-ok').click()
  await waitToastGone()
  t = await waitToast('toast-checkin')
  await tid(t, 'toast-ok').click()
  await waitToastGone()
  t = await waitToast('toast-timeup', 20000)
  assert.match(await tid(t, 'toast-msg').innerText(), /40분 지났어요/)
  await shot(t, 'm4-6-timeup')
  await tid(t, 'toast-finish').click()
  await tid(page, 'reflection').waitFor()
  await waitToastGone()
  log('진행 중 응답 → 시간 종료 토스트 → 마무리 → 회고 화면')
  await tid(page, 'save-rest').click()
  await tid(page, 'home-break').waitFor()
  await page.getByRole('button', { name: '휴식 끝' }).click()
  await tid(page, 'day-end').click()
  await tid(page, 'home-before-day').waitFor()
  await app.close()
  app = null

  // ── 이벤트 로그 확인 ─────────────────────────────────────────
  const file = readdirSync(join(dataDir, 'events'))[0]
  const events = readFileSync(join(dataDir, 'events', file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const answers = events.filter((e) => e.type === 'checkin').map((e) => e.answer)
  assert.deepEqual(answers, ['stuck', 'stuck', 'stuck', 'timeout', 'ok', 'ok'], `체크인 응답 기록: ${answers}`)
  const ends = events.filter((e) => e.type === 'session_end').map((e) => e.reason)
  assert.deepEqual(ends, ['manual', 'timeout'], `세션 종료 사유: ${ends}`)
  const reflection = events.find((e) => e.type === 'reflection' && e.cause)
  assert.equal(reflection?.cause, 'vague')
  const pause = events.find((e) => e.type === 'session_pause')
  assert.equal(pause?.cause, 'user')
  log(`이벤트 로그: 체크인 응답 ${answers.join('·')}, 세션 종료 ${ends.join('·')}, 원인 태그 vague`)

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
