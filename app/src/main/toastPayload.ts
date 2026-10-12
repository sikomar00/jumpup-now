// 세션 효과(SessionEffect) → 토스트 내용. Electron에 의존하지 않는 순수 함수.
import { rescueStep } from '../domain/recommender'
import type { SessionEffect } from '../domain/sessionMachine'
import type { AppSnapshot, ToastPayload } from '../shared/ipc'

/** 테스트에서 시간을 줄여도 사람이 읽을 수 있는 최소 표시 시간 */
export const MIN_TOAST_MS = 3000
export const CHECKIN_TIMEOUT_MS = 30_000
export const RESCUE_TIMEOUT_MS = 12_000
export const TIME_UP_TIMEOUT_MS = 60_000
export const BREAK_MINUTES = 5

const scaled = (ms: number, scale: number): number => Math.max(MIN_TOAST_MS, Math.round(ms / scale))

export function toastFor(effect: SessionEffect, snap: AppSnapshot, scale = 1): ToastPayload {
  switch (effect.kind) {
    case 'checkin_due':
      return {
        kind: 'checkin',
        taskTitle: snap.sessionTask?.title ?? '',
        timeoutMs: scaled(CHECKIN_TIMEOUT_MS, scale)
      }
    case 'rescue':
      return {
        kind: 'rescue',
        level: effect.level,
        step: rescueStep(effect.level),
        timeoutMs: scaled(RESCUE_TIMEOUT_MS, scale)
      }
    case 'suggest_break':
      return { kind: 'break', minutes: BREAK_MINUTES }
    case 'time_up':
      return {
        kind: 'time_up',
        plannedMin: snap.settings.sessionMin,
        timeoutMs: scaled(TIME_UP_TIMEOUT_MS, scale)
      }
  }
}

/**
 * 현재 표시 중인 토스트가 새 상태에서도 유효한지 판단한다.
 * 체크인은 응답 대기가 끝나면, 막힘 대응·시간 종료는 세션이 끝나면, 휴식 제안은 정지가 풀리면 사라진다.
 */
export function isToastStale(payload: ToastPayload, snap: AppSnapshot): boolean {
  const { phase, checkinPending } = snap.session
  const active = phase === 'running' || phase === 'paused'
  switch (payload.kind) {
    case 'checkin':
      return !checkinPending || !active
    case 'rescue':
    case 'time_up':
      return !active
    case 'break':
      return phase !== 'paused' || snap.breakOpen
  }
}
