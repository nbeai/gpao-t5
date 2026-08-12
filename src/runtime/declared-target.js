// L3 · 런타임 선언 주소 경계.
//
// 소스에 적힌 커넥터는 우리가 읽고 넣은 주소다. 런타임 선언은 다르다 — **모델이 만든 주소**가
// 그대로 T5 의 손이 된다. 그래서 여기서 한 번 자른다.
//
// 막는 것은 "바깥으로 나가는 척하며 안을 두드리는 것"이다:
//   · https 가 아닌 것 (평문으로 비밀값이 나간다)
//   · 루프백·사설망·링크로컬 (이 컴퓨터와 집 안 장비. 클라우드 메타데이터도 여기 걸린다)
//   · 자격 심는 주소 (user:pass@host)
//
// 이건 사용자 능력을 줄이는 게 아니다. 사용자가 부른 서비스는 전부 바깥에 있다 —
// 안쪽 주소가 필요한 일은 애초에 이 길로 오지 않는다(로컬 손이 따로 있다).

const 사설 = [
  /^10\./, /^127\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // 링크로컬 — 클라우드 메타데이터(169.254.169.254)가 여기다
];

/** 호스트가 이 컴퓨터·집 안 장비인가. 이름으로도 IP 로도 본다. */
function 안쪽인가(hostname) {
  const h = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  return 사설.some((re) => re.test(h));
}

/**
 * 런타임에 선언된 주소를 받아도 되는가.
 * @param {string} url
 * @returns {{ok:true, url:URL}|{ok:false, why:string}}
 */
export function checkDeclaredTarget(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return { ok: false, why: '주소 형식이 아니에요' }; }
  if (u.protocol !== 'https:') return { ok: false, why: '암호화된 주소(https)만 쓸 수 있어요 — 비밀값이 그대로 나가면 안 돼요' };
  if (u.username || u.password) return { ok: false, why: '주소 안에 아이디·비밀번호를 담은 형식은 쓰지 않아요' };
  if (안쪽인가(u.hostname)) return { ok: false, why: '이 컴퓨터나 집 안 장비를 가리키는 주소예요 — 바깥 서비스만 이 길로 붙여요' };
  return { ok: true, url: u };
}

/**
 * 선언 하나에 들어 있는 모든 주소를 검사한다. 하나라도 걸리면 그 선언은 안 받는다
 * (확인용 주소만 바깥이고 실제 호출은 안쪽인 선언을 막는다).
 * @param {object} decl
 * @returns {{ok:true}|{ok:false, why:string, where:string}}
 */
export function checkDeclaredUrls(decl = {}) {
  const 주소들 = [
    ['확인 주소', decl.verify?.url],
    ...(decl.tools ?? []).map((t, i) => [`${t?.label ?? t?.name ?? `${i + 1}번 기능`}`, t?.request?.url]),
  ].filter(([, u]) => u != null);
  if (!주소들.length) return { ok: false, why: '어디로 연결하는지가 없어요', where: '주소' };
  for (const [where, u] of 주소들) {
    const r = checkDeclaredTarget(u);
    if (!r.ok) return { ok: false, why: r.why, where };
  }
  return { ok: true };
}
