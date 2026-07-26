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
    capability: '정해진 작업 폴더 안에서 파일을 보고·읽고·만들고·옮기고·지운다. 지우거나 덮어쓴 것은 되돌릴 수 있다.',
    // 모델 노출 스키마도 같은 선언에 둔다(1축) — 예전엔 tool-schema.js 의 수동 맵에 있었다.
    schema: {
      description: '정해진 작업 폴더 안의 파일을 보거나 읽거나 저장하거나 옮기거나 지운다. 되돌리기도 가능.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'move', 'delete', 'undo'] },
          path: { type: 'string', description: '대상 파일·폴더(작업 폴더 기준 상대 경로)' },
          to: { type: 'string', description: 'move 일 때 옮길 위치' },
          text: { type: 'string', description: 'write 일 때 저장할 내용' },
        },
        required: ['action'],
      },
    },
    // 지우거나 덮어쓴 것은 휴지통에 남고 되돌리기 표가 있다(local-file.js) — 사실이므로 선언한다.
    reversible: true, reversibleNote: '휴지통에 남아 "되돌려줘"로 되살릴 수 있어요',
  }),
  defineTool({ reversible: false, id: 'mail.send', label: '메일 발송', owner: 'channel', availability: [{ kind: 'connected' }, { kind: 'auth' }], toolKind: 'send', needsApproval: true,
    capability: '메일을 보낸다(보내기 전 확인을 받는다).',
    // 지금은 실행 불가라 모델에게 안 보이지만, **연결되는 순간 보여야 한다.** 스키마가 없으면
    // 그때 `session.search` 와 똑같은 일이 난다 — 도구는 있는데 모델이 존재를 모른다.
    schema: {
      description: '메일을 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '받는 사람(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
  defineTool({ reversible: false, id: 'slack.post', label: '슬랙 게시', owner: 'channel', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true,
    capability: '슬랙에 글을 올린다(올리기 전 확인을 받는다).',
    schema: {
      description: '슬랙에 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '채널·대상(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
  // 채널 레지스트리가 outboundTool 로 선언하는 도구는 descriptor 도 있어야 한다 — 선언만 있고
  // 손이 없으면 T5 가 "텔레그램으로 보낸다"고 말해 놓고 못 보낸다(감사 지적, 게이트가 불변식으로 막는다).
  // 지난 대화 검색 — 읽기 전용이라 자연 진행(A0). 결과는 후보이지 자동 반영이 아니다.
    // 능력 문장이 없어서 자기파악에서 이름만 보였다(1축에서 발견 — 맵에 안 적혀 있었다).
  defineTool({ id: 'session.search', label: '지난 대화 찾기', owner: 'core', availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    capability: '지난 대화들에서 찾는다. 제목·시각·짧은 조각만 돌려주며 대화 내용을 통째로 옮기지 않는다.',
    schema: {
      description: '지난 대화들에서 찾는다. 사용자가 "전에 말했던", "그때 그거", "물어봤던 세션"처럼'
        + ' 과거 대화를 가리키면 이걸로 찾는다. 제목·시각·짧은 조각만 돌려주며 대화 내용을 통째로 옮기지 않는다.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '찾을 말(주제·상호·키워드)' } },
        required: ['query'],
      },
    } }),
  // P2-10: 브라우저 표면. **URL 읽기로 닿지 않는 화면**을 실제로 보는 손이다.
  // 보기(observe)와 조작(act)을 나눈다 — 조작이라 해도 이 슬라이스는 관찰 목적뿐이다.
  // 둘 다 읽기(A0): 입력·전송·구매는 만들지 않았으므로 실수로도 못 한다.
  // 브라우저가 없는 컴퓨터에서는 손이 안 붙고, 손이 없으면 선언도 안 딸려온다(1축의 배당금).
  defineTool({
    id: 'browser.observe', label: '브라우저로 화면 보기', owner: 'core',
    availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    capability: '주소를 브라우저로 열어 **실제로 그려진 화면**을 본다. 자바스크립트로 그려지거나 탭 뒤에 있는 내용도 볼 수 있고,'
      + ' 어디까지 봤고 얼마가 남았는지를 함께 남긴다. 보기만 하고 화면을 바꾸지 않는다.',
    schema: {
      description: '주소를 브라우저로 열어 실제 화면을 본다. `web.collect` 로 읽었는데 내용이 비어 있거나'
        + ' 자바스크립트로 그려지는 화면일 때 쓴다. 본 범위와 못 본 범위를 함께 돌려준다.'
        + ' 화면을 더 보려면(내리기·탭 전환·더보기) `browser.act` 를 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'snapshot'] },
          url: { type: 'string', description: 'open 일 때 열 주소' },
        },
        required: ['action'],
      },
    },
  }),
  defineTool({
    id: 'browser.act', label: '브라우저 화면 넘기기', owner: 'core',
    availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    capability: '보고 있는 화면을 더 본다 — 아래로 내리거나, 탭을 바꾸거나, 더보기를 편다.'
      + ' 몇 번 내렸는지와 왜 멈췄는지를 남긴다. 글을 쓰거나 보내거나 사는 일은 하지 않는다.',
    schema: {
      description: '보고 있는 화면을 더 본다. scroll(아래로 내리기 — 최대 5번, 새 내용이 안 나오면 멈춘다) ·'
        + ' click(앞선 관찰이 준 ref 의 **탭·더보기만**). 링크는 누르지 않는다 — 주소를 알면 browser.observe 로 연다.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['scroll', 'click'] },
          ref: { type: 'string', description: 'click 일 때, 앞선 관찰이 준 ref(탭·더보기만)' },
          times: { type: 'number', description: 'scroll 일 때 몇 번 내릴지(최대 5)' },
        },
        required: ['action'],
      },
    },
  }),
  defineTool({ reversible: false, id: 'telegram.send', label: '텔레그램 전송', owner: 'channel', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true,
    capability: '텔레그램으로 보낸다(보내기 전 확인을 받는다).',
    schema: {
      description: '텔레그램으로 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '보낼 방(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
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
    // P2-10: 브라우저 손. 실제 손을 안 넘기면 **등록하지 않는다** — 스텁 금지(게이트가 검사한다).
    ...(opts.browserObserve ? { 'browser.observe': opts.browserObserve } : {}),
    ...(opts.browserAct ? { 'browser.act': opts.browserAct } : {}),
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
