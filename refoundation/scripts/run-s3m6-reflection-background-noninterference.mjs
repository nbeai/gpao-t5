import { qualifyReflectionBackgroundNoninterference } from '../src/reflection-background-noninterference.js';

const result = await qualifyReflectionBackgroundNoninterference();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;
