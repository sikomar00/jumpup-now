import { useState } from 'react'
import type { TaskSize } from '../../../domain/events'
import type { AppSnapshot } from '../../../shared/ipc'
import { SIZE_LABEL, dateInputToDue, dueText } from '../format'
import type { Run } from '../hooks'

const SIZES: TaskSize[] = ['small', 'medium', 'large']

export function Tasks({ snap, run, back }: { snap: AppSnapshot; run: Run; back: () => void }) {
  const [title, setTitle] = useState('')
  const [size, setSize] = useState<TaskSize | undefined>()
  const [date, setDate] = useState('')
  const [showMore, setShowMore] = useState(false)

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    const due = dateInputToDue(date)
    const ok = await run({
      type: 'task_add',
      title,
      ...(size ? { size } : {}),
      ...(due !== undefined ? { due } : {})
    })
    if (ok) {
      setTitle('')
      setSize(undefined)
      setDate('')
    }
  }

  return (
    <div className="stack" data-testid="tasks">
      <div className="status">
        <h2>할 일 목록</h2>
        <button className="link" data-testid="back" onClick={back}>닫기</button>
      </div>

      {snap.tasks.length === 0 ? (
        <div className="empty">아직 할 일이 없습니다. 제목만 입력하면 됩니다.</div>
      ) : (
        <div className="list">
          {snap.tasks.map((t) => {
            const due = t.due !== undefined ? dueText(t.due, snap.now) : null
            return (
              <div key={t.id} className={`item${t.done ? ' done' : ''}`} data-testid="task-item">
                <input
                  type="checkbox"
                  className="check"
                  checked={t.done}
                  disabled={t.done}
                  aria-label={`${t.title} 완료`}
                  onChange={() => void run({ type: 'task_done', id: t.id })}
                />
                <span className="title">{t.title}</span>
                {due && <span className={`chip${due.hot ? ' hot' : ''}`}>{due.text}</span>}
                {t.size && <span className="chip">{SIZE_LABEL[t.size]}</span>}
                <button className="x" aria-label={`${t.title} 삭제`} onClick={() => void run({ type: 'task_delete', id: t.id })}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <input
            className="input"
            maxLength={200}
            placeholder="+ 할 일 추가 (제목만 있으면 됩니다)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            aria-label="할 일 제목"
            data-testid="task-title"
          />
          <button className="btn small" style={{ width: 'auto' }} disabled={!title.trim()} onClick={() => void add()} data-testid="task-add">
            추가
          </button>
        </div>
        <button className="link" onClick={() => setShowMore((v) => !v)}>
          {showMore ? '마감·크기 접기' : '마감·크기 입력 (선택)'}
        </button>
        {showMore && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="seg">
              {SIZES.map((s) => (
                <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(size === s ? undefined : s)}>
                  {SIZE_LABEL[s]}
                </button>
              ))}
            </div>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="마감일" />
          </div>
        )}
        <p className="lead">입력이 없으면 목록 순서대로 추천합니다.</p>
      </div>
    </div>
  )
}
