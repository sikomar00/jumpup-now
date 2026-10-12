import { useCallback, useEffect, useState } from 'react'
import type { AppSnapshot, Command } from '../../shared/ipc'

export function useAppState(): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.getSnapshot().then((s) => {
      if (alive) setSnapshot(s)
    })
    const off = window.api.onState((s) => setSnapshot(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return snapshot
}

/** 일정 간격으로 갱신되는 현재 시각. 타이머 표시용. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export type Run = (cmd: Command) => Promise<boolean>

/** 명령을 보내고 실패 메시지를 error 상태로 노출한다. */
export function useRunner(): { run: Run; error: string | null; clearError: () => void } {
  const [error, setError] = useState<string | null>(null)
  const run = useCallback<Run>(async (cmd) => {
    const result = await window.api.command(cmd)
    setError(result.ok ? null : result.error)
    return result.ok
  }, [])
  const clearError = useCallback(() => setError(null), [])
  return { run, error, clearError }
}
