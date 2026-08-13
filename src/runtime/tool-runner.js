// L3 · ToolRunner — 도구 실행 런타임. 실행 가능 게이트를 통과한 것만 실제 호출한다.
// 결과는 항상 ToolReceipt 로 기록한다(못 쓴 도구를 쓴 척 금지). 진단면은 diagnosticTrace 로 분리.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { receipt, blockedReceipt } from '../kernel/l0-evidence/tool-receipt.js';

/**
 * §5-3 c · **큰 결과는 파일로 흘린다** (Hermes tool_result_storage.py 축 흡수 — 구조만, 값은 우리 창에서).
 *
 * 기준: 결과 원문(JSON)이 창 예산의 결과자(`executionContext.결과자` · 모르면 옛 고정값 1,200자)의
 * **네 배**를 넘으면, 요약이 아무리 정직해도 알맹이 대부분이 모델 입력 밖이다. 그때 원문을
 * 상태 자리 아래 한 디렉터리(`results/`)에 그대로 남기고, 모델에는 요약+경로+전체 크기를 준다 —
 * 모델은 그 경로를 `local.file read` (offset·limit) 로 이어 읽는다(같은 상한·같은 문).
 * 네 배인 이유: 결과자 안이면 원문이 통째로 실리고(파일 불필요), 그 근처면 접기 표식이 문이 된다.
 * 그보다 크게 넘는 것만 파일이 문이다 — 작게 넘는 것까지 흘리면 파일 소음이다.
 */
export const 흘림배수 = 4;
const 상태자리 = () => process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
let 흘림일련 = 0;

/**
 * **흘림 파일의 수명 — 회전(C3 · 2026-08-12).**
 *
 * 예전엔 쓰기만 하고 지우는 자가 없었다. 한 턴에 몇 개씩 나오고 세션은 계속 도니, 그건
 * 수명이 아니라 무한 누적이다. 사용자 디스크에 우리가 남기는 것에 끝이 없으면 안 된다.
 *
 * 헤르메스는 같은 자리를 **자리 선택**으로 풀었다 — `tool_result_storage.py:41`
 * (`STORAGE_DIR = "/tmp/hermes-results"`) · `:48` (*"Return the best **temp-backed**
 * storage dir for this environment."*). temp 에 두고 OS 가 걷게 한다.
 * 우리는 그 길을 못 쓴다: 우리 흘림 파일은 모델이 `local.file read` 로 **이어 읽는 문**이라
 * 읽기 범위 안(상태 자리)에 살아야 한다. 그래서 같은 목적을 회전으로 이룬다.
 *
 * **기준이 나이가 아니라 개수인 이유**: 아직 이어 읽을 수 있는 것은 「최근 것」이지
 * 「몇 시간 안에 쓴 것」이 아니다. 시계로 자르면 오래 도는 한 턴의 문이 그 턴 안에서
 * 사라질 수 있다(「시간은 학습의 근거가 아니다」 — 시계는 lease·TTL 에만).
 *
 * **방금 쓴 것은 절대 안 걷는다**(정렬이 이름의 시각·일련번호를 그대로 따른다).
 */
export const 흘림보관수 = Number(process.env.GPAO_T5_RESULT_KEEP) > 0
  ? Number(process.env.GPAO_T5_RESULT_KEEP)
  : 50;

/** 오래된 것부터 걷는다. **옆길이다** — 실패해도 본선(결과·영수증)을 막지 않는다. */
async function 흘림회전(방) {
  try {
    const 목록 = (await readdir(방)).filter((f) => f.startsWith('결과-') && f.endsWith('.json'));
    if (목록.length <= 흘림보관수) return;
    // 이름이 `결과-<도구>-<epoch ms>-<일련>.json` 이라 **이름 순서가 곧 쓴 순서**다
    // (같은 밀리초에 둘이 나와도 일련이 가른다). 파일 시각(mtime)을 다시 묻지 않는 이유:
    // 묻는 만큼 syscall 이 늘고, 이름이 이미 우리가 적은 사실이다.
    const 순서 = 목록.map((f) => {
      const m = /-(\d+)-(\d+)\.json$/.exec(f);
      return { f, ms: m ? Number(m[1]) : 0, 순: m ? Number(m[2]) : 0 };
    }).sort((a, b) => (a.ms - b.ms) || (a.순 - b.순));
    for (const { f } of 순서.slice(0, 순서.length - 흘림보관수)) {
      await unlink(join(방, f)).catch(() => {}); // 남이 이미 지웠어도 그냥 넘어간다
    }
  } catch { /* 회전 실패가 흘림을 깨지 않는다 */ }
}

async function 큰결과흘리기(원문, toolId) {
  const 방 = join(상태자리(), 'results');
  await mkdir(방, { recursive: true });
  흘림일련 += 1;
  const path = join(방, `결과-${String(toolId).replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}-${흘림일련}.json`);
  await writeFile(path, 원문, 'utf8');
  await 흘림회전(방); // **쓴 뒤에** 돈다 — 방금 쓴 문은 보관수 안에 있으므로 살아남는다
  return path;
}

/**
 * **다음 턴에 이어야 할 대상은 도구가 낸다.** `previewOf(args)` 와 같은 모양의 계약이다.
 *
 * 예전엔 커널(working-state.js)이 `if (tool === 'web.collect') … if (tool === 'local.file') …`
 * 로 도구 이름을 알아봤다. 이미 세 번 새어 본 패턴이다 — 새 도구가 생기면 커널을 고쳐야 하고,
 * 안 고치면 그 도구만 조용히 다음 턴으로 안 이어진다(실제로 `local.locate` 가 그랬다).
 * P5 에서 채널·외부 API·MCP·CLI 가 붙으면 같은 누수가 그만큼 커진다.
 *
 * 그래서 **영수증에 실어 보낸다.** 영수증이 진실이고, 자기 결과를 아는 건 도구뿐이다.
 * 커널은 이제 도구 이름을 모른다 — `receipt.subject` 를 그대로 얹기만 한다.
 * 계약을 안 낸 도구는 이어지지 않을 뿐 아무것도 깨지 않는다(조용한 실패가 아니라 조용한 미참여).
 */
function withSubject(rec, tool) {
  let s;
  try { s = tool.subjectOf?.(rec); } catch { return rec; }
  // 최소 계약만 확인한다 — 무엇으로 이어갈지(key), 어떤 종류인지(kind), 사람이 부를 이름(label).
  if (!s || !s.key || !s.kind || !s.label) return rec;
  return { ...rec, subject: s };
}

/** 도구가 실제 결과에서 파생한 같은 턴 읽기 범위를 영수증에 붙인다. */
async function withReadScope(rec, tool, executionContext) {
  let roots;
  try { roots = await tool.readScopeOf?.(rec, executionContext); } catch { return rec; }
  if (!Array.isArray(roots)) return rec;
  const clean = [...new Set(roots.filter((root) => typeof root === 'string' && root.trim()))];
  return clean.length ? { ...rec, readScopeRoots: clean } : rec;
}
import { isToolExecutable } from '../kernel/l0-evidence/self-state.js';
import { assertWebEvidence, SOURCE_CONTRACT_FAILED } from '../kernel/l2-plan/web-tool.js';
import { FAILURE } from '../kernel/contracts.js';

export class ToolRunner {
  /**
   * @param {Record<string, {handler: (args:*) => Promise<*>}>} tools
   */
  constructor(tools = {}) {
    this.tools = tools;
  }

  /**
   * @param {string} toolId
   * @param {*} args
   * @param {import('../kernel/contracts.js').SelfStateSnapshot} selfState
   * @returns {Promise<import('../kernel/contracts.js').ToolReceipt>}
   */
  async run(toolId, args, selfState, executionContext = {}) {
    const intended = `${toolId} 실행`;
    // **호출 신분은 실행 문맥으로 흘러 영수증에 박힌다** (오너 지시 2026-08-04).
    // `providerCallId` 는 공급자가 발급한 것 — 없으면 칸을 만들지 않는다(Gemini 규약엔 없다).
    // `callRef` 는 T5 내부 상관용 — 둘을 한 칸에 섞지 않는다.
    // 여기 한 자리에 두면 계획 경로·걸음 경로·승인 재개가 전부 같은 길을 탄다.
    const 신분 = {
      ...(executionContext?.providerCallId ? { providerCallId: executionContext.providerCallId } : {}),
      ...(executionContext?.callRef ? { callRef: executionContext.callRef } : {}),
    };
    const 부른것 = { tool: toolId, args, ...신분 };

    // 1) SelfState 실행 가능 게이트: 목록에 있어도 executable=false 면 호출하지 않는다.
    if (!isToolExecutable(selfState, toolId)) {
      return blockedReceipt(
        intended,
        toolId,
        `${toolId} 은 아직 실행 준비가 안 됐어요.`,
        `${toolId} 연결/권한을 준비하면 이어서 할 수 있어요.`,
        // **여기는 정말로 손이 안 선 자리다.** 사다리가 "도구가 준비되지 않았다"고
        // 말하는 것이 사실이므로 그 근거를 직접 남긴다(기본값에 기대지 않는다).
        { tool: toolId, reason: 'not_executable' },
      );
    }

    const tool = this.tools[toolId];
    if (!tool || typeof tool.handler !== 'function') {
      return blockedReceipt(intended, toolId, `${toolId} 을 지금 사용할 수 없어요.`,
        undefined, { tool: toolId, reason: 'not_executable' });   // handler 가 없다 — 진짜로 없는 손이다
    }

    // 2) 실제 호출. 실패는 failureState 로 정직하게, 원인은 진단면으로 분리.
    try {
      // **실행기 자신과 현재 자기 상태를 문맥에 실어 보낸다.** 캡슐(S4)은 안에서 다시 손을
      // 불러야 하는데, 그 호출이 **이 실행 경로를 그대로 타야** 승인·영수증·되돌리기가
      // 두 벌이 되지 않는다. 다른 손들은 이 두 칸을 안 본다.
      const out = await tool.handler(args, { ...executionContext, tools: this, selfState });
      // 출처 원장 필수 도구(웹 등)는 계약을 런타임이 강제한다 — handler 관례에 맡기지 않는다(감사 보정 1).
      // 출처 없는 성공·내용 담은 실패는 계약 위반이므로 failed로 떨어뜨린다("못 본 걸 본 척" 차단).
      if (tool.sourceLedgerRequired) {
        try {
          assertWebEvidence(out);
        } catch (e) {
          return receipt({
            intended,
            actualCall: 부른것,
            failureState: FAILURE.FAILED,
            userSafeSummary: SOURCE_CONTRACT_FAILED,
            diagnosticTrace: { reason: e?.message },
            nextSafeAction: '출처가 있는 방법으로 다시 시도할까요?',
          });
        }
      }
      // **화면 증거는 옆길로 간다**(CU F-2). 영수증에 실으면 `ledgerEntries` 로 세션 파일에
      // 저장되고, 그건 오너 화면이 디스크에 남는다는 뜻이다 — 계획 §6 의 수명 계약이 깨진다.
      // 그래서 손이 낸 그림은 **여기서 받아 넘기고 영수증에는 안 싣는다.**
      if (out?.그림) { try { executionContext?.그림받기?.(out.그림); } catch { /* 옆길은 본선을 막지 않는다 */ } }
      if (out && out.blocked) {
        return receipt({
          intended,
          actualCall: 부른것,
          failureState: FAILURE.BLOCKED,
          // 어떤 종류로 막혔는지(사이트 차단·로그인벽·범위 밖…)를 잃지 않는다 — 다음 계단을 그걸로 정한다.
          fetchState: out.fetchState,
          scopeState: out.scopeState,
          surfaceRequest: out.surfaceRequest,
          // **막혔어도 손이 쥔 다음 수는 떨어뜨리지 않는다.** 내용(`result`)은 여전히 안 싣는다 —
          // 못 본 것은 못 본 것이다. 그러나 안 가 본 후보는 검색기가 실제로 준 사실이다.
          다음수단: out.다음수단,
          다른후보: out.다른후보,
          막힌곳: out.막힌곳,
          userSafeSummary: out.userSafeSummary ?? `${toolId} 대상이 접근을 막았어요.`,
          diagnosticTrace: out.diagnosticTrace,
          // **손이 다음 수를 쥐고 있으면 그 길을 가리킨다.** 기본 문구는 웹에서 온 것이라
          // (*"공개 자료/대체 경로로 이어갈까요?"*) 화면 손에 붙으면 엉뚱하다 —
          // 라이브(2026-08-05)에서 모델이 토큰 실린 다음수단 둘을 받고도 그 문구를 읽고
          // *"desktop.act 가 막혀 있어서"* 라며 사용자에게 떠넘겼다.
          // **가진 길을 두고 없는 것처럼 말하게 만든 것은 기본값이지 모델이 아니다.**
          nextSafeAction: out.nextSafeAction
            ?? (out.다음수단?.length ? '막힌 자리에 다음 수가 있어요 — 그 중 하나를 골라 이어가세요.'
              : '공개 자료/대체 경로로 이어갈까요?'),
        });
      }
      // transient 실패(재시도 여지) — handler가 정직한 사용자면 메시지와 함께 알린다. blocked(permanent)와 분리.
      if (out && out.failed) {
        const 다음수단 = Array.isArray(out.다음수단) ? out.다음수단 : undefined;
        const 미확인 = out.진행?.판정 === 'unknown';
        return withSubject(receipt({
          intended,
          actualCall: 부른것,
          // 실패해도 실행 결과는 사라지지 않는다. stdout/stderr/exit/effect는 성공 주장이
          // 아니라 다음 판단에 필요한 관측 사실이다. 영수증에는 원형을, 모델 입력에는
          // 저장되지 않는 diagnosticTrace 경로로 같은 실패 원문을 보낸다.
          result: out.failureResult,
          failureState: FAILURE.FAILED,
          lifecycle: out.lifecycle,
          userSafeSummary: out.userSafeSummary ?? `${toolId} 실행에 실패했어요.`,
          diagnosticTrace: out.diagnosticTrace ?? out.failureResult,
          // 제출 뒤 효과를 모르는 행동에 generic retry를 붙이면 중복 효과를 낼 수 있다.
          // 손이 낸 구조화된 다음 수가 있으면 그것을 모델이 고르게 하고, 없더라도
          // unknown을 "같은 호출 재시도"로 바꾸어 말하지 않는다.
          nextSafeAction: out.nextSafeAction
            ?? (다음수단?.length ? '실제 상태를 확인할 다음 수가 있어요 — 그 중 하나를 골라 이어가세요.'
              : (미확인 ? undefined : '잠시 후 다시 시도할까요?')),
          진행: out.진행,
          다음수단,
        }), tool);
      }
      const rec = withSubject(receipt({
        intended,
        actualCall: 부른것,
        result: out?.result ?? out,
        failureState: FAILURE.NONE,
        // 성공했어도 **무엇을 얻었는지**는 손이 밝힌다(예: 찾는 손은 후보 목록이지 내용이 아니다).
        읽은상태: out?.읽은상태,
        // 출처 근거를 원장에 함께 남긴다(P6-2). 웹 도구는 sources 없이 성공을 반환하지 못한다.
        sources: out?.sources,
        connectionDiscovery: out?.connectionDiscovery,
        userSafeSummary: out?.userSafeSummary ?? `${toolId} 실행 완료.`,
      }), tool);
      const 확정 = await withReadScope(rec, tool, executionContext);
      // §5-3 c — 기준을 크게 넘는 원문은 파일로 흘리고 영수증에 그 문(경로·전체 크기)만 싣는다.
      // 흘리기 실패는 본선을 막지 않는다 — 요약은 그대로 간다(옆길은 본선을 막지 않는다).
      try {
        const 결과자 = Number(executionContext?.결과자) > 0 ? Number(executionContext.결과자) : 1200;
        const 원문 = JSON.stringify(확정.result ?? null);
        if (원문.length > 결과자 * 흘림배수) {
          return { ...확정, 흘린원문: { path: await 큰결과흘리기(원문, toolId), totalChars: 원문.length } };
        }
      } catch { /* 흘림은 부가 공급이다 — 실패해도 결과·영수증은 그대로다 */ }
      return 확정;
    } catch (err) {
      return receipt({
        intended,
        actualCall: 부른것,
        failureState: FAILURE.FAILED,
        userSafeSummary: `${toolId} 실행 중 문제가 있었어요.`, // 내부 오류 비노출
        diagnosticTrace: { message: err?.message, stack: err?.stack },
        nextSafeAction: '잠시 후 다시 시도할까요?',
      });
    }
  }
}
