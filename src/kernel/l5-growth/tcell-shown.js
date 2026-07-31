// L5 · 보임(shown) 기록 (S5-1 · 계획 §4.5) — **모델 앞에 실제로 놓인 것만 사실로 남긴다.**
//
// §4.5 는 세 가지를 엄격히 가른다:
//   · `shownMemoryRefs` — **사실**. `[반영된 기억]`·`[이어받을 수 있는 작업]` 에 실제 렌더된 것.
//   · `modelCitedRefs`  — **모델 주장**. 통제 채널로 받은 인용(다음 슬라이스).
//   · `correctionCorrelation` — **통계**. 정정 턴과의 상관(그 다음).
//
// 이 파일은 첫째 칸 하나만 한다. 그런데 이 칸이 틀리면 위에 쌓을 두 칸이 전부 거짓이 되므로,
// 기록은 **렌더된 그 배열**에서만 뽑는다 — 렌더 뒤에 다시 계산하지 않는다. 다시 계산하면
// "무엇을 보여줬나"가 아니라 "무엇을 보여줬을 것 같나"가 되고, 둘은 언젠가 갈린다.
//
// 노출 경계: 여기 남는 것은 내부 신분뿐이고, 사용자 답변에도 모델 입력에도 나가지 않는다.
// 모델이 보는 것은 사람이 아는 문장이고, 신분은 OS 만 안다.

/** 무한 성장 금지. 상관 판정은 최근 턴만 보면 되므로 길게 들 이유가 없다. */
export const SHOWN_CAP = 200;

/**
 * 이 턴에 렌더된 항목들의 신분. **`렌더된` 배열에 실제로 들어 있는 것만** 남는다.
 *
 * @param {{turnRef:{sessionId:string,turnSeq:number}, 렌더된:string[],
 *          후보들:Array<{ref:string, kind:string, statement:string}>, at?:number}} p
 */
export function shownFromRendered({ turnRef, 렌더된 = [], 후보들 = [], at = 0 }) {
  const 놓인것 = new Set(렌더된);
  const refs = 후보들
    .filter((e) => e?.ref && 놓인것.has(e.statement))
    .map((e) => ({ ref: e.ref, kind: e.kind }));
  return { turnRef, refs, at };
}

/**
 * 기록을 남긴다. **빈 기록은 남기지 않는다** — 아무 것도 안 보여준 턴은 셀 것이 없다.
 * 같은 턴이 다시 오면(재처리) 덮어쓴다. 그래야 재처리가 통계를 부풀리지 않는다.
 */
export function recordShown(memory, record) {
  if (!record?.turnRef || !record.refs?.length) return memory.shownRefs ?? [];
  const 같은턴 = (x) => x.turnRef?.sessionId === record.turnRef.sessionId
    && x.turnRef?.turnSeq === record.turnRef.turnSeq;
  const 남길것 = (memory.shownRefs ?? []).filter((x) => !같은턴(x));
  return [...남길것, record].slice(-SHOWN_CAP);
}
