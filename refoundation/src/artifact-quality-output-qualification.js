import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import { unzipSync } from 'fflate';

import { makeArtifactQualityQualifier } from './artifact-quality-qualification.js';
import { renderAttachmentPreview } from './artifact-preview.js';
import { inspectBusinessDocument } from './document-data-inspector.js';
import {
  detectQualifiedDocumentFormat, inspectQualifiedDocument,
} from './qualified-document-parser.js';

const CONTRACT_SUFFIX = '.t5-artifact-purpose.json';
const MAX_CONTRACT_BYTES = 128 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);
const PRODUCERS = Object.freeze([
  { kind: 'semantic_verifier', identity: 't5.document-semantic-observer.v1' },
  { kind: 'domain_verifier', identity: 't5.document-domain-observer.v1' },
  { kind: 'structural_verifier', identity: 't5.document-structure-observer.v1' },
  { kind: 'render_verifier', identity: 't5.document-render-observer.v1' },
]);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function xmlText(bytes) { return Buffer.from(bytes ?? []).toString('utf8'); }
function decodeXml(value = '') {
  return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}
function attributes(fragment = '') {
  return Object.fromEntries([...fragment.matchAll(/([\w:]+)="([^"]*)"/gu)]
    .map((match) => [match[1], decodeXml(match[2])]));
}
function flattenStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => flattenStrings(item, output));
  return output;
}
function observationBase(contract, requirement, suffix) {
  return {
    schema: 't5.artifact-quality-observation.v1',
    observationId: `${requirement.requirementId}:${suffix}`,
    requirementId: requirement.requirementId,
    kind: requirement.kind,
    contractId: contract.contractId,
    artifactSha256: contract.artifact.sha256,
    state: 'observed',
  };
}
function unknownObservation(base) { return { ...base, state: 'unknown' }; }

async function readPurposeContract(filePath) {
  const path = `${resolve(filePath)}${CONTRACT_SUFFIX}`;
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing', path };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    return { state: 'invalid', reason: 'purpose_contract_not_regular', path };
  }
  if (stat.size > MAX_CONTRACT_BYTES) {
    return { state: 'invalid', reason: 'purpose_contract_too_large', path };
  }
  try { return { state: 'loaded', contract: JSON.parse(await readFile(path, 'utf8')), path }; }
  catch { return { state: 'invalid', reason: 'purpose_contract_invalid_json', path }; }
}

function actualUnits(evidence, surface) {
  if (evidence.kind === 'xlsx') return evidence.document?.workbook?.sheets?.map((sheet) => (
    surface === 'print' ? `${sheet.name}:p1` : sheet.name
  )) ?? [];
  if (evidence.kind === 'pdf') return Array.from(
    { length: evidence.document?.pdf?.pageCount ?? 0 },
    (_, index) => `page:${index + 1}`,
  );
  if (evidence.kind === 'docx' && evidence.preview?.state === 'ready') return ['document:page1'];
  return [];
}

function workbookPageSetups(bytes) {
  let archive;
  try { archive = unzipSync(Buffer.from(bytes)); }
  catch { return []; }
  const workbook = xmlText(archive['xl/workbook.xml']);
  const rels = xmlText(archive['xl/_rels/workbook.xml.rels']);
  if (!workbook || !rels) return [];
  const relTargets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gu)]
    .map((match) => attributes(match[1])).map((item) => [item.Id, item.Target]));
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/gu)]
    .map((match, index) => ({ ...attributes(match[1]), index }));
  const printAreas = new Map([...workbook.matchAll(
    /<definedName\b([^>]*)>([^<]*)<\/definedName>/gu,
  )].flatMap((match) => {
    const attr = attributes(match[1]);
    return attr.name === '_xlnm.Print_Area'
      ? [[Number(attr.localSheetId), decodeXml(match[2]).replace(/^'[^']+'!/u, '')]] : [];
  }));
  return sheets.flatMap((sheet) => {
    const target = relTargets.get(sheet['r:id']);
    if (!target) return [];
    const normalizedTarget = target.replace(/^\/?xl\//u, '').replace(/^\/?/u, '');
    const entry = normalizedTarget.startsWith('worksheets/')
      ? `xl/${normalizedTarget}` : `xl/${normalizedTarget}`;
    const xml = xmlText(archive[entry]);
    if (!xml) return [];
    const pageSetupMatch = xml.match(/<pageSetup\b([^>]*)\/?>(?:<\/pageSetup>)?/u);
    if (!pageSetupMatch) return [];
    const pageSetup = attributes(pageSetupMatch?.[1] ?? '');
    const pageProperties = attributes(xml.match(/<pageSetUpPr\b([^>]*)\/?>(?:<\/pageSetUpPr>)?/u)?.[1] ?? '');
    const paper = Number(pageSetup.paperSize);
    return [{
      sheetId: sheet.name,
      paperSize: paper === 9 ? 'A4' : String(pageSetup.paperSize ?? ''),
      orientation: pageSetup.orientation ?? '',
      fitToPage: pageProperties.fitToPage === '1' || pageProperties.fitToPage === 'true',
      fitToWidth: Number(pageSetup.fitToWidth ?? 0),
      fitToHeight: Number(pageSetup.fitToHeight ?? 0),
      printArea: printAreas.get(sheet.index) ?? '',
    }];
  });
}

function artifactForms(evidence) {
  if (evidence.kind === 'xlsx') return evidence.document?.workbook?.sheets?.map((sheet) => sheet.name) ?? [];
  if (evidence.kind === 'pdf') return actualUnits(evidence, 'screen');
  if (evidence.kind === 'docx') return ['document'];
  return [];
}

function producerObservation({ producer, context, evidence }) {
  const { contract, requirement } = context;
  const base = observationBase(contract, requirement, producer.kind);
  const corpus = evidence.corpus;
  const contains = (value) => corpus.includes(String(value));
  if (producer.kind === 'semantic_verifier') {
    const present = contract.sourceFacts.filter((fact) => contains(fact.factId) && contains(fact.sourceRef));
    const expectedIds = [...new Set(Object.values(requirement.expected).flat())];
    if (expectedIds.every((factId) => present.some((fact) => fact.factId === factId))) {
      return unknownObservation(base);
    }
    return { ...base, facts: {
      satisfiedFactIds: present.filter((fact) => fact.resolution === 'resolved').map((fact) => fact.factId),
      unchangedSourceFactIds: present.map((fact) => fact.factId),
      preservedUnresolvedFactIds: present.filter((fact) => fact.resolution === 'unresolved').map((fact) => fact.factId),
    } };
  }
  if (producer.kind === 'domain_verifier') {
    const traces = contract.sourceFacts.filter((fact) => contains(fact.factId) && contains(fact.sourceRef))
      .map((fact) => ({
        sourceFactId: fact.factId, sourceRef: fact.sourceRef,
        originalValuePresent: fact.preserveOriginal === true,
        reversible: fact.preserveOriginal === true,
      }));
    const calculationIds = contract.calculations.filter((item) => contains(item.calculationId))
      .map((item) => item.calculationId);
    if ((requirement.expected.sourceFactIds ?? []).every((factId) => traces.some((trace) => trace.sourceFactId === factId))
      && (requirement.expected.calculationIds ?? []).every((calculationId) => calculationIds.includes(calculationId))) {
      return unknownObservation(base);
    }
    return { ...base, facts: {
      traces,
      calculationIds,
    } };
  }
  if (producer.kind === 'structural_verifier') {
    if (requirement.kind === 'structural_scan') return { ...base, facts: {
      reopenedArtifactSha256: evidence.sha256,
      formulaErrors: evidence.document?.workbook?.totals?.formulaErrors ?? 0,
      schemaErrors: evidence.documentState === 'observed' ? 0 : 1,
    } };
    if (requirement.kind === 'artifact_forms') return { ...base, facts: {
      observedFormIds: artifactForms(evidence),
    } };
    if (requirement.kind === 'openxml_page_setup') return { ...base, facts: {
      sheets: evidence.pageSetups,
    } };
  }
  if (producer.kind === 'render_verifier') {
    const surface = requirement.expected.surface;
    const units = actualUnits(evidence, surface);
    if (requirement.kind === 'render_coverage' && surface === 'screen') return { ...base, facts: {
      surface, observedUnitIds: evidence.preview?.state === 'ready' ? units : [],
    } };
    if (requirement.kind === 'render_coverage') return unknownObservation(base);
    if (requirement.kind === 'visual_integrity') {
      const defects = surface === 'print' && evidence.kind === 'xlsx'
        ? evidence.pageSetups.filter((sheet) => sheet.fitToWidth !== 1)
          .map((sheet) => ({ unitId: `${sheet.sheetId}:p1`, type: 'horizontal_split' })) : [];
      if (defects.length === 0) return unknownObservation(base);
      return { ...base, facts: { surface, observedUnitIds: units, defects } };
    }
    if (requirement.kind === 'visual_hierarchy') {
      const achievedGoalIds = contract.visualHierarchyGoals.filter(contains);
      return achievedGoalIds.length === contract.visualHierarchyGoals.length
        ? unknownObservation(base)
        : { ...base, facts: { surface, observedUnitIds: units, achievedGoalIds } };
    }
  }
  return unknownObservation(base);
}

async function collectEvidence(filePath, bytes, extension) {
  let document = null; let documentState = 'unmeasured'; let kind = extension.slice(1);
  try {
    if (extension === '.xlsx' || extension === '.pdf') {
      document = await inspectBusinessDocument({ file: filePath, maxCells: 100_000, maxPages: 200 });
    } else {
      const format = detectQualifiedDocumentFormat(bytes, filePath);
      document = await inspectQualifiedDocument({
        bytes, format, sourceSha256: sha256(bytes), maxChars: 200_000, maxCells: 100_000,
      });
    }
    documentState = document?.state === 'observed' || document?.schema === 't5.document-observation.v1'
      ? 'observed' : 'unmeasured';
  } catch { documentState = 'failed'; }
  let preview = null;
  try {
    const rendered = await renderAttachmentPreview({
      record: {
        originalName: filePath, storedPath: filePath, bytes: bytes.length,
        kind: extension === '.xlsx' ? 'spreadsheet' : extension === '.pdf' ? 'pdf' : 'document',
        mimeType: extension === '.xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : extension === '.pdf' ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      bytes,
    });
    preview = { state: 'ready', ...rendered };
  } catch { preview = null; }
  const corpus = flattenStrings({ document, preview }).join('\n');
  return {
    kind, document, documentState, preview, corpus,
    pageSetups: extension === '.xlsx' ? workbookPageSetups(bytes) : [],
    sha256: sha256(bytes),
  };
}

export function makeArtifactQualityOutputQualifier() {
  return async function qualifyArtifactQualityOutput({ filePath, workspace } = {}) {
    const source = resolve(String(filePath ?? ''));
    const extension = extname(source).toLowerCase();
    const sidecar = await readPurposeContract(source);
    if (sidecar.state === 'missing') return { applicable: false };
    if (!SUPPORTED_EXTENSIONS.has(extension)) return {
      applicable: true, qualified: false, state: 'artifact_quality_unqualified',
      reason: 'purpose_contract_unsupported_artifact', verificationMissing: true,
    };
    if (sidecar.state !== 'loaded') return {
      applicable: true, qualified: false, state: 'artifact_quality_unqualified',
      reason: sidecar.reason, verificationMissing: true,
    };
    const root = await realpath(workspace); const path = await realpath(source);
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
      throw new Error('quality output path is outside workspace');
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
      throw new Error('quality output must be one regular file');
    }
    const bytes = await readFile(path);
    const evidence = await collectEvidence(path, bytes, extension);
    const qualifier = makeArtifactQualityQualifier({
      observationProducers: PRODUCERS.map((producer) => ({
        ...producer,
        observe(context) { return producerObservation({ producer, context, evidence }); },
      })),
    });
    try {
      const receipt = await qualifier({ contract: sidecar.contract });
      return {
        applicable: true,
        qualified: receipt.qualified,
        state: receipt.qualified ? 'artifact_quality_qualified' : 'artifact_quality_unqualified',
        ...(receipt.qualified ? {} : { reason: 'artifact_quality_qualification_failed', verificationMissing: true }),
        receipt,
      };
    } catch {
      return {
        applicable: true, qualified: false, state: 'artifact_quality_unqualified',
        reason: 'artifact_purpose_contract_invalid', verificationMissing: true,
      };
    }
  };
}

export const ARTIFACT_QUALITY_OUTPUT_CONTRACT = Object.freeze({
  suffix: CONTRACT_SUFFIX,
  supportedExtensions: Object.freeze([...SUPPORTED_EXTENSIONS]),
});
