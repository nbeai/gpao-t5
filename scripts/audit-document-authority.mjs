import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DOCUMENT_RULES = [
  {
    file: 'AGENTS.md',
    require: ['GPAO-T5-DOCUMENT-AUTHORITY-MAP-2026-07-30-ko.md', 'Minimum safety floor, maximum autonomy'],
    forbid: ['recommended solution, minimum sufficient verification'],
  },
  {
    file: 'README.md',
    require: ['## Product Invariant', 'npm run audit:docs'],
    forbid: ['## Current First Build Slice', '## Non-Scope For Current Body Development'],
  },
  {
    file: 'GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md',
    require: ['### 0-A-2. 오너 의도 비변형', '제품 회귀다'],
    forbid: [],
  },
  {
    file: 'docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md',
    require: ['진정한 거버넌스는 사용자에게 통제를 계속 요구하는 것이 아니다', 'undo·rollback·archive·restore'],
    forbid: [],
  },
  {
    file: 'GPAO-T5-APPROVAL-LIFECYCLE-CONTRACT-2026-07-25-ko.md',
    require: ['current_approval_lifecycle_contract_needs_effect_granularity_alignment', '명시적 사용자 요청은 그 범위의 확인이다'],
    forbid: ['Status: `초안 작성 완료 · 감사 전'],
  },
  {
    file: 'GPAO-T5-PRODUCT-CONSTITUTION-2026-07-24-ko.md',
    require: ['historical_product_constitution_foundation', '최신 절대 원칙 §0-A-1·§0-A-2'],
    forbid: [],
  },
  {
    file: 'GPAO-T5-KERNEL-CONTRACT-2026-07-24-ko.md',
    require: ['living_kernel_contract_historical_change_log', '저위험 가역 작업은 자동 + 원장·undo가 기본이다'],
    forbid: [],
  },
  {
    file: 'GPAO-T5-UX-ARCHITECTURE-2026-07-24-ko.md',
    require: ['historical_ux_architecture_foundation', '내부 후보·원리·검사 상태는 기본 대화를 점유하지 않고'],
    forbid: [],
  },
  {
    file: 'GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md',
    require: [
      '절대 원칙 §0-A-1·§0-A-2',
      '질문·카드·클릭·턴·전경 대기가 늘면',
      '이 검사는 현재 코드의 회귀 방지 자산이지 최신 제품 철학의 영구 정답이 아니다',
    ],
    forbid: [],
  },
  {
    file: 'GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md',
    require: ['현재화: 2026-07-30', '## 6. 현재 게이트 운영', '`npm run gate` 전체 실행'],
    forbid: ['## 6. Phase 5 이후 붙일 게이트', 'Phase 5에서 첫 코드가 생길 때'],
  },
  {
    file: 'GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md',
    require: ['최소 안전 바닥 밖만 막고 나머지는 최대한 자동으로 끝낸다', '구현 해법을 선점하지 않는다'],
    forbid: [],
  },
  {
    file: 'GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md',
    require: ['감사 통과를 위해 승인·카드·확인·검사를 늘려', '다음 검사는 만들지 않는다'],
    forbid: ['권장 해결 방향과 최소 충분 검증을 함께 제시한다'],
  },
  {
    file: 'GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md',
    require: ['completed_p_op_work_order_historical'],
    forbid: ['지금의 단 하나의 최우선 코어 작업이다', '권장 해결 방향과 최소 충분 검증을 포함'],
  },
  {
    file: 'GPAO-T5-DEVELOPMENT-PLAN-v3.1-SUPPLEMENT-2026-07-26-ko.md',
    require: ['historical_completion_supplement'],
    forbid: ['초안(오너 확정 대기)'],
  },
  {
    file: 'design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md',
    require: ['current_automation_core_implementation_plan', 'P-OP-7은 완료됐다'],
    forbid: ['현재 진행 중인 P-OP-7', '현재 P-OP-7 차단 결함 수정'],
  },
  {
    file: 'design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md',
    require: ['P-OP A~H와 P-OP-7은 완료됐다', '최소 안전을 보장하는 상태에서 최대 허용한다'],
    forbid: ['현재 최우선 P-OP A~H를 계속 닫는다'],
  },
  {
    file: 'docs/03-verification/T5-OPERATOR-HARNESS-EXECUTION-BOARD-2026-07-28-ko.md',
    require: ['completed_p_op_history_and_regression_scenarios', '**완료.** A~H'],
    forbid: ['**진행 중 · 완료 아님.**'],
  },
];

export function auditDocumentTexts(texts) {
  const findings = [];
  for (const rule of DOCUMENT_RULES) {
    const text = texts.get(rule.file);
    if (typeof text !== 'string') {
      findings.push({ file: rule.file, kind: 'missing_file', text: '' });
      continue;
    }
    for (const required of rule.require) {
      if (!text.includes(required)) findings.push({ file: rule.file, kind: 'missing_required', text: required });
    }
    for (const forbidden of rule.forbid) {
      if (text.includes(forbidden)) findings.push({ file: rule.file, kind: 'stale_forbidden', text: forbidden });
    }
  }
  return findings;
}

export async function auditRepositoryDocuments(root = ROOT) {
  const texts = new Map();
  await Promise.all(DOCUMENT_RULES.map(async ({ file }) => {
    try {
      texts.set(file, await readFile(path.join(root, file), 'utf8'));
    } catch {
      texts.set(file, null);
    }
  }));
  return auditDocumentTexts(texts);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await auditRepositoryDocuments();
  if (findings.length === 0) {
    console.log(`PASS  document authority · ${DOCUMENT_RULES.length} documents`);
  } else {
    for (const finding of findings) {
      console.error(`GAP   ${finding.file} · ${finding.kind} · ${finding.text}`);
    }
    process.exitCode = 1;
  }
}
