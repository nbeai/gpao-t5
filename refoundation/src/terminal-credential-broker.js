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

export function makeTerminalCredentialBroker({
  registrations = [], generalTerminalIsolationQualified = false,
} = {}) {
  const byExecutable = new Map();
  for (const registration of registrations) {
    if (!registration?.id || !registration?.executable || !isAbsolute(registration.program)) {
      throw new TypeError('registered CLI broker identity is invalid');
    }
    if (byExecutable.has(registration.executable)) throw new Error('registered CLI executable is duplicated');
    byExecutable.set(registration.executable, registration);
  }
  return {
    capabilities: (generalTerminalIsolationQualified ? registrations : []).map((registration) => ({
      id: registration.id, executable: registration.executable,
      label: String(registration.label ?? registration.executable), kind: 'authenticated_cli',
    })),
    async inspect(capabilityId = null) {
      const selected = capabilityId == null
        ? registrations : registrations.filter((registration) => registration.id === capabilityId);
      if (capabilityId != null && selected.length === 0) throw new Error('registered CLI capability not found');
      return Promise.all(selected.map(async (registration) => {
        let observed;
        try { observed = typeof registration.inspect === 'function' ? await registration.inspect() : null; }
        catch { observed = null; }
        const ready = observed?.state === 'ready' && generalTerminalIsolationQualified;
        return {
          id: registration.id, label: String(registration.label ?? registration.executable),
          executable: registration.executable, kind: 'authenticated_cli',
          state: ready ? 'ready' : observed?.state === 'needs_connection'
            ? 'needs_connection' : 'needs_attention',
          reason: !generalTerminalIsolationQualified
            ? 'registered_cli_terminal_isolation_unavailable'
            : observed?.reason ?? (ready ? 'registered_cli_ready' : 'registered_cli_identity_unverified'),
          identity: observed?.identity ?? null,
          authority: observed?.authority ?? { state: 'unknown', permissions: [] },
          credential: {
            owner: observed?.credential?.owner ?? String(registration.label ?? registration.executable),
            storage: observed?.credential?.storage ?? 'cli_owned',
            rawExposedToModel: false, rawExposedToGeneralTerminal: false,
          },
          actions: (registration.actions ?? []).map((action) => action.id),
        };
      }));
    },
    async prepare({ commandExplanation, managed = false } = {}) {
      const steps = commandExplanation?.ok ? commandExplanation.steps ?? [] : [];
      const executable = steps[0]?.executable;
      const registration = byExecutable.get(executable);
      if (!registration) return { matched: false };
      if (!generalTerminalIsolationQualified) return {
        matched: true, allowed: false, reason: 'registered CLI terminal isolation is unavailable',
      };
      if (managed || steps.length !== 1 || (commandExplanation.operators ?? []).length !== 0) {
        return { matched: true, allowed: false, reason: 'registered CLI requires one foreground command' };
      }
      const argv = steps[0].argv ?? [];
      const action = registration.actions?.find((candidate) => candidate.matches(argv.slice(1)));
      if (!action) return { matched: true, allowed: false, reason: 'registered CLI action is not allowed' };
      let observed = null;
      try { observed = typeof registration.inspect === 'function' ? await registration.inspect() : null; }
      catch { /* the exact command can still return the authoritative failure */ }
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
        capabilityAdmission: {
          kind: 'authenticated_cli', capabilityId: registration.id,
          action: prepared.action ?? action.id,
          credential: {
            owner: observed?.credential?.owner ?? String(registration.label ?? registration.executable),
            storage: observed?.credential?.storage ?? 'cli_owned',
          },
          authority: observed?.authority ?? { state: 'unknown', permissions: [] },
          execution: { state: 'unknown', adapter: `registered-cli:${registration.executable}` },
          effect: { state: 'unknown', kind: 'observe' },
        },
      };
    },
  };
}
