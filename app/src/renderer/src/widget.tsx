import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { elapsedMs } from '../../domain/sessionMachine'
import { clock } from './format'
import { useAppState, useNow } from './hooks'
import './widget.css'

function Widget() {
  const snap = useAppState()
  const now = useNow(1000)
  if (!snap) return null
  const { session, sessionTask } = snap
  if (session.phase !== 'running' && session.phase !== 'paused') return null

  const paused = session.phase === 'paused'
  const bySleep = paused && session.pauseCause === 'suspend'
  const byIdle = paused && session.pauseCause === 'idle'
  const autoPaused = bySleep || byIdle
  const send = (type: 'session_pause' | 'session_resume'): void => void window.api.command({ type })
  const end = (): void => void window.api.command({ type: 'session_end', reason: 'manual' })

  return (
    <div className={`pill${paused ? ' paused' : ''}`} data-testid="widget">
      <span className="t" data-testid="widget-timer">{clock(elapsedMs(session, now))}</span>
      <span className="n" title={sessionTask?.title}>
        {bySleep ? '절전으로 멈춤' : byIdle ? '자리 비움으로 멈춤' : (sessionTask?.title ?? '')}
      </span>
      {paused ? (
        <button className="b go" aria-label="이어가기" data-testid="widget-resume" onClick={() => send('session_resume')}>
          {autoPaused ? '이어가기' : '▶'}
        </button>
      ) : (
        <button className="b" aria-label="일시정지" data-testid="widget-pause" onClick={() => send('session_pause')}>
          ❚❚
        </button>
      )}
      <button className="b" aria-label="종료" data-testid="widget-end" onClick={end}>
        ■
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Widget />
  </StrictMode>
)
