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

function allowSameOriginContentFrames(req, res) {
  const pathname = String(req.url || '').split('?')[0];
  if (!pathname.startsWith('/api/shares/') || !pathname.endsWith('/content')) return;

  // Helmet correctly prevents MuStash pages from being framed, but PDF/text
  // previews are intentionally embedded by the same-origin recipient page.
  // Adjust only file-content responses at the point headers are committed.
  const originalWriteHead = res.writeHead;
  res.writeHead = function writeHeadWithPreviewCsp(...args) {
    const header = res.getHeader('Content-Security-Policy');
    if (typeof header === 'string') {
      res.setHeader(
        'Content-Security-Policy',
        header.replace(/frame-ancestors\s+'none'/i, "frame-ancestors 'self'")
      );
    }
    return originalWriteHead.apply(this, args);
  };
}

function dispatch(req, res, next) {
  const [pathname, query = ''] = String(req.url || '').split('?');
  if (pathname === '/admin/') req.url = `/admin/index.html${query ? `?${query}` : ''}`;
  if (isAdminPath(req)) return adminApp(req, res, next);
  allowSameOriginContentFrames(req, res);
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
