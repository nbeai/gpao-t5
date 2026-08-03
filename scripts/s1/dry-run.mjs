// **S1 러너 배선 예행** — `node scripts/s1/dry-run.mjs` · 모델 과금 0
//
// 실모델을 켜기 전에 배선이 실제로 도는지 확인한다. 여기서 잡히는 것들: 격리 HOME 이 정말
// 격리인가 · fixture 437개가 서버가 보는 뿌리에 있는가 · 도청기가 와이어를 바꾸지 않고
// 흘리는가 · 호출표와 실물 대조가 채워지는가 · 회차 정리 후 남는 것이 0인가.
//
// **대본 모델은 판정에 쓰지 않는다.** 여기서 옮겨진 파일 수는 대본이 정한 값이지 모델의
// 능력이 아니다. 이 예행이 답하는 질문은 하나다 — **러너가 사실을 볼 수 있는가.**
import { createServer } from 'node:http';
import { 회차돌리기 } from './run.mjs';

// OpenAI 와이어를 말하는 대본 상류. T5 가 무엇을 골라도 두 걸음만 시킨다.
const 본것 = [];
const 상류 = createServer((req, res) => {
  const 조각 = [];
  req.on('data', (c) => 조각.push(c));
  req.on('end', () => {
    const 보내기 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && req.url.includes('/models')) return 보내기({ data: [{ id: 'gpt-5.1' }] });
    let m = {}; try { m = JSON.parse(Buffer.concat(조각).toString('utf8')); } catch { /* 말로만 답한다 */ }
    본것.push({ 도구수: (m.tools ?? []).length, 강제: m.tool_choice?.function?.name ?? null });
    const 답 = (content, tool_calls) => 보내기({
      choices: [{ message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    // 판정 심문(구조 채널 강제)에는 그 스키마로 답해 준다 — A 팔이 여기서 멈추면 안 된다.
    const 강제 = m.tool_choice?.function?.name;
    if (강제) {
      return 답('', [{ id: 't0', type: 'function', function: {
        name: 강제,
        arguments: JSON.stringify(강제.includes('deliverable') ? { output: 'chat' } : { unclear: false, requestedIndexes: [0] }),
      } }]);
    }
    const 손 = (m.tools ?? []).map((t) => t.function.name);
    const 이미봤나 = JSON.stringify(m.messages ?? []).includes('여기까지가 이름을 실은');
    if (손.includes('local_file') && !이미봤나) {
      return 답('', [{ id: 't1', type: 'function', function: {
        name: 'local_file', arguments: JSON.stringify({ action: 'list', path: 'Downloads' }),
      } }]);
    }
    return 답('폴더를 봤어요. 어떻게 나눌지 알려 주시면 이어서 할게요.');
  });
});
await new Promise((r) => 상류.listen(0, '127.0.0.1', r));
const 상류주소 = `http://127.0.0.1:${상류.address().port}/v1`;

const 잰것 = [];
const 잰다 = (이름, 통과, 근거) => {
  잰것.push({ 이름, 통과, 근거 });
  console.log(`  ${통과 ? '✔' : '✖'} ${이름}\n      ${근거}`);
};

console.log('\nS1 러너 배선 예행 — 모델 과금 0 (대본 상류)\n');
const 팔결과 = {};
try {
  for (const 팔 of ['A', 'B']) {
    console.log(`── 팔 ${팔} ────────────────────────────────`);
    const r = await 회차돌리기({ n: 0, 팔, 연결: { provider: 'openai', modelId: 'gpt-5.1', 자격: 'dry-run', 상류: 상류주소 } });
    팔결과[팔] = r;
    잰다(`${팔}: 서버가 실모델 경로로 실제로 돌았다`, r.모델호출수 > 0, `모델 호출 ${r.모델호출수}회`);
    // 동결 §2.1: 최상위 437 + 하위폴더 파일 23(이 23개는 437에 불포함) = 전수 460.
    잰다(`${팔}: fixture 전수 460개가 서버가 보는 뿌리에 있다(최상위 437 + 하위 23)`,
      r.실물.원본개수 === 460, `원본 ${r.실물.원본개수} · 현재 ${r.실물.현재개수}`);
    잰다(`${팔}: 회차 시작 시점에 남은 상태가 0이다(§3 회차 독립성)`,
      r.시작잔여 === 0, `데이터 자리 항목 ${r.시작잔여}개`);
    잰다(`${팔}: 호출표가 채워지고 첫 전이가 '최초'다(§5.1.1)`,
      r.호출표.length > 0 && r.호출표[0].전이 === '최초',
      `${r.호출표.length}개 — ${r.호출표.map((c) => `${c.tool}/${c.action ?? '-'}:${c.전이}`).join(' → ') || '없음'}`);
    잰다(`${팔}: 사용자 발화가 대화에 중복으로 실리지 않는다(§5.2 과정 ①)`,
      r.발화중복 === 0, `중복 실린 호출 ${r.발화중복}건`);
    잰다(`${팔}: 토큰 사용량이 기록된다(§6 비용)`,
      r.토큰.입력 > 0, `입력 ${r.토큰.입력} · 출력 ${r.토큰.출력}`);
    잰다(`${팔}: 대본이 안 옮겼으므로 실물도 안 옮겨졌다(대조가 지어내지 않는다)`,
      r.실물.이동 === 0 && r.실물.손상 === 0 && r.실물.사라짐 === 0,
      `이동 ${r.실물.이동} · 이동불명 ${r.실물.이동불명} · 손상 ${r.실물.손상} · 사라짐 ${r.실물.사라짐}`);
    console.log(`      (심문 호출 ${r.심문호출}회 · 도구 선택 ${r.호출표.length}회 · ${(r.걸린ms / 1000).toFixed(1)}초)`);
  }

  // ── 여기가 이 예행의 핵심 ────────────────────────────────────────────────
  // 팔이 실제로 갈리는지는 **팔을 나란히 놔야만** 보인다. 첫 판 예행에서 B 가 A 와
  // 똑같이 심문 1회를 돌렸는데, 팔 안쪽만 재는 항목들은 전부 초록이었다.
  console.log('── 두 팔 대조 ────────────────────────────────');
  const { A, B } = 팔결과;
  잰다('A 팔은 심문을 돈다(기준선이다)', A.심문호출 > 0, `A 심문 ${A.심문호출}회`);
  잰다('B 팔은 심문을 돌지 않는다 — 플래그가 서버까지 도달했다',
    B.심문호출 === 0, `B 심문 ${B.심문호출}회 (0이 아니면 플래그가 커널에 안 닿은 것이다)`);
  잰다('A/B 첫 턴 시스템 프롬프트가 글자 단위로 같다(§1.1)',
    A.첫프롬프트지문 === B.첫프롬프트지문, `A ${A.첫프롬프트지문} vs B ${B.첫프롬프트지문}`);
  잰다('A/B 첫 턴 도구 스키마가 같다(§1.1)',
    A.첫스키마지문 === B.첫스키마지문, `A ${A.첫스키마지문} vs B ${B.첫스키마지문}`);
} finally {
  await new Promise((r) => 상류.close(r));
}

const 실패 = 잰것.filter((x) => !x.통과);
console.log('');
if (실패.length) {
  console.error(`S1 DRY-RUN: FAIL (${실패.length}/${잰것.length}) — 실모델을 켜지 않는다`);
  process.exit(1);
}
console.log(`S1 DRY-RUN: PASS (${잰것.length}건 · 실제 서버·파일·표면 응답 · 모델만 대본)`);
