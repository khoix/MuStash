// CommonJS entry for mounting MuStash in main-server.js (same pattern as pixlab/optprob).
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';

let app = null;
let loadError = null;

const loading = import('./server.mjs')
  .then((mod) => mod.createApp())
  .then((created) => {
    app = created;
    return app;
  })
  .catch((error) => {
    loadError = error;
    console.error('❌ MuStash failed to initialize:', error.message || error);
    throw error;
  });

function mountableApp(req, res, next) {
  if (app) return app(req, res, next);
  if (loadError) {
    return res.status(503).json({
      error: 'MuStash is not available',
      message: loadError.message || 'Failed to initialize'
    });
  }
  loading.then(() => app(req, res, next)).catch(next);
}

module.exports = mountableApp;
