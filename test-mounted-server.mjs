import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mustash = require('./server.cjs');
const PORT = Number(process.env.PORT || 4173);

const host = express();
host.disable('x-powered-by');
// Keep the historical root test surface while also exercising the production mount path.
host.use('/mustash', mustash);
host.use('/', mustash);

const server = host.listen(PORT, '127.0.0.1', () => {
  console.log(`MuStash test server listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
