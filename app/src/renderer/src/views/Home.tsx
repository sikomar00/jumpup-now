import type { AppSnapshot } from '../../../shared/ipc'
import type { View } from '../App'
import type { Run } from '../hooks'
import { hhmm } from '../format'

interface Props {
  snap: AppSnapshot
  run: Run
  go: (view: View) => void
}

export function Home({ snap, run, go }: Props) {
  const { dayOpen, breakOpen, reco, stats, settings, openTaskCount, sessions } = snap
  const pct = Math.round(stats.ratio * 100)
  const openTasks = (): void => go('tasks')
  const secondaryLinks = (
    <>
      {sessions.length > 0 && (
        <button className="link" data-testid="open-summary" onClick={() => go('summary')}>
          오늘 요약
        </button>
      )}
      <button className="link" data-testid="open-settings" onClick={() => go('settings')}>
        설정
      </button>
    </>
  )

  if (!dayOpen) {
    return (
      <div className="stack" data-testid="home-before-day">
        <h2>오늘 시작하세요.</h2>
        <p className="lead">목표: {settings.goal}</p>
        <div className="grow" />
        <button className="btn primary hero" onClick={() => void run({ type: 'day_start' })}>
          하루 시작
        </button>
        <div className="links">
          <button className="link" onClick={openTasks}>
            할 일 목록 ({openTaskCount})
          </button>
          {secondaryLinks}
        </div>
      </div>
    )
  }

  const header = (
    <div className="stack" style={{ gap: 8 }}>
      <div className="status">
        <h2>오늘 {snap.dayStartedAt ? hhmm(snap.dayStartedAt) : ''} 시작</h2>
        <span className="step" data-testid="ratio">
          실질 {pct}% · 목표 {settings.successTargetPct}%
        </span>
      </div>
      <div className="progress" aria-hidden>
        <i style={{ width: `${Math.min(100, (pct / settings.successTargetPct) * 100)}%` }} />
      </div>
    </div>
  )

  if (breakOpen) {
    return (
      <div className="stack" data-testid="home-break">
        {header}
        <div className="grow" />
        <h2 className="center">휴식 중</h2>
        <button className="btn primary hero" onClick={() => void run({ type: 'break_end' })}>
          휴식 끝
        </button>
        <div className="grow" />
      </div>
    )
  }

  return (
    <div className="stack" data-testid="home">
      {header}

      {reco ? (
        <div className="stack" data-testid="reco">
          <div className="card">
            <div className="meta">지금 할 일</div>
            <div className="big" data-testid="reco-title">{reco.task.title}</div>
            <div data-testid="reco-step">{reco.firstStep}</div>
            <div className="meta" style={{ marginTop: 8 }}>이유 · {reco.reason}</div>
          </div>
          <button
            className="btn primary hero"
            data-testid="start"
            onClick={() => void run({ type: 'session_start' })}
          >
            시작 ({settings.sessionMin}분)
          </button>
          <button className="link" onClick={() => void run({ type: 'reco_reject' })}>
            이건 못 하겠어요
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="grow" />
          <button
            className="btn primary hero"
            data-testid="ask"
            disabled={openTaskCount === 0}
            onClick={() => void run({ type: 'reco_request' })}
          >
            지금 뭐 하지?
          </button>
          {openTaskCount === 0 && (
            <p className="lead center">할 일을 먼저 추가하세요. 제목만 있으면 됩니다.</p>
          )}
        </div>
      )}

      <div className="grow" />
      <div className="links">
        <button className="link" data-testid="open-tasks" onClick={openTasks}>
          할 일 목록 ({openTaskCount})
        </button>
        {!reco && (
          <>
            <button className="link" onClick={() => void run({ type: 'break_start' })}>
              휴식
            </button>
            <button className="link" data-testid="day-end" onClick={() => void run({ type: 'day_end' })}>
              하루 종료
            </button>
            {secondaryLinks}
          </>
        )}
      </div>
    </div>
  )
}
