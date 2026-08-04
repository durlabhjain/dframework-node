import {
  DEFAULT_BODY_TYPE,
  buildBatchRequest,
  buildRequest,
  createRequestContext,
  validateOptions,
} from '../lib/pino-http-send-providers/openobserve.mjs';

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

const options = {
  username: 'user',
  password: 'pass',
  app: 'dframework',
  environment: 'test',
  appVersion: '1.2.3',
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

validateOptions(options);
test('default body type constant is ndjson', DEFAULT_BODY_TYPE === 'ndjson');
test('invalid body type is rejected', throws(() => validateOptions({ ...options, bodyType: 'xml' }), /bodyType values/));

const context = createRequestContext(options);
const singleRequest = buildRequest(sampleLog, options, context);
const singleRecord = JSON.parse(singleRequest.body);

test('single request uses basic auth header', singleRequest.headers.Authorization === 'Basic ' + Buffer.from('user:pass').toString('base64'));
test('single request stamps app metadata', singleRecord.app === 'dframework' && singleRecord.environment === 'test' && singleRecord.app_version === '1.2.3');
test('single request merges params and body', singleRecord.parameters === JSON.stringify({ id: 5, filter: 'active' }));

const batchRequest = buildBatchRequest([sampleLog, { ...sampleLog, msg: 'again' }], options, context);
const ndjsonLines = batchRequest.body.split('\n');
test('batch request emits ndjson lines', ndjsonLines.length === 2);
test('batch request preserves each record message', JSON.parse(ndjsonLines[1]).message === 'again');

const jsonBatchRequest = buildBatchRequest([sampleLog, { ...sampleLog, msg: 'json' }], { ...options, bodyType: 'json' });
const jsonBatchBody = JSON.parse(jsonBatchRequest.body);
test('json body type emits a JSON array', Array.isArray(jsonBatchBody) && jsonBatchBody.length === 2);

console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}
