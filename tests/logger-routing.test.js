import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import config from '../lib/appConfig.mjs';

// Exercise the framework's real config and Pino routing without workers or disk writes.
for (const postLevel of [undefined, 'slow']) {
    test(`HTTP routes correctly with postLevel=${postLevel ?? 'default'}`, async () => {
        const originalTransport = pino.transport;
        const originalLogging = config.logging;
        const received = new Map();
        let httpThreshold;
        config.logging = {
            customLevels: { diagnostic: 15, slow: 35, clienterror: 45 },
            otherConfig: {
                stdout: false,
                httpConfig: { url: 'http://example.invalid' },
                ...(postLevel ? { postLevel } : {}),
            },
        };
        pino.transport = options => {
            const streams = options.targets.map(target => {
                const records = [];
                received.set(target.options.file || 'http', records);
                if (!target.options.file) httpThreshold = target.level;
                return { level: target.level, stream: { write: line => records.push(JSON.parse(line)) } };
            });
            return pino.multistream(streams, { levels: options.levels, dedupe: options.dedupe });
        };
        try {
            const { default: logger } = await import(`../lib/logger.js?routing=${postLevel ?? 'default'}`);
            logger.info('ordinary');
            logger.slow('slow');
            logger.clienterror('client');
            logger.error('failure');
            logger.fatal('fatal');
            assert.equal(httpThreshold, postLevel ?? 'error');
            assert.deepEqual(received.get('http').map(record => record.msg),
                postLevel ? ['slow', 'client', 'failure', 'fatal'] : ['failure', 'fatal']);
            assert.ok([...received.entries()].some(([name, records]) => name.endsWith('/error.json') && records.some(record => record.msg === 'failure')));
        } finally {
            pino.transport = originalTransport;
            config.logging = originalLogging;
        }
    });
}
