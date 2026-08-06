// **그림의 크기만 읽는다** — 알맹이는 안 본다.
//
// 모델이 화면에서 자리를 짚으려면 **그 그림의 자**를 알아야 한다. 창 크기를 주면 밖을 짚는다
// (실측 2026-08-06: 그림 500×768 인데 창 559×859 를 자로 줘서 `y=840` → 창 좌표 939, 밖).
// 그런데 MCP 이미지 조각에는 크기가 없다(키가 `data · mimeType · type` 뿐).
//
// 커널은 그림의 **알맹이를 안 읽는다**(심문 금지 — 그건 모델의 일이다).
// 크기는 알맹이가 아니라 **봉투**다: PNG 는 머리 24바이트, JPEG 는 SOF 마커에 적혀 있다.
// 무엇이 찍혔는지는 여전히 모른다.

/**
 * base64 그림의 가로·세로. 못 읽으면 `null` — **지어내지 않는다.**
 * @param {string} base64
 * @returns {{w:number,h:number}|null}
 */
export function 그림크기재기(base64) {
  // 머리만 보면 되므로 문턱은 낮다 — PNG 는 24바이트, JPEG 는 그보다 짧은 SOF 도 있다.
  if (typeof base64 !== 'string' || base64.length < 12) return null;
  let b;
  // 머리만 있으면 된다 — 통째로 디코드하지 않는다(그림이 수백 KB 다).
  try { b = Buffer.from(base64.slice(0, 4096), 'base64'); } catch { return null; }
  if (b.length < 8) return null;

  // PNG — 시그니처 뒤 IHDR 에 가로·세로가 빅엔디안 4바이트씩.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }

  // JPEG — SOF0~SOF3·SOF5~SOF7·SOF9~SOF11·SOF13~SOF15 마커에 세로·가로 순으로.
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i + 9 <= b.length) {
      if (b[i] !== 0xFF) { i += 1; continue; }
      const 마커 = b[i + 1];
      if (마커 >= 0xC0 && 마커 <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(마커)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      if (마커 === 0xD8 || (마커 >= 0xD0 && 마커 <= 0xD9)) { i += 2; continue; }
      const 길이 = b.readUInt16BE(i + 2);
      if (!(길이 > 0)) return null;
      i += 2 + 길이;
    }
  }
  return null;
}
