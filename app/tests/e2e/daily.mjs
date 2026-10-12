// e2e: 하루 시작 알림(미루기) · 트레이 상주 · 전역 단축키 · 설정 화면 · 하루 요약.
// JUMPUP_TIME_SCALE=60 (미루기 10분 → 10초), JUMPUP_E2E=1 (트레이·단축키 훅 노출).
// 사용법: npm run build && npm run e2e:daily
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = mkdtempSync(join(tmpdir(), 'jumpup-e2e-daily-'))
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'jumpup-shots')
mkdirSync(shots, { recursive: true })

// 하루 시작 알림 시각을 "10분 전"(늦음 기준 5분 초과)으로 심어 앱이 켜지자마자 "아직 시작 안 했어요"가 뜨게 한다.
const twoMinAgo = new Date(Date.now() - 10 * 60_000)
const sameDay = twoMinAgo.getDate() === new Date().getDate()
const hhmm = sameDay
  ? `${String(twoMinAgo.getHours()).padStart(2, '0')}:${String(twoMinAgo.getMinutes()).padStart(2, '0')}`
  : '00:00'
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ goal: '포트폴리오 완성', successTargetPct: 40, dayStartTime: hhmm, shortcut: 'Ctrl+Alt+Shift+F11', sessionMin: 25, checkinMin: 10, onboarded: true })
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
    env: { ...process.env, JUMPUP_DATA_DIR: dataDir, JUMPUP_TIME_SCALE: '60', JUMPUP_E2E: '1' }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForLoadState('domcontentloaded')

  const hook = (fn, arg) =>
    app.evaluate((_e, { fn, arg }) => globalThis.__jumpup[fn](arg), { fn, arg })
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
  const waitToast = async (id, timeout = 25000) => {
    const t = await toastPage()
    await tid(t, id).waitFor({ state: 'visible', timeout })
    return t
  }
  const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`) })

  // ── 1) 하루 시작 알림: 늦은 문구 → 10분 뒤(미루기) → 다시 알림 → 하루 시작 ──
  await tid(page, 'home-before-day').waitFor()
  let t = await waitToast('toast-daystart', 15000)
  assert.equal(await tid(t, 'toast-msg').innerText(), '오늘 아직 시작 안 했어요.')
  await shot(t, 'm5-1-daystart')
  await tid(t, 'toast-snooze').click()
  await t.locator('[data-testid^="toast-"]').first().waitFor({ state: 'hidden', timeout: 5000 })
  log('앱을 켜자마자 "오늘 아직 시작 안 했어요" 알림 → 10분 뒤(미루기)')

  t = await waitToast('toast-daystart', 25000) // 10분/60 = 10초 + 확인 주기(≤5초)
  await tid(t, 'toast-startday').click()
  await tid(page, 'home').waitFor() // 하루가 열림
  log('미룬 알림이 다시 떠서 [하루 시작] → 하루가 열림')

  // 하루를 시작한 뒤에는 더 이상 알리지 않는다
  await sleep(7000)
  assert.equal(await tid(t, 'toast-daystart').count(), 0, '시작한 뒤 재촉 없음')
  log('하루를 시작한 뒤에는 재촉하지 않음')

  // ── 2) 트레이 상주 · 창 닫기 · 빠른 추천 ────────────────────
  await tid(page, 'open-tasks').click()
  await tid(page, 'task-title').fill('글 초안 쓰기')
  await tid(page, 'task-title').press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-item"]').length === 1)
  await tid(page, 'back').click()
  assert.equal(await hook('hasTray'), true, '트레이 아이콘이 있다')
  const labels = await hook('trayLabels')
  assert.deepEqual(labels, ['JumpUp Now 열기', '지금 뭐 하지?', '종료'])
  log(`트레이 메뉴: ${labels.join(' / ')}`)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'JumpUp Now')?.close()
  })
  await sleep(400)
  assert.equal(await hook('mainVisible'), false, '닫기(X)는 창을 숨길 뿐이다')
  assert.equal(await hook('hasTray'), true, '창을 숨겨도 앱은 트레이에서 계속 실행된다')
  log('창 닫기 → 종료되지 않고 트레이로 내려감')

  await hook('quickAsk') // 트레이 "지금 뭐 하지?" / 전역 단축키와 같은 경로
  await tid(page, 'reco').waitFor()
  assert.equal(await hook('mainVisible'), true, '창이 다시 앞으로 나온다')
  assert.equal(await tid(page, 'reco-title').innerText(), '글 초안 쓰기')
  await shot(page, 'm5-2-quickask')
  log('빠른 추천(단축키·트레이): 숨겨진 창이 나오며 추천 카드가 바로 표시됨')

  // ── 3) 전역 단축키 · 설정 화면 ──────────────────────────────
  assert.equal(await hook('shortcutRegistered', 'Ctrl+Alt+Shift+F11'), true, '저장된 단축키 등록')
  log('저장된 전역 단축키(Ctrl+Alt+Shift+F11) 등록됨')

  // 추천 카드 상태에서는 설정 링크가 숨어 있으므로, 한 세션을 끝낸 뒤 홈에서 설정을 연다.
  await tid(page, 'start').click()
  await tid(page, 'session').waitFor()
  await sleep(2200)
  await tid(page, 'finish-done').click()
  await tid(page, 'reflection').waitFor()
  await tid(page, 'output').fill('초안 3문단')
  await page.getByRole('button', { name: '예', exact: true }).click()
  await tid(page, 'save-next').click() // 열린 할 일이 없으니 추천은 없고 홈으로
  await tid(page, 'home').waitFor()

  await tid(page, 'open-settings').click()
  await tid(page, 'settings').waitFor()
  await tid(page, 'set-shortcut').fill('Ctrl+Alt+Shift+F12')
  await tid(page, 'set-save').click()
  await page.getByRole('button', { name: '저장했어요' }).waitFor()
  assert.equal(await hook('shortcutRegistered', 'Ctrl+Alt+Shift+F12'), true)
  assert.equal(await hook('shortcutRegistered', 'Ctrl+Alt+Shift+F11'), false, '이전 단축키는 해제된다')
  log('설정: 단축키를 Ctrl+Alt+Shift+F12로 바꾸면 새로 등록되고 이전 것은 해제됨')

  // 잘못된 값은 거부하고 기존 설정 유지
  await tid(page, 'set-shortcut').fill('NotAKey')
  await tid(page, 'set-save').click()
  await tid(page, 'error').waitFor()
  assert.match(await tid(page, 'error').innerText(), /올바르지 않은 단축키/)
  assert.equal(await hook('shortcutRegistered', 'Ctrl+Alt+Shift+F12'), true, '실패해도 기존 단축키 유지')
  // 다른 앱이 이미 쓰는 단축키: 등록에 실패하면 저장하지 않고, 기존 단축키는 유지된다
  assert.equal(await hook('occupyShortcut', 'Ctrl+Alt+Shift+F10'), true)
  await tid(page, 'set-shortcut').fill('Ctrl+Alt+Shift+F10')
  await tid(page, 'set-save').click()
  await page.waitForFunction(() => /등록하지 못했어요/.test(document.querySelector('[data-testid="error"]')?.textContent ?? ''))
  assert.equal(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).shortcut, 'Ctrl+Alt+Shift+F12', '충돌한 값은 저장되지 않음')
  assert.equal(await hook('shortcutRegistered', 'Ctrl+Alt+Shift+F12'), true)
  log('다른 앱이 점유한 단축키로 바꾸면 "등록하지 못했어요" 오류, 설정·기존 단축키 유지')

  await tid(page, 'set-shortcut').fill('Ctrl+Alt+Shift+F12')
  await tid(page, 'set-checkin').fill('0')
  await tid(page, 'set-save').click()
  await page.waitForFunction(() => /체크인 간격/.test(document.querySelector('[data-testid="error"]')?.textContent ?? ''))
  log('설정: 잘못된 단축키·범위 밖 값은 오류로 거부, 기존 값 유지')
  await shot(page, 'm5-3-settings-error')

  await tid(page, 'set-checkin').fill('10')
  await tid(page, 'set-autolaunch').check()
  await tid(page, 'set-save').click()
  await page.getByRole('button', { name: '저장했어요' }).waitFor()
  const saved = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(saved.autoLaunch, true)
  assert.equal(saved.shortcut, 'Ctrl+Alt+Shift+F12')
  assert.equal(await app.evaluate(({ app: a }) => a.getLoginItemSettings().openAtLogin), false, '개발 실행은 OS 로그인 항목을 건드리지 않음')
  log('설정 저장(자동 실행 켬)이 파일에 반영됨, 개발 실행에선 OS 로그인 항목 미변경')
  await tid(page, 'back').click()

  // ── 4) 하루 종료 → 오늘 요약 ───────────────────────────────
  await tid(page, 'day-end').click()
  await tid(page, 'summary').waitFor()
  assert.match(await tid(page, 'summary-ratio').innerText(), /실질 작업 \d+%/)
  assert.equal(await tid(page, 'stat-sessions').innerText(), '1개')
  assert.equal(await tid(page, 'stat-stuck').innerText(), '0회')
  const list = await tid(page, 'summary-sessions').innerText()
  assert.match(list, /글 초안 쓰기/)
  assert.match(list, /초안 3문단/)
  assert.match(list, /목표 ✓/)
  await shot(page, 'm5-4-summary')
  log(`하루 종료 → 요약 자동 표시 (${(await tid(page, 'summary-ratio').innerText()).trim()}, 세션 1개, 산출물·목표 연결 표시)`)
  await tid(page, 'back').click()
  await tid(page, 'home-before-day').waitFor()
  await tid(page, 'open-summary').waitFor()
  log('홈에 "오늘 요약" 링크 유지')

  // 오늘 이미 시작·종료했으므로 알림은 다시 뜨지 않는다
  await sleep(7000)
  const tp = app.windows().find((p) => p.url().includes('toast.html'))
  assert.equal(tp ? await tid(tp, 'toast-daystart').count() : 0, 0, '종료한 하루는 재촉하지 않음')
  log('하루를 끝낸 뒤에는 하루 시작 알림이 다시 뜨지 않음')

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
