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
