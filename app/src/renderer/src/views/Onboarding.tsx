import { useState } from 'react'
import type { Run } from '../hooks'

const TIMES = ['08:00', '09:00', '10:00']
const TARGETS = [30, 40, 50]

export function Onboarding({ run }: { run: Run }) {
  const [step, setStep] = useState(1)
  const [goal, setGoal] = useState('')
  const [time, setTime] = useState('09:00')
  const [target, setTarget] = useState(40)
  const [autoLaunch, setAutoLaunch] = useState(false)

  return (
    <div className="stack" data-testid="onboarding">
      <div className="step">{step} / 3</div>

      {step === 1 && (
        <>
          <h2>지금 가장 큰 목표 한 줄</h2>
          <p className="lead">세션이 끝날 때마다 이 목표에 가까워졌는지 묻습니다.</p>
          <input
            className="input"
            autoFocus
            maxLength={200}
            placeholder="예) 3개월 안에 포트폴리오 1개 완성"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && goal.trim() && setStep(2)}
            aria-label="큰 목표"
          />
          <button className="btn primary" disabled={!goal.trim()} onClick={() => setStep(2)}>
            다음
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h2>하루 시작 시각과 성공 기준</h2>
          <div className="stack">
            <p className="lead">하루 시작 알림 시각</p>
            <div className="seg">
              {TIMES.map((t) => (
                <button key={t} className={t === time ? 'on' : ''} onClick={() => setTime(t)}>
                  {t}
                </button>
              ))}
            </div>
            <p className="lead">목표 실질 작업비율 (지금은 약 20%)</p>
            <div className="seg">
              {TARGETS.map((p) => (
                <button key={p} className={p === target ? 'on' : ''} onClick={() => setTarget(p)}>
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary" onClick={() => setStep(3)}>
            다음
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <h2>AI 연결 (선택)</h2>
          <p className="lead">
            연결하지 않아도 바로 쓸 수 있습니다. AI 연결은 다음 단계에서 제공됩니다.
          </p>
          <label className="row" style={{ alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              className="check"
              checked={autoLaunch}
              onChange={(e) => setAutoLaunch(e.target.checked)}
              data-testid="autolaunch"
            />
            <span>
              컴퓨터를 켤 때 자동으로 실행
              <span className="lead" style={{ display: 'block' }}>
                하루 시작 알림을 놓치지 않습니다. 설정에서 언제든 끌 수 있어요.
              </span>
            </span>
          </label>
          <button
            className="btn primary"
            onClick={() =>
              void run({
                type: 'complete_onboarding',
                goal,
                successTargetPct: target,
                dayStartTime: time,
                autoLaunch
              })
            }
          >
            나중에 — 바로 시작
          </button>
        </>
      )}
    </div>
  )
}
