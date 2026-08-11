// **부른 이름이 스킬 이름 그대로면 그건 서비스가 아니다** (콘솔 라이브 2026-08-12).
//
// 밟은 사슬 — 「네이버에서 팔식당 검색해서 플레이스 후기 분석해줄 수 있어?」
//   ① 프롬프트의 스킬 목록에 「네이버 검색 — 네이버 검색 결과를 주소로 바로 읽는다」가 있다
//   ② 모델이 그것을 **서비스로 읽고** `connector.connect{connector:'네이버 검색'}` 을 부른다
//   ③ `findConnector` 가 부분일치(`"네이버검색" ⊃ "네이버"`)로 **네이버 커넥터**를 잡는다
//   ④ 비밀 입력면이 떠서 턴이 **API 키 요구**로 닫힌다
// 이 회차가 여러 번 이 자리에서 죽었다 — 오너가 직접 연 콘솔에서도 같았다.
//
// `findConnector` 의 부분일치를 조이는 길은 막혀 있다: 같은 방향이 「노션 붙여줘」를 살리는
// 자리이기도 하고, 그 계약을 무는 검사가 이미 있다(api-key-connect.test.js:317).
// 그래서 **이름이 스킬과 정확히 같을 때만** 가른다 — 낱말 목록도 문구 그물도 아니고
// 이미 있는 스킬 색인과의 동일성이다. 그리고 막고 끝내지 않는다: 그 일 하는 법이 적힌
// 문서를 다음 수단으로 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { skillIndex } from '../src/surface/skill-docs.js';

const 네이버커넥터 = {
  id: 'naver', label: '네이버', kind: 'provider',
  authMethods: [{ kind: 'api_key', fields: [{ name: 'client_id', secret: true }] }],
};

const 손 = () => makeConnectorConnectTool({
  connectors: () => [네이버커넥터],
  ctx: () => ({ tools: { tools: {} }, descriptors: [], env: { connections: [] } }),
});

test('전제: 이 저장소에 「네이버 검색」 스킬이 실재한다', () => {
  const 있나 = (skillIndex() ?? []).some((s) => String(s.name).replace(/\s/g, '') === '네이버검색');
  assert.ok(있나, '스킬이 없으면 이 검사는 아무것도 안 잰다 — 전제부터 세운다');
});

test('스킬 이름으로 연결을 부르면 비밀 입력면이 안 뜬다', async () => {
  const r = await 손().handler({ connector: '네이버 검색' });
  assert.equal(r?.surfaceRequest, undefined,
    `**스킬 이름에 비밀 입력면이 떴다** — 턴이 API 키 요구로 닫힌다: ${JSON.stringify(r?.surfaceRequest)}`);
  assert.equal(r?.diagnosticTrace?.reason, 'skill_not_service');
});

test('막고 끝내지 않는다 — 그 일 하는 법이 적힌 문서를 다음 수단으로 준다', async () => {
  const r = await 손().handler({ connector: '네이버 검색' });
  const 다음 = r?.다음수단 ?? [];
  assert.ok(다음.length, '다음 길이 없다 — 막다른 답이다');
  assert.match(String(다음[0].path ?? ''), /SKILL\.md$/, `문서 경로가 아니다: ${JSON.stringify(다음[0])}`);
  assert.equal(다음[0].방법, 'local.file');
});

test('진짜 서비스 이름은 그대로 연결 흐름을 탄다 — 그물이 안 넓어졌다', async () => {
  const r = await 손().handler({ connector: '네이버' });
  assert.ok(r?.surfaceRequest, `**진짜 서비스가 막혔다** — 연결 자체가 죽는다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(r?.diagnosticTrace?.reason, undefined);
});

test('스킬도 서비스도 아닌 이름은 예전처럼 「목록에 없다」', async () => {
  const r = await 손().handler({ connector: '있지도않은서비스' });
  assert.notEqual(r?.diagnosticTrace?.reason, 'skill_not_service');
  assert.match(String(r?.userSafeSummary ?? ''), /목록에 없어요/);
});
