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
| `npm run e2e` | 빌드된 앱을 실제로 띄워 하루 한 바퀴·위젯 검증 (`npm run build` 선행). 스크린샷은 `SHOTS_DIR` 또는 OS 임시 폴더 |
| `npm run e2e:checkin` | 체크인 토스트·막힘 대응·연속 막힘 휴식·시간 종료 검증. 테스트 전용 `JUMPUP_TIME_SCALE=60`으로 시간을 60배 빠르게 돌림(약 1분 소요) |
| `npm run e2e:daily` | 하루 시작 알림(미루기)·트레이 상주·빠른 추천·설정·하루 요약 검증. `JUMPUP_TIME_SCALE=60`, `JUMPUP_E2E=1`(트레이·단축키 훅) 사용 |
| `npm run e2e:all` | e2e 셋 모두 |

테스트 전용 환경 변수: `JUMPUP_DATA_DIR`(데이터 경로), `JUMPUP_TIME_SCALE`(시간 배율), `JUMPUP_E2E=1`(e2e 훅 노출). 일반 사용에서는 설정하지 않는다.

## 데이터 위치
`%APPDATA%/jumpup-now/` 아래 `events/YYYY-MM.jsonl`(이벤트 로그), `settings.json`.
개발·테스트에서 분리하려면 `JUMPUP_DATA_DIR` 환경 변수로 경로를 바꾼다.

## 구조
- `src/domain/` — Electron 의존 없는 순수 로직 (이벤트, 통계, 세션 상태 머신, 추천, 복구)
- `src/main/` — Electron main process: `AppController`(상태 단일 출처), 저장소, 창·IPC
- `src/preload/` — `window.api` 브리지 (contextIsolation, sandbox)
- `src/renderer/` — React UI
- `src/shared/ipc.ts` — main ↔ renderer 계약(타입·채널)
