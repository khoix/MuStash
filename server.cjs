// CommonJS entry for mounting MuStash in main-server.js (same pattern as pixlab/optprob).
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';

let app = null;
let adminApp = null;
let loadError = null;

const loading = Promise.all([
  import('./server.mjs'),
  import('./admin.mjs')
])
  .then(async ([mainMod, adminMod]) => {
    const [createdApp, createdAdminApp] = await Promise.all([
      mainMod.createApp(),
      adminMod.createAdminApp()
    ]);
    app = createdApp;
    adminApp = createdAdminApp;
    return app;
  })
  .catch((error) => {
    loadError = error;
    console.error('❌ MuStash failed to initialize:', error.message || error);
    throw error;
  });

function isAdminPath(req) {
  const pathname = String(req.url || '').split('?')[0];
  return pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname === '/api/admin'
    || pathname.startsWith('/api/admin/');
}

function dispatch(req, res, next) {
  const [pathname, query = ''] = String(req.url || '').split('?');
  if (pathname === '/admin/') req.url = `/admin/index.html${query ? `?${query}` : ''}`;
  if (isAdminPath(req)) return adminApp(req, res, next);
  return app(req, res, next);
}

function mountableApp(req, res, next) {
  if (app && adminApp) return dispatch(req, res, next);
  if (loadError) {
    return res.status(503).json({
      error: 'MuStash is not available',
      message: loadError.message || 'Failed to initialize'
    });
  }
  loading.then(() => dispatch(req, res, next)).catch(next);
}

module.exports = mountableApp;
