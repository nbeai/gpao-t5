// 슬라이스-1 데모 환경. 실서비스 연결·자격은 밀도화 단계에서 실제 provider/connector 로 대체한다.
// 여기서는 커널 흐름을 사람이 실제로 겪어 보게 하는 최소 실행 맥락만 만든다.
import { ToolRunner } from '../runtime/tool-runner.js';
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';
import { defineWebTool, makeSourceEvidence, classifyWebFetch } from '../kernel/l2-plan/web-tool.js';
import { defineConnector } from '../kernel/l2-plan/connector-profile.js';
import { defineChannel } from '../kernel/l2-plan/channel-registry.js';

// P6-2 Slice-3: 채널 커넥터를 ConnectorProfile로 선언(멀티채널). 실제 adapter는 P6 후속.
export function demoConnectors() {
  return [
    defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true }),
    defineConnector({ id: 'slack.channel', label: '슬랙 채널', kind: 'channel', authState: 'oauth', connected: false }),
  ];
}

// P6-16 Slice-1: ChannelRegistry 데모 fixture — 커넥터(자격) + inbound 정책 + outbound 도구 바인딩.
//   ⚠️ **demo/test 전용 fixture다.** telegram을 connected:true로 박아두므로 **라이브 표면에 쓰면 안 된다** —
//   라이브 채널 상태는 실제 자격에서 파생한다(live-context.liveChannels). server 기본은 이 fixture(테스트 편의).
export function demoChannels() {
  const byId = Object.fromEntries(demoConnectors().map((c) => [c.id, c]));
  return [
    defineChannel({ id: 'telegram', connector: byId.telegram, inboundPolicy: 'mention_required', outboundTool: 'telegram.send' }),
    defineChannel({ id: 'slack.channel', connector: byId['slack.channel'], inboundPolicy: 'mention_required', outboundTool: 'slack.post' }),
  ];
}

// P6-2: 도구를 ToolDescriptor로 정의한다(소유≠실행, availability 신호, auth≠approval).
// web.collect는 WebToolDescriptor로 확장(입력스키마·출처계약·세션·스크래핑 정책).
const DESCRIPTORS = [
  defineWebTool({ id: 'web.collect', label: '웹 자료 수집', sessionMode: 'anonymous' }),
  defineTool({
    id: 'local.file', label: '로컬 파일', owner: 'core', availability: [{ kind: 'connected' }], toolKind: 'organize',
    // 지우거나 덮어쓴 것은 휴지통에 남고 되돌리기 표가 있다(local-file.js) — 사실이므로 선언한다.
    reversible: true, reversibleNote: '휴지통에 남아 "되돌려줘"로 되살릴 수 있어요',
  }),
  defineTool({ reversible: false, id: 'mail.send', label: '메일 발송', owner: 'channel', availability: [{ kind: 'connected' }, { kind: 'auth' }], toolKind: 'send', needsApproval: true }),
  defineTool({ reversible: false, id: 'slack.post', label: '슬랙 게시', owner: 'channel', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true }),
  // 채널 레지스트리가 outboundTool 로 선언하는 도구는 descriptor 도 있어야 한다 — 선언만 있고
  // 손이 없으면 T5 가 "텔레그램으로 보낸다"고 말해 놓고 못 보낸다(감사 지적, 게이트가 불변식으로 막는다).
  // 지난 대화 검색 — 읽기 전용이라 자연 진행(A0). 결과는 후보이지 자동 반영이 아니다.
  defineTool({ id: 'session.search', label: '지난 대화 찾기', owner: 'core', availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true }),
  defineTool({ reversible: false, id: 'telegram.send', label: '텔레그램 전송', owner: 'channel', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true }),
];
/**
 * 도구함 투영용 descriptor 목록(라벨·toolKind·needsApproval·sourcePolicy 포함).
 * @param {{include?:string[]}} [opts] include 를 주면 **그 id 만** 선언한다 — 라이브는 실제 손이 있는
 *   것만 선언한다(손 없는 선언 = 사용자에게 하는 거짓말).
 */
export function demoDescriptors(opts = {}) {
  return opts.include ? DESCRIPTORS.filter((d) => opts.include.includes(d.id)) : DESCRIPTORS;
}

// 환경 사실(연결·인증 존재 여부). mail.send는 연결됐으나 발송 인증 미준비 → needs_auth.
const FACTS = {
  'web.collect': { connected: true },
  'local.file': { connected: true },
  'mail.send': { connected: true, auth: false },
  'slack.post': { connected: true },
  'telegram.send': { connected: true },
  'session.search': { connected: true },
};

/**
 * 슬라이스-1 기본 환경(SelfState 입력). 연결은 descriptor availability로 판정한다.
 * @param {{factOverrides?:Record<string,object>, include?:string[]}} [opts]
 *   factOverrides: 실제 자격 상태를 반영할 때 FACTS를 덮어쓴다(라이브).
 *   include: 그 도구만 자기 상태에 싣는다 — descriptor 선언과 같은 집합이어야 한다(단일 진실).
 */
export function demoEnv(opts = {}) {
  const facts = { ...FACTS, ...(opts.factOverrides ?? {}) };
  return {
    model: { id: 'beai5-stub', strengths: '자연 대화·판단', authSignal: 'ok' },
    connections: demoDescriptors(opts).map((d) => toConnection(d, facts[d.id] ?? {})),
    grantedAuthorities: [],
  };
}

/**
 * 슬라이스-1 스텁 도구. web.collect 는 차단 사례를 재현할 수 있게 한다(복구 흐름 시연).
 * @param {{webCollector?:object, senders?:Record<string,object>}} [opts]
 *   webCollector 주입 시 web.collect를 실제 어댑터로(P6-5). senders 주입 시 해당 send 도구를 실제 어댑터로(P6-6).
 */
export function demoTools(opts = {}) {
  const senders = opts.senders ?? {};
  return new ToolRunner({
    'web.collect': opts.webCollector ?? {
      // 출처 원장 필수 — ToolRunner가 assertWebEvidence를 강제한다(handler 관례에 안 맡김).
      sourceLedgerRequired: true,
      async handler(args) {
        const q = String(args?.request ?? '');
        // 로그인벽/차단/봇벽을 성공과 분리(정직한 상태). 실패는 내용·출처 없음.
        const fetchState = classifyWebFetch({ status: q });
        if (fetchState !== 'ok') {
          const msg = fetchState === 'login_wall' ? '로그인이 필요한 페이지예요.'
            : fetchState === 'bot_wall' ? '봇 차단이 걸려 있어요.'
              : fetchState === 'robots_disallow' ? '그 사이트가 수집을 허용하지 않아요.'
                : '그 사이트가 접근을 막고 있어요.';
          return { blocked: true, fetchState, userSafeSummary: msg };
        }
        // 성공: 반드시 출처 근거(SourceEvidence)를 만든다. 런타임 assertWebEvidence가 출처 없는 성공을 막는다.
        const sources = [makeSourceEvidence({ sourceUrl: 'https://example.com/public', title: '공개 자료', excerpt: q, confidence: 0.6 })];
        return { result: { note: '공개 자료 기준 요약' }, sources, userSafeSummary: '공개 자료로 확인했어요.' };
      },
    },
    // 라이브는 실제 손발(makeLocalFileTool)을 주입한다. 여기 기본값은 **테스트/데모 전용 fixture** 이며
    // 스텁 금지 게이트가 라이브에서 이게 쓰이면 실패시킨다(§16-C).
    'local.file': opts.localFile ?? {
      isFixture: true,
      async handler() {
        return { result: { scanned: true }, userSafeSummary: '로컬 파일을 확인했어요(변경 없음).' };
      },
    },
    'slack.post': senders['slack.post'] ?? {
      async handler() {
        return { result: { posted: true }, userSafeSummary: '슬랙에 게시했어요.' };
      },
    },
    // 라이브는 makeChannelSender 로 실제 전송을 주입한다. 여기 기본값은 데모/테스트 전용이다.
    // 지난 대화 찾기 — 라이브는 실제 세션 저장소를 주입한다(여기 기본값은 빈 결과).
    'session.search': opts.sessionSearch ?? {
      async handler() { return { result: { hits: [] }, userSafeSummary: '지난 대화에서 찾지 못했어요.' }; },
    },
    'telegram.send': senders['telegram.send'] ?? {
      isFixture: true,
      async handler() {
        return { result: { sent: true }, userSafeSummary: '텔레그램으로 보냈어요.' };
      },
    },
  });
}
