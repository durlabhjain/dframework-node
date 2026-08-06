import { createWriteStream } from '../lib/pino-http-send.mjs';

let passCount = 0;
let failCount = 0;

const test = (name, condition) => {
  if (condition) {
    console.log(`✓ ${name}`);
    passCount++;
  } else {
    console.log(`✗ ${name}`);
    failCount++;
  }
};

const writeLinesAndClose = (stream, lines) => new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.on('close', resolve);
  for (const line of lines) {
    stream.write(`${JSON.stringify(line)}\n`);
  }
  stream.end();
});

const sampleLog = (msg) => ({
  level: 50,
  time: '2026-08-04T00:00:00.000Z',
  Username: 'copilot',
  msg,
  req: {
    url: '/users',
    query: {},
    params: {},
    body: {},
  },
});

// exceptionHandler provider has no buildBatchRequest — with batchSize > 1, flushBatch
// must still send every buffered log individually instead of dropping all but the first.
{
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(init.body);
    return { ok: true, text: async () => '' };
  };

  const stream = createWriteStream({
    url: 'http://example.com/ExceptionHandler.ashx',
    provider: 'exceptionHandler',
    batchSize: 3,
  });

  try {
    await writeLinesAndClose(stream, [sampleLog('first'), sampleLog('second'), sampleLog('third')]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  test('no buildBatchRequest: sends one request per buffered log (no data loss)', calls.length === 3);
  test('no buildBatchRequest: preserves each log body distinctly', calls.every((body, i) => body.includes(['first', 'second', 'third'][i])));
}

console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}
