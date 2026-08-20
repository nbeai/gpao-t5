const FALLBACK = '작업을 이어가고 있어요';

const MODEL_PROGRESS = Object.freeze({
  first: '요청을 이해하고 있어요',
  next: '확인한 내용을 바탕으로 다음 단계를 생각하고 있어요',
});

const BROWSER_PROGRESS = Object.freeze({
  status: '브라우저 준비 상태를 확인하고 있어요',
  profiles: '브라우저 준비 상태를 확인하고 있어요',
  tabs: '열려 있는 페이지를 확인하고 있어요',
  navigate: '요청한 페이지를 열고 있어요',
  snapshot: '페이지 내용을 살펴보고 있어요',
  screenshot: '화면을 이미지로 확인하고 있어요',
  click: '화면에서 다음 단계를 진행하고 있어요',
  fill: '화면에 필요한 내용을 입력하고 있어요',
  submit: '입력한 내용을 전송하고 있어요',
  login_start: '로그인 화면을 준비하고 있어요',
  login_status: '로그인 상태를 확인하고 있어요',
  login_cancel: '로그인 작업을 정리하고 있어요',
  download: '파일을 내려받고 있어요',
  upload: '파일을 보내고 있어요',
});

const ATTACHMENT_PROGRESS = Object.freeze({
  list: '받은 파일을 확인하고 있어요',
  inspect: '첨부 파일의 내용을 살펴보고 있어요',
  extract_archive: '압축 파일의 구성을 확인하고 있어요',
  register_output: '결과 파일을 준비하고 있어요',
});

const SKILL_PROGRESS = Object.freeze({
  list: '사용할 수 있는 작업 방법을 확인하고 있어요',
  search: '알맞은 작업 방법을 찾고 있어요',
  view: '필요한 작업 방법을 살펴보고 있어요',
});

const MEMORY_PROGRESS = Object.freeze({
  list: '기억해 둔 내용을 확인하고 있어요',
  add: '기억할 내용을 정리하고 있어요',
  replace: '기억할 내용을 정리하고 있어요',
  remove: '더는 필요하지 않은 기억을 정리하고 있어요',
});

const SESSION_PROGRESS = Object.freeze({
  search: '지난 대화에서 관련 내용을 찾고 있어요',
  read: '찾은 대화를 다시 살펴보고 있어요',
  browse: '지난 대화 목록을 확인하고 있어요',
});

const RECALL_PROGRESS = Object.freeze({
  find: '이전 작업 결과에서 필요한 내용을 찾고 있어요',
  read: '이전 작업 결과를 다시 읽고 있어요',
});

const PROCESS_PROGRESS = Object.freeze({
  list: '진행 중인 작업을 확인하고 있어요',
  poll: '진행 중인 작업의 상태를 확인하고 있어요',
  write: '실행 중인 작업에 필요한 내용을 입력하고 있어요',
  resize: '작업 화면을 알맞게 맞추고 있어요',
  stop: '실행 중인 작업을 멈추고 있어요',
});

const COMPLETED_PROGRESS = Object.freeze({
  web_search: '찾은 자료들을 비교하고 있어요',
  web_read: '읽은 내용을 요청과 맞춰보고 있어요',
  browser: '화면에서 확인한 내용을 정리하고 있어요',
  attachment: '파일에서 확인한 내용을 정리하고 있어요',
  skill: '확인한 방법을 작업에 적용하고 있어요',
  memory: '기억에서 확인한 내용을 현재 대화와 이어보고 있어요',
  session_search: '지난 대화에서 찾은 내용을 현재 요청과 이어보고 있어요',
  conversation_recall: '이전 작업에서 찾은 내용을 정리하고 있어요',
  exec: '컴퓨터 작업 결과를 다시 확인하고 있어요',
  process_start: '시작한 작업의 상태를 확인하고 있어요',
  process_control: '진행 중인 작업 결과를 확인하고 있어요',
  pty_start: '대화형 작업 결과를 확인하고 있어요',
});

const FIXED_PROGRESS_TEXT = new Set([
  FALLBACK, ...Object.values(MODEL_PROGRESS), ...Object.values(BROWSER_PROGRESS),
  ...Object.values(ATTACHMENT_PROGRESS), ...Object.values(SKILL_PROGRESS),
  ...Object.values(MEMORY_PROGRESS), ...Object.values(SESSION_PROGRESS),
  ...Object.values(RECALL_PROGRESS), ...Object.values(PROCESS_PROGRESS),
  ...Object.values(COMPLETED_PROGRESS),
  '웹에서 관련 자료를 찾고 있어요', '선택한 자료를 자세히 읽고 있어요',
  '컴퓨터에서 필요한 정보를 확인하고 있어요',
  '컴퓨터에서 요청한 작업을 진행하고 있어요',
  '시간이 걸리는 작업을 시작하고 있어요', '대화형 터미널 작업을 시작하고 있어요',
  '필요한 작업을 진행하고 있어요', '확인한 결과를 정리하고 있어요',
  '브라우저 화면을 살펴보고 있어요', '첨부 파일을 확인하고 있어요',
  '지난 대화를 확인하고 있어요', '이전 작업 결과를 다시 확인하고 있어요',
  '진행 중인 작업을 확인하고 있어요',
  '이제 거의 다 됐어요',
]);

function actionOf(args) {
  return typeof args?.action === 'string' ? args.action : '';
}

export function modelProgressText(turn) {
  return Number(turn) <= 1 ? MODEL_PROGRESS.first : MODEL_PROGRESS.next;
}

export function toolProgressText(name, args = {}) {
  const action = actionOf(args);
  if (name === 'web_search') return '웹에서 관련 자료를 찾고 있어요';
  if (name === 'web_read') return '선택한 자료를 자세히 읽고 있어요';
  if (name === 'browser') return BROWSER_PROGRESS[action] ?? '브라우저 화면을 살펴보고 있어요';
  if (name === 'attachment') return ATTACHMENT_PROGRESS[action] ?? '첨부 파일을 확인하고 있어요';
  if (name === 'skill') return SKILL_PROGRESS[action] ?? '필요한 작업 방법을 살펴보고 있어요';
  if (name === 'memory') return MEMORY_PROGRESS[action] ?? '기억해 둔 내용을 확인하고 있어요';
  if (name === 'session_search') return SESSION_PROGRESS[action] ?? '지난 대화를 확인하고 있어요';
  if (name === 'conversation_recall') return RECALL_PROGRESS[action]
    ?? '이전 작업 결과를 다시 확인하고 있어요';
  if (name === 'process_start') return '시간이 걸리는 작업을 시작하고 있어요';
  if (name === 'process_control') return PROCESS_PROGRESS[action] ?? '진행 중인 작업을 확인하고 있어요';
  if (name === 'pty_start') return '대화형 터미널 작업을 시작하고 있어요';
  if (name === 'exec') return args?.effect?.kind === 'observe'
    ? '컴퓨터에서 필요한 정보를 확인하고 있어요'
    : '컴퓨터에서 요청한 작업을 진행하고 있어요';
  return '필요한 작업을 진행하고 있어요';
}

export function toolCompletedProgressText(name) {
  return COMPLETED_PROGRESS[name] ?? '확인한 결과를 정리하고 있어요';
}

export function safeProgressText(value) {
  const text = String(value ?? '');
  return FIXED_PROGRESS_TEXT.has(text) ? text : FALLBACK;
}
