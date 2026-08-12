// UX 정본 §4의 「못 본 여덟」을 제품 렌더러에 넣는 고정 입력.
// 화면 마크업을 복제하지 않는다. 실제 index.html의 renderResult가 이 사실을 그린다.
export const 숨은표면고정물 = [
  {
    id: 'approval', 이름: '승인 카드', 기대글: ['실행 전 승인이 필요해요', '왜 확인하나요'], 기대버튼: ['승인', '하지 마'],
    activePendingIds: ['pending-ux-1'],
    result: {
      kind: 'approval', pendingId: 'pending-ux-1', pending: [{
        action: 'local.terminal', label: '휴지통을 비워요', tier: 'A3', safetyFloor: true,
        preview: { impact: '지운 파일은 되돌릴 수 없어요.', where: '이 컴퓨터의 휴지통', what: '휴지통 안의 모든 파일' },
        reason: { why: '되돌릴 수 없는 삭제라서 실행 전에 확인해요.', reversible: '실행 뒤에는 되돌릴 수 없어요.' },
      }],
    },
  },
  {
    id: 'secret-input', 이름: '비밀 입력', 기대글: ['네이버 연결', '대화에는 남지 않아요'], 기대버튼: ['보기', '저장하고 연결 확인'],
    result: {
      kind: 'reply', reply: '연결에 필요한 값을 이 창에서 받아요.',
      surfaceRequest: {
        kind: 'secret_input', connector: 'naver', label: '네이버',
        fields: [
          { name: 'client_id', label: '클라이언트 ID', secret: false },
          { name: 'client_secret', label: '클라이언트 비밀값', secret: true },
        ],
        issue: { steps: ['네이버 개발자센터에서 애플리케이션 키를 확인해요.'], url: 'https://developers.naver.com/', buttonLabel: '키 받으러 가기' },
      },
    },
  },
  {
    id: 'capability-resolution', 이름: '능력 해결', 기대글: ['Notion 연결이 필요해요', '준비되면 이어서 진행할게요'], 기대버튼: ['연결 화면 열기', '나중에'],
    result: {
      kind: 'reply', reply: 'Notion 자료를 읽으려면 연결이 필요해요.',
      capabilityResolution: { capabilityType: 'connector', missingCapability: 'Notion', reason: '아직 연결되지 않았어요.', ref: { toolId: 'notion' } },
    },
  },
  {
    id: 'memory-change', 이름: '기억 반영과 철회', 기대글: ['이렇게 기억해 뒀어요', '그 기억은 지웠어요'], 기대버튼: ['되돌리기'],
    result: {
      kind: 'reply', reply: '말씀하신 선호를 반영하고, 예전 선호는 지웠어요.',
      memoryApplied: { statement: '보고서는 한국어로 작성해', undoId: 'memory-ux-1' },
      memoryWithdrawn: { statement: '보고서는 영어로 작성해' },
    },
  },
  {
    id: 'automation-proposal', 이름: '자동화 제안', 기대글: ['이 작업을 자동으로 반복할까요?', '승인 전엔 아무것도 실행하지 않아요'], 기대버튼: ['자동화 설정', '아니요'],
    result: {
      kind: 'reply', reply: '매주 반복되는 작업으로 보입니다.',
      automationProposal: { candidateId: 'automation-ux-1', statement: '매주 월요일 오전 9시에 지난주 정산표 만들기' },
    },
  },
  {
    id: 'pattern-candidate', 이름: '기본 대상 제안', 기대글: ['이 도구의 기본 대상으로 기억할까요?', '모든 대화에서'], 기대버튼: ['기본으로 설정', '아니요'],
    result: {
      kind: 'reply', reply: '이번에도 같은 채널로 보냈어요.',
      patternCandidate: { patternId: 'pattern-ux-1', targetLabel: '정산팀 Slack 채널' },
    },
  },
  {
    id: 'delivery-failure', 이름: '전달 실패', 기대글: ['결과는 만들었는데 전달이 막혔어요', '처음부터 다시 안 해요'], 기대버튼: ['다시 보내기', '나중에'],
    result: {
      kind: 'reply', reply: '정산표 파일은 만들었습니다.',
      deliveryFailed: { deliveryId: 'delivery-ux-1', needsFix: true, userSafeSummary: 'Slack 연결이 끊겨 전달하지 못했어요.' },
    },
  },
  {
    id: 'recovery', 이름: '회복 안내', 기대글: ['작업을 이어갈 다른 길을 찾았어요.', '다음: 브라우저로 다시 열어 볼까요?'], 기대버튼: [],
    recovery: { text: '작업을 이어갈 다른 길을 찾았어요.', nextSafeAction: '브라우저로 다시 열어 볼까요?' },
  },
];
