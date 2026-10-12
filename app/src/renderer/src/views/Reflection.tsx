import { useState } from 'react'
import type { GoalLink, StuckCause } from '../../../domain/events'
import type { AppSnapshot } from '../../../shared/ipc'
import { duration } from '../format'
import type { Run } from '../hooks'

const GOAL_OPTIONS: { value: GoalLink; label: string }[] = [
  { value: 'yes', label: '예' },
  { value: 'no', label: '아니오' },
  { value: 'unsure', label: '모르겠음' }
]
const CAUSES: { value: StuckCause; label: string }[] = [
  { value: 'anxiety', label: '불안' },
  { value: 'vague', label: '모호함' },
  { value: 'tired', label: '피곤' },
  { value: 'distracted', label: '딴짓' },
  { value: 'other', label: '기타' }
]

export function Reflection({ snap, run }: { snap: AppSnapshot; run: Run }) {
  const [output, setOutput] = useState('')
  const [goalLink, setGoalLink] = useState<GoalLink | undefined>()
  const [cause, setCause] = useState<StuckCause | undefined>()

  const save = (): Promise<boolean> =>
    run({
      type: 'save_reflection',
      output,
      ...(goalLink ? { goalLink } : {}),
      ...(cause ? { cause } : {})
    })

  const next = async (after: 'reco_request' | 'break_start'): Promise<void> => {
    if (await save()) await run({ type: after })
  }

  return (
    <div className="stack" data-testid="reflection">
      <div className="step">세션 종료 · {duration(snap.session.activeMs)}</div>
      <h2>한 줄만 남기세요</h2>
      <p className="lead">{snap.sessionTask?.title}</p>
      <input
        className="input"
        autoFocus
        maxLength={500}
        placeholder="산출물: 무엇을 했나요?"
        value={output}
        onChange={(e) => setOutput(e.target.value)}
        aria-label="산출물"
        data-testid="output"
      />

      {snap.settings.goal && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="lead">목표에 가까워졌나요?</p>
          <div className="seg">
            {GOAL_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={goalLink === o.value ? 'on' : ''}
                onClick={() => setGoalLink(goalLink === o.value ? undefined : o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {snap.stats.stuckCount > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="lead">막힌 원인 (선택)</p>
          <div className="seg">
            {CAUSES.map((o) => (
              <button
                key={o.value}
                className={cause === o.value ? 'on' : ''}
                onClick={() => setCause(cause === o.value ? undefined : o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grow" />
      <div className="btns">
        <button className="btn primary" data-testid="save-next" onClick={() => void next('reco_request')}>
          저장하고 다음 세션
        </button>
        <button className="btn" data-testid="save-rest" onClick={() => void next('break_start')}>
          쉬기
        </button>
      </div>
    </div>
  )
}
