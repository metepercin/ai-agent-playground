import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { load, save, withLock, addTask, completeTask, listTasks } from '../src/store.js';

const cli = new URL('../src/cli.js', import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'task-'));

test('addTask artan id verir ve boş başlığı reddeder', () => {
  const d = { nextId: 1, tasks: [] };
  assert.equal(addTask(d, 'a').id, 1);
  assert.equal(addTask(d, ' b ').title, 'b');
  assert.equal(d.tasks.length, 2);
  assert.throws(() => addTask(d, '   '));
});

test('completeTask görevi tamamlar; bilinmeyen id hata verir', () => {
  const d = { nextId: 1, tasks: [] };
  addTask(d, 'a');
  assert.equal(completeTask(d, '1').done, true);
  assert.throws(() => completeTask(d, 99));
});

test('listTasks bekleyenleri filtreler', () => {
  const d = { nextId: 1, tasks: [] };
  addTask(d, 'a'); addTask(d, 'b'); completeTask(d, 1);
  assert.equal(listTasks(d).length, 2);
  assert.deepEqual(listTasks(d, { onlyPending: true }).map((t) => t.title), ['b']);
});

test('save/load JSON dosyasında kalıcıdır', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    assert.deepEqual(load(f), { nextId: 1, tasks: [] });
    const d = load(f); addTask(d, 'x'); save(f, d);
    assert.equal(load(f).tasks[0].title, 'x');
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).nextId, 2);
  } finally { rmSync(dir, { recursive: true }); }
});

test('CLI uçtan uca: add, list, done', () => {
  const dir = tmp(); const env = { ...process.env, TASKS_FILE: join(dir, 't.json') };
  const r = (...a) => spawnSync(process.execPath, [cli, ...a], { env, encoding: 'utf8' });
  try {
    assert.match(r('add', 'süt', 'al').stdout, /Eklendi: #1 süt al/);
    assert.match(r('list').stdout, /\[ \] süt al/);
    assert.match(r('done', '1').stdout, /Tamamlandı: #1/);
    assert.match(r('list').stdout, /\[x\] süt al/);
    assert.match(r('list', '--pending').stdout, /Görev yok/);
    const bad = r('done', '42');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Hata/);
  } finally { rmSync(dir, { recursive: true }); }
});

const runAsync = (env, ...a) => new Promise((res) => {
  const c = spawn(process.execPath, [cli, ...a], { env });
  let err = ''; c.stderr.on('data', (d) => (err += d));
  c.on('close', (code) => res({ code, err }));
});

test('eşzamanlı add çağrıları güncelleme kaybetmez', async () => {
  const dir = tmp(); const f = join(dir, 't.json'); const env = { ...process.env, TASKS_FILE: f };
  try {
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => runAsync(env, 'add', 't' + i)));
    rs.forEach((r) => assert.equal(r.code, 0, r.err));
    const d = load(f);
    assert.equal(d.tasks.length, 12);
    assert.equal(new Set(d.tasks.map((t) => t.id)).size, 12);
    assert.equal(existsSync(f + '.lock'), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('withLock zaman aşımında açık hata verir ve başkasının kilidini silmez', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    writeFileSync(f + '.lock', '');
    assert.throws(() => withLock(f, () => {}, { timeoutMs: 50 }), /Kilit alınamadı/);
    assert.equal(existsSync(f + '.lock'), true);
  } finally { rmSync(dir, { recursive: true }); }
});

test('save sembolik bağlantı üzerinden yazmaz ve geçici dosya bırakmaz', () => {
  const dir = tmp(); const f = join(dir, 't.json'); const victim = join(dir, 'victim');
  try {
    writeFileSync(victim, 'dokunma');
    symlinkSync(victim, f + '.tmp');
    save(f, { nextId: 1, tasks: [] });
    assert.equal(readFileSync(victim, 'utf8'), 'dokunma');
    assert.equal(load(f).nextId, 1);
    const circular = {}; circular.c = circular;
    assert.throws(() => save(f, circular));
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), ['t.json.tmp']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('geçersiz nextId reddedilir ve dosya değişmez', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  const env = { ...process.env, TASKS_FILE: f };
  try {
    for (const bad of [undefined, null, 0, -1, 1.5, '3', 2 ** 60]) {
      const body = JSON.stringify({ nextId: bad, tasks: [] });
      writeFileSync(f, body);
      assert.throws(() => load(f), /nextId/);
      const r = spawnSync(process.execPath, [cli, 'add', 'x'], { env, encoding: 'utf8' });
      assert.equal(r.status, 1); assert.match(r.stderr, /nextId/);
      assert.equal(readFileSync(f, 'utf8'), body);
    }
    writeFileSync(f, JSON.stringify({ nextId: 3, tasks: [{ id: 3, title: 'a', done: false }] }));
    assert.throws(() => load(f), /nextId/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('help ve bilinmeyen komut bozuk veri dosyasında da kullanımı yazar', () => {
  const dir = tmp(); const f = join(dir, 't.json'); const env = { ...process.env, TASKS_FILE: f };
  try {
    writeFileSync(f, '{bozuk');
    const h = spawnSync(process.execPath, [cli, 'help'], { env, encoding: 'utf8' });
    assert.equal(h.status, 0); assert.match(h.stdout, /Kullanım/);
    const u = spawnSync(process.execPath, [cli, 'bilinmeyen'], { env, encoding: 'utf8' });
    assert.equal(u.status, 1); assert.match(u.stdout, /Kullanım/); assert.equal(u.stderr, '');
  } finally { rmSync(dir, { recursive: true }); }
});
