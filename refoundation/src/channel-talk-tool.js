export function makeChannelTalkTool({ api } = {}) {
  if (!api?.listChats || !api?.readMessages) throw new TypeError('Channel Talk API is required');
  return {
    name: 'channel_talk',
    description: '연결된 Channel Talk에서 고객 상담 목록과 상담 메시지를 읽어요. 현재는 읽기 전용이며 답장·수정·종료는 지원하지 않아요.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list_chats', 'read_messages'] },
      chatId: { type: ['string', 'null'], maxLength: 200 },
      state: { type: ['string', 'null'], enum: ['opened', 'snoozed', 'closed', null] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      effect: { type: ['object', 'null'] },
    }, required: ['action', 'chatId', 'state', 'limit', 'effect'] },
    async preflight(args = {}) {
      if (args.effect?.kind !== 'observe') return { allowed: false, outcome: 'not_executed',
        result: { state: 'observe_effect_required' } };
      if (args.action === 'read_messages' && !String(args.chatId ?? '').trim()) return { allowed: false,
        outcome: 'not_executed', result: { state: 'chat_identity_required' } };
      return { allowed: true };
    },
    async execute(args = {}) {
      if (args.action === 'list_chats') return { state: 'listed', readOnly: true,
        ...await api.listChats({ state: args.state ?? 'opened', limit: args.limit }) };
      if (args.action === 'read_messages') return { state: 'read', readOnly: true, chatId: args.chatId,
        ...await api.readMessages({ chatId: args.chatId, limit: args.limit }) };
      throw new TypeError('unsupported Channel Talk action');
    },
  };
}
