import { createHash } from 'node:crypto';

export const TEXT_TABULAR_TURNS = Object.freeze([
  {
    id: 'inspect-encoded-files',
    prompt: () => '첨부한 세 파일을 각각 실제로 읽어줘. 고객별 금액과 합계를 정리하고, 근무 메모에서 확정할 수 있는 시간과 아직 확인이 필요한 것을 파일별 출처와 함께 구분해줘.',
  },
  {
    id: 'reconcile-exact-result',
    prompt: () => '결론부터 짧게 다시 정리해줘. 한빛상회·새봄상사 금액과 전체 합계, 근무시간 메모의 확정값과 미확인 이유를 숫자로 써줘. 인코딩 때문에 읽지 못한 파일이 있었다면 성공한 척하지 마.',
  },
]);

export const TEXT_TABULAR_CASUAL_TURNS = Object.freeze([
  {
    id: 'inspect-encoded-files',
    prompt: () => '예전에 저장한 파일들이라 글자가 깨질 수도 있어. 세 첨부를 직접 보고 거래처별 금액을 더해주고, 근무 메모는 확실한 것과 애매한 것을 나눠줘. 어느 파일에서 봤는지도 알려줘.',
  },
  {
    id: 'reconcile-exact-result',
    prompt: () => '내가 바로 확인할 수 있게 한빛상회, 새봄상사, 둘의 합계와 근무시간에서 아직 못 정하는 부분만 숫자 중심으로 마무리해줘.',
  },
]);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function createTextTabularFixtureBytes() {
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('8월 3일: 총 4.5시간, 휴게 포함 여부 미기재\n', 'utf16le'),
  ]);
  const cp949 = Buffer.from('b0edb0b42cb1ddbed70ac7d1bafbbbf3c8b82c34303330300a', 'hex');
  const utf8 = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('고객,메모,금액\r\n새봄상사,"정산, 확인",25000\r\n'),
  ]);
  return [
    { key: 'work-note', fileName: '근무_메모_UTF16.txt', mimeType: 'text/plain', bytes: utf16, sha256: sha256(utf16) },
    { key: 'hanbit', fileName: '한빛상회_CP949.csv', mimeType: 'text/csv', bytes: cp949, sha256: sha256(cp949) },
    { key: 'saebom', fileName: '새봄상사_UTF8_BOM.csv', mimeType: 'text/csv', bytes: utf8, sha256: sha256(utf8) },
  ];
}

function receipts(turns) { return turns.flatMap((turn) => turn.receipts ?? []); }

export function assessTextTabularQualification({ turns = [], inputRecords = [] } = {}) {
  const allReceipts = receipts(turns); const attachmentObservations = allReceipts.filter((receipt) => (
    receipt.requestedCall?.name === 'attachment' && receipt.requestedCall?.args?.action === 'inspect'
      && receipt.outcome === 'succeeded'
  )).map((receipt) => receipt.result?.observation).filter(Boolean);
  const final = turns.find((turn) => turn.id === 'reconcile-exact-result')?.answer ?? '';
  const first = turns.find((turn) => turn.id === 'inspect-encoded-files')?.answer ?? '';
  const byEncoding = new Map(attachmentObservations.map((observation) => [observation.encoding, observation]));
  const cp949 = byEncoding.get('windows-949-compatible');
  const utf16 = byEncoding.get('utf-16le');
  const utf8 = byEncoding.get('utf-8');
  const checks = {
    allTurnsAnswered: turns.length === 2 && turns.every((turn) => turn.runStatus === 'completed' && String(turn.answer ?? '').trim()),
    allInputsPreserved: inputRecords.length === 3 && inputRecords.every((record) => record.sha256 === record.afterSha256),
    utf16ActuallyRead: utf16?.kind === 'text' && /4\.5시간/u.test(utf16.text ?? ''),
    cp949ActuallyRead: cp949?.kind === 'tabular_text' && cp949.table?.rows?.some((row) => row[0] === '한빛상회' && row[1] === '40300'),
    utf8CsvActuallyRead: utf8?.kind === 'tabular_text' && utf8.table?.rows?.some((row) => row[0] === '새봄상사' && row[2] === '25000'),
    legacyEncodingHonest: cp949?.encodingEvidence?.ambiguous === true
      && cp949.encodingEvidence.candidates?.join(',') === 'cp949,euc-kr',
    exactCustomerAmounts: /한빛상회[\s\S]*40,?300/u.test(`${first}\n${final}`)
      && /새봄상사[\s\S]*25,?000/u.test(`${first}\n${final}`),
    exactCombinedTotal: /65,?300/u.test(final),
    unknownBreakPreserved: /4\.5|4시간\s*30분/u.test(final)
      && /(?:휴게[\s\S]*(?:미기재|미확인|미확정|확인.*필요|알 수 없)|미확정[\s\S]*휴게)/u.test(final),
    sourceSeparated: /CP949|한빛상회_CP949|한빛상회/u.test(first)
      && /UTF8|새봄상사_UTF8|새봄상사/u.test(first) && /UTF16|근무_메모/u.test(first),
    boundedToolUse: allReceipts.length > 0 && allReceipts.length <= 12,
  };
  return { checks, toolCalls: allReceipts.length, passed: Object.values(checks).every(Boolean) };
}
