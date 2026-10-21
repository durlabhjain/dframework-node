import http from 'node:http';
import { createWriteStream, severityByLevel, toRecord } from '../lib/pino-openobserve.mjs';

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

const throws = (fn, pattern) => {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test(error.message);
  }
};

const context = {
  app: 'dframework',
  environment: 'test',
  appVersion: '1.2.3',
  severities: severityByLevel(),
};

const sampleLog = {
  level: 50,
  time: '2026-08-04T00:00:00.000Z',
  Username: 'copilot',
  msg: 'boom',
  req: {
    url: '/users',
    query: { page: 1 },
    params: { id: 5 },
    body: { filter: 'active' },
    remoteAddress: '127.0.0.1',
    userAgent: 'test-agent',
  },
};

const record = toRecord(sampleLog, context);

test('stamps app metadata', record.application_name === 'dframework' && record.environment === 'test' && record.app_version === '1.2.3');
test('keeps query string separate', JSON.stringify(record.query_string) === JSON.stringify({ page: 1 }));
test('keeps form separate', JSON.stringify(record.form) === JSON.stringify({ id: 5 }));
test('sends the request body as a JSON string', record.body === JSON.stringify({ filter: 'active' }));
test('reports the remote host', record.remote_host === '127.0.0.1');
test('stamps the system path', record.system_path === process.cwd());
test('sends utc_date in OpenObserve display format', record.utc_date === '2026-08-04 12:00:00 AM');
test('maps level to severity name', record.severity === 'Error');
test('uses msg as the message', record.message === 'boom');

const emptyBodyRecord = toRecord({ ...sampleLog, req: { ...sampleLog.req, body: null } }, context);
test('a null request body is dropped rather than stringified', !('body' in emptyBodyRecord));

const emptyRequestRecord = toRecord({ ...sampleLog, req: { url: '/users', query: {}, params: {} } }, context);
test('empty query string and form are dropped', !('query_string' in emptyRequestRecord) && !('form' in emptyRequestRecord));

const errorRecord = toRecord({ ...sampleLog, query: 'SELECT * FROM users', err: { stack: 'Error: boom\n    at foo' } }, context);
test('appends top-level query to stack trace', errorRecord.stack_trace === 'Error: boom\n    at foo\r\nquery: SELECT * FROM users');
test('params and body stay out of the stack trace', !errorRecord.stack_trace.includes('active'));

const customLevels = { slow: 35 };
test('custom level maps to its configured severity name', toRecord({ ...sampleLog, level: 35 }, { ...context, severities: severityByLevel(customLevels) }).severity === 'Slow');
test('unrecognized level defaults severity to Error', toRecord({ ...sampleLog, level: 999 }, context).severity === 'Error');

const { level: _omitted, ...logWithoutLevel } = sampleLog;
const noLevelRecord = toRecord(logWithoutLevel, context);
test('missing level is excluded from the record', !('level' in noLevelRecord));
test('missing level still defaults severity to Error', noLevelRecord.severity === 'Error');

test('url, organization and streamName are required', throws(() => createWriteStream({ auth: { username: 'u', password: 'p' } }), /needs "url", "organization", "streamName"/));

// Delivery uses the OpenObserve _multi ingest endpoint
{
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ took: 1, errors: false, items: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const stream = createWriteStream({
    url: `http://127.0.0.1:${port}`,
    organization: 'default',
    streamName: 'playbook_logs',
    auth: { username: 'user', password: 'pass' },
    app: 'dframework',
    environment: 'test',
  });

  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('close', resolve);
    stream.write(`${JSON.stringify(sampleLog)}\n`);
    stream.end();
  });
  server.close();

  const [request] = requests;
  const sent = JSON.parse((request?.body || '{}').trim());
  test('posts to the organization and stream ingest endpoint', request?.url === '/api/default/playbook_logs/_multi');
  test('authenticates with basic auth', request?.auth === `Basic ${Buffer.from('user:pass').toString('base64')}`);
  test('sends the mapped record, not the raw pino line', sent.severity === 'Error' && sent.message === 'boom');
  test('stamps the static tags on the delivered record', sent.application_name === 'dframework' && sent.environment === 'test');
}

console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}
