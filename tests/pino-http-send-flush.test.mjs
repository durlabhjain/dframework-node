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

{
  const calls = [];
  const originalFetch = globalThis.fetch;
  let batchAttempted = false;
  globalThis.fetch = async (url, init) => {
    calls.push(init.body);
    if (!batchAttempted) {
      batchAttempted = true;
      return { ok: false, status: 500, text: async () => 'batch failed' };
    }
    return { ok: true, text: async () => '' };
  };

  const stream = createWriteStream({
    url: 'https://example.com/api/ingest',
    provider: 'openobserve',
    username: 'user',
    password: 'pass',
    batchSize: 2,
  });

  try {
    await writeLinesAndClose(stream, [sampleLog('fall-back-first'), sampleLog('fall-back-second')]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  test('batch delivery failure falls back to sending each log individually', calls.length === 3);
  test('batch delivery fallback preserves each individual log body', calls.slice(1).every((body, i) => body.includes(['fall-back-first', 'fall-back-second'][i])));
}

{
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const signal = init.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new Error('aborted');
    }
    return { ok: true, text: async () => '' };
  };

  const stream = createWriteStream({
    url: 'http://example.com/ExceptionHandler.ashx',
    provider: 'exceptionHandler',
    timeoutMs: 10,
  });

  try {
    await writeLinesAndClose(stream, [sampleLog('timed-out')]);
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  test('timeout errors are logged and do not crash the stream', errors.some((msg) => /timed out|aborted|timeout/i.test(msg)));
}

console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}
