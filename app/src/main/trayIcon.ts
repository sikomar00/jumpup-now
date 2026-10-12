// 트레이·창 아이콘. 외부 에셋 파일 없이 쓰도록 32x32 PNG(파란 원 + 위쪽 화살표)를 내장한다.
import { nativeImage, type NativeImage } from 'electron'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA+UlEQVR42s2X2w3DIAxFWYUJECMwEUuwArOwAitkCCbgo1UkUKOUFrg2LZb8lcc9iY0fQoCmbJLKJl1citVWhJyyKSqbsrLpcfNcrp33aE5ho2wKDcGen88YqrgHhO/u0fhGBvHqcThPivjBKF79GIJg/vK3P/GLmGM5UbJ96mXVAAjTAgiIOAgRWkUGFgch9BXAUcUBCDed+aM2fSI+1HZIfAIiXwsPq/gEhOwmINW6ifgNgMt6ABKpaMQj+ArBaBIuAMikBsQAEKFCxAjg4FLMBKD3aUZIOyYCGPJAQgDwLCMZuQFtO5T+fSzfYjHZZjXbYjldvZ4/AXIvMH0FKnPtAAAAAElFTkSuQmCC'

export function appIcon(): NativeImage {
  return nativeImage.createFromBuffer(Buffer.from(PNG_BASE64, 'base64'))
}

/** 트레이는 16x16이 기본이라 줄여서 쓴다(고해상도 화면에서도 선명하도록 원본은 32x32). */
export function trayIcon(): NativeImage {
  return appIcon().resize({ width: 16, height: 16 })
}
