import pino from 'pino';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const [url, batchSize, count, mode] = process.argv.slice(2);
const transport = pino.transport({
  targets: [
    { target: 'pino/file', options: { destination: 1 } },
    {
      target: fileURLToPath(new URL('../../lib/pino-openobserve.mjs', import.meta.url)),
      options: { url, organization: 'default', streamName: 'logs', auth: { username: 'user', password: 'pass' }, batchSize: Number(batchSize) },
    },
  ],
});
await once(transport, 'ready');
transport.ref();
const logger = pino(transport);
for (let i = 0; i < Number(count); i++) logger.error(`record ${i}`);
if (mode === 'process-exit') process.exit(0);
const closed = once(transport, 'close');
transport.end();
await closed;
