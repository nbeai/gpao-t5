// 검사용 헬퍼 — **영수증에 subject 를 붙이는 일은 도구가 한다**(계약: subjectOf).
//
// 커널(working-state)은 더 이상 도구 이름을 모른다. 그래서 손으로 만든 영수증에도
// **진짜 도구의 subjectOf 를 태워서** subject 를 붙인다 — 가짜 subject 를 손으로 적으면
// 계약이 깨져도 검사가 초록이라, 검사가 계약을 안 지키는 셈이 된다.
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalProcessTool } from '../src/runtime/local-process.js';
import { makeSessionSearchTool } from '../src/runtime/session-search-tool.js';
import { makeWebCollector } from '../src/runtime/web-collector.js';

const 손 = {
  'local.terminal': makeLocalTerminalTool(),
  'local.locate': makeLocalLocateTool(),
  'local.file': makeLocalFileTool({ roots: ['/검사용'], dataDir: '/검사용' }),
  'local.process': makeLocalProcessTool({ store: { async all() { return []; }, async save() {} }, dataDir: '/검사용' }),
  'session.search': makeSessionSearchTool({ store: { async list() { return []; } } }),
  'web.collect': makeWebCollector({}),
};

/** 영수증 하나에 그 도구의 계약을 태운다(ToolRunner 가 라이브에서 하는 일과 같다). */
export function 계약태우기(rec) {
  const s = 손[rec?.actualCall?.tool]?.subjectOf?.(rec);
  return s?.key && s?.kind && s?.label ? { ...rec, subject: s } : rec;
}

/** 여러 영수증에 한 번에. */
export const 계약태운턴 = (turn) => (turn?.receipts
  ? { ...turn, receipts: turn.receipts.map(계약태우기) }
  : turn);

/** 가짜 도구가 진짜 계약을 그대로 쓰게 한다 — 계약을 손으로 베끼면 드리프트가 난다. */
export const 계약of = (toolId) => 손[toolId]?.subjectOf;
