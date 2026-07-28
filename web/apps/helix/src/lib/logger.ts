import * as winston from 'winston';

import { requestContextStorage } from '@/lib/request-context';

const isProduction = process.env['NODE_ENV'] === 'production';

const injectRequestContext = winston.format((info) => {
  const ctx = requestContextStorage.getStore();
  if (ctx !== undefined) {
    info.requestId = ctx.requestId;
    info.method = ctx.method;
    info.path = ctx.path;
  }
  return info;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    injectRequestContext(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'helix' },
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(
            injectRequestContext(),
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
          )
        : winston.format.combine(
            injectRequestContext(),
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(
              ({ timestamp, level, message, service, requestId, method, path, ...meta }) => {
                const reqStr =
                  requestId !== undefined
                    ? ` [${String(method)} ${String(path)} req:${String(requestId)}]`
                    : '';
                const metaStr =
                  Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
                return `${String(timestamp)} [${String(service)}]${reqStr} ${String(level)}: ${String(message)}${metaStr}`;
              },
            ),
          ),
    }),
  ],
});

export default logger;
