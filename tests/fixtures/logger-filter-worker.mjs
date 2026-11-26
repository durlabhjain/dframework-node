import logger, { closeLogger } from '../../lib/logger.js';

const error = new Error('SQL query failed');
error.code = 'EREQUEST';
error.originalError = { message: 'nested-detail', stack: 'nested-detail' };
logger.error({ err: error, query: 'SELECT 1' }, 'SQL query failed');
await closeLogger();
