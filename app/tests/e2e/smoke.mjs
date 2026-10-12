// e2e 스모크: 빌드된 Electron 앱을 실제로 띄워 하루 한 바퀴를 돌린다.
// 사용법: npm run build && npm run e2e   (스크린샷 폴더: SHOTS_DIR 환경 변수, 기본은 OS 임시 폴더)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { launchOptions, mode } from './launch.mjs'

const dataDir = mkdtempSync(join(tmpdir(), 'jumpup-e2e-'))
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'jumpup-shots')
mkdirSync(shots, { recursive: true })

console.log(`실행 대상: ${mode()}`)
const errors = []
const log = (m) => console.log(`✓ ${m}`)

const openApps = new Set()

async function launch() {
  const app = await electron.launch(launchOptions({ JUMPUP_DATA_DIR: dataDir }))
  openApps.add(app)
  app.on('close', () => openApps.delete(app))
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** 위젯 창의 페이지를 찾는다(처음 세션을 시작할 때 만들어진다). */
async function waitForWidget(app) {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((p) => p.url().includes('widget.html'))
    if (w) {
      await w.waitForLoadState('domcontentloaded')
      return w
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('위젯 창이 열리지 않았습니다')
}

/** main process에서 위젯 BrowserWindow의 실제 속성을 읽는다. */
const widgetState = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('widget.html'))
    if (!w) return null
    const [x, y] = w.getPosition()
    return { visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), x, y, focused: w.isFocused() }
  })

const tid = (page, id) => page.getByTestId(id)
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) })

try {
  // ── 1차 실행: 온보딩 → 하루 한 바퀴 ─────────────────────────────
  let { app, page } = await launch()
  await tid(page, 'onboarding').waitFor()
  await shot(page, '01-onboarding')

  // ── 디자인 시스템 약속(번들 폰트·포커스 링)이 실제 렌더에 적용되는지 ──
  const design = await page.evaluate(async () => {
    await document.fonts.ready
    const pretendard = [...document.fonts].find((f) => f.family.includes('Pretendard'))
    const input = document.querySelector('input')
    const cs = input ? getComputedStyle(input) : null
    return {
      fontLoaded: pretendard?.status === 'loaded',
      bodyFont: getComputedStyle(document.body).fontFamily,
      outlineStyle: cs?.outlineStyle,
      // Chromium은 외곽선 두께를 장치 픽셀 정수로 맞춘다(125% 배율에서 2px → 1.6px). 배율과 무관하게 비교한다.
      outlineWidth: cs ? parseFloat(cs.outlineWidth) : 0,
      inputMinHeight: cs?.minHeight
    }
  })
  assert.equal(design.fontLoaded, true, `Pretendard 번들 폰트가 로드되어야 한다 (${design.bodyFont})`)
  assert.equal(design.outlineStyle, 'solid', '입력 포커스 링은 실선')
  assert.ok(design.outlineWidth >= 1.5 && design.outlineWidth <= 2, `포커스 링 두께 약 2px: ${design.outlineWidth}`)
  assert.equal(design.inputMinHeight, '48px', '입력 높이 48')
  log(`디자인: Pretendard 번들 폰트 로드, 포커스 링 ${design.outlineWidth}px(2px 장치 픽셀 정수화), 입력 높이 48`)
  await page.getByLabel('큰 목표').fill('3개월 안에 포트폴리오 완성')
  await page.getByRole('button', { name: '다음' }).click()
  // 직접 입력: 프리셋에 없는 시각·목표 비율
  await tid(page, 'ob-time-custom').click()
  await tid(page, 'ob-time').fill('08:30')
  await tid(page, 'ob-target-custom').click()
  await tid(page, 'ob-target').fill('0')
  await tid(page, 'ob-invalid').waitFor()
  assert.equal(await page.getByRole('button', { name: '다음' }).isDisabled(), true, '범위 밖 목표는 다음으로 넘어갈 수 없다')
  await tid(page, 'ob-target').fill('150')
  assert.equal(await page.getByRole('button', { name: '다음' }).isDisabled(), true)
  await tid(page, 'ob-target').fill('35')
  await tid(page, 'ob-invalid').waitFor({ state: 'detached' })
  await shot(page, '01b-onboarding-custom')
  await page.getByRole('button', { name: '다음' }).click()
  log('온보딩 직접 입력: 08:30 · 35% (범위 밖 값은 막힘)')
  // 자동 실행은 옵트인: 체크해도 개발(패키징 전) 실행에서는 OS 로그인 항목을 건드리지 않아야 한다.
  assert.equal(await tid(page, 'autolaunch').isChecked(), false, '자동 실행은 기본 꺼짐')
  await tid(page, 'autolaunch').check()
  await page.getByRole('button', { name: /나중에/ }).click()
  await tid(page, 'home-before-day').waitFor()
  const savedSettings = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(savedSettings.autoLaunch, true, '선택한 자동 실행 값이 설정에 저장됨')
  assert.equal(savedSettings.dayStartTime, '08:30', '직접 입력한 시작 시각이 저장됨')
  assert.equal(savedSettings.successTargetPct, 35, '직접 입력한 목표 비율이 저장됨')
  assert.equal(
    await app.evaluate(({ app: a }) => a.getLoginItemSettings().openAtLogin),
    false,
    '패키징되지 않은 실행은 실제 로그인 항목을 등록하지 않는다'
  )
  log('자동 실행 옵트인: 설정엔 저장, 개발 실행에선 OS 로그인 항목 미변경')
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

  assert.equal(await widgetState(app), null, '세션 전에는 위젯 창이 없다')
  await tid(page, 'start').click()
  await tid(page, 'session').waitFor()
  await page.waitForTimeout(2200)
  const t1 = await tid(page, 'timer').innerText()
  assert.match(t1, /^00:0[1-9]$/, `타이머가 흐르는지: ${t1}`)
  await shot(page, '05-session')

  // ── 위젯 ────────────────────────────────────────────────
  const widget = await waitForWidget(app)
  await tid(widget, 'widget').waitFor()
  const ws = await widgetState(app)
  assert.equal(ws.visible, true, '세션 중 위젯이 보인다')
  assert.equal(ws.alwaysOnTop, true, '위젯은 항상 위')
  assert.equal(ws.focused, false, '위젯이 포커스를 빼앗지 않는다')
  assert.match(await tid(widget, 'widget-timer').innerText(), /^\d\d:\d\d$/)
  assert.equal(await widget.locator('.n').innerText(), '보고서 개요 쓰기')
  const pauseBox = await tid(widget, 'widget-pause').boundingBox()
  assert.ok(pauseBox && Math.round(pauseBox.height) === 32 && pauseBox.width >= 32, `위젯 버튼은 32px: ${pauseBox?.width}×${pauseBox?.height}`)
  await widget.screenshot({ path: join(shots, '05b-widget.png') })
  log('위젯 표시: 항상 위·포커스 비침범·현재 할 일·경과시간')

  // 위젯에서 일시정지 → 메인 창에도 반영, 타이머 정지
  await tid(widget, 'widget-pause').click()
  await tid(page, 'resume').waitFor()
  const paused1 = await tid(page, 'timer').innerText()
  await page.waitForTimeout(1500)
  assert.equal(await tid(page, 'timer').innerText(), paused1, '일시정지 중에는 타이머가 멈춤')
  await widget.screenshot({ path: join(shots, '05c-widget-paused.png') })
  await tid(page, 'resume').click()
  await tid(widget, 'widget-pause').waitFor()
  log(`위젯 일시정지·재개가 메인 창과 동기화 (타이머 ${t1} → ${paused1} 정지 확인)`)

  // 절전 진입 시뮬레이션: powerMonitor 'suspend' 이벤트
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await tid(page, 'sleep-note').waitFor()
  await tid(widget, 'widget-resume').waitFor()
  assert.equal(await tid(widget, 'widget-resume').innerText(), '이어가기')
  assert.match(await widget.locator('.n').innerText(), /절전/)
  await widget.screenshot({ path: join(shots, '05d-widget-sleep.png') })
  await shot(page, '05e-session-sleep')
  await tid(widget, 'widget-resume').click()
  await tid(page, 'pause').waitFor()
  log('절전 진입 → 세션 자동 일시정지 → 위젯에서 이어가기')

  // 위젯 위치 저장
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('widget.html')).setPosition(220, 180)
  })
  await page.waitForTimeout(900) // 이동 저장 디바운스(400ms) 대기
  const movedTo = await widgetState(app)
  log(`위젯 이동 (${movedTo.x}, ${movedTo.y})`)

  await tid(page, 'finish-done').click()
  await tid(page, 'reflection').waitFor()
  assert.equal((await widgetState(app)).visible, false, '세션이 끝나면 위젯이 사라진다')
  log('세션 종료 시 위젯 숨김')
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
  await tid(widget, 'widget-end').waitFor()
  assert.equal((await widgetState(app)).visible, true, '두 번째 세션에서 위젯이 다시 나타난다')
  const reshown = await widgetState(app)
  assert.ok(Math.abs(reshown.x - movedTo.x) <= 2 && Math.abs(reshown.y - movedTo.y) <= 2, '다시 나타나도 이동한 위치 유지')
  await tid(widget, 'widget-end').click() // 위젯의 ■ 로 종료
  await tid(page, 'reflection').waitFor()
  assert.equal((await widgetState(app)).visible, false)
  log('위젯 ■ 종료 → 회고 화면, 위젯 숨김, 위치 유지')
  await tid(page, 'save-rest').click()
  await tid(page, 'home-break').waitFor()
  await shot(page, '07-break')
  await page.getByRole('button', { name: '휴식 끝' }).click()
  await tid(page, 'home').waitFor()
  assert.match(await tid(page, 'ratio').innerText(), /목표 35%/)
  await shot(page, '08-home-after')
  await tid(page, 'day-end').click()
  await tid(page, 'summary').waitFor() // 하루를 끝내면 오늘 요약이 바로 열린다
  assert.match(await tid(page, 'summary-ratio').innerText(), /실질 작업 \d+%/)
  assert.equal(await tid(page, 'stat-sessions').innerText(), '2개')
  await shot(page, '09-summary')
  await tid(page, 'back').click()
  await tid(page, 'home-before-day').waitFor()
  log('휴식 → 하루 종료')
  await app.close()

  // ── 2차 실행: 데이터 유지 확인 ───────────────────────────────
  ;({ app, page } = await launch())
  await tid(page, 'home-before-day').waitFor()
  assert.match(await page.locator('p.lead').first().innerText(), /3개월 안에 포트폴리오 완성/)
  log('재실행 후 설정(목표) 유지')

  // 재실행 후 새 세션에서 위젯이 저장된 위치에 나타나는지
  await page.getByRole('button', { name: '하루 시작' }).click()
  await tid(page, 'ask').click()
  await tid(page, 'start').click()
  await waitForWidget(app)
  const restored = await widgetState(app)
  assert.ok(restored?.visible, '재실행 후 세션에서 위젯이 보인다')
  assert.ok(Math.abs(restored.x - movedTo.x) <= 2 && Math.abs(restored.y - movedTo.y) <= 2, `재실행 후 저장된 위치로 복원: (${restored.x}, ${restored.y})`)
  log(`위젯 위치가 재실행 후에도 복원됨 (${restored.x}, ${restored.y})`)
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
