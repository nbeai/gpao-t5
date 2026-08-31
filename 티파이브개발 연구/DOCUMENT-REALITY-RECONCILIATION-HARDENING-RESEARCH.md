# T5 문서 현실·대사 강화 연구 — Document Reality & Reconciliation Hardening

기록일: 2026-08-30
조사 기준 head: `4e6a0770`
연구 상태: `RESEARCHED · NOT_ADOPTED · DEFERRED_AFTER_SIXTH_COMPLETION`

## 1. 오너 의도와 현재 결론

오너가 원하는 것은 Upstage Studio를 사용하거나 복제하는 일이 아니다. 공개된 한국 실무 문서 사례에서
검증할 가치가 있는 원리를 배우고, 대한민국 일반인·사업자·일하는 사람이 자신의 현실에서 T5의 기존 능력을
더 자연스럽고 강하게 끌어낼 수 있도록 만드는 것이다.

현재 결론은 다음과 같다.

> T5에 새 문서 플랫폼·업종별 Agent·DocumentPacket Store를 만들지 않는다. 현재 T5에 이미 있는
> File Reality·OCR·Document·`bind_sources`·source manifest·G Program·Artifact·Undo·Work를 실제 복합 문서
> 목적에서 먼저 자격하고, 반복 재현된 약한 문서 인식·관계 결속·주장별 근거 UX만 강화한다.

이 연구는 현재 `S6-UX` Gate와 6차 완료 범위를 바꾸지 않는다. 6차 UX·변경 edge WA 재감사·남은 물리 자격·
최종 S6-HQ를 먼저 닫는다. 그 뒤 오너가 별도 후속 Gate를 열 때만 이 문서의 `DR-0`부터 재검증한다.

이 연구는 `T5 Method Runtime`의 구현 사유가 아니다. DR-0에서 목적 실패의 최초 경계를 문서 perception·source
selection·relation/reconciliation·Evidence UX·model/tool 왕복으로 먼저 분리한다. 정확성과 source truth는 선 상태에서
단계별 모델 감독 비용만 반복 병목으로 남을 때 별도 `MR-0` 연구를 검토한다.

## 2. Upstage 공개 사례에서 배울 원리

2026-08-30 공개 페이지의 JSON-LD에는 78개 Agent 상세 URL이 있고, 현재 가시 카드에서는 58개의 산업·단계
metadata를 확인할 수 있다. 이 수치는 변할 수 있으며 시장 규모나 실제 유료 사용량을 뜻하지 않는다.

공개 사례가 반복해서 보여주는 구조는 다음이다.

```text
같은 사건의 여러 자료를 모음
→ 문서 역할을 구분
→ 필요한 값을 공통 의미로 추출
→ 문서 사이의 identity·값·날짜·수량을 대조
→ 계산을 검산
→ 누락·불확실성·해석 필요를 분리
→ 사람이 다음 행동을 결정할 근거와 결과물을 제공
```

대표 사례군:

- 계약서·인보이스·송금증
- 발주서·입고전표·세금계산서·거래명세서
- 실사수량·전산재고·입출고·폐기대장
- 카드내역·영수증·비용 증빙
- 진료기록·청구명세·급여기준
- 계약서·보안점검표·처리방침
- 보험 청약서·적합성진단서·완전판매 기록

흡수할 원리:

1. 파일 하나보다 문서 사이의 관계가 사용자 가치의 중심이다.
2. 추출값은 파일·revision·page/sheet/row/cell·원문·coverage와 결속돼야 한다.
3. 결과는 일치·불일치·누락·판독 불확실·해석 필요를 분리해야 한다.
4. 분류·추출 성공은 계산·전문 판정·사용자 목적 완료를 증명하지 않는다.
5. 일반 사용자는 결과의 중요한 주장 하나에서 원문 위치를 바로 확인할 수 있어야 한다.
6. 결과는 확인 목록·문의 초안·표·문서·전달·다음 달 반복으로 이어져야 한다.

복제하지 않을 것:

- Parse·Classify·Extract·Instruct 노드 UI
- 업종별 Agent 카탈로그
- 사용자가 schema·workflow를 설계하는 경험
- 서비스·문서명·확장자 정규식 Router
- 공급자 판정을 T5의 최종 판단으로 승격
- 공개 마케팅 정확도·속도·사례를 T5 성능 정답으로 사용

참고:

- https://studio.upstage.ai/library
- https://www.upstage.ai/products/studio
- https://www.upstage.ai/products/information-extract

## 3. 현재 T5에서 이미 선 기반

이 연구는 다음을 새로 만들지 않는다. 현재 source와 완료 evidence에서 먼저 실제 재사용 가능성을 확인한다.

### File·Document Reality

- 파일 identity·SHA·revision·exact handle
- standard·local sync 범위의 filename·content·OCR 검색
- 대형 PDF 전체 로컬 검색과 exact page reopen
- PDF page·coverage와 OCR/vision 필요 경계
- XLSX sheet·row·cell·수식·cached result 관측
- HWP3·HWP5·HWPX·BIFF8 XLS·DOCX 읽기
- 이미지·PDF·DOCX·HTML·SVG의 visual candidate·render 관측

### Source·Reconciliation

- `file_reality bind_sources`
- source manifest와 source revision 재검사
- source usage·unresolved fact 결속
- CSV/TSV field mapping·ordered output columns·전체 행 reconciliation
- duplicate·unmatched·ambiguous·conflicting cardinality·coverage 계약
- Artifact 등록 전 source와 output 재대조
- G same-language program·immutable source universe·독립 검증

### 결과·연속성

- DOCX·XLSX·PDF·CSV·HTML·SVG·ZIP 생성
- render·reopen·QualityReceipt·Artifact version·Preview·download
- 다중 파일 publication·Delivery·Undo·rollback
- Work·교정·취소·restart·결과 재개방

근거 시작점:

- `T5-SIXTH-COMPLETION.md` 2절·S6-P0·S6-H·S6-WA
- `T5-FOURTH-COMPLETION.md` S4-H Reconciliation
- `refoundation/src/file-reality-tool.js`
- `refoundation/src/file-source-manifest-store.js`
- `refoundation/src/document-data-inspector.js`
- `refoundation/src/attachment-hand.js`
- `refoundation/src/artifact-quality-qualification.js`

## 4. 현재 미확인과 연구 질문

기능 존재와 실제 사용자 목적 자격을 합치지 않는다. 다음은 현재 T5가 없다고 확정한 사실이 아니라, 복합 실무
문서의 서로 다른 세 목적에서 아직 반복 자격됐는지 확인해야 할 연구 질문이다.

### A. 복합 문서 인식 품질

- 저해상도·기울어진·손상된 스캔
- 한글 필기와 인쇄 혼합
- 체크박스·도장·서명·강조 상태
- 병합 셀·다단 표·페이지를 넘는 표
- 이미지와 본문이 함께 의미를 만드는 문서
- 한 PDF 안의 여러 하위 문서
- 양식이 크게 다른 문서의 같은 의미 필드

### B. 현재 Work의 문서 집합과 역할

- 모델이 목적에 맞는 source 전체를 선택했는가
- exact revision을 선택했는가
- 계약서·인보이스·입고표 같은 역할 후보와 근거가 보존되는가
- 미분류·읽지 못한 문서와 필수 자료 누락이 사라지지 않는가

### C. 최종 주장과 원문 근거

- 일반 사용자가 중요한 결론에서 exact page/sheet/row/cell을 열 수 있는가
- 관측값·정규화값·계산값을 구분하는가
- source 위치가 없는 주장을 Citation처럼 꾸미지 않는가
- 부분 coverage를 전체 확인으로 표현하지 않는가

### D. 복합 문서 reconciliation

- 현재 `bind_sources`·G·Artifact 경로가 PDF·XLSX·이미지 혼합 source에서도 사용자 목적 전체를 자격하는가
- identity join·revision·누락·충돌·계산 lineage가 최종 사용자 결과까지 이어지는가
- output 파일의 전체 행 검증과 자연어 결론의 source truth가 함께 성립하는가

### E. 전문 기준과 책임 경계

- 문서에서 관측한 사실과 법률·의료·금융·산업 규정 판단을 분리하는가
- 공식 기준의 source·관할·적용 시점·회사 정책이 없으면 적격·승인을 단정하지 않는가
- 전문가 확인이 필요한 항목을 단순 parser confidence와 혼동하지 않는가

## 5. 후속 연구·개발 Gate 제안

### DR-0 — 현재 능력 지도와 actual 실패 기준선

제품 변경 0으로 세 사용자 목적을 실제 Console에서 실행한다.

1. 구매·정산: 발주서·입고전표·세금계산서·거래명세서 대조
2. 계약: 기존·신규 revision의 금액·기간·해지·책임 차이
3. 비용 증빙: 카드내역·영수증·세금계산서의 누락·불일치

입력 변형:

- 정상 디지털 PDF
- 저해상도 스캔·회전 문서
- 병합 셀·다단 표·페이지를 넘는 표
- 체크박스·서명·도장
- PDF·XLSX·이미지 혼합 packet
- 동일 문서의 여러 revision
- 필수 문서 누락·관련 없는 문서 혼입

측정:

- 실제로 관측한 page·sheet·row·cell과 coverage
- 필드 precision·recall과 잘못 읽은 값
- source location 정확성
- 문서 역할·identity join·revision 정확성
- 누락·충돌·불확실성 보존
- 숫자·날짜·세액 계산 정확성
- false completion·근거 없는 승인 0
- first useful result·wall·model/tool calls·tokens
- 최종 결과 사용성·다시 맡길 의향

원인 귀속:

```text
perception       문서 자체를 정확히 읽지 못함
selection        필요한 source·revision을 고르지 못함
relation         같은 사건·사람·품목 관계를 잘못 결속
reconciliation   값·누락·충돌·계산을 잘못 대조
evidence_ux      맞는 결론의 원문 근거를 사용자가 확인하지 못함
method_cost      위 품질은 맞지만 단계별 model/tool 왕복이 주 병목
```

`method_cost`만 재현된 경우 DR에 실행 engine을 추가하지 않고 Method Runtime `MR-0`으로 분리한다. 반대로 perception·
selection·relation 실패를 Method Runtime으로 우회하지 않는다.

완료 문장:

> 현재 T5가 이미 해결하는 범위와 세 목적에서 공통으로 재현되는 문서 인식·관계·근거 미달이 제품 변경 없이
> 분리됐고, 첫 후보는 그중 하나만 줄이도록 열린다.

### DR-1 — Document Perception Qualification

동일 문서 표본에서 현재 구조 parser·PDF text·local OCR·visual candidate·model observation·Terminal 도구를
비교한다. 새 OCR engine이나 외부 provider를 먼저 만들지 않는다.

문서 가족별로 가장 검증된 현재 경로를 보존하고, 실제 반복 실패 가족에서만 다음 후보를 연다.

- 다른 로컬 parser
- bounded local OCR·vision
- 검증된 외부 Document AI
- 사람 확인

합격:

- 읽은 범위·놓친 범위·관측 방법이 exact하다.
- 인식 개선이 사용자 목적 정확성과 first useful result를 높인다.
- 정상 디지털 문서의 가벼운 경로를 느리게 만들지 않는다.
- privacy·provider bytes·비용·retention이 현재 권한 경계 안에 있다.

### DR-2 — Work Document Set Projection

문서 선택·revision·역할·누락 혼동이 실제로 재현될 때만 연다. 새 Store는 만들지 않는다.

기존 Work·source handle·Document observation에서 다음 현재 보기를 파생한다.

```yaml
WorkDocumentSet:
  purpose:
  selectedSources:
  observedRevisions:
  observedCoverage:
  candidateRoles:
  relationEvidence:
  unreadOrUnclassified:
  missingEvidence:
```

모델은 문서의 의미·역할·관계를 판단한다. Runtime은 source identity·revision·coverage·handle만 보증한다.
projection은 현재 목적에 필요한 만큼만 공급하며 Memory·기업 지식·새 canonical store로 자동 승격하지 않는다.

### DR-3 — Claim-to-Source Evidence Projection

최종 답의 중요한 주장을 일반 사용자가 exact 원문에서 확인하지 못하는 실패가 재현될 때만 연다.

```yaml
ClaimEvidence:
  claim:
  sourceHandle:
  location:
  observedValue:
  normalizedValue:
  calculation:
  method:
  coverage:
  uncertainty:
```

경계:

- 위치를 찾지 못한 주장은 source citation으로 표시하지 않는다.
- Citation은 출처 증명이며 계산·전문 해석의 독립 증명이 아니다.
- 모델 최종 문장을 별도 Fact로 복제하지 않는다.
- 대화 종료를 이유로 영구 Memory·기업 지식으로 승격하지 않는다.

### DR-4 — Cross-Document Reconciliation Qualification

새 범용 대사 엔진을 만들지 않는다. 현재 `bind_sources`·source manifest·G Program·Artifact quality 경로를
세 실제 목적에서 먼저 자격한다.

공통 대조 단위:

```text
source identity·revision
same-event·same-party·same-item relation
value·date·quantity match
required evidence presence
deterministic calculation
duplicate·unmatched·ambiguous·conflicting cardinality
coverage·unknown
```

같은 결함이 세 목적에서 재현될 때만 기존 reconciliation 계약의 작은 연결부를 보강한다. CSV/TSV 전체 행
검증 성공을 PDF·XLSX·이미지 혼합 packet 전체 성공으로 승격하지 않는다.

### DR-5 — Honest Decision Boundary

Core 결과:

- 서로 맞음
- 다른 부분이 있음
- 필요한 자료가 빠짐
- 정확히 읽히지 않음
- 계산 검산 결과
- 해석·전문가 확인 필요

사용자·조직별 지식:

- 회사 양식·필수 필드·승인 한도·결과 형식
- 거래처별 처리 방식·현재 사용자 교정

전문 Capability:

- 법령·관할·적용 시점
- 금융·보험·의료·FTA·KYC·안전 기준
- 공식 외부 데이터와 조직 정책

공식 기준과 실제 권한이 없으면 `법적 적격`, `지급 승인`, `의학적으로 안전`을 말하지 않고, `현재 자료에서
확인된 사실`과 `담당자·전문가가 확인할 항목`을 분리한다.

### DR-6 — Evidence UX

새 문서 Dashboard를 만들지 않고 현재 Conversation·Result·Artifact surface에서 다음 순서를 실제 Console로
검증한다.

1. 지금 결론
2. 중요한 차이·누락
3. 근거가 있는 표
4. 미확인과 이유
5. 원문 위치
6. 바로 가능한 다음 행동
7. 필요한 결과 파일·version·Undo

사용자 성과:

- 결론의 이유를 몇 초 안에 찾는다.
- 잘못 읽힌 값을 원문에서 확인하고 교정한다.
- 교정 뒤 무엇이 다시 계산됐는지 이해한다.
- 이전 결과와 새 결과를 구분한다.
- 확인 목록·문의 초안·XLSX/PDF 결과를 바로 사용한다.
- 원본·결과·Undo를 잃지 않는다.

### DR-HQ — 실제 사용자 자격

첫 자격은 저위험·중위험 실무 다섯 목적에 한정한다.

- 견적서 비교
- 계약서 revision 비교
- 매출·입금·정산 차이
- 발주·입고·청구 대조
- 영수증·증빙 누락

의료·법률·금융·KYC·FTA는 기반이 같더라도 공식 기준·시점·전문가 경계가 선 뒤 별도 자격한다. 전세 위험
진단은 첫 제품 시나리오가 아니라 근거가 부족할 때 T5가 법률·시세·권리 위험을 단정하지 않는지 확인하는
고위험 sentinel 후보로 둔다.

합격식:

```text
서로 다른 세 목적에서 전용 업무 규칙 없이 같은 원리 성립
AND 읽은 범위·source·revision·coverage 정직
AND 누락·불일치·불확실성 탐지
AND 계산·source location 정확
AND false approval·false completion 0
AND 일반 사용자가 결과를 이해·검증·교정·사용
AND current T5보다 이유 없는 wall·calls·tokens 악화 없음
AND 결과물·version·Undo·Delivery 무회귀
```

## 6. 개발 판정 순서

```text
6차 UX·WA delta·물리 자격·최종 HQ 완료
→ 오너가 별도 후속 Gate를 열지 결정
→ DR-0 actual baseline, product delta 0
→ 같은 결함 가족이 세 목적에서 재현됐는지 확인
→ 현재 source·prompt·context·wire·receipt 확인
→ 가장 작은 DR-1~6 후보 하나
→ deterministic countertest
→ 현재 T5 vs candidate 동일 목적 actual A/B
→ 채택·완전 폐기·제품 변경 0
→ focused regression·작은 evidence JSON·clean commit
```

Method Runtime과의 결속은 다음 한 방향만 허용한다.

```text
DR-0이 정확한 문서 목적 baseline과 반복 model/tool 병목 Evidence를 제공
→ MR-0이 같은 fixture에서 현재 자연 경로와 read-only Method 후보를 A/B
→ Method 후보가 실패해도 DR의 문서 현실·근거 연구는 독립 유지
```

중단:

- 현재 T5가 실제 목적을 이미 정확히 끝내면 제품 변경 0으로 닫는다.
- 같은 결함 가족의 두 후보가 사용자 성과를 높이지 못하면 세 번째 patch를 붙이지 않는다.
- 업종별 Prompt·Runtime Router가 필요하면 구조를 재판정한다.
- 문서 인식 개선이 정상 문서 경로의 속도·비용·정확성을 악화시키면 폐기한다.
- 근거 UX를 위해 새 Fact DB·원문 복제·Context 전량 주입이 필요하면 폐기한다.

## 7. 명확한 비목표

- 현재 `S6-UX` 범위 확대
- 58개·78개 Agent 복제
- 새 Document 플랫폼 Core
- 새 DocumentPacket·Fact·Reconciliation 영구 DB
- 새 Capability lifecycle·Learning 시스템
- KDW 전용 Work·Intent·Router
- 업종별 Pack·workflow·service mapping
- 문서명·확장자·업무명 정규식 route
- 새 관리자 schema·workflow UI
- Upstage 또는 다른 공급자 대비 우월성 주장
- 공개 마케팅 결과를 성능 oracle로 사용
- 규정 source가 없는 승인·적격·법률·의료 판정
- 한 목적 성공을 전체 한국 문서 지원으로 승격
- 문서 원문을 Memory·History에 자동 저장

## 8. 미래 세션의 시작 일곱 줄

오너가 이 연구를 다시 열면 구현부터 시작하지 않는다.

1. **제품 약속**: 사용자는 문서 기능을 고르지 않고 평소 말로 실제 목적을 맡긴다.
2. **현재 Gate**: 당시 오너가 별도로 연 문서 현실·대사 강화 Gate와 정확한 완료 범위.
3. **사용자 완료 문장**: T5는 복합 문서를 빠짐없이 읽고 관계·차이·누락·미확인을 원문 근거와 함께 보여주며 실제 다음 일로 이어간다.
4. **이미 선 증거**: 당시 File Reality·OCR·Document·`bind_sources`·source manifest·G Program·Artifact·Undo·Work actual.
5. **가장 큰 미달**: 서로 다른 세 사용자 목적에서 재현된 exact failure 하나.
6. **첫 변경 방식**: 기존 상태 전이로 해결 가능한지 확인하고, 부족한 연결부 하나만 후보화한다.
7. **Non-goals**: 새 Store·Router·업종 workflow·공급자 종속·전문 최종 판단·현재 Gate 밖 기능.

그 뒤 반드시 `DR-0`부터 현재 제품에서 다시 시작한다. 이 문서의 존재와 과거 조사 결과를 제품 개발 승인·
현재 실패·성능 우위로 해석하지 않는다.
