// 트레이·창 아이콘. 외부 에셋 파일 없이 쓰도록 PNG를 base64로 내장한다(iconData.ts, tools/make-icons.cjs로 생성).
import { nativeImage, type NativeImage } from 'electron'
import { APP_ICON_64_BASE64, TRAY_ICON_32_BASE64 } from './iconData'

const fromBase64 = (b64: string): NativeImage => nativeImage.createFromBuffer(Buffer.from(b64, 'base64'))

/** 창·작업 표시줄용 (계단 3단) */
export function appIcon(): NativeImage {
  return fromBase64(APP_ICON_64_BASE64)
}

/** 트레이는 16x16이 기본이라 줄여서 쓴다. 작은 크기에서 뭉개지지 않도록 계단 2단·굵은 선 전용 변형(32px 원본)을 쓴다. */
export function trayIcon(): NativeImage {
  return fromBase64(TRAY_ICON_32_BASE64).resize({ width: 16, height: 16 })
}
