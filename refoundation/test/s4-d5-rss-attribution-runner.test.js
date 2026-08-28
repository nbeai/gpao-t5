import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5 profiler는 격리 arm에서 RSS 계층을 분리하고 제품·사용자 현실을 바꾸지 않는다', async () => {
  const source = await readFile(new URL(
    '../scripts/run-s4-d5-rss-attribution.mjs', import.meta.url), 'utf8');
  const helper = await readFile(new URL(
    '../scripts/command-explainer-child.mjs', import.meta.url), 'utf8');
  for (const arm of ['idle', 'store_only', 'raw_pipe_discard', 'raw_pipe_bounded_string',
    'raw_pipe_bounded_snapshots', 'registry_direct_wait_terminal', 'registry_direct_poll',
    'registry_shell_poll', 'command_explainer_short', 'command_explainer_output',
    'explainer_then_raw_pipe', 'explainer_then_registry_poll', 'explainer_output_then_registry_poll',
    'explainer_retained_then_registry_poll',
    'process_start_no_explainer', 'process_start_detached_explanation', 'process_start_json_explanation',
    'process_start_buffer_detached_explanation',
    'process_start_explainer_discarded',
    'process_start_prepared_explanation_bytes',
    'process_start_isolated_explanation',
    'prepared_bytes_then_registry_poll',
    'explanation_digest_then_registry_poll', 'explanation_file_then_registry_poll',
    'process_start_registry_poll', 'process_start_control_poll',
    'registry_direct_without_live_store', 'registry_without_live_store',
    'terminal_direct_live_store', 'terminal_live_store',
    'terminal_bounded_hash_read', 'terminal_concat_read']) {
    assert.match(source, new RegExp(`'${arm}'`, 'u'));
  }
  assert.match(source, /--expose-gc/u);
  assert.match(source, /samplesPerArm: 3/u);
  assert.match(source, /isolatedTemporaryRoots: true/u);
  assert.match(source, /realUserData: false/u);
  assert.match(source, /externalWrites: 0/u);
  assert.match(source, /productChanges: 0/u);
  assert.doesNotMatch(source, /makeConsoleServer|modelFactory|provider|credential/u);
  assert.match(helper, /for await \(const chunk of process\.stdin\)/u);
  assert.doesNotMatch(helper, /process\.argv|workspace|credential|provider/u);
});
