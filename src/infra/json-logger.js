/**
 * One JSON object per line on stdout (journald captures it on the VM).
 * Callers must pass ids, never names/emails/passport data.
 *
 * @typedef {{ info: (event: string, fields?: object) => void, warn: (event: string, fields?: object) => void, error: (event: string, fields?: object) => void }} Logger
 * @returns {Logger}
 */
export function createJsonLogger() {
  const write = (level, event, fields = {}) =>
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`);
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
