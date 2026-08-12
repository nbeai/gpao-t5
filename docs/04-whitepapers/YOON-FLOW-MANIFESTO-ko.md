# YOON Flow Manifesto

AI로 개발할 때 가장 위험한 착각은 "코드가 빨리 나왔다"를 "제품이 좋아졌다"로 착각하는 것이다.

바이브코딩은 개발의 문을 열었다. 이제 필요한 것은 그 속도를 실제 제품 완성으로 끌고 가는 운영법이다.

나는 이것을 **YOON Flow-Governed Vibe Engineering**이라고 부른다.

짧게는 **YOON Flow**다. 새로운 컴퓨터과학 이론이 아니라, AI-native 제품 개발을 위한 실무 운영 모델이다.

## 한 문장

> 인간은 의도와 사용자 감각을 지키고, AI는 구현 속도를 만들고, 감사는 사실과 방향을 붙잡고, 실제 사용자 흐름이 최종 판정을 내린다.

## 왜 필요한가

AI 코딩 도구는 놀랍다. 하지만 실제 제품을 만들다 보면 같은 문제가 반복된다.

- AI가 말을 알아들은 듯하지만 엉뚱한 방향으로 간다.
- 테스트는 통과했는데 실제 화면은 불편하다.
- 문서와 계획은 완벽해지는데 제품은 멈춘다.
- 긴 세션에서 맥락이 흐려지고 과거 결정을 잘못 되살린다.
- AI가 검증하지 않은 것을 완료처럼 말한다.
- 안전을 이유로 모든 것을 카드와 클릭으로 막는다.
- 자동화를 서두르다 잘못 배운 내용이 실제 행동에 들어간다.

그래서 AI 개발에는 단순한 프롬프트가 아니라 **역할, 흐름, 검증, 인수인계**가 필요하다.

## 핵심 용어

- **Flow Governance**: 사용자의 의도가 요구사항, 구현, 검증, 사용자 표면, 인수인계로 이동하는 동안 왜곡되지 않게 관리하는 흐름.
- **말귀(Intent Fidelity)**: 사용자의 실제 목적과 불편, 맥락이 제품 결과 안에 살아남는 정도.
- **Flow Friction**: 불필요한 질문, 카드, 클릭, 대기, 재설명, 복구 비용.
- **Counter-Test**: 원하는 성공보다 먼저 금지해야 할 실패 경로를 붉게 만드는 테스트.

## 5대 원칙

1. **Intent First**: 사용자의 의도가 코드보다 우선한다.
2. **Flow over Features**: 기능 수보다 사용자 흐름의 개선을 본다.
3. **Negative First**: 반대시험을 먼저 만든다.
4. **Reality over Mocks**: 실제 환경을 최종 판정에 더 가깝게 둔다.
5. **Shared Truth**: 코드, 테스트, 문서, 커밋, 인수인계가 같은 현재 사실을 말해야 한다.

## 10가지 원칙

1. **말귀가 제일 중요하다.**  
   코드를 많이 쓰는 것보다 사용자의 의도를 정확히 잡는 것이 먼저다.

2. **카드와 클릭으로 사람을 괴롭히지 마라.**  
   지킨 위험이 없는 확인은 사용성 부채다.

3. **최소 안전, 최대 자동화.**  
   외부 전송, 결제, 공개, 복구 불가능한 삭제, 새 지속 권한만 강하게 막고, 가역적인 로컬 작업은 자동화한다.

4. **모델을 멍청하게 만들지 마라.**  
   규칙으로 AI를 압박하기보다, 정확한 맥락·도구·권한·실패 사실을 공급해 능력을 끌어낸다.

5. **테스트 초록은 제품 성공이 아니다.**  
   테스트, 반대시험, 전체 회귀, 실제 화면 검증을 구분한다.

6. **실제 사용자 문장으로 개발하라.**  
   "기억 기능 구현"이 아니라 "앞으로 보고서는 목록으로 정리해줘"가 통과해야 한다.

7. **구현자와 감사자를 분리하라.**  
   AI가 만든 구조를 같은 관성으로 AI가 검사하면 누락이 생긴다.

8. **비교군은 순위가 아니라 흡수 재료다.**  
   다른 도구가 잘하는 흐름은 배우고, 위험한 경계는 복사하지 않는다.

9. **인수인계는 문서가 아니라 현재 진실이다.**  
   세션이 바뀌어도 다음 AI가 같은 제품을 만들 수 있어야 한다.

10. **완성은 기능 수가 아니라 흐름이다.**  
    사용자가 덜 묻고, 덜 누르고, 덜 기다리고, 더 자연스럽게 목표를 끝내면 좋아진 것이다.

## AI에게 이렇게 맡겨라

AI에게 "이 파일 고쳐"만 말하지 말고, 다음 구조를 준다.

```text
목표:
사용자가 실제로 얻어야 하는 결과는 무엇인가?

사용자 문장:
이 기능이 통과해야 할 실제 발화 3~5개를 적어라.

성공 기준:
질문 수, 카드 수, 클릭 수, 완료 턴, 오류 복구, 성능 기준을 적어라.

안전 경계:
승인이 필요한 일과 자동으로 해도 되는 일을 나눠라.

역할:
구현 AI는 코드와 실행을 맡고, 감사 AI는 결함 계열과 실제 사용자 흐름을 본다.

검증:
반대시험을 먼저 쓰고, 전체 회귀를 돌리고, 실제 화면이나 실제 환경에서 확인하라.

인수인계:
커밋, 현재 상태, 남은 한계, 다음 행동을 기록하라.
```

## 8단계 실행 루프

8단계인 이유는 각 단계가 AI 개발에서 자주 끊기는 책임 경계를 하나씩 닫기 때문이다. 의도를 고정하고, 기존 현실을 읽고, 현재 실패를 재현하고, 잘못된 성공을 막고, 제품 경로를 고치고, 동작 증거를 모으고, 제품 목표에 맞는지 판단하고, 다음 작업자가 이어받게 만든다.

```text
1. Frame
   목표와 실제 사용자 문장을 다시 말한다.

2. Locate
   기존 코드, 문서, 테스트, 최근 인수인계를 읽는다.

3. Baseline
   현재 동작을 재현하거나 재현 불가 이유를 밝힌다.

4. Counter-Test
   수정 전 실패하는 반대시험을 먼저 만든다.

5. Implement
   실제 제품 경로를 가장 작게 고친다.

6. Verify
   표적 검사, 필요한 회귀, 실제 환경 검증을 구분해 수행한다.

7. Audit
   검사가 주장보다 좁지 않은지, 사용자 마찰이 줄었는지 본다.

8. Handoff
   커밋, 검증, 한계, 다음 행동을 기록한다.

→ next Frame
```

루프는 얇게 유지한다. 다음 구현을 돕지 않거나 실제 반복 실패를 막지 않는 문서와 게이트는 만들지 않는다.

Verify와 Audit는 다르다. Verify는 **구현이 동작하는지 증명**하고, Audit는 **그 동작이 사용자 목표와 실제 흐름을 만족하는지 판단**한다.

## 언제 얼마나 적용할까

| 작업 | 모드 |
|---|---|
| 작은 스크립트·간단 수정 | Lite Loop |
| 일반 기능·버그 수정 | Standard Loop |
| 데이터·결제·권한·삭제·외부 전송 | Full Loop |
| AI 기억·자가학습·자동화·장기 에이전트 | Full Loop + 독립 감사 |

작으면 줄이고, 되돌리기 어렵거나 AI가 스스로 배우고 행동하면 줄이지 않는다.

## 간단한 Flow Friction 점수

불필요한 질문, 카드, 클릭은 각각 +1. 같은 맥락 재설명은 +2. 복구 경로 없는 실패는 +5. 한 슬라이스에서 0~2점은 양호, 3~5점은 개선 필요, 6점 이상은 사용성 결함이다.

## 프로젝트에 바로 넣는 규칙

`YOON.md`, `AGENTS.md`, `CLAUDE.md` 같은 파일에 아래를 붙여 넣어도 된다.

```md
# YOON Vibe Engineering Rules

1. Understand the user's intent before choosing the implementation path.
2. Build vertical slices around real user utterances, not abstract feature names.
3. Use minimum safety and maximum automation.
4. Do not add confirmation cards unless they protect a real external, irreversible, or durable risk.
5. Write counter-tests before implementation.
6. A passing unit test is not completion. Verify the actual product path.
7. Do not invent fixture fields the product does not create.
8. Separate implementer and auditor roles whenever possible.
9. Update handoff after every major decision, rollback, or completed slice.
10. Completion means the user flow improved: fewer questions, fewer clicks, less waiting, more correct outcomes.

Development loop: Frame -> Locate -> Baseline -> Counter-Test -> Implement -> Verify -> Audit -> Handoff.
```

이 규칙은 특정 모델이나 IDE에 묶이지 않는다. LLM이 코드를 만들고 파일, 터미널, 브라우저, 테스트 환경을 다루는 곳이라면 어떤 agentic coding 도구에도 적용할 수 있다. 실제 채택을 위해서는 `YOON.md`, `AGENTS.md`, `CLAUDE.md`, Cursor Rules, Gemini/Codex용 프롬프트처럼 도구별 운영 파일로 내려가야 한다.

## 끝내는 질문

AI 개발이 끝났다고 말하기 전에 이것만 묻는다.

```text
실제로 연결됐는가?
사용자가 덜 묻고 덜 눌러도 되는가?
AI가 더 잘 알아듣고 더 많이 끝내는가?
실패해도 정직하고 복구 가능한가?
다음 세션이 같은 사실에서 이어받을 수 있는가?
```

바이브코딩은 시작점이다.  
제품을 완성하려면 바이브를 흐름으로 다스려야 한다.
