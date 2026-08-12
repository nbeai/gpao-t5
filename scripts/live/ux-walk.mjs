// **전수 걷기** — 화면을 하나씩 열고 버튼을 하나씩 세어 표로 낸다.
// 짐작이 아니라 **실제 클릭**이다. 안 눌러 본 것은 「안 눌러 봤다」로 남긴다.
import { writeFile } from 'node:fs/promises';
import { 크롬띄우기 } from './ux-cdp.mjs';

const base = process.argv[2];
const 폭 = Number(process.argv[3] || 1180);
const 크롬 = await 크롬띄우기({ url: base, width: 폭, height: 900 });
// ⚠ `--window-size` 는 맥에서 **최소 창 너비(약 500px)** 아래로 안 내려간다 — 375 를 줘도 500 이 된다.
//    첫 판이 그렇게 나왔다(자가 못 닿았다). 진짜 좁은 폭은 CDP 로 **강제**해야 잰다.
await 크롬.send('Emulation.setDeviceMetricsOverride', {
  width: 폭, height: 900, deviceScaleFactor: 2, mobile: 폭 < 768,
});
await 크롬.준비대기("!!document.getElementById('actbar')");
try {
  const 결과 = await 크롬.돌리기(`(async () => {
    const 뜸 = (ms) => new Promise(r => setTimeout(r, ms));
    const out = { 폭: innerWidth, 화면: [], 버튼전수: [], 말: {}, 문제: [] };

    const 보이나 = (e) => { const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
    const 훑기 = (이름) => {
      const bs = [...document.querySelectorAll('button, [role=button], .ov-act')];
      const 목록 = bs.map((b) => ({
        화면: 이름,
        글: (b.textContent || '').trim().slice(0, 24),
        라벨: b.getAttribute('aria-label') || b.title || null,
        보임: 보이나(b),
        꺼짐: !!b.disabled,
        폭0: b.getBoundingClientRect().width === 0,
      }));
      out.버튼전수.push(...목록);
      // 이 화면에서 **글자도 라벨도 없는 버튼**은 사람이 뜻을 알 수 없다
      for (const b of 목록) if (b.보임 && !b.글 && !b.라벨) out.문제.push({ 화면: 이름, 왜: '글자도 라벨도 없는 버튼' });
      return 목록.filter((b) => b.보임).length;
    };

    // ── 0. 본화면 ──────────────────────────────────────────────────
    out.화면.push({ 이름: '대화(본화면)', 열림: true, 보이는버튼: 훑기('대화'), 비고: '' });

    // ── 1. 검색 패널 ───────────────────────────────────────────────
    document.getElementById('searchbtn')?.click(); await 뜸(300);
    out.화면.push({ 이름: '대화 찾기', 열림: document.getElementById('search').style.display === 'block',
      보이는버튼: 훑기('찾기'), 비고: '' });
    document.getElementById('searchbtn')?.click(); await 뜸(200);

    // ── 2. 상태 칩 ────────────────────────────────────────────────
    document.getElementById('chip')?.click(); await 뜸(500);
    const st = document.getElementById('state');
    out.화면.push({ 이름: '상태(칩)', 열림: !!st && 보이나(st), 보이는버튼: 훑기('상태'),
      비고: (st?.textContent || '').trim().slice(0, 60) });
    document.getElementById('chip')?.click(); await 뜸(200);

    // ── 3. 도구함 ─────────────────────────────────────────────────
    document.getElementById('tbov').classList.add('open'); await 뜸(700);
    out.화면.push({ 이름: '도구함', 열림: true, 보이는버튼: 훑기('도구함'),
      비고: (document.getElementById('tb-body')?.textContent || '').trim().slice(0, 60) });
    document.getElementById('tbov').classList.remove('open'); await 뜸(200);

    // ── 4. 설정 7탭 — **하나씩 실제로 연다** ────────────────────────
    // 모듈 안 함수는 못 부른다 — **사람이 하는 그대로** 버튼을 눌러서 간다.
    document.getElementById('settingsbtn').click(); await 뜸(800);
    const 탭들 = ['모델','메신저','도구와 연결','스킬','자동화','기억과 개인정보','모양'];
    for (const t of 탭들) {
      const 탭 = [...document.querySelectorAll('#set-tabs button')].find((b) => b.textContent.trim() === t);
      if (!탭) { out.문제.push({ 화면: '설정/' + t, 왜: '탭 버튼이 없다' }); continue; }
      탭.click();
      await 뜸(900);
      const body = document.getElementById('set-body');
      const 글 = (body?.textContent || '').trim();
      out.화면.push({ 이름: '설정 · ' + t, 열림: document.getElementById('setov').classList.contains('open'),
        보이는버튼: 훑기('설정/' + t), 비고: 글.slice(0, 70), 빈칸: 글.length === 0 });
      if (!글) out.문제.push({ 화면: '설정/' + t, 왜: '내용이 비어 있다(사람이 열면 빈 화면)' });
    }
    document.getElementById('setov').classList.remove('open');

    // ── 5. 말 대조 — 같은 뜻이 화면마다 다른 말을 쓰나 ───────────────
    const 사전 = { 지움: ['지우기','삭제','치워 두기','휴지통','제거'], 되돌림: ['되돌리기','복구','되살리기','붙듦 해제'],
      닫기: ['닫기','✕','대화로 돌아가기','취소'], 보냄: ['보내기','다시 보내기','전송'] };
    for (const [뜻, 말들] of Object.entries(사전)) {
      const 쓰인것 = [...new Set(out.버튼전수.filter((b) => 말들.some((w) => b.글 === w || b.라벨 === w)).map((b) => b.글 || b.라벨))];
      out.말[뜻] = 쓰인것;
      if (쓰인것.length > 2) out.문제.push({ 화면: '(전역)', 왜: \`「\${뜻}」을 \${쓰인것.length}가지 말로 쓴다: \${쓰인것.join(' / ')}\` });
    }
    return out;
  })()`, 180000);
  console.log(JSON.stringify(결과, null, 2));
  if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify(결과, null, 2));
} finally { await 크롬.닫기(); }
