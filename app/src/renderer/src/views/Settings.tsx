import { useState } from 'react'
import type { AppSnapshot, SettingsPatch } from '../../../shared/ipc'
import type { Run } from '../hooks'

export function Settings({ snap, run, back }: { snap: AppSnapshot; run: Run; back: () => void }) {
  const s = snap.settings
  const [goal, setGoal] = useState(s.goal)
  const [target, setTarget] = useState(String(s.successTargetPct))
  const [startTime, setStartTime] = useState(s.dayStartTime)
  const [sessionMin, setSessionMin] = useState(String(s.sessionMin))
  const [checkinMin, setCheckinMin] = useState(String(s.checkinMin))
  const [shortcut, setShortcut] = useState(s.shortcut)
  const [autoLaunch, setAutoLaunch] = useState(s.autoLaunch)
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    // 바뀐 항목만 보낸다. 숫자 칸이 비었거나 숫자가 아니면 NaN이 되어 서버에서 거부된다.
    const patch: SettingsPatch = {}
    if (goal !== s.goal) patch.goal = goal
    if (Number(target) !== s.successTargetPct) patch.successTargetPct = Number(target)
    if (startTime !== s.dayStartTime) patch.dayStartTime = startTime
    if (Number(sessionMin) !== s.sessionMin) patch.sessionMin = Number(sessionMin)
    if (Number(checkinMin) !== s.checkinMin) patch.checkinMin = Number(checkinMin)
    if (shortcut.trim() !== s.shortcut) patch.shortcut = shortcut.trim()
    if (autoLaunch !== s.autoLaunch) patch.autoLaunch = autoLaunch
    if (Object.keys(patch).length === 0) {
      setSaved(true)
      return
    }
    setSaved(await run({ type: 'update_settings', patch }))
  }

  return (
    <div className="stack" data-testid="settings">
      <div className="status">
        <h2>설정</h2>
        <button className="link" data-testid="back" onClick={back}>닫기</button>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="lead">큰 목표</span>
        <input className="input" maxLength={200} value={goal} onChange={(e) => (setGoal(e.target.value), setSaved(false))} data-testid="set-goal" />
      </label>

      <div className="row">
        <label className="stack" style={{ gap: 6, flex: 1 }}>
          <span className="lead">하루 시작 알림</span>
          <input className="input" type="time" value={startTime} onChange={(e) => (setStartTime(e.target.value), setSaved(false))} data-testid="set-starttime" />
        </label>
        <label className="stack" style={{ gap: 6, flex: 1 }}>
          <span className="lead">목표 실질 작업비율(%)</span>
          <input className="input" inputMode="numeric" value={target} onChange={(e) => (setTarget(e.target.value), setSaved(false))} data-testid="set-target" />
        </label>
      </div>

      <div className="row">
        <label className="stack" style={{ gap: 6, flex: 1 }}>
          <span className="lead">세션 길이(분)</span>
          <input className="input" inputMode="numeric" value={sessionMin} onChange={(e) => (setSessionMin(e.target.value), setSaved(false))} data-testid="set-session" />
        </label>
        <label className="stack" style={{ gap: 6, flex: 1 }}>
          <span className="lead">체크인 간격(분)</span>
          <input className="input" inputMode="numeric" value={checkinMin} onChange={(e) => (setCheckinMin(e.target.value), setSaved(false))} data-testid="set-checkin" />
        </label>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="lead">전역 단축키 (예: Alt+Shift+J)</span>
        <input className="input" value={shortcut} onChange={(e) => (setShortcut(e.target.value), setSaved(false))} data-testid="set-shortcut" />
      </label>

      <label className="row" style={{ alignItems: 'center', gap: 10 }}>
        <input type="checkbox" className="check" checked={autoLaunch} onChange={(e) => (setAutoLaunch(e.target.checked), setSaved(false))} data-testid="set-autolaunch" />
        <span>컴퓨터를 켤 때 자동으로 실행</span>
      </label>

      <div className="grow" />
      <button className="btn primary" data-testid="set-save" onClick={() => void save()}>
        {saved ? '저장했어요' : '저장'}
      </button>
    </div>
  )
}
