// L3 · API 키 연결 실행기 (P5-B-1B, 연결 방식 kind: api_key)
//
// **채팅창으로 키를 받으면 실패다.** 오너 기준(2026-07-27):
//   "사람을 개발자로 만들지 않는다는 건, 비밀값까지 대화창에 던지게 하지 않는다는 뜻이기도 해."
//
// 그래서 비밀값은 **턴을 통과하지 않는다.** 대화 턴은 "입력창을 열어야 한다"는 요청만 만들고,
// 값은 브라우저 → 전용 통로 → 0600 저장소로 곧장 간다. 커널도 모델도 그 값을 본 적이 없다.
// 마스킹으로 가리는 것은 "안 남는 것"이 아니라 "안 보이게 한 것"이라 언젠가 샌다 —
// 원장에는 마스킹조차 남기지 않는다(오너 결정).
//
// **서비스를 모른다.** 어떤 값이 필요한지도, 그 값이 맞는지 확인하는 방법도 커넥터가 선언한다.
// 여기는 선언을 실행할 뿐이다(previewOf·subjectOf·localSigns 와 같은 계약 패턴).

/** 선언한 자리에 저장된 값을 끼운다. `{client_id}` 처럼 쓴다. */
function 채우기(틀, 값들) {
  if (typeof 틀 !== 'string') return 틀;
  return 틀.replace(/\{(\w+)\}/g, (m, k) => (k in 값들 ? String(값들[k]) : m));
}

/** 사용자에게 무엇을 물어야 하는가. **값은 절대 담지 않는다** — 화면을 그리는 데 필요한 것만. */
export function secretFields(method = {}) {
  return (method.fields ?? []).map((f) => ({
    name: f.name,
    label: f.label ?? f.name,
    secret: f.secret !== false, // 기본은 가린다 — 드러내는 쪽이 의식적 선택이어야 한다
    hint: f.hint,
  }));
}

/** 선언된 값이 다 찼는가. 안 찼으면 무엇이 비었는지만 돌려준다(값은 보지 않는다). */
export function missingFields(method, 저장값 = {}) {
  return secretFields(method).filter((f) => !String(저장값[f.name] ?? '').trim()).map((f) => f.name);
}

/**
 * **저장했다고 연결이 아니다.** 커넥터가 선언한 방법으로 T5 가 직접 한 번 불러 본다.
 * 실패해도 값을 되읽어 주지 않는다 — 이유만 사람 말로.
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function verifyApiKey(method, 값들, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const v = method?.verify;
  if (!v?.url) return { ok: true }; // 확인 방법을 선언하지 않았으면 확인할 것이 없다(거짓 성공 아님)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  let res;
  try {
    res = await fetchImpl(채우기(v.url, 값들), {
      method: v.method ?? 'GET',
      signal: ac.signal,
      headers: Object.fromEntries(Object.entries(v.headers ?? {}).map(([k, x]) => [k, 채우기(x, 값들)])),
      ...(v.body ? { body: 채우기(v.body, 값들) } : {}),
    });
  } catch {
    // 네트워크 실패와 키 오류를 섞지 않는다 — 사용자가 키를 의심하며 헤매게 된다.
    return { ok: false, reason: '확인하러 갔는데 서비스에 닿지 못했어요. 잠시 뒤 다시 해볼게요.' };
  } finally { clearTimeout(timer); }

  const 기대 = v.okWhen?.status ?? 200;
  if (res.status === 기대) return { ok: true };
  // **응답 본문을 그대로 옮기지 않는다** — 키가 되비쳐 오는 서비스가 있다.
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: '입력하신 값으로는 접근이 거절됐어요. 값이 다르거나 권한이 모자란 것 같아요.' };
  }
  return { ok: false, reason: `서비스가 지금 이 요청을 받지 못했어요(${res.status}).` };
}
