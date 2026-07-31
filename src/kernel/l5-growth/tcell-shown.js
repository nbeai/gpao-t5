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

/**
 * 모델이 **썼다고 주장한** 것들의 신분(S5-2 §4.5).
 *
 * 모델에게는 내부 신분을 주지 않는다 — 모델은 자기가 본 **문장**으로 지목하고, 여기서 그
 * 턴에 실제로 렌더된 것과 대조해 신분으로 바꾼다. 그래서 "인용은 보인 것의 부분집합"이
 * 검사로 지켜지는 게 아니라 **구조로** 지켜진다: 대조에 실패한 인용은 애초에 신분을 못 얻는다.
 *
 * 이름을 조심한다. 여기 남는 것은 **주장**이지 사용 사실이 아니다 — 모델 내부에서 무엇이
 * 실제로 쓰였는지는 관측 불가다(불변식 9). 그래서 `applied`·`verified` 같은 말을 쓰지 않는다.
 *
 * @param {{렌더된:string[], 후보들:Array<{ref:string,kind:string,statement:string}>, used?:string[]}} p
 * @returns {{refs:Array<{ref:string,kind:string}>, rejected:string[]}}
 */
export function citedFromShown({ 렌더된 = [], 후보들 = [], used = [] }) {
  const 보인것 = shownFromRendered({ turnRef: null, 렌더된, 후보들 });
  const 문장에서신분 = new Map();
  for (const e of 후보들) {
    if (e?.ref && 보인것.refs.some((r) => r.ref === e.ref)) 문장에서신분.set(e.statement, e);
  }
  const refs = [];
  const rejected = [];
  const 본것 = new Set();
  for (const 지목 of used) {
    const 문장 = String(지목 ?? '').trim();
    if (!문장) continue; // 빈 인용은 인용이 아니다 — 거부로도 세지 않는다
    const e = 문장에서신분.get(문장);
    if (!e) { rejected.push(문장.slice(0, 120)); continue; } // 허공 인용
    if (본것.has(e.ref)) continue; // 같은 것을 두 번 말해도 하나다
    본것.add(e.ref);
    refs.push({ ref: e.ref, kind: e.kind });
  }
  return { refs, rejected };
}
