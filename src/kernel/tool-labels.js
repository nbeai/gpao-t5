// 내부 도구 id → 사용자 표시 이름. 기본 채팅 화면에 스키마·내부명이 새지 않게 한다(UX §1.2, S43).
// 밀도화 단계에서 connector 등록과 함께 확장한다.
const LABELS = {
  'web.collect': '웹 자료 수집',
  'local.file': '로컬 파일',
  'mail.send': '메일 발송',
  'slack.post': '슬랙 게시',
  'telegram.send': '텔레그램 전송',
};

/** @param {string} id */
export function toolLabel(id) {
  return LABELS[id] ?? id;
}

// 도구가 **실제로 하는 일** 한 줄. 라벨만 주면 모델이 그럴듯한 하위 기능을 지어낸다(오너 실사용
// 2026-07-26: "검색 기반 수집·다중 페이지 순회·CSV 내보내기"를 약속했지만 전부 미구현이었다).
// 여기 문장은 구현과 함께 갱신한다 — 구현이 늘면 문장을 늘리고, 아니면 늘리지 않는다.
const CAPABILITIES = {
  'web.collect': '사용자가 준 주소의 공개 페이지를 읽어 온다(읽기 전용). 검색어로 찾아 주는 기능은 아직 없다.',
  'local.file': '이 컴퓨터의 파일을 읽고 정리한다.',
  'mail.send': '메일을 보낸다(보내기 전 확인을 받는다).',
  'slack.post': '슬랙에 글을 올린다(올리기 전 확인을 받는다).',
  'telegram.send': '텔레그램으로 보낸다(보내기 전 확인을 받는다).',
};

/** 사용자면에 쓸 "라벨 — 하는 일" 한 줄. 설명이 없으면 라벨만(없는 설명을 지어내지 않는다). */
export function toolCapabilityLine(id) {
  const cap = CAPABILITIES[id];
  return cap ? `${toolLabel(id)} — ${cap}` : toolLabel(id);
}
