import assert from 'node:assert/strict';
import test from 'node:test';

import {
  atomClaimEvidenceJsonSchema, evidenceAtomsFromProjection, materializeAtomClaimEvidence,
} from './helpers/nx-evidence-atom-candidate.js';

const handle = 'source-00000001';
const atoms = evidenceAtomsFromProjection({ handle, kind: 'xlsx', projection: [
  '[sheet:Card Ledger]',
  'A2=Transaction ID', 'A3=C-102', 'D2=Card Amount (KRW)', 'D3=42000',
  '[sheet:Invoice]', 'A1=Transaction reference C-102', 'B1=Total (KRW) 41000',
].join('\n') });
const atomBy = (value) => atoms.find((atom) => Object.is(atom.value, value));

function candidate() {
  return { schema: 't5.atom-claim-evidence.v1', sourceManifestId: 'sources-11111111',
    coverage: { state: 'complete', observedHandles: [handle], unresolvedHandles: [] },
    claims: [{ claimId: 'claim-c102-mismatch', state: 'conflict',
      summary: 'C-102 원장과 세금계산서 금액이 다르다.',
      sourceRefs: [{ handle, location: 'Card Ledger!D3' }, { handle, location: 'Invoice:line:7' }],
      evidenceAtomIds: [atomBy('C-102').atomId, atomBy(42000).atomId, atomBy(41000).atomId],
      calculations: [{ calculationId: 'calc-c102-difference', operator: 'subtract',
        inputRefs: [{ kind: 'atom', refId: atomBy(42000).atomId },
          { kind: 'atom', refId: atomBy(41000).atomId }],
        label: 'C-102 amount difference', unit: 'KRW' }],
    }], excludedFindings: [] };
}

test('Runtime Evidence Atom은 exact source location의 cell·number·ID를 결정적으로 만든다', () => {
  assert.ok(atoms.length >= 7);
  assert.equal(atomBy(42000).location, 'sheet:Card Ledger!D3');
  assert.equal(atomBy(42000).unit, 'KRW');
  assert.equal(atomBy(41000).kind, 'number');
  assert.ok(atoms.some((atom) => atom.value === 'C-102' && atom.kind === 'literal'));
  assert.deepEqual(evidenceAtomsFromProjection({ handle, kind: 'xlsx', projection: [
    '[sheet:Card Ledger]', 'A2=Transaction ID', 'A3=C-102', 'D2=Card Amount (KRW)', 'D3=42000',
    '[sheet:Invoice]', 'A1=Transaction reference C-102', 'B1=Total (KRW) 41000',
  ].join('\n') }), atoms);
  assert.doesNotMatch(JSON.stringify(atoms), /\/Users\/|[A-Za-z]:\\/u);
});

test('모델은 atom ID와 연산만 제출하고 Runtime이 42,000-41,000=1,000을 materialize한다', () => {
  const result = materializeAtomClaimEvidence(candidate(), {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: atoms,
  });
  const values = result.claims[0].evidenceValues;
  assert.ok(values.some((item) => item.value === 42000));
  assert.ok(values.some((item) => item.value === 41000));
  assert.ok(values.some((item) => item.valueId === 'calc-c102-difference'
    && item.value === 1000 && item.unit === 'KRW'));
  assert.equal(result.claims[0].calculation, null);
});

test('모델이 exact spreadsheet row를 sourceRef로 선택하면 Runtime이 빠뜨린 cell atom도 자동 결속한다', () => {
  const value = candidate();
  value.claims[0].sourceRefs = [{ handle, location: 'Card Ledger!A3:D3' },
    { handle, location: 'Invoice!A1:B1' }];
  value.claims[0].evidenceAtomIds = [atomBy('C-102').atomId];
  value.claims[0].calculations = [];
  const result = materializeAtomClaimEvidence(value, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: atoms,
  });
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 42000));
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 41000));
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 1000
    && item.label === 'observed numeric difference candidate'));
});

test('supported 변경 Claim도 같은 단위의 두 숫자에서 bounded 차액 후보를 받는다', () => {
  const feeAtoms = evidenceAtomsFromProjection({ handle, kind: 'pdf', projection: [
    '[page:1]', 'Service fee KRW 4500000', 'Service fee KRW 5100000',
  ].join('\n') });
  const value = candidate(); value.claims[0].state = 'supported';
  value.claims[0].evidenceAtomIds = feeAtoms.filter((atom) => typeof atom.value === 'number')
    .map((atom) => atom.atomId);
  value.claims[0].sourceRefs = [{ handle, location: 'page:1:line:2-page:1:line:3' }];
  value.claims[0].calculations = [];
  const result = materializeAtomClaimEvidence(value, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: feeAtoms,
  });
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 600000
    && item.unit === 'KRW' && item.label === 'observed numeric difference candidate'));
});

test('서로 다른 source의 같은 page·line 위치는 같은 관측으로 오인하지 않는다', () => {
  const otherHandle = 'source-00000002';
  const left = evidenceAtomsFromProjection({ handle, kind: 'pdf', projection: '[page:1]\nService fee KRW 4500000' });
  const right = evidenceAtomsFromProjection({ handle: otherHandle, kind: 'pdf', projection: '[page:1]\nService fee KRW 5100000' });
  const evidenceAtoms = [...left, ...right];
  const input = candidate(); input.coverage.observedHandles = [handle, otherHandle];
  input.claims[0].state = 'supported';
  input.claims[0].sourceRefs = [{ handle, location: 'page:1:line:2' },
    { handle: otherHandle, location: 'page:1:line:2' }];
  input.claims[0].evidenceAtomIds = evidenceAtoms.filter((atom) => typeof atom.value === 'number')
    .map((atom) => atom.atomId);
  input.claims[0].calculations = [];
  const result = materializeAtomClaimEvidence(input, { sourceManifestId: 'sources-11111111',
    exactInputHandles: [handle, otherHandle], evidenceAtoms });
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 600000 && item.unit === 'KRW'));
});

test('넓은 PDF page·OCR 표시는 provenance일 뿐 source 전체 atom을 자동 확장하지 않는다', () => {
  const pdfAtoms = evidenceAtomsFromProjection({ handle, kind: 'pdf', projection: [
    '[page:1]', 'Invoice IV-991 total KRW 3000000', 'Unrelated control PO-2026-099 KRW 720000',
  ].join('\n') });
  const invoice = pdfAtoms.find((atom) => atom.value === 'IV-991');
  const input = candidate();
  input.claims[0].sourceRefs = [{ handle, location: 'page:1' }];
  input.claims[0].evidenceAtomIds = [invoice.atomId];
  input.claims[0].calculations = [];
  const result = materializeAtomClaimEvidence(input, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: pdfAtoms,
  });
  assert.deepEqual(result.claims[0].evidenceValues.map((item) => item.value), ['IV-991']);
});

test('bounded PDF line range는 그 exact line atoms만 자동 결속한다', () => {
  const pdfAtoms = evidenceAtomsFromProjection({ handle, kind: 'pdf', projection: [
    '[page:1]', 'Header control 999', 'Accepted 118 units', 'Amount KRW 2950000', 'Unrelated 720000',
  ].join('\n') });
  const accepted = pdfAtoms.find((atom) => atom.value === 118);
  const input = candidate(); input.claims[0].sourceRefs = [{ handle, location: 'page:1:line:3-page:1:line:4' }];
  input.claims[0].evidenceAtomIds = [accepted.atomId]; input.claims[0].calculations = [];
  const result = materializeAtomClaimEvidence(input, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: pdfAtoms,
  });
  assert.ok(result.claims[0].evidenceValues.some((item) => item.value === 2950000));
  assert.equal(result.claims[0].evidenceValues.some((item) => item.value === 720000), false);
  assert.equal(result.claims[0].evidenceValues.some((item) => item.value === 999), false);
});

test('foreign atom·미래 calculation은 차단하고 중복 atom 참조는 canonical set으로 합친다', () => {
  const foreign = candidate(); foreign.claims[0].evidenceAtomIds[0] = 'atom-ffffffffffffffffffff';
  assert.throws(() => materializeAtomClaimEvidence(foreign, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: atoms,
  }), /unknown Evidence Atom/u);
  const future = candidate(); future.claims[0].calculations[0].inputRefs[0] = {
    kind: 'calculation', refId: 'later-calculation',
  };
  assert.throws(() => materializeAtomClaimEvidence(future, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: atoms,
  }), /calculation inputs are invalid/u);
  const duplicate = candidate(); duplicate.claims[0].evidenceAtomIds.push(duplicate.claims[0].evidenceAtomIds[0]);
  const deduped = materializeAtomClaimEvidence(duplicate, {
    sourceManifestId: 'sources-11111111', exactInputHandles: [handle], evidenceAtoms: atoms,
  });
  assert.equal(new Set(deduped.claims[0].evidenceValues.map((item) => item.valueId)).size,
    deduped.claims[0].evidenceValues.length);
});

test('atom Tool schema에는 모델이 source value나 calculation result를 다시 쓰는 필드가 없다', () => {
  const schema = atomClaimEvidenceJsonSchema({ atomIds: atoms.map((atom) => atom.atomId) }); const claim = schema.properties.claims.items;
  assert.ok(claim.properties.evidenceAtomIds);
  assert.equal(claim.properties.evidenceAtomIds.maxItems, 16);
  assert.deepEqual(claim.properties.evidenceAtomIds.items.enum, atoms.map((atom) => atom.atomId));
  assert.equal('evidenceValues' in claim.properties, false);
  assert.equal('presentationValueIds' in claim.properties, false);
  assert.equal('result' in claim.properties.calculations.items.properties, false);
});
