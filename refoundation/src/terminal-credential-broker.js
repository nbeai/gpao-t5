import { isAbsolute } from 'node:path';

function redact(value, secrets) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(String(secret), '[REDACTED]');
  return text;
}

export function redactBrokeredTerminalResult(result, secrets = []) {
  return {
    ...result,
    ...(typeof result?.stdout === 'string' ? { stdout: redact(result.stdout, secrets) } : {}),
    ...(typeof result?.stderr === 'string' ? { stderr: redact(result.stderr, secrets) } : {}),
  };
}

export function makeTerminalCredentialBroker({ registrations = [] } = {}) {
  const byExecutable = new Map();
  for (const registration of registrations) {
    if (!registration?.id || !registration?.executable || !isAbsolute(registration.program)) {
      throw new TypeError('registered CLI broker identity is invalid');
    }
    if (byExecutable.has(registration.executable)) throw new Error('registered CLI executable is duplicated');
    byExecutable.set(registration.executable, registration);
  }
  return {
    prepare({ commandExplanation, managed = false } = {}) {
      const steps = commandExplanation?.ok ? commandExplanation.steps ?? [] : [];
      const executable = steps[0]?.executable;
      const registration = byExecutable.get(executable);
      if (!registration) return { matched: false };
      if (managed || steps.length !== 1 || (commandExplanation.operators ?? []).length !== 0) {
        return { matched: true, allowed: false, reason: 'registered CLI requires one foreground command' };
      }
      const argv = steps[0].argv ?? [];
      const action = registration.actions?.find((candidate) => candidate.matches(argv.slice(1)));
      if (!action) return { matched: true, allowed: false, reason: 'registered CLI action is not allowed' };
      const prepared = action.prepare(argv.slice(1));
      if (!Array.isArray(prepared?.args) || prepared.args.some((arg) => typeof arg !== 'string')) {
        throw new Error('registered CLI action returned invalid args');
      }
      return {
        matched: true, allowed: true,
        launch: {
          program: registration.program, args: prepared.args,
          env: prepared.env ?? {}, sensitiveValues: prepared.sensitiveValues ?? [],
        },
        receipt: { kind: 'registered_cli', capabilityId: registration.id, action: action.id },
      };
    },
  };
}
