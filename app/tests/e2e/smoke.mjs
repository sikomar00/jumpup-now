// e2e 스모크: 빌드된 Electron 앱을 실제로 띄워 하루 한 바퀴를 돌린다.
// 사용법: npm run build && npm run e2e   (스크린샷 폴더: SHOTS_DIR 환경 변수, 기본은 OS 임시 폴더)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = mkdtempSync(join(tmpdir(), 'jumpup-e2e-'))
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'jumpup-shots')
mkdirSync(shots, { recursive: true })

const errors = []
const log = (m) => console.log(`✓ ${m}`)

const openApps = new Set()

async function launch() {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [appDir],
    cwd: appDir,
    env: { ...process.env, JUMPUP_DATA_DIR: dataDir }
  })
  openApps.add(app)
  app.on('close', () => openApps.delete(app))
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

const tid = (page, id) => page.getByTestId(id)
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) })

try {
  // ── 1차 실행: 온보딩 → 하루 한 바퀴 ─────────────────────────────
  let { app, page } = await launch()
  await tid(page, 'onboarding').waitFor()
  await shot(page, '01-onboarding')
  await page.getByLabel('큰 목표').fill('3개월 안에 포트폴리오 완성')
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: '10:00' }).click()
  await page.getByRole('button', { name: '50%' }).click()
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: /나중에/ }).click()
  await tid(page, 'home-before-day').waitFor()
  log('온보딩 완료 → 하루 시작 전 화면')

  await page.getByRole('button', { name: '하루 시작' }).click()
  await tid(page, 'home').waitFor()
  assert.equal(await tid(page, 'ask').isDisabled(), true, '할 일이 없으면 추천 버튼은 비활성')
  await shot(page, '02-home-empty')
  log('하루 시작, 할 일 없을 땐 추천 버튼 비활성')

  await tid(page, 'open-tasks').click()
  await tid(page, 'tasks').waitFor()
  await tid(page, 'task-title').fill('보고서 개요 쓰기')
  await tid(page, 'task-title').press('Enter')
  await tid(page, 'task-title').fill('자료 5개 읽기')
  await tid(page, 'task-title').press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-item"]').length === 2)
  await shot(page, '03-tasks')
  await tid(page, 'back').click()
  log('할 일 2개 추가')

  await tid(page, 'ask').click()
  await tid(page, 'reco').waitFor()
  assert.equal(await tid(page, 'reco-title').innerText(), '보고서 개요 쓰기')
  await shot(page, '04-reco')
  log('추천 카드 표시 (목록 순서)')

  await tid(page, 'start').click()
  await tid(page, 'session').waitFor()
  await page.waitForTimeout(2200)
  const t1 = await tid(page, 'timer').innerText()
  assert.match(t1, /^00:0[1-9]$/, `타이머가 흐르는지: ${t1}`)
  await shot(page, '05-session')
  await tid(page, 'pause').click()
  await page.getByRole('button', { name: '다시 시작' }).waitFor()
  const paused1 = await tid(page, 'timer').innerText()
  await page.waitForTimeout(1500)
  assert.equal(await tid(page, 'timer').innerText(), paused1, '일시정지 중에는 타이머가 멈춤')
  await page.getByRole('button', { name: '다시 시작' }).click()
  log(`세션 시작·일시정지·재개 (타이머 ${t1} → ${paused1} 정지 확인)`)

  await tid(page, 'finish-done').click()
  await tid(page, 'reflection').waitFor()
  await tid(page, 'output').fill('제목 3개 작성')
  await page.getByRole('button', { name: '예', exact: true }).click()
  await shot(page, '06-reflection')
  await tid(page, 'save-next').click()
  await tid(page, 'reco').waitFor()
  assert.equal(await tid(page, 'reco-title').innerText(), '자료 5개 읽기', '완료한 할 일은 제외하고 다음 추천')
  log('회고 저장 → 다음 세션 추천 (완료한 할 일 제외)')

  await page.getByRole('button', { name: '이건 못 하겠어요' }).click()
  // 명령은 비동기이므로 화면이 갱신될 때까지 기다린다.
  await page.waitForFunction(
    () => /2분/.test(document.querySelector('[data-testid="reco-step"]')?.textContent ?? ''),
    null,
    { timeout: 5000 }
  )
  assert.equal(await tid(page, 'reco-title').innerText(), '자료 5개 읽기', '후보가 하나뿐이면 같은 항목')
  log('거절 시 같은 후보를 더 작은 첫 행동으로')

  await tid(page, 'start').click()
  await tid(page, 'finish-manual').click()
  await tid(page, 'reflection').waitFor()
  await tid(page, 'save-rest').click()
  await tid(page, 'home-break').waitFor()
  await shot(page, '07-break')
  await page.getByRole('button', { name: '휴식 끝' }).click()
  await tid(page, 'home').waitFor()
  assert.match(await tid(page, 'ratio').innerText(), /목표 50%/)
  await shot(page, '08-home-after')
  await tid(page, 'day-end').click()
  await tid(page, 'home-before-day').waitFor()
  log('휴식 → 하루 종료')
  await app.close()

  // ── 2차 실행: 데이터 유지 확인 ───────────────────────────────
  ;({ app, page } = await launch())
  await tid(page, 'home-before-day').waitFor()
  assert.match(await page.locator('p.lead').first().innerText(), /3개월 안에 포트폴리오 완성/)
  log('재실행 후 설정(목표) 유지')
  await app.close()

  const files = readdirSync(join(dataDir, 'events'))
  const lines = readFileSync(join(dataDir, 'events', files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const types = new Set(lines.map((e) => e.type))
  for (const t of ['day_start', 'task_add', 'reco_shown', 'session_start', 'session_end', 'reflection', 'break_start', 'break_end', 'day_end']) {
    assert.ok(types.has(t), `이벤트 로그에 ${t} 기록`)
  }
  log(`이벤트 로그 ${lines.length}줄, 필수 이벤트 타입 모두 기록`)

  assert.deepEqual(errors, [], `렌더러 오류 없음: ${errors.join(' | ')}`)
  log('렌더러 콘솔·페이지 오류 없음')
  console.log(`\nPASS — 스크린샷: ${shots}`)
} catch (err) {
  console.error('\nFAIL —', err)
  console.error('errors:', errors)
  process.exitCode = 1
} finally {
  // 실패해도 남은 앱을 닫아야 데이터 폴더를 지울 수 있다.
  for (const app of openApps) await app.close().catch(() => {})
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    console.warn(`임시 폴더를 지우지 못했습니다: ${dataDir}`)
  }
}
