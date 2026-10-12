// e2e 공용 실행 옵션.
// 기본: 빌드된 out/ 을 electron으로 실행. JUMPUP_EXE=<경로>를 주면 패키징된 실행파일(설치 전 win-unpacked 등)을 실행한다.
// 어느 쪽이든 JUMPUP_DATA_DIR이 필수다 — 사용자의 실제 데이터·로그인 항목을 건드리지 않기 위함.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function launchOptions(env) {
  if (!env.JUMPUP_DATA_DIR) throw new Error('e2e는 JUMPUP_DATA_DIR(격리된 데이터 경로)이 반드시 필요합니다')
  const merged = { ...process.env, ...env }
  const exe = process.env.JUMPUP_EXE
  if (exe) return { executablePath: exe, args: [], env: merged }
  return { executablePath: require('electron'), args: [appDir], cwd: appDir, env: merged }
}

export const mode = () => (process.env.JUMPUP_EXE ? `패키징 실행파일 (${process.env.JUMPUP_EXE})` : '개발 빌드 (out/)')
