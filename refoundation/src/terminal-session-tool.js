const ACTIONS = ['start', 'start_tty', 'list', 'poll', 'write', 'resize', 'stop', 'read_output'];

function argsForStart(args) {
  return { command: args.command, cwd: args.cwd, effect: args.effect };
}

function argsForPty(args) {
  return { ...argsForStart(args), cols: args.cols, rows: args.rows };
}

function argsForControl(args) {
  return {
    action: args.action,
    processId: args.processId,
    cursor: args.cursor,
    input: args.input,
    end: args.end,
    waitMs: args.waitMs,
    cols: args.cols,
    rows: args.rows,
  };
}

/**
 * One continuous Terminal session surface over the already-qualified process, PTY,
 * effect-observation, and exact-output implementations. This adapter owns no
 * process state and must not reinterpret commands or receipts.
 */
export function makeTerminalSessionTool({ start, ptyStart, control, output, effectSchema } = {}) {
  if (!start || !ptyStart || !control) throw new TypeError('terminal session delegates are required');
  if (!effectSchema) throw new TypeError('terminal effect schema is required');
  return {
    name: 'terminal_session',
    description: 'Continue work in a managed Terminal session: start a background or TTY command, observe only new output, write input, resize, stop, list, or read an exact range of saved output. Use exec for a short foreground command.',
    resourceSemantics(args, result) {
      return args?.action === 'poll' && typeof control.resourceSemantics === 'function'
        ? control.resourceSemantics(argsForControl(args), result) : {};
    },
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS },
        command: { type: ['string', 'null'] },
        cwd: { type: ['string', 'null'] },
        effect: { ...effectSchema, type: ['object', 'null'] },
        processId: { type: ['string', 'null'] },
        cursor: {
          type: ['object', 'null'],
          properties: { stdout: { type: 'integer' }, stderr: { type: 'integer' } },
          required: ['stdout', 'stderr'],
          additionalProperties: false,
        },
        input: { type: ['string', 'null'] },
        end: { type: ['boolean', 'null'] },
        waitMs: { type: ['integer', 'null'], minimum: 0, maximum: 30000 },
        cols: { type: ['integer', 'null'], minimum: 20, maximum: 500 },
        rows: { type: ['integer', 'null'], minimum: 5, maximum: 200 },
        handle: { type: ['string', 'null'] },
        stream: { type: ['string', 'null'], enum: ['stdout', 'stderr', null] },
        offset: { type: ['integer', 'null'], minimum: 0 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 16000 },
      },
      required: [
        'action', 'command', 'cwd', 'effect', 'processId', 'cursor', 'input', 'end',
        'waitMs', 'cols', 'rows', 'handle', 'stream', 'offset', 'limit',
      ],
      additionalProperties: false,
    },
    async preflight(args, context) {
      if (args.action === 'start' && typeof start.preflight === 'function') {
        return start.preflight(argsForStart(args), context);
      }
      if (args.action === 'start_tty' && typeof ptyStart.preflight === 'function') {
        return ptyStart.preflight(argsForPty(args), context);
      }
      return { allowed: true };
    },
    async execute(args = {}, context = {}) {
      if (args.action === 'start') return start.execute(argsForStart(args), context);
      if (args.action === 'start_tty') return ptyStart.execute(argsForPty(args), context);
      if (['list', 'poll', 'write', 'resize', 'stop'].includes(args.action)) {
        return control.execute(argsForControl(args), context);
      }
      if (args.action === 'read_output') {
        if (!output) throw Object.assign(new Error('saved Terminal output is unavailable'), { status: 404 });
        return output.execute({
          handle: args.handle, stream: args.stream, offset: args.offset, limit: args.limit,
        }, context);
      }
      throw new TypeError(`unknown terminal session action: ${args.action}`);
    },
  };
}
