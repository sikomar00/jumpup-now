import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { elapsedMs } from '../../domain/sessionMachine'
import { clock } from './format'
import { useAppState, useNow } from './hooks'
import './widget.css'

// 글자 기호 대신 SVG 아이콘(디자인 보드 04). 장식이므로 aria-hidden, 버튼에는 aria-label이 있다.
const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor" />
    <rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor" />
  </svg>
)
const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
  </svg>
)
const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
  </svg>
)

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
        {bySleep
          ? '절전으로 멈춤'
          : byIdle
            ? '자리 비움으로 멈춤'
            : paused
              ? `일시정지 · ${sessionTask?.title ?? ''}` // 색만이 아니라 문구로도 상태를 알린다
              : (sessionTask?.title ?? '')}
      </span>
      {paused ? (
        <button className="b go" aria-label="이어가기" data-testid="widget-resume" onClick={() => send('session_resume')}>
          {autoPaused ? '이어가기' : <PlayIcon />}
        </button>
      ) : (
        <button className="b" aria-label="일시정지" data-testid="widget-pause" onClick={() => send('session_pause')}>
          <PauseIcon />
        </button>
      )}
      <button className="b" aria-label="종료" data-testid="widget-end" onClick={end}>
        <StopIcon />
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Widget />
  </StrictMode>
)
