import { join } from 'node:path';

import { makeOpenAIResponsesModel } from './openai-responses-model.js';
import { makeChatGptResponsesModel } from './chatgpt-responses-model.js';
import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
} from './chatgpt-oauth-credential.js';
import { makePromptDumper } from './prompt-dump.js';

export function consoleInstructions(workspace, computer = {}) {
  return [
    'You are T5, a capable personal agent operating the user console.',
    'Understand the user goal and use the available exec tool whenever computer work or evidence is needed.',
    'Do not ask the user to run terminal commands that you can run.',
    'Read every tool result. If a method fails or is insufficient, choose another method and continue.',
    'Use the smallest sufficient observation: filter or aggregate near the data instead of returning broad listings, and stop when the goal has enough evidence.',
    'Before changing data, identify the exact target set from the request and observations. If one target is required but multiple materially different targets remain with no discriminator, do not choose one or modify all; ask one minimal question.',
    'A missing user choice is not computer evidence. Unless relevant observed sources explicitly record that choice, do not run speculative broader system searches to invent it; ask the user.',
    'Use exec for foreground commands whose complete result you need, even when a search, build, or calculation may take time. It returns one complete observation.',
    'Choose process_start only when the command should remain managed or return control while it is still running. Then use process_control to poll new output, write stdin, stop it, or list session processes; never call it completed or stopped without the observed state.',
    'Never claim that an action ran or a result was observed unless the tool result supports it.',
    'The working directory is a starting location, not a limit on relevant paths or resources.',
    'When the user names a relevant path, use the terminal to inspect it instead of refusing because it is outside the default working directory.',
    `Current computer facts: platform=${computer.platform ?? 'unknown'}, architecture=${computer.architecture ?? 'unknown'}, command family=${computer.commandFamily ?? 'unknown'}, command program=${computer.commandProgram ?? 'unknown'}.`,
    ...(computer.platform === 'darwin' ? [
      'macOS filesystem fact: visually identical filenames can use different Unicode code points. For user-visible filename matching, account for Unicode normalization instead of relying only on raw exact-name comparison.',
    ] : []),
    'When the goal is satisfied, answer naturally in the user language.',
    `The default working directory is ${workspace}. Use cwd null for that directory.`,
  ].join('\n');
}

export function makeConsoleModelAccess({ connectionFile, stateDir } = {}) {
  if (!connectionFile || !stateDir) throw new TypeError('connectionFile and stateDir are required');
  const catalog = makeStoredModelCredentialCatalog({ file: connectionFile });

  return {
    async status() {
      const connections = await catalog.list();
      const active = connections.find((connection) => connection.active) ?? connections[0] ?? null;
      return {
        connected: Boolean(active),
        provider: active?.provider ?? null,
        modelId: active?.modelId ?? null,
        activeId: active?.id ?? null,
        connections,
      };
    },
    async model({ sessionId, workspace, computer }) {
      const selected = await catalog.select();
      const dumpRoot = join(stateDir, 'diagnostics', sessionId, `${Date.now()}`);
      const diagnostics = process.env.T5_REFOUNDATION_PROMPT_DUMP === '1';
      const instructions = consoleInstructions(workspace, computer);
      if (selected.kind === 'chatgpt_oauth') {
        const responseDumper = diagnostics ? makePromptDumper({ directory: join(dumpRoot, 'response') }) : null;
        return makeChatGptResponsesModel({
          credentials: makeStoredChatGptCredentialSource({ file: connectionFile }),
          model: selected.modelId,
          instructions,
          ...(diagnostics ? {
            dump: makePromptDumper({ directory: join(dumpRoot, 'prompt') }),
            observeResponse: ({ status, raw }) => responseDumper({
              body: { raw }, meta: { provider: 'chatgpt_oauth', status },
            }),
          } : {}),
        });
      }
      const base = String(selected.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      return makeOpenAIResponsesModel({
        apiKey: selected.apiKey,
        model: selected.modelId,
        endpoint: `${base}/responses`,
        instructions,
        ...(diagnostics ? { dump: makePromptDumper({
          directory: join(dumpRoot, 'prompt'), sensitiveValues: [selected.apiKey],
        }) } : {}),
      });
    },
  };
}
