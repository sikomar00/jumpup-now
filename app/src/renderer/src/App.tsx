import { useState } from 'react'
import { Home } from './views/Home'
import { Onboarding } from './views/Onboarding'
import { Reflection } from './views/Reflection'
import { SessionView } from './views/SessionView'
import { Tasks } from './views/Tasks'
import { useAppState, useRunner } from './hooks'

export function App() {
  const snap = useAppState()
  const { run, error, clearError } = useRunner()
  const [view, setView] = useState<'home' | 'tasks'>('home')

  if (!snap) return <div className="app" />

  let body: React.ReactNode
  if (!snap.settings.onboarded) {
    body = <Onboarding run={run} />
  } else if (view === 'tasks') {
    body = <Tasks snap={snap} run={run} back={() => setView('home')} />
  } else if (snap.breakOpen) {
    // 연속 막힘 뒤 휴식처럼 세션이 정지된 채 휴식 중일 때도 휴식 화면을 먼저 보여준다.
    body = <Home snap={snap} run={run} openTasks={() => setView('tasks')} />
  } else if (snap.session.phase === 'running' || snap.session.phase === 'paused') {
    body = <SessionView snap={snap} run={run} />
  } else if (snap.session.phase === 'reflecting') {
    body = <Reflection snap={snap} run={run} />
  } else {
    body = <Home snap={snap} run={run} openTasks={() => setView('tasks')} />
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
