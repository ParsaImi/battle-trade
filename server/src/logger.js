// Minimal timestamped logger. Keeps output greppable without pulling in a
// logging dependency for a game server this size.

function stamp() {
  return new Date().toISOString();
}

function write(stream, level, msg, extra) {
  const line = `${stamp()} [${level}] ${msg}`;
  if (extra !== undefined) {
    stream.write(`${line} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}\n`);
  } else {
    stream.write(`${line}\n`);
  }
}

export const log = {
  info: (msg, extra) => write(process.stdout, 'info', msg, extra),
  warn: (msg, extra) => write(process.stderr, 'warn', msg, extra),
  error: (msg, extra) => {
    // Errors carry a stack; everything else is serialised as-is.
    const detail = extra instanceof Error ? extra.stack : extra;
    write(process.stderr, 'error', msg, detail);
  },
};
