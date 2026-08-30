import express from 'express';
import { createRequire } from 'node:module';

process.env.TRUST_PROXY = process.env.TRUST_PROXY || '0';

const require = createRequire(import.meta.url);
const mustash = require('./server.cjs');
const PORT = Number(process.env.PORT || 3000);

const host = express();
host.disable('x-powered-by');
host.use('/', mustash);

const server = host.listen(PORT, () => {
  console.log(`MuStash listening on http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
