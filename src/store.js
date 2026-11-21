import fs from 'node:fs';
const { readFileSync, closeSync, openSync, renameSync, unlinkSync, existsSync } = fs;
import { createHash, randomBytes } from 'node:crypto';
import { dirname, basename, join, resolve } from 'node:path';

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 20;
const SHARED_LOCK_NAME = '.lock-dir.lock';

export function load(file) {
  if (!existsSync(file)) return { nextId: 1, tasks: [] };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.tasks)) throw new Error('Geçersiz veri dosyası: ' + file);
  const isId = (n) => Number.isSafeInteger(n) && n > 0;
  let max = 0;
  for (const t of data.tasks) {
    if (!t || !isId(t.id)) throw new Error('Geçersiz görev id: ' + file);
    if (t.id > max) max = t.id;
  }
  if (!isId(data.nextId) || data.nextId <= max) {
    throw new Error(`Geçersiz nextId (pozitif güvenli tam sayı ve mevcut tüm id'lerden büyük olmalı): ${file}`);
  }
  return data;
}

// Lock/temp names are short and fixed-length so long data file names cannot exceed NAME_MAX.
function sibling(file, prefix, suffix) {
  const h = createHash('sha1').update(basename(file)).digest('hex').slice(0, 12);
  return join(dirname(file), `.${prefix}-${h}${suffix}`);
}

// Probes whether dir is case-insensitive: create a temp file, look it up by its upper-case name.
// If the probe cannot run, assume case-insensitive (only costs extra lock contention).
export function isCaseInsensitiveDir(dir) {
  const name = `.case-probe-${process.pid}-${randomBytes(6).toString('hex')}`;
  const p = join(dir, name);
  try {
    closeSync(openSync(p, 'wx', 0o600));
  } catch { return true; }
  try { return existsSync(join(dir, name.toUpperCase())); }
  finally { try { unlinkSync(p); } catch {} }
}

// Win32 ignores trailing dots and spaces in the final component, so "name." names the same file as "name".
export function isReservedLockName(base) {
  const b = base.replace(/[. ]+$/, '');
  return b.toLowerCase() === SHARED_LOCK_NAME || b.toUpperCase() === SHARED_LOCK_NAME.toUpperCase();
}

// Lock path for a data file. The directory is resolved with realpath (so symlinked directory aliases
// agree); on a case-insensitive directory every data file shares one fixed
// per-directory lock, even when the data file does not exist yet. `probe` may be injected for tests.
export function lockPath(file, { probe = isCaseInsensitiveDir } = {}) {
  const abs = resolve(file);
  const dir = fs.realpathSync(dirname(abs));
  // Case-insensitive directory: one shared lock for the whole directory, since we cannot
  // reproduce the filesystem's own case mapping (e.g. Σ/σ/ς).
  if (probe(dir)) {
    const base = basename(abs);
    if (isReservedLockName(base)) {
      throw new Error(`Veri dosyası adı "${base}" deponun kilidi için ayrılmıştır; başka bir ad kullanın.`);
    }
    return join(dir, SHARED_LOCK_NAME);
  }
  return sibling(join(dir, basename(abs)), 'lock', '.lock');
}

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));

// Serializes read-modify-write across processes using an exclusive lock file.
// The timeout uses a monotonic clock so wall-clock changes cannot affect it.
export function withLock(file, fn, { timeoutMs = LOCK_TIMEOUT_MS, probe } = {}) {
  const lock = lockPath(file, probe ? { probe } : undefined);
  const start = process.hrtime.bigint();
  const limit = BigInt(timeoutMs) * 1000000n;
  let fd;
  for (;;) {
    try { fd = openSync(lock, 'wx', 0o600); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (process.hrtime.bigint() - start >= limit) {
        throw new Error(`Kilit alınamadı (${timeoutMs} ms): ${lock} başka bir işlem tarafından tutuluyor.` +
          (lock === resolve(file) || isReservedLockName(basename(file)) ? '' : ' Eski bir kilit dosyasıysa silin.'));
      }
      Atomics.wait(sleepBuf, 0, 0, LOCK_RETRY_MS);
    }
  }
  // We created the lock file, so we own it and are the only one who removes it.
  try { return fn(); }
  finally {
    try { closeSync(fd); } catch {}
    try { unlinkSync(lock); } catch {}
  }
}

export function update(file, fn, opts) {
  return withLock(file, () => {
    const data = load(file);
    const result = fn(data);
    save(file, data);
    return result;
  }, opts);
}

export function save(file, data) {
  const tmp = sibling(file, 'tmp', `-${process.pid}-${randomBytes(6).toString('hex')}`);
  const buf = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
  // exclusive: never follows/overwrites an existing path; if this throws we created nothing
  let fd = openSync(tmp, 'wx', 0o600);
  try {
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off); // may be a short write
      if (!Number.isInteger(n) || n <= 0) throw new Error('Veri dosyası yazılamadı (kısa yazma): ' + tmp);
      off += n;
    }
    fs.fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    try { unlinkSync(tmp); } catch {} // our own file, created above with 'wx'
    throw e;
  }
}

export function addTask(data, title) {
  title = String(title ?? '').trim();
  if (!title) throw new Error('Görev başlığı boş olamaz.');
  if (!Number.isSafeInteger(data.nextId + 1)) throw new Error('Görev id sınırına ulaşıldı (en büyük güvenli tam sayı).');
  const task = { id: data.nextId++, title, done: false, createdAt: new Date().toISOString() };
  data.tasks.push(task);
  return task;
}

export function completeTask(data, id) {
  const task = data.tasks.find((t) => t.id === Number(id));
  if (!task) throw new Error(`Görev bulunamadı: ${id}`);
  if (!task.done) { task.done = true; task.completedAt = new Date().toISOString(); }
  return task;
}

export function listTasks(data, { all = true, onlyPending = false } = {}) {
  return onlyPending ? data.tasks.filter((t) => !t.done) : data.tasks;
}

export function formatTask(t) {
  return `${String(t.id).padStart(3)}  [${t.done ? 'x' : ' '}] ${t.title}`;
}
