import type { GoalLink, StuckCause } from '../../../domain/events'
import type { AppSnapshot } from '../../../shared/ipc'
import { hhmm, shortDuration } from '../format'

const GOAL_CHIP: Record<GoalLink, string> = { yes: '목표 ✓', no: '목표 ✗', unsure: '목표 ?' }
const CAUSE_LABEL: Record<StuckCause, string> = {
  anxiety: '불안',
  vague: '모호함',
  tired: '피곤',
  distracted: '딴짓',
  other: '기타'
}

export function DaySummary({ snap, back }: { snap: AppSnapshot; back: () => void }) {
  const { stats, settings, sessions, dayOpen } = snap
  const pct = Math.round(stats.ratio * 100)
  const target = settings.successTargetPct
  const finished = sessions.filter((s) => s.endReason !== null)

  return (
    <div className="stack" data-testid="summary">
      <div className="status">
        <h2>{dayOpen ? '오늘 요약 (진행 중)' : '오늘 요약'}</h2>
        <button className="link" data-testid="back" onClick={back}>닫기</button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="status">
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }} data-testid="summary-ratio">실질 작업 {pct}%</div>
          <span className="step">목표 {target}%</span>
        </div>
        <div className="progress" aria-hidden>
          <i style={{ width: `${Math.min(100, (pct / target) * 100)}%` }} />
        </div>
        <p className="lead" data-testid="summary-verdict">
          {stats.availableMs === 0
            ? '아직 측정된 시간이 없어요.'
            : pct >= target
              ? '오늘은 목표를 넘겼어요.'
              : `목표까지 ${target - pct}%p 남았어요.`}
        </p>
      </div>

      <div className="grid2">
        <div className="stat">
          <b data-testid="stat-work">{shortDuration(stats.workMs)}</b>
          <span>실질 작업 / {shortDuration(stats.availableMs)}</span>
        </div>
        <div className="stat">
          <b data-testid="stat-latency">
            {stats.medianStartLatencyMs === null ? '—' : shortDuration(stats.medianStartLatencyMs)}
          </b>
          <span>착수 지연 (중앙값)</span>
        </div>
        <div className="stat">
          <b data-testid="stat-stuck">{stats.stuckCount}회</b>
          <span>막혔어요</span>
        </div>
        <div className="stat">
          <b data-testid="stat-sessions">{stats.sessionCount}개</b>
          <span>세션 완료</span>
        </div>
      </div>

      {finished.length === 0 ? (
        <div className="empty">아직 끝낸 세션이 없어요.</div>
      ) : (
        <div className="list" data-testid="summary-sessions">
          {finished.map((s, i) => (
            <div className="item" key={`${s.startedAt}-${i}`} style={{ alignItems: 'flex-start' }}>
              <div className="title">
                <div>{s.taskTitle}</div>
                <div className="lead">
                  {hhmm(s.startedAt)} · {shortDuration(s.workMs)}
                  {s.output ? ` · ${s.output}` : ''}
                </div>
              </div>
              {s.goalLink && <span className="chip">{GOAL_CHIP[s.goalLink]}</span>}
              {s.cause && <span className="chip hot">{CAUSE_LABEL[s.cause]}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
