import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

export function load(file) {
  if (!existsSync(file)) return { nextId: 1, tasks: [] };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.tasks)) throw new Error('Geçersiz veri dosyası: ' + file);
  return data;
}

export function save(file, data) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
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
