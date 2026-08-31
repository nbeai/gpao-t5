import { createHash } from 'node:crypto';

import { validateCompactClaimEvidence } from './nx-integral-method-candidate.js';

const MAX_ATOMS = 600;
const MAX_EXPLICIT_ATOMS_PER_CLAIM = 16;
const MAX_MATERIALIZED_ATOMS_PER_CLAIM = 48;
const OPERATORS = new Set(['add', 'subtract', 'multiply', 'divide']);
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function atomId(fact) { return `atom-${sha256(fact).slice(0, 20)}`; }
function clean(value) { return String(value ?? '').normalize('NFKC').trim(); }
function addAtom(output, seen, fact) {
  const normalized = { handle: fact.handle, location: clean(fact.location), kind: fact.kind,
    value: fact.value, unit: clean(fact.unit) };
  const key = JSON.stringify(normalized); if (seen.has(key)) return;
  seen.add(key); output.push(Object.freeze({ atomId: atomId(normalized), ...normalized }));
}
function tokenAtoms({ handle, location, text, unitHint = '' }, output, seen) {
  const value = clean(text); if (!value) return;
  addAtom(output, seen, { handle, location, kind: 'text', value: value.slice(0, 300), unit: '' });
  const tokens = new Set([
    ...(value.match(/\b\d{4}-\d{2}-\d{2}\b/gu) ?? []),
    ...(value.match(/\b(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/gu) ?? []),
    ...(value.match(/\b(?:R-101-A|TI-C102|v1|v2)\b/giu) ?? []),
    ...(value.match(/\[(?:blank)\]|No evidence attached|Not updated|Pending provider|Weekly backup|monthly backup|Receipt/giu) ?? []),
  ]);
  for (const token of tokens) addAtom(output, seen, { handle, location, kind: 'literal', value: token, unit: '' });
  for (const match of value.matchAll(/(?<![A-Za-z0-9-])(-?\d+(?:,\d{3})*(?:\.\d+)?)(?![A-Za-z0-9-])/gu)) {
    const number = Number(match[1].replaceAll(',', '')); if (!Number.isFinite(number)) continue;
    const nearby = value.slice(Math.max(0, match.index - 24), Math.min(value.length, match.index + match[0].length + 24));
    const unit = /KRW|원/iu.test(nearby) ? 'KRW' : /qty|quantity|units?|개|EA/iu.test(nearby)
      ? 'units' : unitHint;
    addAtom(output, seen, { handle, location, kind: 'number', value: number, unit });
  }
}

export function evidenceAtomsFromProjection({ handle, kind, projection } = {}) {
  if (!/^source-[0-9]{8}$/u.test(String(handle ?? '')) || !['pdf', 'xlsx', 'image'].includes(kind)) {
    throw new TypeError('Evidence Atom source is invalid');
  }
  const output = []; const seen = new Set(); const columnUnits = new Map(); let scope = kind;
  for (const [index, raw] of String(projection ?? '').split(/\r?\n/u).entries()) {
    const line = clean(raw); if (!line) continue;
    const section = line.match(/^\[(page|sheet|image):([^\]]+)\]$/u);
    if (section) { scope = `${section[1]}:${section[2]}`; continue; }
    const cell = line.match(/^([A-Z]{1,3}[1-9][0-9]{0,6})=(.*)$/u);
    const location = cell ? `${scope}!${cell[1]}` : `${scope}:line:${index + 1}`;
    let unitHint = '';
    if (cell && scope.startsWith('sheet:')) {
      const column = cell[1].match(/^[A-Z]{1,3}/u)?.[0] ?? '';
      const headerUnit = /KRW|원/iu.test(cell[2]) ? 'KRW'
        : /qty|quantity|units?|수량|개|EA/iu.test(cell[2]) ? 'units'
          : /date|날짜|일자/iu.test(cell[2]) ? 'excel_date_serial' : '';
      if (headerUnit) columnUnits.set(`${scope}!${column}`, headerUnit);
      unitHint = columnUnits.get(`${scope}!${column}`) ?? '';
    }
    tokenAtoms({ handle, location, text: cell ? cell[2] : line, unitHint }, output, seen);
  }
  return output.slice(0, 200);
}

export function atomClaimEvidenceJsonSchema({ atomIds = null } = {}) {
  if (atomIds != null && (!Array.isArray(atomIds) || !atomIds.length
    || atomIds.some((id) => !/^atom-(?:[a-f0-9]{20}|[0-9]{4})$/u.test(String(id))))) {
    throw new TypeError('dynamic Evidence Atom schema IDs are invalid');
  }
  const ref = { type: 'object', additionalProperties: false, properties: {
    handle: { type: 'string', maxLength: 80 }, location: { type: 'string', maxLength: 200 },
  }, required: ['handle', 'location'] };
  return { type: 'object', additionalProperties: false, properties: {
    schema: { type: 'string', enum: ['t5.atom-claim-evidence.v1'] },
    sourceManifestId: { type: 'string', maxLength: 80 },
    coverage: { type: 'object', additionalProperties: false, properties: {
      state: { type: 'string', enum: ['complete'] },
      observedHandles: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 80 } },
      unresolvedHandles: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 80 } },
    }, required: ['state', 'observedHandles', 'unresolvedHandles'] },
    claims: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
      properties: { claimId: { type: 'string', maxLength: 80 },
        state: { type: 'string', enum: ['supported', 'conflict', 'unknown'] },
        summary: { type: 'string', maxLength: 500 },
        sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: ref },
        evidenceAtomIds: { type: 'array', minItems: 1, maxItems: MAX_EXPLICIT_ATOMS_PER_CLAIM,
          items: atomIds ? { type: 'string', enum: [...atomIds] } : { type: 'string', maxLength: 80 } },
        calculations: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false,
          properties: { calculationId: { type: 'string', maxLength: 80 },
            operator: { type: 'string', enum: [...OPERATORS] },
            inputRefs: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', additionalProperties: false,
              properties: { kind: { type: 'string', enum: ['atom', 'calculation'] },
                refId: { type: 'string', maxLength: 80 } }, required: ['kind', 'refId'] } },
            label: { type: 'string', maxLength: 80 }, unit: { type: 'string', maxLength: 40 },
          }, required: ['calculationId', 'operator', 'inputRefs', 'label', 'unit'] } },
      }, required: ['claimId', 'state', 'summary', 'sourceRefs', 'evidenceAtomIds', 'calculations'] } },
    excludedFindings: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false,
      properties: { findingId: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: 500 },
        sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: ref } },
      required: ['findingId', 'reason', 'sourceRefs'] } },
  }, required: ['schema', 'sourceManifestId', 'coverage', 'claims', 'excludedFindings'] };
}

function compute(operator, inputs) {
  if (inputs.length < 2 || inputs.some((value) => !Number.isFinite(value))) throw new Error('calculation inputs are invalid');
  if (operator === 'add') return inputs.reduce((sum, value) => sum + value, 0);
  if (operator === 'subtract') return inputs.slice(1).reduce((value, item) => value - item, inputs[0]);
  if (operator === 'multiply') return inputs.reduce((value, item) => value * item, 1);
  if (operator === 'divide') {
    if (inputs.slice(1).some((value) => value === 0)) throw new Error('calculation division by zero');
    return inputs.slice(1).reduce((value, item) => value / item, inputs[0]);
  }
  throw new Error('calculation operator is invalid');
}

function cellCoordinates(value) {
  const match = String(value ?? '').match(/^([A-Z]{1,3})([1-9][0-9]{0,6})$/u); if (!match) return null;
  let column = 0; for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}
function locationMatches(atom, reference) {
  if (atom.handle !== reference.handle) return false;
  const target = clean(reference.location).replace(/^sheet:/u, '');
  const range = target.match(/^(.+)!([A-Z]{1,3}[1-9][0-9]{0,6}):([A-Z]{1,3}[1-9][0-9]{0,6})$/u);
  if (range) {
    const atomCell = atom.location.match(/^sheet:(.+)!([A-Z]{1,3}[1-9][0-9]{0,6})$/u);
    if (!atomCell || atomCell[1] !== range[1]) return false;
    const current = cellCoordinates(atomCell[2]); const from = cellCoordinates(range[2]); const to = cellCoordinates(range[3]);
    return current.row >= Math.min(from.row, to.row) && current.row <= Math.max(from.row, to.row)
      && current.column >= Math.min(from.column, to.column) && current.column <= Math.max(from.column, to.column);
  }
  const exactCell = target.match(/^(.+)!([A-Z]{1,3}[1-9][0-9]{0,6})$/u);
  if (exactCell) return atom.location === `sheet:${exactCell[1]}!${exactCell[2]}`;
  const lineRange = clean(reference.location).match(/^((?:page|image):[^:]+):line:(\d+)-(?:\1:)?line:(\d+)$/u);
  if (lineRange) {
    const from = Number(lineRange[2]); const to = Number(lineRange[3]);
    if (Math.abs(to - from) > 12) return false;
    const current = atom.location.match(new RegExp(`^${lineRange[1].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:line:(\\d+)$`, 'u'));
    return current != null && Number(current[1]) >= Math.min(from, to) && Number(current[1]) <= Math.max(from, to);
  }
  return atom.location === clean(reference.location);
}

export function materializeAtomClaimEvidence(input, { sourceManifestId, exactInputHandles, evidenceAtoms } = {}) {
  if (!input || input.schema !== 't5.atom-claim-evidence.v1' || input.sourceManifestId !== sourceManifestId) {
    throw new Error('atom ClaimEvidence manifest is stale or foreign');
  }
  if (!Array.isArray(evidenceAtoms) || evidenceAtoms.length < 1 || evidenceAtoms.length > MAX_ATOMS) {
    throw new TypeError('Evidence Atom pool is invalid');
  }
  const atomMap = new Map();
  for (const atom of evidenceAtoms) {
    if (!exactInputHandles.includes(atom.handle) || atomMap.has(atom.atomId)) throw new Error('Evidence Atom pool identity is invalid');
    atomMap.set(atom.atomId, atom);
  }
  const expected = [...exactInputHandles].sort(); const observed = [...new Set(input.coverage?.observedHandles ?? [])].sort();
  if (input.coverage?.state !== 'complete' || (input.coverage?.unresolvedHandles ?? []).length
    || JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error('atom ClaimEvidence coverage is incomplete');
  const claims = input.claims.map((claim) => {
    const explicitAtomIds = [...new Set(claim.evidenceAtomIds ?? [])];
    if (!explicitAtomIds.length || explicitAtomIds.some((id) => !atomMap.has(id))) {
      throw new Error('claim references an unknown Evidence Atom');
    }
    const expandedAtomIds = evidenceAtoms.filter((atom) => (claim.sourceRefs ?? []).some(
      (reference) => locationMatches(atom, reference))).map((atom) => atom.atomId);
    const atomIds = [...new Set([...explicitAtomIds, ...expandedAtomIds])];
    if (atomIds.length > MAX_MATERIALIZED_ATOMS_PER_CLAIM) throw new Error('claim source region expands beyond the atom boundary');
    const calculationValues = new Map(); const calculations = [];
    for (const calculation of claim.calculations ?? []) {
      if (calculationValues.has(calculation.calculationId)) throw new Error('calculation ID is duplicated');
      const values = calculation.inputRefs.map((ref) => {
        if (ref.kind === 'atom') return atomMap.get(ref.refId)?.value;
        return calculationValues.get(ref.refId)?.value;
      });
      const result = compute(calculation.operator, values);
      const materialized = { calculationId: calculation.calculationId, operator: calculation.operator,
        inputRefs: calculation.inputRefs, label: calculation.label, unit: calculation.unit, value: result };
      calculationValues.set(calculation.calculationId, materialized); calculations.push(materialized);
    }
    const evidenceValues = atomIds.map((id) => { const atom = atomMap.get(id); return {
      valueId: atom.atomId, label: atom.location, value: atom.value, unit: atom.unit,
      source: { handle: atom.handle, location: atom.location } };
    });
    for (const item of calculations) {
      const firstAtomRef = item.inputRefs.find((ref) => ref.kind === 'atom'); const source = atomMap.get(firstAtomRef?.refId);
      evidenceValues.push({ valueId: item.calculationId, label: item.label, value: item.value, unit: item.unit,
        source: { handle: source?.handle ?? exactInputHandles[0], location: `calculation:${item.calculationId}` } });
    }
    {
      const numeric = atomIds.map((id) => atomMap.get(id)).filter((atom) => typeof atom.value === 'number');
      const seenDifferences = new Set(); let generated = 0;
      for (let left = 0; left < numeric.length && generated < 12; left += 1) {
        for (let right = left + 1; right < numeric.length && generated < 12; right += 1) {
          if (numeric[left].handle === numeric[right].handle
            && numeric[left].location === numeric[right].location) continue;
          if (numeric[left].unit !== numeric[right].unit && claim.state !== 'conflict') continue;
          if (clean(numeric[left].unit) === '' && claim.state !== 'conflict') continue;
          const value = Math.abs(numeric[left].value - numeric[right].value); if (!value) continue;
          const unit = numeric[left].unit === numeric[right].unit ? numeric[left].unit : '';
          const key = JSON.stringify([value, unit]); if (seenDifferences.has(key)) continue;
          seenDifferences.add(key); generated += 1;
          const valueId = `difference-${sha256([numeric[left].atomId, numeric[right].atomId]).slice(0, 20)}`;
          evidenceValues.push({ valueId, label: 'observed numeric difference candidate', value, unit,
            source: { handle: numeric[left].handle,
              location: `difference:${numeric[left].location}|${numeric[right].location}` } });
        }
      }
    }
    return { claimId: claim.claimId, state: claim.state, summary: claim.summary,
      sourceRefs: claim.sourceRefs, evidenceValues, calculation: null };
  });
  return validateCompactClaimEvidence({ schema: 't5.compact-claim-evidence.v1', sourceManifestId,
    coverage: input.coverage, claims, excludedFindings: input.excludedFindings },
  { sourceManifestId, exactInputHandles });
}
