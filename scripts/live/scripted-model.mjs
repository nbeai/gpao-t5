// 라이브 관통용 **대본 모델 종단** — Anthropic Messages 와이어를 그대로 말한다.
//
// 왜 필요한가(M2 복기 R5): 라이브가 잡은 결함 둘은 20분의 실사용이 잡았는데, 그 20분을
// 매번 손으로 차리느라 3회차를 헛돌았다(인자명 `op`/`action`, "두 번째 호출" 판정, 스키마).
// 그 셋은 전부 **여기 한 파일**의 문제였으므로, 한 번 맞춰 두고 자산으로 남긴다.
//
// **무엇을 가짜로 두는가**: 모델의 판단 하나뿐이다. provider 코드·fetch·헤더·도구 스키마
// 전달·응답 파싱·서버·저장소·권한·표면 응답·파일 시스템은 전부 실제로 돈다.
// 그래서 이 하네스는 "모델이 무엇을 고르는가"가 아니라 **"고른 뒤 무슨 일이 벌어지는가"** 를 잰다.
//
// **판정에 쓰지 않는다**: 여기서 나온 문구로 합격을 만들지 않는다(모델은 같은 답을 낼 수 없다 —
// 문구 일치는 판정이 아니다). 판정은 호출자가 파일·원장·표면 응답에서 따로 잰다.
import { createServer } from 'node:http';

/** T5 가 도구 이름을 와이어에 실을 때 쓰는 변환과 같아야 한다(`model-provider.js`). */
export const wireToolName = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_');

const 응답본문 = (content) => ({
  id: 'msg_live', type: 'message', role: 'assistant', content, stop_reason: 'end_turn',
});

/**
 * 대본 모델을 띄운다. 포트는 0(비어 있는 것 아무거나) — 두 하네스가 부딪히지 않게.
 * @param {Object} p
 * @param {Array<{열쇠:string, tool:string, args:(문장:string)=>object}>} p.대본
 *   사용자 문장의 **마지막 줄**에 `열쇠` 가 있으면 그 도구를 고른다. T5 가 문장 앞에 맥락을
 *   길게 붙이므로 전문에서 찾으면 서문의 낱말을 잘못 집는다(실측).
 * @param {string} [p.모델id]
 * @returns {Promise<{port:number, baseUrl:string, 고른것:Array, close:()=>Promise<void>}>}
 */
export async function 대본모델띄우기({ 대본, 모델id = 'claude-opus-4-8' }) {
  // 이번 턴에서 이미 도구를 고른 사용자 문장. 같은 턴에 두 번 고르지 않는다(무한 루프 방지).
  // **이력 길이로 판정하면 안 된다** — T5 는 대화 이력을 매번 함께 싣기 때문에 두 번째 턴부터
  // 항상 참이 된다(실측: 그래서 삭제가 실행되지 않았다). 턴의 신분은 사용자의 마지막 문장이다.
  const 쓴턴 = new Set();
  const selector쓴턴 = new Set();
  const 고른것 = [];
  const 통제범주 = (tool) => {
    if (String(tool).startsWith('memory.')) return 'memory';
    if (String(tool).startsWith('automation.')) return 'automation';
    if (tool === 'skill.propose') return 'skill';
    if (tool === 'agent.propose') return 'agent';
    if (tool === 'work.state') return 'work';
    if (tool === 'ask.user') return 'question';
    return null;
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const 보내기 = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      // doctor(P-RT-2)가 과금 없이 키·도달성·모델 존재를 확인하는 경로.
      if (req.method === 'GET' && req.url.includes('/models')) return 보내기(200, { data: [{ id: 모델id }] });

      let m = {};
      try { m = JSON.parse(body); } catch { /* 아래에서 말로만 답한다 */ }
      const 쓸수있는도구 = (m?.tools ?? []).map((t) => t.name);
      const 이번턴 = String(m?.messages?.at(-1)?.content ?? '').trim().split('\n').at(-1).trim();
      const 규칙 = 대본.find((r) => 이번턴.includes(r.열쇠));
      const 배선됨 = Boolean(규칙) && 쓸수있는도구.includes(wireToolName(규칙.tool));
      const 범주 = 규칙 ? 통제범주(규칙.tool) : null;

      if (규칙 && 범주 && !배선됨 && 쓸수있는도구.includes(wireToolName('control.select'))
        && !selector쓴턴.has(이번턴)) {
        selector쓴턴.add(이번턴);
        고른것.push({ 턴: 이번턴, tool: 'control.select' });
        return 보내기(200, 응답본문([{
          type: 'tool_use', id: `tu_${고른것.length}`,
          name: wireToolName('control.select'), input: { categories: [범주] },
        }]));
      }

      if (규칙 && 배선됨 && !쓴턴.has(이번턴)) {
        쓴턴.add(이번턴);
        고른것.push({ 턴: 이번턴, tool: 규칙.tool });
        return 보내기(200, 응답본문([{
          type: 'tool_use', id: `tu_${고른것.length}`,
          name: wireToolName(규칙.tool), input: 규칙.args(이번턴),
        }]));
      }
      return 보내기(200, 응답본문([{ type: 'text', text: 규칙 ? '처리했어요.' : '무슨 일을 할까요?' }]));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    고른것,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
