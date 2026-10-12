# JumpUp Now (app)

생각이 많아 미루는 문제를 풀기 위한 데스크톱 앱. 기획·설계는 저장소 루트의 [기획문서.md](../기획문서.md), [기술설계.md](../기술설계.md) 참고.

## 명령어
| 명령 | 설명 |
|---|---|
| `npm install` | 의존성 설치 (Node.js 20+ 필요) |
| `npm run dev` | 개발 모드 실행 (핫 리로드) |
| `npm run build` | 프로덕션 빌드 → `out/` |
| `npm test` | 단위·통합 테스트 (Vitest) |
| `npm run typecheck` | 타입 검사 |
| `npm run e2e` | 빌드된 앱을 실제로 띄워 하루 한 바퀴 검증 (`npm run build` 선행). 스크린샷은 `SHOTS_DIR` 또는 OS 임시 폴더 |

## 데이터 위치
`%APPDATA%/jumpup-now/` 아래 `events/YYYY-MM.jsonl`(이벤트 로그), `settings.json`.
개발·테스트에서 분리하려면 `JUMPUP_DATA_DIR` 환경 변수로 경로를 바꾼다.

## 구조
- `src/domain/` — Electron 의존 없는 순수 로직 (이벤트, 통계, 세션 상태 머신, 추천, 복구)
- `src/main/` — Electron main process: `AppController`(상태 단일 출처), 저장소, 창·IPC
- `src/preload/` — `window.api` 브리지 (contextIsolation, sandbox)
- `src/renderer/` — React UI
- `src/shared/ipc.ts` — main ↔ renderer 계약(타입·채널)
