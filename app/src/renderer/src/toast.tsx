import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ToastAction, ToastPayload } from '../../shared/ipc'
import './toast.css'

function Toast() {
  const [payload, setPayload] = useState<ToastPayload | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.getToast().then((p) => alive && setPayload((cur) => cur ?? p))
    const off = window.api.onToast(setPayload)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!payload) return null
  const act = (a: ToastAction): void => window.api.toastAction(a)

  switch (payload.kind) {
    case 'checkin':
      return (
        <div className="card" data-testid="toast-checkin">
          <div className="h">JumpUp Now · 체크인</div>
          <div className="m" data-testid="toast-msg">지금 하던 거 이어가고 있어요?</div>
          {payload.taskTitle && <div className="s">{payload.taskTitle}</div>}
          <div className="btns">
            <button className="p" data-testid="toast-ok" onClick={() => act('ok')}>진행 중</button>
            <button data-testid="toast-stuck" onClick={() => act('stuck')}>막혔어요</button>
          </div>
        </div>
      )
    case 'rescue':
      return (
        <div className="card" data-testid="toast-rescue">
          <div className="h">막혔어요 · {payload.level}회</div>
          <div className="m" data-testid="toast-msg">{payload.step}</div>
          <div className="btns">
            <button className="p" data-testid="toast-accept" onClick={() => act('dismiss')}>
              {payload.level === 1 ? '2분' : '1분'}만 하기
            </button>
          </div>
        </div>
      )
    case 'break':
      return (
        <div className="card" data-testid="toast-break">
          <div className="h">막혔어요 · 3회 연속</div>
          <div className="m" data-testid="toast-msg">
            {payload.minutes}분 쉬세요. 돌아오면 더 작은 걸 드릴게요.
          </div>
          <div className="btns">
            <button className="p" data-testid="toast-start-break" onClick={() => act('start_break')}>
              {payload.minutes}분 휴식 시작
            </button>
            <button data-testid="toast-continue" onClick={() => act('resume_session')}>계속하기</button>
          </div>
        </div>
      )
    case 'time_up':
      return (
        <div className="card" data-testid="toast-timeup">
          <div className="h">시간 종료</div>
          <div className="m" data-testid="toast-msg">{payload.plannedMin}분 지났어요. 정리할까요?</div>
          <div className="btns">
            <button className="p" data-testid="toast-finish" onClick={() => act('finish_session')}>마무리</button>
            <button data-testid="toast-more" onClick={() => act('dismiss')}>조금 더</button>
          </div>
        </div>
      )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toast />
  </StrictMode>
)
