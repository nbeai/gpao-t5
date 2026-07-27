// L3 · 공통 엔지니어링 탐색. 서비스 이름을 아는 것이 아니라, 이미 있는 연결 단서를 읽는다.
// 비밀·설정 본문·자동 연결은 다루지 않는다. 후보는 다음 판단의 근거일 뿐 연결 성공이 아니다.
import { readdir } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { mcpServerNames } from './local-signs.js';

const norm = (v) => String(v ?? '').normalize('NFC').toLowerCase().replace(/[\s._-]+/g, '');
const matches = (name, subject) => {
  const a = norm(name); const b = norm(subject);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
};

async function commandNames(deps = {}) {
  const dirs = deps.pathDirs ?? String(deps.path ?? process.env.PATH ?? '').split(delimiter);
  const out = new Set();
  for (const dir of dirs.slice(0, 24)) {
    for (const entry of await readdir(dir).catch(() => [])) out.add(entry);
  }
  return [...out];
}

export function makeLocalDiscoveryTool(deps = {}) {
  const connectors = () => deps.connectors?.() ?? [];
  return {
    subjectOf(rec) {
      const subject = rec?.actualCall?.args?.subject;
      return subject ? { key: `discovery:${subject}`, kind: 'discovery', label: String(subject) } : null;
    },
    async handler(args = {}) {
      const subject = String(args.subject ?? '').trim();
      if (!subject) return { blocked: true, userSafeSummary: '무엇의 연결 흔적을 볼지 알려주세요.' };
      const candidates = [];
      const seen = new Set();
      const add = (kind, label, evidence) => {
        const key = `${kind}:${label}`;
        if (!seen.has(key) && candidates.length < 5) { seen.add(key); candidates.push({ kind, label, evidence }); }
      };
      for (const entry of await (deps.mcpNames ?? mcpServerNames)(deps)) {
        if (matches(entry.name, subject)) add('mcp', entry.name, 'MCP 등록 이름이 요청과 맞아요');
      }
      for (const name of await commandNames(deps)) {
        if (matches(name, subject)) add('cli', name, '설치된 명령 이름이 요청과 맞아요');
      }
      for (const c of connectors()) {
        const names = [c.id, c.label, ...(c.aliases ?? [])];
        if (names.some((name) => matches(name, subject))) {
          add('connector', c.label ?? c.id, c.connected ? 'T5 연결 상태가 확인돼 있어요' : 'T5에 연결 선언은 있지만 현재 직접 연결은 아니에요');
        }
      }
      const connectionDiscovery = { subject, checked: ['mcp', 'cli', 'known_connectors'], candidates };
      return {
        result: { ...connectionDiscovery, checkedAt: Date.now() },
        connectionDiscovery,
        userSafeSummary: candidates.length ? '기존 연결 단서를 찾았어요.' : '바로 쓸 연결 단서는 아직 찾지 못했어요.',
      };
    },
  };
}
