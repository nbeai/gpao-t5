// L1 · 파일 작업 인자 파싱 (Phase 0-1) — "어떤 파일에 무엇을" 을 지시 문장에서 분리한다.
//
// send 에는 parseSend 가 있는데 파일에는 없었다. 그래서 도구를 실제로 만들어도 커널이 **무엇을
// 하라고 말해줄 수 없었다** — 도구만 만들면 되는 게 아니라는 실증(오너 실사용에서 "쓰기 도구는
// 준비되어 있지 않아요"로 나타났다).
//
// 계약:
//   · 문장 전체를 파일 내용으로 쓰지 않는다(parseSend 와 같은 원리).
//   · 대상·내용이 애매하면 **실행 전에 묻는다**(절대 원칙 5, 막다른 답 금지).
//   · 여기서는 해석만 한다 — 범위 판정·승인·실행은 각자의 자리에서(file-scope / authority / ToolRunner).

const ACTION_PATTERNS = [
  { action: 'delete', re: /지워|삭제|없애/ },
  { action: 'undo', re: /되돌려|복구|취소해|undo/i },
  { action: 'move', re: /옮겨|이동|이름.*바꿔|rename/i },
  { action: 'write', re: /만들어|저장해|적어|써줘|쓰고|기록해|생성/ },
  { action: 'read', re: /읽어|열어|보여|내용/ },
  { action: 'list', re: /목록|뭐.?있|리스트|보여줘/ },
];

// 파일명: 확장자가 있는 토큰(한글 파일명도 받는다). 경로 구분자도 허용.
const FILE_TOKEN = /(?:^|[\s'"“”‘’(])([^\s'"“”‘’()]+\.[A-Za-z0-9]{1,8})(?=(?:을|를|은|는|이|가|에서|으로|로)?(?:$|[\s'"“”‘’),.]))/;
// 따옴표 안 내용 = 파일에 쓸 내용
const QUOTED = /['"“”‘’]([^'"“”‘’]{1,4000})['"“”‘’]/;

/**
 * @param {string} text
 * @returns {{action:string, path?:string, to?:string, text?:string,
 *            ambiguous?:boolean, clarifyReason?:string}}
 */
export function parseFileRequest(text) {
  const t = String(text ?? '').trim();
  // **못 알아들은 말을 list 로 흘리지 않는다.** 예전엔 기본값이 'list' 라서 "이름 바꿔줘" 같은
  // 표현이 조용히 "폴더 목록"이 됐다 — 사용자가 시킨 일과 다른 일을 하고 성공으로 기록했다.
  // 이 목록은 손으로 관리하는 패턴이라 언젠가 또 어긋난다. 어긋났을 때 **묻는 쪽으로** 떨어지게 한다.
  const action = ACTION_PATTERNS.find((p) => p.re.test(t))?.action;
  if (!action) return { action: 'unknown', ambiguous: true, clarifyReason: 'no_action' };

  if (action === 'undo') return { action: 'undo' };
  if (action === 'list') {
    // "무슨 파일 있어?" 류 — 경로가 있으면 그 폴더, 없으면 기본 폴더
    const named = t.match(FILE_TOKEN)?.[1];
    return { action: 'list', path: named ?? '.' };
  }

  const pathMatches = [...t.matchAll(new RegExp(FILE_TOKEN.source, 'g'))];
  const pathMatch = pathMatches[0];
  const path = pathMatch?.[1];
  if (!path) return { action, ambiguous: true, clarifyReason: 'no_path' };

  if (action === 'move') {
    // "a.txt 를 보관/b.txt 로" — 두 번째 파일 토큰이 대상
    const all = [...t.matchAll(new RegExp(FILE_TOKEN, 'g'))].map((m) => m[1]);
    const to = all.find((p) => p !== path);
    if (!to) return { action, path, ambiguous: true, clarifyReason: 'no_destination' };
    return { action, path, to };
  }

  if (action === 'write') {
    const pathStart = pathMatch.index + pathMatch[0].indexOf(path);
    const pathSpan = { start: pathStart, end: pathStart + path.length };
    const quotes = [...t.matchAll(new RegExp(QUOTED.source, 'g'))].map((match) => {
      const start = match.index + match[0].indexOf(match[1]);
      return { body: match[1], span: { start, end: start + match[1].length } };
    });
    const selected = quotes.find(({ span }) => span.end <= pathSpan.start || pathSpan.end <= span.start);
    const body = selected?.body;
    if (!body) return { action, path, ambiguous: true, clarifyReason: 'no_content' };
    return { action, path, text: body,
      provenance: { source: 'user_utterance', path: pathSpan, text: selected.span,
        pathCount: pathMatches.length, independent: pathMatches.length === 1 } };
  }

  return { action, path };
}

/** 애매할 때 사용자에게 물을 말(방법 나열 금지, 한 가지만 묻는다). */
export function fileClarifyQuestion(parsed) {
  switch (parsed?.clarifyReason) {
    case 'no_path': return '어떤 파일로 할까요? (파일 이름을 알려주세요)';
    case 'no_destination': return '어디로 옮길까요? (새 이름이나 폴더를 알려주세요)';
    case 'no_content': return '무엇을 적을까요? (내용을 따옴표로 알려주시면 그대로 씁니다)';
    case 'no_action': return '그 파일로 무엇을 할까요? (보기·읽기·저장·옮기기·지우기 중에서요)';
    default: return '파일 작업을 조금 더 자세히 알려주시겠어요?';
  }
}
