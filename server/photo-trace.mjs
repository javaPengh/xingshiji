import { logEvent, logRecord, writeLog } from './logging.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

// Runs before JSON parsing so incomplete uploads also leave a trace. Only
// operational metadata is recorded; never headers, image data or model text.
export function photoTraceMiddleware(store) {
  return (req, res, next) => {
    if (req.method !== 'POST' || !['/api/photos', '/api/sync/photos', '/api/ai/recognize'].includes(req.path)) return next();
    const context = req.logContext, started = Date.now();
    let photoId = null, receivedBytes = 0;
    const trace = (event, data = {}) => {
      const row = { ...logRecord('info', event, data, context), photoId, elapsedMs: Date.now() - started };
      try { store.recordPhotoEvent(row); } catch (error) { logEvent('error', 'photo_log_unavailable', { code: error.code || error.name }, context); }
      writeLog(row, '[Photo]');
    };
    trace.photo = id => { if (uuid(id)) photoId = id; };
    trace.account = id => { context.accountId = id; };
    trace.failure = error => trace('request_failed', { errorType: error.name || 'Error', code: error.code || error.cause?.code || null, status: error.status || null, diagnosticId: error.diagnosticId || null, phase: error.diagnosticPhase || null });
    req.photoTrace = trace;
    res.setHeader('X-Photo-Request-Id', context.requestId);
    trace('request_received', { route: req.path, declaredBytes: Number(req.get('content-length')) || null });
    req.on('data', chunk => { receivedBytes += chunk.length; });
    req.once('aborted', () => trace('upload_aborted', { receivedBytes }));
    req.once('error', error => trace('request_stream_error', { code: error.code || null, receivedBytes }));
    req.once('end', () => trace('request_body_received', { receivedBytes }));
    res.once('finish', () => trace('response_finished', { status: res.statusCode }));
    res.once('close', () => { if (!res.writableFinished) trace('client_disconnected', { receivedBytes }); });
    next();
  };
}
