import { useState } from 'react'
import type { Run } from '../hooks'

const TIMES = ['08:00', '09:00', '10:00']
const TARGETS = [30, 40, 50]
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function Onboarding({ run }: { run: Run }) {
  const [step, setStep] = useState(1)
  const [goal, setGoal] = useState('')
  const [time, setTime] = useState('09:00')
  const [customTime, setCustomTime] = useState(false)
  // 직접 입력 중에는 비어 있을 수 있어 문자열로 들고 있다가 검증한다.
  const [target, setTarget] = useState('40')
  const [customTarget, setCustomTarget] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)

  const targetNum = Number(target)
  const timeValid = TIME_RE.test(time)
  const targetValid = target.trim() !== '' && Number.isInteger(targetNum) && targetNum >= 1 && targetNum <= 100

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
          <div className="grow" />
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
                <button
                  key={t}
                  className={!customTime && t === time ? 'on' : ''}
                  onClick={() => {
                    setTime(t)
                    setCustomTime(false)
                  }}
                >
                  {t}
                </button>
              ))}
              <button className={customTime ? 'on' : ''} data-testid="ob-time-custom" onClick={() => setCustomTime(true)}>
                직접
              </button>
            </div>
            {customTime && (
              <input
                className="input"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label="하루 시작 알림 시각 직접 입력"
                data-testid="ob-time"
              />
            )}

            <p className="lead">목표 실질 작업비율 (지금은 약 20%)</p>
            <div className="seg">
              {TARGETS.map((p) => (
                <button
                  key={p}
                  className={!customTarget && Number(target) === p ? 'on' : ''}
                  onClick={() => {
                    setTarget(String(p))
                    setCustomTarget(false)
                  }}
                >
                  {p}%
                </button>
              ))}
              <button className={customTarget ? 'on' : ''} data-testid="ob-target-custom" onClick={() => setCustomTarget(true)}>
                직접
              </button>
            </div>
            {customTarget && (
              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={3}
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
                  aria-label="목표 실질 작업비율 직접 입력(퍼센트)"
                  data-testid="ob-target"
                />
                <span aria-hidden>%</span>
              </div>
            )}
            {(!timeValid || !targetValid) && (
              <p className="lead" role="alert" data-testid="ob-invalid" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                {!timeValid ? '하루 시작 알림 시각을 입력하세요.' : '목표 비율은 1~100 사이의 숫자로 입력하세요.'}
              </p>
            )}
          </div>
          <div className="grow" />
          <button className="btn primary" disabled={!timeValid || !targetValid} onClick={() => setStep(3)}>
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
          <div className="grow" />
          <button
            className="btn primary"
            onClick={() =>
              void run({
                type: 'complete_onboarding',
                goal,
                successTargetPct: targetNum,
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
