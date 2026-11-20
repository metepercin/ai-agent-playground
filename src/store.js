import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function load(file) {
  if (!existsSync(file)) return { nextId: 1, tasks: [] };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.tasks)) throw new Error('Geçersiz veri dosyası: ' + file);
  const { nextId } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1) {
    throw new Error('Geçersiz veri dosyası (nextId pozitif tam sayı olmalı): ' + file);
  }
  for (const t of data.tasks) {
    if (!t || !Number.isSafeInteger(t.id) || t.id >= nextId) {
      throw new Error("Geçersiz veri dosyası (nextId, mevcut tüm id'lerden büyük olmalı): " + file);
    }
  }
  return data;
}

export function save(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Serializes read-modify-write cycles across processes via an exclusive lock file.
export function withLock(file, fn, { timeoutMs = 5000, retryMs = 10 } = {}) {
  const lock = file + '.lock';
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = openSync(lock, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() >= deadline) {
        throw new Error(`Kilit alınamadı (zaman aşımı): ${lock} — başka bir işlem çalışıyor olabilir.`);
      }
      sleep(retryMs);
    }
  }
  try {
    return fn();
  } finally {
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

export function addTask(data, title) {
  title = String(title ?? '').trim();
  if (!title) throw new Error('Görev başlığı boş olamaz.');
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
