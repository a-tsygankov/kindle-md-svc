import { readFile } from 'node:fs/promises';
import { convertDocument } from './converter.js';

try {
  const options = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await convertDocument(options);
} catch (error) {
  // Parent captures this message only; do not log source text or raw tool stderr.
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Conversion failed.' }));
  process.exitCode = 1;
}
