import { createHash } from 'node:crypto';

export const S3_HUMAN_BUSINESS_OBSERVATION_SCHEMA = 't5.s3.human-business-observation.v1';

const TEXT_FIELDS = Object.freeze([
  'exactUserWording', 'businessSituation', 'availableAccountsConnectionsAndFiles',
  'expectedOutcome', 'observedT5Behavior', 'feltFriction', 'usableResult', 'manualRecovery',
]);

const PRIVATE_PATTERNS = Object.freeze([
  { label: 'absolute user path', pattern: /(?:\/Users\/|[A-Za-z]:\\Users\\)/u },
  { label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu },
  { label: 'Korean phone number', pattern: /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/u },
  { label: 'secret-like value', pattern: /\b(?:sk-|ntn_|ghp_|xox[baprs]-|bot\d+:)[A-Za-z0-9_-]{8,}/u },
  { label: 'credential URL', pattern: /https?:\/\/[^\s/@:]+:[^\s/@]+@/iu },
]);

export function makeS3HumanBusinessObservationTemplate() {
  return {
    schema: S3_HUMAN_BUSINESS_OBSERVATION_SCHEMA,
    collectionAuthority: null,
    sourceReference: '',
    exactUserWording: '',
    businessSituation: '',
    availableAccountsConnectionsAndFiles: '',
    expectedOutcome: '',
    observedT5Behavior: '',
    feltFriction: '',
    usableResult: '',
    manualRecovery: '',
    wouldDelegateAgain: null,
    redactionConfirmed: false,
    notes: '',
  };
}

export function validateS3HumanBusinessObservation(value) {
  if (value?.schema !== S3_HUMAN_BUSINESS_OBSERVATION_SCHEMA) {
    throw new Error('invalid S3 human business observation schema');
  }
  if (!['owner_provided', 'public_source', 'consented_tester'].includes(value.collectionAuthority)) {
    throw new Error('collectionAuthority is required');
  }
  if (value.redactionConfirmed !== true) throw new Error('redactionConfirmed must be true');
  if (![true, false, null].includes(value.wouldDelegateAgain)) {
    throw new Error('wouldDelegateAgain must be true, false or null');
  }
  const combined = [];
  for (const field of TEXT_FIELDS) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    combined.push(value[field]);
  }
  if (typeof value.sourceReference === 'string') combined.push(value.sourceReference);
  const content = combined.join('\n');
  for (const check of PRIVATE_PATTERNS) {
    if (check.pattern.test(content)) throw new Error(`observation contains ${check.label}`);
  }
  return {
    schema: 't5.s3.human-business-observation-validation.v1',
    valid: true,
    collectionAuthority: value.collectionAuthority,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    exactUserWordingChars: value.exactUserWording.length,
    fieldCount: TEXT_FIELDS.length,
    wouldDelegateAgain: value.wouldDelegateAgain,
    nextState: 'deidentified_observation_ready_for_purpose_labeling',
  };
}
