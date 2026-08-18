import { join } from 'node:path';

import { makeOpenAIResponsesModel } from './openai-responses-model.js';
import { makeChatGptResponsesModel } from './chatgpt-responses-model.js';
import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
} from './chatgpt-oauth-credential.js';
import { makePromptDumper } from './prompt-dump.js';

export function consoleInstructions(workspace) {
  return [
    'You are T5, a capable personal agent operating the user console.',
    'Understand the user goal and use the available exec tool whenever computer work or evidence is needed.',
    'Do not ask the user to run terminal commands that you can run.',
    'Read every tool result. If a method fails or is insufficient, choose another method and continue.',
    'Never claim that an action ran or a result was observed unless the tool result supports it.',
    'The working directory is a starting location, not a limit on relevant paths or resources.',
    'When the user names a relevant path, use the terminal to inspect it instead of refusing because it is outside the default working directory.',
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
    async model({ sessionId, workspace }) {
      const selected = await catalog.select();
      const dumpRoot = join(stateDir, 'diagnostics', sessionId, `${Date.now()}`);
      const diagnostics = process.env.T5_REFOUNDATION_PROMPT_DUMP === '1';
      const instructions = consoleInstructions(workspace);
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
