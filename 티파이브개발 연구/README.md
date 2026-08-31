# 티파이브 개발 연구

이 폴더는 T5의 다음 개발 가능성을 조사한 **비정본 연구 자료**를 보존한다.

오너가 새 작업 세션에서 “저장소의 `티파이브개발 연구` 폴더를 살펴봐”라고 말하면 다음 순서로 읽는다.

1. 저장소의 `AGENTS.md`
2. `T5-PRODUCT.md`
3. 현재 단일 개발 정본 `T5-NX.md`
4. 이 폴더의 `INDEX.md`
5. 현재 요청과 관련된 연구 문서만

`INDEX.md`의 관계 지도와 개통 판정표를 먼저 읽고, 여러 연구를 동시에 현재 개발 범위로 열지 않는다.

## 이 폴더가 아닌 것

- 현재 Gate나 개발 범위를 바꾸는 계획 정본이 아니다.
- 연구했다는 사실만으로 제품 채택·완료를 주장하지 않는다.
- 과거 source를 현재 제품에 import하거나 복원하는 근거가 아니다.
- 미래 세션이 이 폴더의 아이디어를 즉시 구현하라는 지시가 아니다.

연구를 실제 개발로 열려면 `T5-NX.md`의 현재 Gate가 필요하다. NX Mastery Lab은 고가치 목적 하나에서 격리 후보를
먼저 만들 수 있지만, Core 승격에는 현재 baseline·hidden oracle·same-purpose A/B·독립 field evidence가 필요하다.

## 공통 연구 lifecycle

```text
research_only
→ current product baseline
→ exact failure family
→ qualification candidate
→ same-purpose A/B
→ adopted | rejected | closed_with_observation
```

- `research_only`는 구현 승인이나 현재 제품 미달 확정을 뜻하지 않는다.
- 총괄 HQ 뒤 같은 사용자 결함의 원인을 먼저 분리하고, 가장 직접적인 연구선 하나만 연다.
- 한 연구 후보가 다른 연구를 필요로 한다는 이유만으로 두 Gate를 동시에 개통하지 않는다.
- 채택되지 않은 후보는 source·Prompt·schema·feature flag를 제품에 남기지 않는다.
