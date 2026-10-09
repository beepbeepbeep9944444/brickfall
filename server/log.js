// Minimal logger: readable lines in development, one JSON object per line in production.
import { config } from './config.js';

function write(level, msg, extra) {
  const time = new Date().toISOString();
  if (config.isProduction) {
    const line = JSON.stringify({ time, level, msg, ...extra });
    (level === 'error' ? console.error : console.log)(line);
  } else {
    const tail = extra && Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
    (level === 'error' ? console.error : console.log)(`${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
  }
}

export const log = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};
