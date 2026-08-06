# 오픈클로·헤르메스 흡수 조사 (M1 · 2026-08-03)

읽은 것: 이 맥에 있는 실물 코드다. 문서·블로그가 아니다.
- OpenClaw `~/Developer/lab_un/openclaw-pure-2026-07-20` — `src/infra/exec-approvals.ts`(2,799줄) ·
  `exec-authorization-plan.ts` · `command-analysis/risks.ts`
- Hermes `~/Developer/lab_un/hermes-agent` — `tools/approval.py` · `tools/code_execution_tool.py` ·
  `agent/prompt_builder.py` · `tools/skill_manager_tool.py`

목적: 자동성 헌장(`T5-AUTONOMY-CHARTER-2026-08-03-ko.md`)과 M2~M4 구현의 재료.
흡수/변형/배제 — 그대로 가져올 것, T5 원리에 맞게 바꿀 것, 안 가져올 것과 이유.

## 1. 승인 모델 (M2 재료)

### 실측 사실

**OpenClaw** — 기본값 `security=full · ask=off · askFallback=deny`
(`exec-approvals.ts:311-313`). 실행은 기본이 자동이다. 정교함은 "무엇이 위험한가"가 아니라
**"이 승인을 재사용할 수 있는가"** 에 들어가 있다:
- `PROMPT_ONLY_RISKS` — eval·source·alias 등은 그 자리에서만 승인, 저장 불가
- `NON_REUSABLE_RISKS` — inline-eval 은 승인해도 다음 번에 재사용 못 함
- `UNANALYZABLE_RISKS` — command-substitution·heredoc·redirect 등 정적 분석 불가면 allowlist 등재 불가
그리고 wrapper 해체(`bash -c`, `env X=`, carrier 중첩)를 재귀로 풀어서 **감싸기로 allowlist 를
우회하지 못하게** 한다(`risks.ts` buildCommandPayloadCandidates).

**Hermes** — 기본은 전부 실행. 멈추는 것은 `DANGEROUS_PATTERNS` 하나뿐이고(`approval.py:606`),
그 목록은 사실상 **파괴 목록**이다: 재귀 삭제 · mkfs · dd · 블록장치 쓰기 · SQL DROP/WHERE 없는
DELETE · 시스템 설정 덮어쓰기 · kill -9 -1 · fork bomb. 게다가 패턴에 걸려도 **보조 LLM 이
저위험이면 자동 승인**한다(Smart approval). 승인 상태는 세션 단위 + 영구 allowlist 로 남는다.
`HERMES_YOLO_MODE` 는 import 시점에 동결 — 스킬이 실행 중에 우회 변수를 심는 프롬프트 주입 차단.

### 처분

| 항목 | 처분 | 이유 |
|---|---|---|
| 기본 자동·묻는 것 최소 (둘 다) | **흡수** | 헌장 그 자체. 두 제품이 독립적으로 같은 결론에 도착했다 |
| Hermes 파괴 패턴 → 헌장 ② 판정 | **변형 흡수** | 목록은 참고하되, T5 는 정규식 목록이 아니라 **probe(격리 실행)** 가 1차 판정. 목록은 probe 가 못 보는 것(SQL·원격 파괴)의 보조 |
| Hermes 보조 LLM 승인 | **변형 흡수** | "모르면 묻는다" 대신 "모르면 모델이 한 번 더 본다". T5 는 이미 모델 판단 우선 원칙 — 같은 자리에 앉힌다 |
| OpenClaw 승인 재사용 구조 | **흡수** | 헌장 ③ "그 상대에 한 번만"이 정확히 이것. 첫 전송 승인이 상대 단위로 저장되고 다시 안 묻는다 |
| OpenClaw wrapper 해체 | **흡수** | 저장된 허용을 감싸기로 우회 못 하게. M4 에서 터미널이 커질수록 필수 |
| OpenClaw analyzability 3분류 | **변형 흡수** | "위험한가"가 아니라 "저장할 수 있는 승인인가"라는 질문 자체를 가져온다 |
| Hermes YOLO 동결 패턴 | **흡수** | 실행 중 환경변수로 헌장을 끌 수 없어야 한다 |
| OpenClaw allowlist 파일 정책 계층 | **배제** | 팀 1차 범위 밖. 설정 파일 계층은 지금 사용자에게 없는 개념 |

## 2. 범용 실행 능력 (M4 재료)

### 실측 사실 — Hermes PTC (`code_execution_tool.py`)

> "Lets the LLM write a Python script that calls Hermes tools via RPC,
> collapsing multi-step tool chains into a single inference turn."

- 부모가 `hermes_tools.py` 스텁을 생성 → UDS 소켓 RPC 리스너 → 자식 프로세스가 모델이 쓴
  스크립트 실행 → 도구 호출이 소켓으로 부모에 돌아와 디스패치
- 샌드박스 안에서 허용된 도구는 **7개 고정**(web_search·web_extract·read_file·write_file·
  search_files·patch·terminal) ∩ 세션 활성 도구
- 한도: 5분 · 도구 호출 50회 · stdout 50KB. **중간 결과는 컨텍스트에 안 들어간다** — stdout 만
- 승인 컨텍스트가 스레드로 상속된다 — 샌드박스 안 도구 호출도 같은 승인 경계를 탄다

### 처분

| 항목 | 처분 | 이유 |
|---|---|---|
| PTC 구조 전체 | **변형 흡수** | M4 의 뼈대. 팀원 세션의 "파이썬 코드 출력만"이 정확히 이게 없어서다. 모델이 쓴 스크립트가 T5 의 손을 직접 부르면 폴링 브릿지든 뭐든 그 자리에서 돈다 |
| 스텁 생성 방식 (도구 → 함수) | **흡수** | T5 손 14개가 그대로 스크립트 함수가 된다 |
| 중간 결과 컨텍스트 차단 | **흡수** | T5 의 "지연은 공백을 채우는 것" 원칙과 결이 같다 — 모델을 멍청하게 만들지 않으면서 왕복을 줄이는 유일하게 옳은 방법 |
| 승인 컨텍스트 상속 | **흡수** | 스크립트 안이라고 헌장이 꺼지면 안 된다. 헌장 넷은 스크립트 안에서도 넷 |
| Python 채택 | **배제** | T5 는 런타임 의존성 0(§17). 동봉 Node 로 같은 구조를 만든다 |

## 3. 자기 상태 자각 (M3 재료)

### 실측 사실

- Hermes `prompt_builder.py` — SOUL.md 를 **prompt-build 시점에 한 번 읽어 매 턴 주입**.
  identity slot 을 fork 하지 않는다(1220행 주석). 이중 주입 방지(skip_soul).
- Hermes 는 스킬 표면에 소유권 개념이 있다 — 외부 소유 스킬은 자율 큐레이션이 못 만진다.
  자기가 뭘 바꿀 수 있고 뭘 못 바꾸는지가 **코드로** 갈라져 있다.

### 처분

| 항목 | 처분 | 이유 |
|---|---|---|
| SOUL 매 턴 주입 + 단일 정체 | **이미 있음 — 점검** | T5 도 SOUL 이 매 턴 간다. 그런데 말귀 측정에서 반말/존댓말이 흔들렸다 — 주입이 아니라 **내용**(어투 규정)이 빈 것인지 M3 에서 확인 |
| 능력 지도의 진실성 | **T5 가 더 가야 함** | 팀원 세션의 헛말("입력창 열게요")·우회(수신기 있는데 커넥터 선언)는 selfState 에 제품 1급 기능(채널·자동화·비밀 입력면)이 안 실리거나 모델이 소비 안 한 것. 이건 흡수가 아니라 T5 자기 숙제 |
| "할게요" 주장 대조 | **T5 고유** | 읽은척차단의 정의역 확장. 두 제품 다 없다 — T5 의 출처 원장이 있어서 가능한 것 |

## 4. 채널 구조 (참고 — M4 이후)

OpenClaw 는 채널 N 개(telegram·whatsapp·discord·slack·signal·imessage·… 20여 개)를
**Gateway 한 프로세스**가 소유하고 에이전트는 읽고 쓸 뿐이다. Hermes 도 같은 구조다
(single gateway process, README). T5 의 텔레그램 수신기는 이미 이 모양이다 —
채널을 늘릴 때 이 패턴을 유지하면 되고, **채널별 기능을 만들지 않는다**(오너 지시와 일치).

## 5. 요약 — M2~M4 가 가져갈 것

- **M2**: 헌장 넷 판정 + Hermes 파괴 패턴(보조) + 승인 재사용(상대 단위 저장) + YOLO 동결 + 보조 모델 재판정
- **M3**: selfState 에 제품 1급 기능 완전 등재 + "할게요" 주장 원장 대조 + SOUL 어투 규정 점검
- **M4**: Node 판 PTC — 모델이 쓴 스크립트가 T5 손을 RPC 로 부르고, stdout 만 돌아온다.
  헌장은 스크립트 안에서도 유효
