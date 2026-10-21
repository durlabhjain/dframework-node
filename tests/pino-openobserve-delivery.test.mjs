import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createWriteStream } from '../lib/pino-openobserve.mjs';

const options = { url: 'http://127.0.0.1', organization: 'default', streamName: 'logs', auth: { username: 'user', password: 'pass' } };
const line = (i) => JSON.stringify({ level: 50, msg: `record ${i}` }) + '\n';
const end = async (stream) => {
  const closed = once(stream, 'close');
  stream.end();
  await closed;
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('condition was not met within 2 seconds');
};
const collector = async (t, onRequest) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ headers: req.headers, url: req.url, records: body.trim().split('\n').map(JSON.parse) });
      if (onRequest) onRequest(res, requests.length);
      else res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
};

test('rejects missing/blank credentials and invalid batch/queue/time limits', () => {
  for (const auth of [undefined, {}, { username: 'user' }, { password: 'pass' }, { username: ' ', password: 'pass' }]) {
    assert.throws(() => createWriteStream({ ...options, auth }), /auth/);
  }
  for (const key of ['batchSize', 'maxQueueSize', 'timeoutMs', 'timeThreshold']) {
    for (const value of [0, -1, 0.5, NaN, Infinity, 2 ** 31, '10']) {
      assert.throws(() => createWriteStream({ ...options, [key]: value }), /positive integer/);
    }
  }
  assert.throws(() => createWriteStream({ ...options, batchSize: 3, maxQueueSize: 2 }), /at least/);
  assert.throws(() => createWriteStream({ ...options, url: 'ftp://example.com' }), /HTTP/);
});

test('flushes an idle partial batch from the first queued record', async t => {
  const { url, requests } = await collector(t);
  const stream = createWriteStream({ ...options, url, batchSize: 10, timeThreshold: 80 });
  t.after(() => stream.destroy());
  stream.write(line(0));
  await waitFor(() => requests.length === 1);
  assert.equal(requests[0].records[0].message, 'record 0');
  await end(stream);
});

test('new records do not postpone a partial batch deadline', async t => {
  const { url, requests } = await collector(t);
  const stream = createWriteStream({ ...options, url, batchSize: 100, timeThreshold: 100 });
  t.after(() => stream.destroy());
  let i = 0;
  const interval = setInterval(() => stream.write(line(i++)), 10);
  t.after(() => clearInterval(interval));
  await waitFor(() => requests.length > 0);
  assert.ok(requests[0].records.length < 100);
  clearInterval(interval);
  await end(stream);
});

for (const [name, batchSize, count, responseDelay, mode] of [
  ['partial batch', 10, 1, 0, 'end'],
  ['slow collector', 1, 5, 650, 'end'],
  ['partial batch', 10, 1, 0, 'process-exit'],
  ['slow collector', 1, 5, 650, 'process-exit'],
]) {
  test(`real multi-target Pino worker drains ${name} on ${mode}`, { timeout: 10_000 }, async t => {
    const { url, requests } = await collector(t, res => setTimeout(() => res.end('{}'), responseDelay));
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/pino-openobserve-worker.mjs', import.meta.url)), url, String(batchSize), String(count), mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.deepEqual(requests.flatMap(request => request.records.map(record => record.message)), Array.from({ length: count }, (_, i) => `record ${i}`));
  });
}

test('caps the waiting queue while a request is stalled and reports overflow', async t => {
  let firstResponse;
  const { url, requests } = await collector(t, (res, count) => {
    if (count === 1) firstResponse = res;
    else res.end('{}');
  });
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const stream = createWriteStream({ ...options, url, maxQueueSize: 3 });
  t.after(() => stream.destroy());
  stream.write(line(0));
  await waitFor(() => firstResponse);
  for (let i = 1; i <= 100; i++) stream.write(line(i));
  firstResponse.end('{}');
  await end(stream);
  assert.deepEqual(requests.flatMap(request => request.records.map(record => record.message)), ['record 0', 'record 1', 'record 2', 'record 3']);
  assert.ok(errors.some(error => error.includes('Dropped 97 log(s)')));
});

test('timeouts and HTTP failures do not stop later deliveries', async t => {
  const { url, requests } = await collector(t, (res, count) => {
    if (count === 1) return;
    res.statusCode = count === 2 ? 500 : 200;
    res.end('{}');
  });
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const stream = createWriteStream({ ...options, url, timeoutMs: 100 });
  t.after(() => stream.destroy());
  for (let i = 0; i < 3; i++) stream.write(line(i));
  await end(stream);
  assert.equal(requests.length, 3);
  assert.ok(errors.some(error => /timeout/i.test(error)));
  assert.ok(errors.some(error => error.includes('HTTP 500')));
  assert.equal(requests[2].records[0].message, 'record 2');
});

test('request timeout also covers a stalled response body', async t => {
  const { url, requests } = await collector(t, (res, count) => {
    if (count === 1) { res.writeHead(200); res.write('{'); }
    else res.end('{}');
  });
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const stream = createWriteStream({ ...options, url, timeoutMs: 100 });
  t.after(() => stream.destroy());
  stream.write(line(0));
  stream.write(line(1));
  await end(stream);
  assert.equal(requests.length, 2);
  assert.equal(errors.length, 1);
});

test('shutdown aborts a stalled collector within the worker deadline', { timeout: 8_000 }, async t => {
  const { url } = await collector(t, () => {});
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const stream = createWriteStream({ ...options, url, timeoutMs: 60_000 });
  t.after(() => stream.destroy());
  stream.write(line(0));
  stream.write(line(1));
  const started = performance.now();
  await end(stream);
  assert.ok(performance.now() - started < 7_000);
  assert.ok(errors.some(error => error.includes('Shutdown deadline exceeded')));
  assert.ok(errors.some(error => error.includes('Dropped 1 log(s)')));
});
