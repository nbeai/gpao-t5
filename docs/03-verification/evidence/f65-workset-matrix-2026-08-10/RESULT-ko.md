# F-65 현재 작업셋 반사실 시험 — PM 판정

**판정일:** 2026-08-10  
**판정:** `F65_KNOT_CONFIRMED_NARROWLY` · 생활모의 원본은 미닫힘

## 안 된 것

1. F-65 하나로 생활모의 원본은 닫히지 않는다. L1은 8/8에서 `메모.txt`를 읽지 않았고, L4는
   8/8에서 파일을 만들지 않았는데 7/8이 내부 `completed`였다. 전 24판의 durable
   `execution_completed`는 0이다.
2. 원 판정기는 사용자가 경로를 다시 말하게 한 답을 `clarify` 종류일 때만 세어 부담을 24판 모두
   0으로 기록했다. `local.locate`의 `what`도 첫 손 목표에서 누락했다. 결과를 본 뒤 원점수를
   고치지 않고 측정 한계로 남긴다.
3. `consistent=true`는 완료 진실 셋이 모두 거짓인 경우도 포함한다. 완료 판정에는
   `verifiedComplete`만 쓴다.

## 확인된 것

- 세 시나리오의 W/P/O 전부 OFF에서는 3/3이 실제 격리 자료방으로 들어가지 않고
  `local.locate`로 이름을 찾았다. L1·L4는 사용자에게 경로를 다시 요구했고 L5는 미완료로
  멈췄다.
- 같은 시나리오·나머지 축 고정 대조에서 실제 성공한 목록 Receipt(O)는 첫 실제 자료 진입을
  5회 개선·악화 0회, 전량 읽기를 2회 개선·악화 0회 만들었다. canonical path(P)는 첫 진입
  3회 개선·악화 0회였다. 일반적인 작업셋 표지(W)만으로는 개선 2·악화 1이라 현재 작업 장소의
  충분한 기계 신분이 아니다.
- 따라서 F-65는 **허용된 현재 작업셋의 canonical root와 실제 관측한 구성원 신분이 첫
  RealitySnapshot에 서지 않는 진입 결함**으로 좁게 확정한다. 파일명·업종별 행동 규칙이나 손
  순서 지시가 아니라 bounded 현실 공급으로 수리한다.

## 분리 판정

- F-65: bounded current workset root + 실제 list Receipt/member identity를 Runtime reality에 공급한다.
- F-66b: 그 source set의 각 신분을 `read / excluded / unresolved`로 결산하고 산출물 근거와 묶는다.
- F-64: 사용자 목적의 결과 종류·실물 신분·readback과 같은 WorkRef/Receipt/Event가 일치한 뒤에만
  완료를 입장시킨다. 파일 목적을 채팅 초안만으로 완료하지 않는다.
- F-60은 오너 지시대로 미해결 봉인 상태이며 시험·수리 범위 밖이다.

## 원본과 숫자

- clean source `e5c000a5bc7289336197588f98ca1abcaf8df46e`
- OpenAI 요청 `gpt-5.1` · 응답 `gpt-5.1-2025-11-13`
- 3 시나리오 × W/P/O 2×2×2 = 24판 · 재실행 0 · 무효 0
- provider 142호출 · 총 1,775,462 tokens · 비용은 provider 원본에 없어 `unknown`
- 실사용 상태 변경 0 · fixture 변경 0 · durable `execution_completed` 0/24
- 원본 101파일 + 기계 감사 2파일 · 15,501,885 bytes
- `ARCHIVE-MANIFEST.json` SHA256
  `b67fc618f941b9864091bc74d8955b337a15f8b3bad45a99026d02113d0cc3de`
- `POST-RUN-MECHANICAL-AUDIT.json` SHA256
  `227662d837350d4a7729b0c307df5d9f9e0d4abc1d8e233928a0fd70041e216e`
