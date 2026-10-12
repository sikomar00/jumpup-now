import { useEffect, useRef, useState } from 'react'
import { DaySummary } from './views/DaySummary'
import { Home } from './views/Home'
import { Onboarding } from './views/Onboarding'
import { Reflection } from './views/Reflection'
import { SessionView } from './views/SessionView'
import { Settings } from './views/Settings'
import { Tasks } from './views/Tasks'
import { useAppState, useRunner } from './hooks'

export type View = 'home' | 'tasks' | 'settings' | 'summary'

export function App() {
  const snap = useAppState()
  const { run, error, clearError } = useRunner()
  const [view, setView] = useState<View>('home')

  // 하루를 끝내면 곧바로 오늘 요약을 보여준다.
  const wasOpen = useRef<boolean | null>(null)
  const dayOpen = snap?.dayOpen ?? null
  useEffect(() => {
    if (dayOpen === null) return
    if (wasOpen.current === true && dayOpen === false) setView('summary')
    wasOpen.current = dayOpen
  }, [dayOpen])

  if (!snap) return <div className="app" />

  const toHome = (): void => setView('home')
  let body: React.ReactNode
  if (!snap.settings.onboarded) {
    body = <Onboarding run={run} />
  } else if (view === 'tasks') {
    body = <Tasks snap={snap} run={run} back={toHome} />
  } else if (view === 'settings') {
    body = <Settings snap={snap} run={run} back={toHome} />
  } else if (view === 'summary') {
    body = <DaySummary snap={snap} back={toHome} />
  } else if (snap.breakOpen) {
    // 연속 막힘 뒤 휴식처럼 세션이 정지된 채 휴식 중일 때도 휴식 화면을 먼저 보여준다.
    body = <Home snap={snap} run={run} go={setView} />
  } else if (snap.session.phase === 'running' || snap.session.phase === 'paused') {
    body = <SessionView snap={snap} run={run} />
  } else if (snap.session.phase === 'reflecting') {
    body = <Reflection snap={snap} run={run} />
  } else {
    body = <Home snap={snap} run={run} go={setView} />
  }

  return (
    <div className="app">
      {snap.notice && (
        <div className="banner info" role="status" data-testid="notice">
          <span>{snap.notice}</span>
          <button aria-label="안내 닫기" onClick={() => void run({ type: 'dismiss_notice' })}>×</button>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert" data-testid="error">
          <span>{error}</span>
          <button aria-label="오류 닫기" onClick={clearError}>×</button>
        </div>
      )}
      {body}
    </div>
  )
}
