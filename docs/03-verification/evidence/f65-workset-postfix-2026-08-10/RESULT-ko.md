# F-65 보강 뒤 유료 재측정 — PM 판정

## 안 된 것

- F-66b는 남았다. L1은 `메모.txt`를 6/8에서 읽지 않았고, 기준 셀은 합산 조건을 놓쳐
  `750000` 없는 파일을 만든 뒤 완료로 섰다.
- F-64는 남았다. L4는 자료를 8/8 전부 읽었지만 파일 산출물은 0/8인데
  `recentOutcome=completed`는 8/8이었다.
- 완료 진실은 아직 둘이다. 24판 모두 `WorkRef`·`execution_completed`·`verifiedComplete`가 0인데
  `recentOutcome=completed`는 20/24였다.
- 판정기의 `firstToolTarget`은 모델 손이 아닌 `runtime_observation` 목록을 24/24 첫 손으로 셌다.
  `userRestatementBurden`·`firstToolTarget.target`·`consistent`에도 기록된 한계가 있어, 이 판정은
  원본에서 모델 실행만 다시 분리해 계산했다. 원점수는 고치지 않았다.

## 판정

F-65는 **현재 bounded 작업셋에 입장하는 좁은 결함으로 닫는다.** 보강 전 같은 자의 기준 셀 3/3은
`local.locate`로 갔지만, 보강 뒤에는 모델 실제 자료 손 진입 24/24·`local.locate` 0/24였고 기준 셀
3/3 모두 사용자에게 경로를 다시 묻지 않고 실제 파일로 들어갔다.

닫는 범위는 canonical current root와 실제 관측 member identity/sourceSetRef를 첫 현실에 공급하는
것까지다. **목록에 선 자료를 전부 읽었다는 뜻도, 목적 결과가 완성됐다는 뜻도 아니다.** L1은 F-66b,
L4와 두 완료 진실은 F-64에서 이어간다. 각 칸은 1표본이므로 W/P/O 개별 축의 필요충분 우위는
선언하지 않는다.

## 숫자

- 유효 회차 24/24 · 재실행 0 · 실사용 상태 변경 0
- OpenAI 요청 `gpt-5.1` · 응답 `gpt-5.1-2025-11-13`
- 모델 호출 138 · 토큰 1,755,136 · 비용 공급자 미보고
- 자료 손 진입 24/24 · `local.locate` 0/24 · source 전량 읽기 18/24
- 유효 산출물 12/24 · `recentOutcome=completed` 20/24 · `execution_completed` 0/24
- 원본 101파일 · 저장 대조 101/101 · 불일치 0

정본 원본은 이 폴더의 `ARCHIVE-MANIFEST.json`, 기계 재계산은
`POST-RUN-MECHANICAL-AUDIT.json`에 있다.
