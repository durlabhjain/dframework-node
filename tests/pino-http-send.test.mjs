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
test('single request stamps app metadata', singleRecord.application_name === 'dframework' && singleRecord.environment === 'test' && singleRecord.app_version === '1.2.3');
test('single request keeps query string separate', JSON.stringify(singleRecord.query_string) === JSON.stringify({ page: 1 }));
test('single request keeps form separate', JSON.stringify(singleRecord.form) === JSON.stringify({ id: 5 }));
test('single request keeps body parameters separate', singleRecord.body === JSON.stringify({ filter: 'active' }));
test('single request does not merge params/body into stack trace', singleRecord.stack_trace === undefined || !singleRecord.stack_trace.includes('Body:'));

const queryErrorRecord = JSON.parse(buildRequest({
  ...sampleLog,
  query: 'SELECT * FROM users',
  err: { stack: 'Error: boom\n    at foo' },
}, options, context).body);
test('single request keeps the error stack separate', queryErrorRecord.stack_trace === 'Error: boom\n    at foo');
test('single request preserves query and error details', JSON.parse(queryErrorRecord.details).query === 'SELECT * FROM users' && JSON.parse(queryErrorRecord.details).err.stack === queryErrorRecord.stack_trace);
test('single request formats utc_date in UTC', singleRecord.utc_date === '2026-08-04 12:00:00 AM');
test('single request maps level to severity name', singleRecord.severity === 'Error');

const slowQueryRecord = JSON.parse(buildRequest({
  level: 40,
  time: '2026-08-04T00:00:00.000Z',
  msg: 'Query execution exceeded 500 milliseconds (900ms) [query]',
  query: 'SELECT * FROM Users WHERE Id = @Id',
  formattedQuery: 'DECLARE @Id INT = 5;\nSELECT * FROM Users WHERE Id = @Id',
  parameters: { Id: 5 },
  executionTimeMs: 900,
}, options, context).body);
test('slow query does not synthesize a stack', slowQueryRecord.stack_trace === undefined);
const slowDetails = JSON.parse(slowQueryRecord.details);
test('slow query preserves all supplied fields', slowDetails.query === 'SELECT * FROM Users WHERE Id = @Id' && slowDetails.formattedQuery.startsWith('DECLARE @Id') && slowDetails.parameters.Id === 5 && slowDetails.executionTimeMs === 900);

const slowQueryWithStackRecord = JSON.parse(buildRequest({
  level: 40,
  time: '2026-08-04T00:00:00.000Z',
  msg: 'Query execution exceeded 500 milliseconds (900ms) [query]',
  query: 'SELECT * FROM Users WHERE Id = @Id',
  formattedQuery: 'DECLARE @Id INT = 5;\nSELECT * FROM Users WHERE Id = @Id',
  parameters: { Id: 5 },
  executionTimeMs: 900,
  stack: 'Error: slow query trace\n    at Object.runQuery (lib/sql.js:685:27)',
}, options, context).body);
test('slow query with a real stack uses it verbatim', slowQueryWithStackRecord.stack_trace === 'Error: slow query trace\n    at Object.runQuery (lib/sql.js:685:27)');
test('stack does not affect structured details', slowQueryWithStackRecord.details === slowQueryRecord.details);

const slowRequestRecord = JSON.parse(buildRequest({
  level: 50,
  time: '2026-08-04T00:00:00.000Z',
  msg: 'slow request',
  durMs: 1250,
  statusCode: 200,
  url: '/api/v1/report',
  method: 'GET',
}, options, context).body);
test('slow request does not synthesize a stack', slowRequestRecord.stack_trace === undefined);
const requestDetails = JSON.parse(slowRequestRecord.details);
test('slow request preserves duration and request fields', requestDetails.durMs === 1250 && requestDetails.statusCode === 200 && requestDetails.url === '/api/v1/report' && requestDetails.method === 'GET');

const arbitraryFields = {
  job: { id: 7, attempts: [1, 2] },
  objects: [{ a: 1 }, { b: 2 }, { c: 3 }],
  empty: {}, nil: null, blank: '', zero: 0, flag: false,
  severity: 'caller value', details: { nested: true },
  err: { message: 'failure', code: 'E_JOB', cause: { message: 'cause' } },
};
const arbitraryLog = { ...sampleLog, ...arbitraryFields };
for (const bodyType of ['json', 'ndjson']) {
  const body = buildBatchRequest([arbitraryLog, { ...arbitraryLog, msg: 'second' }], { ...options, bodyType }).body;
  const records = bodyType === 'json' ? JSON.parse(body) : body.split('\n').map(JSON.parse);
  test(`${bodyType} preserves arbitrary nested objects, error fields, and empty values`, records.every(record => JSON.stringify(JSON.parse(record.details)) === JSON.stringify(arbitraryFields)));
  test(`${bodyType} protects provider metadata from caller collisions`, records.every(record => record.severity === 'Error' && record.stack_trace === 'failure'));
}

const customLevelContext = createRequestContext({ ...options, customLevels: { slow: 35 } });
const customLevelRecord = JSON.parse(buildRequest({ ...sampleLog, level: 35 }, options, customLevelContext).body);
test('custom level maps to its configured severity name', customLevelRecord.severity === 'Slow');

const unknownLevelRecord = JSON.parse(buildRequest({ ...sampleLog, level: 999 }, options, context).body);
test('unrecognized level defaults severity to Error', unknownLevelRecord.severity === 'Error');

const { level: _omittedLevel, ...logWithoutLevel } = sampleLog;
const noLevelRecord = JSON.parse(buildRequest(logWithoutLevel, options, context).body);
test('missing level is excluded from the record', !('level' in noLevelRecord));
test('missing level still defaults severity to Error', noLevelRecord.severity === 'Error');

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
