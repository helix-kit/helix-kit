import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const rest = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const text = typeof stack === 'string' ? stack : String(message);
    return `${String(timestamp)} ${level}: ${text}${rest}`;
  }),
);

const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export const logger = winston.createLogger({
  format: isProduction ? productionFormat : developmentFormat,
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [new winston.transports.Console()],
});

export type Logger = typeof logger;
