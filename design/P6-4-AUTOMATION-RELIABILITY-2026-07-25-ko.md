# P6-4 · Automation Reliability Guard

작성: 2026-07-25 · 상태: 구현·검증 완료, 깊은 감사 대기

P6-3b로 in-process 스케줄러가 실제로 들어왔다. 웹/메신저 자동화가 붙기 전에 **반복·실패·동시성 아래서
안전**하게 만든다. 막는 사고: 같은 작업 두 번 실행 · 실패한 전송 무한 반복 · 만료된 자동화 애매하게 잔존.

## 다섯 축 → 구현

| 축 | 구현 | 불변식 |
| --- | --- | --- |
| 실패 백오프 | `resolveAfterRun` + `nextBackoffMs`(지수·cap) | transient 실패는 백오프 재시도, `maxAttempts` 초과 시 `failed` |
| 무한 재전송 차단 | `classifyRetry` permanent 분기 | 차단·취소(permanent)는 **재시도 없이 즉시 `failed`** |
| tick 중첩 방지 | `runTrustedTick` in-flight 가드 | 이전 tick이 도는 중이면 새 tick은 `skipped:'in_flight'` |
| 중복 실행 방지 | in-flight 가드 + 상태 머신 | 완료/재예약된 job은 재실행 안 됨 → job 1회만 |
| 만료 정교화 | tick 진입 시 만료 우선 판정 | 백오프 대기 중이라도 만료되면 `expired`(재시도보다 우선) |

## 상태 전이 (resolveAfterRun, 순수)

```
성공(none)      → intervalMs면 scheduled(nextRunAt+=interval), 아니면 completed. failureCount=0
permanent(차단·취소) → failed (failureCount++). 재시도·재예약 없음
transient(실패·타임아웃) → failureCount++;
    failureCount >= maxAttempts → failed (정직하게 포기)
    아니면 scheduled, nextRunAt = now + nextBackoffMs(failureCount)  # 지수·cap
```

만료는 이 전이보다 앞선다: `tick` 진입에서 `state==='scheduled' && jobExpired` → `expired`, continue.

## 계약 (ScheduledJob 확장, §8.3)

`failureCount`(연속 실패, 성공 시 0 리셋) · `maxAttempts`(기본 5) · `backoffBaseMs`(기본 1s) ·
`backoffCapMs`(기본 1h). `GET /automation`의 `jobs[].failureCount` 표면화. 기본값은 `approveAutomation`에서.

## 중첩/중복 방지 경계

`runTrustedTick`은 서버 인스턴스별 `ticking` 플래그로 직렬화된다. HTTP tick과 in-process 스케줄러가 모두
이 단일 경로를 지나므로, 겹친 발화는 load→run→save 경합 없이 하나만 진행하고 나머지는 즉시 skip한다.
플래그는 **지속하지 않는다**(프로세스 크래시 후 stuck-running 회피) — 직렬화 가드로 충분하고, 단일 tick
내부는 순차 실행이라 중복 픽업이 없다.

## 테스트 (26개 중 P6-4 신규 6 + 반대 테스트)

`nextBackoffMs`(지수·cap 포화) · `resolveAfterRun`(성공 리셋/permanent 포기/transient 백오프/maxAttempts) ·
transient 백오프 후 maxAttempts 포기(원장 3회) · permanent 즉시 포기(무한 재전송 없음) ·
백오프 중 만료 우선 · tick 중첩 skip(slow-tool 게이트로 실제 동시성, job 1회).

반대 테스트: (1) 중첩 가드 제거 → 중첩 테스트 실패(job 2회). (2) permanent를 재예약으로 바꿈 →
즉시-포기 테스트 실패. 둘 다 복원 시 통과.

## 검증

전체 132/132. 중첩·백오프는 결정적 단위 테스트로 검증(slow-tool deferred 게이트 + 실패 도구). tick 실측은
런타임 토큰이 서버 내부 생성이라 CLI 불가 — 이는 P6-3b 트러스트 경계가 의도대로 동작하는 것.

## 남은 후속

- 백오프에 지터(thundering herd 완화) — 여러 job 동시 재시도 분산.
- 반복 job 원장 크기 상한(오래된 실행 요약 압축). 진짜 cron/daemon은 배포 계약 이후.
