const multer = require('multer');

function apiNotFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? (err.field === 'referenceImage' ? 'Reference image must be under 3MB' : 'Image must be under 4MB') : err.message });
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(', ') });
  if (!err.expose) console.error(err);
  res.status(err.status || 500).json({
    error: err.expose ? err.message : 'Something went wrong',
    ...(err.expose && err.reason ? { reason: err.reason } : {}),
  });
}

// Express 4 doesn't catch rejected promises by itself, so wrap every async
// route handler, including the ones inside routers.
function wrapAsyncRoutes(stack) {
  for (const layer of stack) {
    if (layer.route) {
      for (const l of layer.route.stack) {
        const fn = l.handle;
        if (fn.constructor.name === 'AsyncFunction') l.handle = (req, res, next) => fn(req, res, next).catch(next);
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      wrapAsyncRoutes(layer.handle.stack);
    }
  }
}

module.exports = { apiNotFound, errorHandler, wrapAsyncRoutes };
