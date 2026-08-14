// 맨몸판 — 커널 겹을 다 뺀 「기본 다섯 줄」 대조군.
//
// 목적: 네 번 실패한 자리에서 가설을 또 고르지 않고, 양 끝을 잡는다.
//   팔 A  터미널 하나 · 중립 선언          ← 부품(모델+터미널)의 무죄/유죄가 여기서 갈린다
//   팔 B  T5 의 두 손 경쟁 재현            ← 파일 손(안전해 보임) + 터미널(HEAD 시점 선언 원문)
//   팔 C  B + applied:false               ← 성공한 읽기에도 「안 돌았다」 꼬리표 (local-terminal.js:217 재현)
//
// 같은 격리 방(진짜 문서) · 같은 모델 · 같은 발화. 커널·원장·분류·답교체 전부 없다.
// 판정은 터미널 호출 수와 답의 정확성(진값은 wc -l 로 직접 센다)으로 한다.
//
// 이 파일은 측정기다 — 제품 코드를 하나도 물지 않는다(자격 문 하나만 빌린다).
import { mkdtemp, mkdir, cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { 저장된연결 } from '/Users/jyp/Developer/t5-p-op/scripts/s1/run.mjs';

const 실행 = promisify(execFile);
const REPO = '/Users/jyp/Developer/t5-p-op';

// ── 발화: 오너가 클로드코드에게 하는 말 그대로 (기준선 §0 과 동일) ─────────────────
const 발화들 = [
  '작업 폴더에 뭐가 들어있는지 좀 봐줘',
  '그 중에 제일 긴 문서가 뭐야?',
];

// ── HEAD 시점 T5 선언 원문 (팔 B·C 용 · demo-context.js 59d68451 에서 옮김) ──────────
// 동료 세션이 지금 이 문구를 고치는 중이다(F-116). 여기는 「고치기 전」을 동결해 재현한다.
const T5_터미널_선언 = '이 컴퓨터에서 명령을 직접 실행한다. 위치를 모르면 직접 찾는다. 확인·검사·테스트·빌드는 바로 하고,'
  + ' **여러 파일을 한꺼번에 다루는 일도 명령 하나로 끝난다**(수백 개를 옮기거나 고르는 일에 파일 도구를 여러 번 부를 필요가 없다).'
  + ' 파일을 바꾸거나 인터넷에 연결하는 명령은 그냥 실행하면 된다 —'
  + ' 실행 직전에 확인 카드가 한 번 뜨고, 승인되면 네가 이어서 실행한다 — 사용자에게 명령어를 적어 주지 않는다.'
  + ' 그러니 사용자에게 명령어를 보여주며 대신 치라고 하지 않는다. 비밀 자리는 승인해도 읽지 않는다.'
  + ' (되돌릴 수 없음)';
const T5_파일_선언 = '파일을 찾고 읽고 쓴다. 읽기는 이 컴퓨터의 홈 전체에서 된다.'
  + ' 지우거나 덮어쓴 것은 되돌릴 수 있다. (되돌릴 수 있음)';

// ── 격리 방: 그냥써본다.mjs 와 같은 재료 ─────────────────────────────────────────
async function 방만들기() {
  const root = await mkdtemp(join(tmpdir(), 't5-맨몸-'));
  const home = join(root, 'home');
  const work = join(home, '작업');
  await mkdir(work, { recursive: true });
  await cp(join(REPO, 'docs/00-START-HERE'), join(work, '시작문서'), { recursive: true });
  await cp(join(REPO, 'README.md'), join(work, 'README.md'));
  await cp(join(REPO, 'AGENTS.md'), join(work, 'AGENTS.md'));
  return { root, home, work };
}

// ── 진값: 사람이 판정할 때 쓸 정답을 직접 센다 ───────────────────────────────────
async function 진값(work) {
  const { stdout } = await 실행('/bin/zsh', ['-c',
    `find . -type f \\( -name '*.md' -o -name '*.txt' \\) -exec wc -l {} + | sort -rn | head -5`,
  ], { cwd: work });
  return stdout.trim();
}

// ── 터미널: 실제로 돌린다. 격리 방 밖을 지우는 명령만 막는다(측정기 자체의 안전벨트) ──
function 위험한가(command, root) {
  const 파괴 = /(^|[;&|]\s*)(rm|rmdir|mv|shred)\b/.test(command);
  if (!파괴) return false;
  const 절대경로 = command.match(/(?<![\w.])\/[\w./~-]+/g) ?? [];
  return 절대경로.some((p) => !resolve(p).startsWith(root));
}
async function 터미널실행(command, { home, work, root }) {
  if (위험한가(command, root)) {
    return { exitCode: 126, stdout: '', stderr: '맨몸판 안전벨트: 격리 방 밖을 지우는 명령은 측정에서 제외한다.' };
  }
  try {
    const { stdout, stderr } = await 실행('/bin/zsh', ['-c', command], {
      cwd: work, timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, HOME: home },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message ?? e) };
  }
}

// ── 파일 손(팔 B·C): T5 local.file 의 최소 재현 — 목록·읽기만 ─────────────────────
async function 파일실행(args, { work }) {
  const p = resolve(work, String(args.path ?? '.'));
  if (!p.startsWith(work)) return { error: '작업 폴더 밖이다' };
  try {
    if (args.action === 'list') {
      const names = await readdir(p, { withFileTypes: true });
      const rows = await Promise.all(names.map(async (d) => {
        const s = await stat(join(p, d.name)).catch(() => null);
        return `${d.isDirectory() ? 'dir ' : 'file'}  ${d.name}${s && !d.isDirectory() ? `  (${s.size}B)` : ''}`;
      }));
      return { entries: rows };
    }
    const text = await readFile(p, 'utf8');
    return { text: text.length > 6000 ? `${text.slice(0, 6000)}\n…(잘림 · 전체 ${text.length}자)` : text };
  } catch (e) { return { error: String(e.message ?? e) }; }
}

const 자르기 = (s, n = 8000) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}\n…(잘림 · 전체 ${s.length}자)` : s);

// ── 팔 정의 ───────────────────────────────────────────────────────────────────
function 팔정의(방) {
  const terminal중립 = {
    name: 'terminal',
    description: '이 컴퓨터에서 셸 명령을 실행한다. stdout·stderr·exitCode 가 원문 그대로 돌아온다.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  };
  const terminalT5 = { ...terminal중립, description: T5_터미널_선언 };
  const file = {
    name: 'file',
    description: T5_파일_선언,
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['list', 'read'] }, path: { type: 'string' } },
      required: ['action', 'path'],
    },
  };
  const 시스템 = (도구말) => `너는 이 컴퓨터에서 사용자를 돕는 조수다. 사용자의 작업 폴더는 ${방.work} 다. ${도구말}`;
  return {
    A: { 이름: 'A-맨몸', 도구: [terminal중립], system: 시스템('터미널을 쓸 수 있다.'), applied꼬리표: false },
    B: { 이름: 'B-T5선언재현', 도구: [file, terminalT5], system: 시스템('파일 도구와 터미널을 쓸 수 있다.'), applied꼬리표: false },
    C: { 이름: 'C-B+applied:false', 도구: [file, terminalT5], system: 시스템('파일 도구와 터미널을 쓸 수 있다.'), applied꼬리표: true },
    // D: B 에서 딱 한 변수만 되돌린다 — 터미널 선언을 중립으로. 파일 손 경쟁은 그대로.
    //    D 에서 터미널이 살아나면 범인은 「선언 문구」, 그대로 죽어 있으면 「경쟁 자체」다.
    D: { 이름: 'D-경쟁+중립선언', 도구: [file, terminal중립], system: 시스템('파일 도구와 터미널을 쓸 수 있다.'), applied꼬리표: false },
    // E: D 에서 파일 손 선언에만 **빠진 사실(한계)** 을 채운다 — 강제가 아니라 유도.
    //    행동은 D 와 동일하고 문구 하나만 다르다. E 에서 터미널이 살아나면
    //    제품 수리는 「파일 손 선언이 자기 한계를 말하게 하는 것」으로 확정된다.
    E: {
      이름: 'E-파일손이-한계를-말함',
      도구: [{
        ...file,
        description: '파일 하나를 열어 읽거나 쓴다. 목록을 보면 이름과 크기를 안다.'
          + ' 여러 파일을 한꺼번에 세거나 줄 수를 재거나 내용을 훑는 일은 이 손으로 하나씩 하면 오래 걸린다 —'
          + ' 그런 일은 터미널이 명령 하나로 끝낸다. 지우거나 덮어쓴 것은 되돌릴 수 있다.',
      }, terminal중립],
      system: 시스템('파일 도구와 터미널을 쓸 수 있다.'),
      applied꼬리표: false,
    },
  };
}

// ── 기본 다섯 줄 루프: 모델이 고르고 → 그대로 실행 → 원문 반환 → 반복 ─────────────
async function 회차(팔, 방, 연결) {
  const messages = [{ role: 'system', content: 팔.system }];
  const 기록 = { 팔: 팔.이름, 턴: [], 터미널호출: 0, 파일호출: 0 };
  for (const text of 발화들) {
    messages.push({ role: 'user', content: text });
    const 턴 = { 오너: text, 호출: [], 답: null };
    const t0 = Date.now();
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${(연결.상류 ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${연결.자격}` },
        body: JSON.stringify({
          model: 연결.modelId, max_completion_tokens: 4000,
          tools: 팔.도구.map((t) => ({ type: 'function', function: t })),
          messages,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`모델 호출 실패 ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      const msg = json.choices?.[0]?.message ?? {};
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) { 턴.답 = msg.content ?? ''; break; }
      for (const c of calls) {
        const args = JSON.parse(c.function.arguments || '{}');
        let 결과;
        if (c.function.name === 'terminal') {
          기록.터미널호출 += 1;
          const r = await 터미널실행(String(args.command ?? ''), 방);
          결과 = { exitCode: r.exitCode, stdout: 자르기(r.stdout), stderr: 자르기(r.stderr) };
          if (팔.applied꼬리표) 결과.applied = false;   // C: 성공해도 「안 돌았다」 꼬리표
          턴.호출.push({ 손: 'terminal', command: args.command, exitCode: r.exitCode });
        } else {
          기록.파일호출 += 1;
          결과 = await 파일실행(args, 방);
          if (팔.applied꼬리표) 결과.applied = true;    // C: 파일 손만 「돌았다」로 보인다
          턴.호출.push({ 손: 'file', args });
        }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(결과) });
      }
    }
    턴.걸린ms = Date.now() - t0;
    기록.턴.push(턴);
  }
  return 기록;
}

// ── 본판 ─────────────────────────────────────────────────────────────────────
const 고른팔 = process.argv.slice(2).filter((a) => ['A', 'B', 'C', 'D', 'E'].includes(a));
const 돌릴팔 = 고른팔.length ? 고른팔 : ['A', 'B', 'C', 'D', 'E'];
const 연결 = 저장된연결(homedir());
if (!연결?.자격) { console.error('저장된 모델 연결이 없다'); process.exit(2); }
const modelId = process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1';

const 증거 = { 시각: new Date().toISOString(), 모델: `${연결.provider}/${modelId}`, 발화들, 팔결과: [] };
for (const 키 of 돌릴팔) {
  const 방 = await 방만들기();                     // 팔마다 새 방 — 서로 오염 금지
  const 팔 = 팔정의(방)[키];
  console.log(`\n══ 팔 ${팔.이름} · 방 ${방.root} ═══════════════════════════`);
  const 정답 = await 진값(방.work);
  const r = await 회차(팔, 방, { ...연결, modelId });
  r.진값_wc상위5 = 정답;
  증거.팔결과.push(r);
  for (const 턴 of r.턴) {
    console.log(`\n[오너] ${턴.오너}   (${(턴.걸린ms / 1000).toFixed(1)}초)`);
    for (const h of 턴.호출) console.log(`  · ${h.손}: ${h.command ?? JSON.stringify(h.args)}${h.exitCode !== undefined ? ` → exit ${h.exitCode}` : ''}`);
    console.log(`[답] ${(턴.답 ?? '(없음)').slice(0, 600)}`);
  }
  console.log(`\n  터미널 ${r.터미널호출}회 · 파일 ${r.파일호출}회`);
  console.log(`  진값(wc -l 상위):\n${정답.split('\n').map((l) => `    ${l}`).join('\n')}`);
}

const out = join(REPO, 'docs/03-verification/evidence/terminal-2026-08-15',
  `맨몸대조군-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(out, JSON.stringify(증거, null, 2));
console.log(`\n증거: ${out}`);
