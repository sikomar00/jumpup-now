import { elapsedMs } from '../../../domain/sessionMachine'
import type { AppSnapshot } from '../../../shared/ipc'
import { clock } from '../format'
import { useNow, type Run } from '../hooks'

export function SessionView({ snap, run }: { snap: AppSnapshot; run: Run }) {
  const now = useNow(1000)
  const { session, sessionTask } = snap
  const paused = session.phase === 'paused'
  const bySleep = paused && session.pauseCause === 'suspend'
  const elapsed = elapsedMs(session, now)

  return (
    <div className="stack" data-testid="session">
      <div className="step">{paused ? '일시정지' : '진행 중'} · 계획 {session.plannedMin}분</div>
      {bySleep && (
        <div className="banner info" data-testid="sleep-note">
          절전으로 멈췄어요. 자리를 비운 시간은 작업 시간에 넣지 않았습니다. 이어갈까요?
        </div>
      )}
      <h2 data-testid="session-title">{sessionTask?.title ?? ''}</h2>
      <div className="grow" />
      <div className="timer" data-testid="timer">{clock(elapsed)}</div>
      <div className="grow" />
      <div className="btns">
        {paused ? (
          <button className="btn primary" data-testid="resume" onClick={() => void run({ type: 'session_resume' })}>
            {bySleep ? '이어가기' : '다시 시작'}
          </button>
        ) : (
          <button className="btn" data-testid="pause" onClick={() => void run({ type: 'session_pause' })}>
            일시정지
          </button>
        )}
      </div>
      <div className="btns">
        <button className="btn" data-testid="finish-done" onClick={() => void run({ type: 'session_end', reason: 'done' })}>
          할 일 완료
        </button>
        <button className="btn" data-testid="finish-manual" onClick={() => void run({ type: 'session_end', reason: 'manual' })}>
          여기까지
        </button>
      </div>
    </div>
  )
}
