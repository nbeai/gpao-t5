import { measureS6Fixture } from '../test/helpers/s3a-s6-state-context.js';

const [root, sessionClass, condition] = process.argv.slice(2);
if (!root || !['short_session', 'long_session'].includes(sessionClass)
  || !['cold_process', 'warm_resident'].includes(condition)) {
  throw new Error('usage: worker <root> <sessionClass> <cold_process|warm_resident>');
}
const fixture = {
  root, sessionClass,
  sessionId: sessionClass === 'short_session'
    ? '11111111-1111-4111-8111-111111111111'
    : '22222222-2222-4222-8222-222222222222',
};
const result = await measureS6Fixture(fixture, { resident: condition === 'warm_resident' });
process.stdout.write(`${JSON.stringify(result)}\n`);
