import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requests = new AsyncLocalStorage();

export function logContext() {
  const context = requests.getStore();
  return { requestId: context?.requestId ?? null, accountId: context?.accountId ?? null };
}

export function logRecord(level, event, data = {}, context = logContext()) {
  return { createdAt: new Date().toISOString(), level, requestId: context.requestId ?? null,
    accountId: context.accountId ?? null, event, data };
}

export function writeLog(record, prefix = '') {
  const output = (prefix ? prefix + ' ' : '') + JSON.stringify(record);
  if (record.level === 'error') console.error(output);
  else if (record.level === 'warn') console.warn(output);
  else console.info(output);
}

export function logEvent(level, event, data = {}, context) {
  const record = logRecord(level, event, data, context);
  writeLog(record);
  return record;
}

// Identity comes only from validated server credentials, never request fields.
// Keep a request-local object for callbacks emitted outside the async context.
export function requestLoggingMiddleware(identify) {
  return (req, res, next) => {
    const context = { requestId: randomUUID(), accountId: null }, started = Date.now();
    req.logContext = context;
    res.setHeader('X-Request-Id', context.requestId);
    const metadata = () => ({ method: req.method, route: req.path, elapsedMs: Date.now() - started });
    requests.run(context, () => {
      res.once('finish', () => logEvent(res.statusCode >= 500 ? 'error' : 'info', 'http_request_finished',
        { ...metadata(), status: res.statusCode }, context));
      res.once('close', () => {
        if (!res.writableFinished) logEvent('warn', 'http_client_disconnected', metadata(), context);
      });
      try {
        context.accountId = identify(req);
        logEvent('info', 'http_request_received', metadata(), context);
        next();
      } catch (error) { next(error); }
    });
  };
}
