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
| `npm run e2e:idle` | 자리 비움 감지(체크인 2회 무응답 → 소급 정지, 시간 인정 이어가기, 시간 종료 무응답, 끝내기) 검증. `JUMPUP_TIME_SCALE=60` |
| `npm run e2e:all` | e2e 넷 모두 |

테스트 전용 환경 변수: `JUMPUP_DATA_DIR`(데이터 경로), `JUMPUP_TIME_SCALE`(시간 배율), `JUMPUP_E2E=1`(e2e 훅 노출). 일반 사용에서는 설정하지 않는다.

## 배포·도그푸딩
| 명령 | 설명 |
|---|---|
| `npm run dist` | NSIS 설치파일 생성 → `release/JumpUpNow-Setup-<버전>.exe` (x64, 사용자 단위 설치, **서명 없음**) |
| `npm run dist:dir` | 설치 없이 실행해 볼 수 있는 `release/win-unpacked/` 만 생성 |
| `npm run report` | 이벤트 로그에서 날짜별 지표와 **기준선**(측정 30분 이상인 날의 중앙값)을 출력. 읽기 전용. `-- <폴더>`로 다른 경로, `-- --since YYYY-MM-DD`로 그 날짜 이후만 |

- 패키징된 실행파일에 e2e를 돌리려면: `JUMPUP_EXE="release/win-unpacked/JumpUp Now.exe" npm run e2e:all` (격리된 임시 데이터 경로를 쓰므로 실제 데이터·로그인 항목은 건드리지 않는다)
- 설치 후 확인할 항목: [수동체크리스트.md](../수동체크리스트.md), 사용·판단 방법: [도그푸딩가이드.md](../도그푸딩가이드.md)

## 데이터 위치
설치된 앱: `%APPDATA%\JumpUp Now\` 아래 `events\YYYY-MM.jsonl`(이벤트 로그, 추가 전용), `settings.json`. 삭제해도 데이터는 남는다.
개발·테스트에서 분리하려면 `JUMPUP_DATA_DIR` 환경 변수로 경로를 바꾼다. 이 변수가 지정된 실행은 **부팅 자동 실행을 OS에 반영하지 않는다**(테스트가 사용자의 로그인 항목을 바꾸지 못하도록).

## 구조
- `src/domain/` — Electron 의존 없는 순수 로직 (이벤트, 통계, 세션 상태 머신, 추천, 복구)
- `src/main/` — Electron main process: `AppController`(상태 단일 출처), 저장소, 창·IPC
- `src/preload/` — `window.api` 브리지 (contextIsolation, sandbox)
- `src/renderer/` — React UI
- `src/shared/ipc.ts` — main ↔ renderer 계약(타입·채널)
