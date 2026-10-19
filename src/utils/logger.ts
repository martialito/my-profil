import fs from 'node:fs';
import path from 'node:path';
import { env, paths } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StepErrorContext {
  company?: string;
  job?: string;
  step: string;
  reason: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function hhmm(d = new Date()): string {
  return d.toTimeString().slice(0, 5);
}

class Logger {
  private stream: fs.WriteStream | undefined;
  private minLevel: LogLevel = 'info';

  private file(): fs.WriteStream | undefined {
    if (env().NODE_ENV === 'test') return undefined;
    if (!this.stream) {
      const dir = paths.logs();
      fs.mkdirSync(dir, { recursive: true });
      this.stream = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });
    }
    return this.stream;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const prefix = level === 'error' ? '[ERROR] ' : level === 'warn' ? '[WARN] ' : '';
    const line = `[${hhmm()}] ${prefix}${message}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    if (env().NODE_ENV !== 'test') {
      (level === 'error' ? console.error : console.log)(line);
    }
    this.file()?.write(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
  debug(msg: string, meta?: Record<string, unknown>): void {
    this.write('debug', msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    this.write('info', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.write('warn', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.write('error', msg, meta);
  }

  /** Multi-line error block for pipeline steps, e.g. "Upload resume" failures. */
  stepError(ctx: StepErrorContext): void {
    const lines = [
      ctx.company ? `Company: ${ctx.company}` : undefined,
      ctx.job ? `Job: ${ctx.job}` : undefined,
      `Step: ${ctx.step}`,
      `Reason: ${ctx.reason}`,
    ].filter(Boolean);
    this.write('error', '\n' + lines.join('\n'));
  }
}

export const logger = new Logger();
