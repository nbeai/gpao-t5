// 자동성 헌장 계약 (design/T5-AUTONOMY-CHARTER-2026-08-03-ko.md · 오너 승인)
//
// > T5 가 사람에게 멈춰 묻는 경우는 넷뿐이다.
// >   ① 비밀값 입력  ② 되돌릴 수 없는 파괴  ③ 새 상대에게 첫 외부 전송(그 상대에 한 번만)  ④ 돈
// > 그 밖의 모든 것은 자동이다.
//
// 이 파일은 그 문장을 **양방향으로** 잰다 — 넷 밖에서 승인 카드가 뜨면 결함이고,
// 넷 안에서 자동 실행돼도 결함이다. 헌장과 코드가 어긋나면 코드가 결함이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoGrant, grantFor, UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';

// ── 넷 안 — 여기서 자동 실행되면 결함 ─────────────────────────────────
test('헌장 ④ 돈이 나가는 일은 묻는다', () => {
  assert.equal(decideAutoGrant({ kind: 'pay' }), false);
});

test('헌장 ② 백업 없는 삭제는 묻는다 — 되돌릴 수 있으면(휴지통) 자동', () => {
  assert.equal(decideAutoGrant({ kind: 'delete' }), false, '되돌릴 수 있는지 모르는 삭제는 파괴로 본다');
  assert.equal(decideAutoGrant({ kind: 'delete', revocable: false }), false);
  // 휴지통으로 가는 삭제는 파괴가 아니다 — "백업 없는" 이 헌장의 조건이다.
  assert.equal(decideAutoGrant({ kind: 'delete', revocable: true }), true);
});

test('헌장 ② 백업 없는 덮어쓰기는 묻는다 — 원본이 보존되면 자동', () => {
  // T5 파일 손은 덮어쓰기 전에 원본을 휴지통에 남긴다(reversible:true 선언). 그러면 자동이다.
  assert.equal(decideAutoGrant({ kind: 'write', revocable: true }), true);
  // **되돌림은 밝혀야 한다 — 삭제와 같은 기본이다**(정정 2026-08-03).
  // 첫 판은 여기가 `true` 였고 근거는 "쓰기의 기본은 만들기다"였다. 로컬 파일에서는 맞는 말이지만
  // `write` 는 덮어쓰기도 같은 종류로 받고, **원격 손에는 휴지통이 아예 없다** —
  // `http-tool` 은 read 가 아니면 `reversible: undefined` 를 낸다. 그래서 그 판에서는
  // 구글 시트 덮어쓰기 같은 원격 쓰기가 백업도 확인도 없이 돌았다(실측).
  // 이 검사의 제목이 이미 옳은 규칙을 적고 있다 — "백업 없는 덮어쓰기는 묻는다".
  // 손이 되돌림을 선언하지 않았다는 것은 안전하다는 뜻이 아니라 **모른다**는 뜻이다.
  assert.equal(decideAutoGrant({ kind: 'write' }), false, '백업이 있다는 것은 손이 밝혀야 하는 사실이다');
  assert.equal(decideAutoGrant({ kind: 'write', revocable: false }), false, '원본을 잃는 덮어쓰기는 파괴다');
});

test('종류를 스스로 적어 내는 손이 헌장을 지나치지 못한다', () => {
  // 실측 2026-08-03: `isCharterAsk` 가 리터럴 `unknown_kind` 만 미상으로 봐서, 커넥터가
  // `toolKind: 'transfer_money'` 로 선언하면 헌장 ④(돈)를 그대로 통과했다. 같은 변경이
  // http/cli 손의 승인 기본값을 걷어내 이 구멍을 덮던 그물도 함께 사라졌던 자리다.
  for (const kind of ['transfer_money', 'crm_write', 'wire_transfer', 'purge_all']) {
    assert.equal(decideAutoGrant({ kind }), false, `어휘 밖 '${kind}' 가 자동으로 샜다`);
  }
});

test('헌장 ③ 새 상대 첫 전송은 묻고, 아는 상대는 자동', () => {
  assert.equal(decideAutoGrant({ kind: 'send' }), false, '상대를 모르면 첫 전송이다');
  assert.equal(decideAutoGrant({ kind: 'send', counterpartKnown: false }), false);
  assert.equal(decideAutoGrant({ kind: 'send', counterpartKnown: true }), true, '한 번 허락한 상대에는 다시 묻지 않는다');
});

test('비밀은 승인카드가 아니라 보호 차단으로 간다', () => {
  assert.equal(decideAutoGrant({ kind: 'export_sensitive', counterpartKnown: true }), false,
    '비밀 본문은 일반 실행으로 보내지 않는다');
  assert.equal(grantFor({ kind: 'export_sensitive' }).approvalRequired, false);
});

// ── 넷 밖 — 여기서 승인 카드가 뜨면 결함 ──────────────────────────────
test('읽기·조회·정리는 어떤 모드에서도 묻지 않는다', () => {
  for (const kind of ['read', 'summarize', 'search', 'draft', 'organize', 'title', 'archive']) {
    for (const mode of ['manual', 'smart', 'strict']) {
      assert.equal(decideAutoGrant({ kind }, mode), true, `${kind}/${mode} 가 승인을 요구했다`);
    }
  }
});

test('연결 준비는 묻지 않는다 — 사람의 순간은 비밀값 입력면이지 승인 카드가 아니다(헌장 ①)', () => {
  // 팀원 실측(2026-08-03): "새 서비스 붙이기 꼭 확인" 카드가 떴다. 붙일 준비는 아무 것도
  // 바꾸지 않는다 — 비밀값이 필요하면 그 자리에서 입력면이 뜨고, 그게 사람의 관문이다.
  assert.equal(decideAutoGrant({ kind: 'connect_account' }), true);
});

test('자동화 설정과 기억 승격은 묻지 않는다 — 문지기는 사후 교정 표면이다', () => {
  // 오너 기준: 학습·기억은 사후 교정 표면(보고 고치고 지움)으로 권한을 주고 사전 게이트로 주지 않는다.
  assert.equal(decideAutoGrant({ kind: 'automate' }), true);
  assert.equal(decideAutoGrant({ kind: 'promote_memory' }), true);
  assert.equal(decideAutoGrant({ kind: 'access_secret' }), true, '저장된 자격을 쓰는 것은 일상이다 — 내보내기(export_sensitive)만 별개');
});

test('모드는 헌장을 바꾸지 못한다 — strict 도 마찰을 되살리지 못한다', () => {
  // 헌장에는 모드 예외가 없다("그 밖의 모든 것은 자동이다"). 모드가 마찰을 되살릴 수 있으면
  // 그 문이 언젠가 다시 열린다 — 그래서 모드는 아무 것도 바꾸지 않는다.
  for (const mode of ['manual', 'smart', 'strict']) {
    assert.equal(decideAutoGrant({ kind: 'organize' }, mode), true);
    assert.equal(decideAutoGrant({ kind: 'write', revocable: true }, mode), true);
    assert.equal(decideAutoGrant({ kind: 'delete', revocable: true }, mode), true);
  }
});

// ── 경계 유지 — 헌장이 버리지 않은 것 ────────────────────────────────
test('도구의 정적 확인 선언은 헌장 밖 카드를 만들지 못한다', () => {
  assert.equal(decideAutoGrant({ kind: 'read', needsApproval: true }), true);
});

test('모르는 종류는 자동으로 흘리지 않는다 — 분류가 먼저다', () => {
  assert.equal(decideAutoGrant({ kind: UNKNOWN_KIND }), false);
  assert.equal(decideAutoGrant({}), false);
});

test('grantFor: 자동이 된 행동은 granted 로 나오고, 묻는 행동은 미리보기를 가진다', () => {
  const 자동 = grantFor({ kind: 'write', label: '메모 저장', revocable: true });
  assert.equal(자동.approvalRequired, false);
  assert.equal(자동.granted, true);
  const 확인 = grantFor({ kind: 'send', label: '텔레그램 전송', counterpartKnown: false });
  assert.equal(확인.approvalRequired, true);
  assert.ok(확인.approvalPreview, '묻는 카드에는 무엇이 일어나는지가 있다');
});
