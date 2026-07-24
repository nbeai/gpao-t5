// 슬라이스-1 데모 환경. 실서비스 연결·자격은 밀도화 단계에서 실제 provider/connector 로 대체한다.
// 여기서는 커널 흐름을 사람이 실제로 겪어 보게 하는 최소 실행 맥락만 만든다.
import { ToolRunner } from '../runtime/tool-runner.js';

/** 슬라이스-1 기본 환경(SelfState 입력). */
export function demoEnv() {
  return {
    model: { id: 'beai5-stub', strengths: '자연 대화·판단', authSignal: 'ok' },
    connections: [
      { id: 'web.collect', connected: true, executable: true, note: '공개 웹 읽기' },
      { id: 'local.file', connected: true, executable: true, note: '로컬 파일 정리' },
      { id: 'mail.send', connected: true, executable: false, note: '발송 권한 준비 전' },
      { id: 'slack.post', connected: true, executable: true, note: '게시 가능(승인 필요)' },
    ],
    grantedAuthorities: [],
  };
}

/** 슬라이스-1 스텁 도구. web.collect 는 차단 사례를 재현할 수 있게 한다(복구 흐름 시연). */
export function demoTools() {
  return new ToolRunner({
    'web.collect': {
      async handler(args) {
        const q = String(args?.request ?? '');
        if (/차단|blocked|로그인벽/.test(q)) {
          return { blocked: true, userSafeSummary: '그 사이트가 접근을 막고 있어요.' };
        }
        return { result: { note: '공개 자료 기준 요약' }, userSafeSummary: '공개 자료로 확인했어요.' };
      },
    },
    'local.file': {
      async handler() {
        return { result: { scanned: true }, userSafeSummary: '로컬 파일을 확인했어요(변경 없음).' };
      },
    },
    'slack.post': {
      async handler() {
        return { result: { posted: true }, userSafeSummary: '슬랙에 게시했어요.' };
      },
    },
  });
}
