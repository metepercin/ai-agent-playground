import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load, save, addTask, completeTask, listTasks } from '../src/store.js';

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

import { spawn } from 'node:child_process';
import { writeFileSync, readdirSync, symlinkSync, existsSync, mkdirSync, lstatSync, readlinkSync } from 'node:fs';
import { withLock, lockPath, isCaseInsensitiveDir } from '../src/store.js';

const runCli = (args, file) => new Promise((res) => {
  const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, TASKS_FILE: file } });
  let err = ''; p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => res({ code, err }));
});

test('eşzamanlı add çağrıları güncelleme kaybetmez', async () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => runCli(['add', 't' + i], f)));
    assert.ok(rs.every((r) => r.code === 0), rs.map((r) => r.err).join());
    const d = load(f);
    assert.equal(d.tasks.length, 12);
    assert.equal(new Set(d.tasks.map((t) => t.id)).size, 12);
    assert.equal(d.nextId, 13);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('kilit zaman aşımında açık hata verir ve başkasının kilidini silmez', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    withLock(f, () => {
      const locks = readdirSync(dir).filter((n) => n.endsWith('.lock'));
      assert.equal(locks.length, 1);
      assert.throws(() => withLock(f, () => {}, { timeoutMs: 100 }), /Kilit alınamadı/);
      assert.ok(existsSync(join(dir, locks[0])));
    });
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('kilit fn hata verse de kaldırılır', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    assert.throws(() => withLock(f, () => { throw new Error('x'); }), /x/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('save eski sabit geçici yoldaki sembolik bağı izlemez', () => {
  const dir = tmp();
  try {
    const victim = join(dir, 'victim'); writeFileSync(victim, 'keep');
    const old = join(dir, 't.json.tmp');
    symlinkSync(victim, old);
    const f = join(dir, 't.json');
    save(f, { nextId: 7, tasks: [] });
    assert.equal(readFileSync(victim, 'utf8'), 'keep');
    assert.ok(lstatSync(old).isSymbolicLink());
    assert.equal(readlinkSync(old), victim);
    assert.equal(load(f).nextId, 7);
    assert.deepEqual(readdirSync(dir).sort(), ['t.json', 't.json.tmp', 'victim']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('save uzun dosya adlarıyla çalışır ve hata durumunda geçici dosya bırakmaz', () => {
  const dir = tmp();
  try {
    const long = join(dir, 'a'.repeat(250) + '.json');
    save(long, { nextId: 1, tasks: [] });
    assert.equal(load(long).nextId, 1);
    const bad = join(dir, 'd.json'); mkdirSync(bad);
    assert.throws(() => save(bad, { nextId: 1, tasks: [] }));
    assert.deepEqual(readdirSync(dir).sort(), ['a'.repeat(250) + '.json', 'd.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lockPath: büyük/küçük harf takma adları duyarsız dizinde aynı kilidi kullanır', () => {
  const dir = tmp();
  try {
    const ci = { probe: () => true }, cs = { probe: () => false };
    assert.equal(lockPath(join(dir, 'tasks.json'), ci), lockPath(join(dir, 'TASKS.json'), ci));
    assert.notEqual(lockPath(join(dir, 'tasks.json'), cs), lockPath(join(dir, 'TASKS.json'), cs));
    assert.notEqual(lockPath(join(dir, 'a.json'), ci), lockPath(join(dir, 'b.json'), ci));
    assert.equal(typeof isCaseInsensitiveDir(dir), 'boolean');
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('load geçersiz nextId değerlerini reddeder; add dosyaya yazmaz', async () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    const t = { id: 5, title: 'a', done: false };
    for (const nextId of [undefined, null, 0, -1, 1.5, '6', 5, 2 ** 53]) {
      writeFileSync(f, JSON.stringify({ nextId, tasks: [t] }));
      assert.throws(() => load(f), /nextId/);
    }
    writeFileSync(f, JSON.stringify({ tasks: [t] }));
    const before = readFileSync(f, 'utf8');
    const r = await runCli(['add', 'x'], f);
    assert.equal(r.code, 1); assert.match(r.err, /nextId/);
    assert.equal(readFileSync(f, 'utf8'), before);
    assert.deepEqual(readdirSync(dir), ['t.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('addTask güvenli tam sayı sınırında taşmayı reddeder', () => {
  const d = { nextId: Number.MAX_SAFE_INTEGER, tasks: [] };
  assert.throws(() => addTask(d, 'x'), /sınır/);
  assert.equal(d.tasks.length, 0);
});

test('help ve bilinmeyen komut bozuk veri dosyasıyla da kullanım yazar', () => {
  const dir = tmp(); const f = join(dir, 't.json');
  try {
    writeFileSync(f, '{bozuk');
    const env = { ...process.env, TASKS_FILE: f };
    const h = spawnSync(process.execPath, [cli, 'help'], { env, encoding: 'utf8' });
    assert.equal(h.status, 0); assert.match(h.stdout, /Kullanım/);
    const u = spawnSync(process.execPath, [cli, 'nope'], { env, encoding: 'utf8' });
    assert.equal(u.status, 1); assert.match(u.stdout, /Kullanım/); assert.equal(u.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('save kısa yazmada dosyayı tam yazar ve geçici dosya bırakmaz', async () => {
  const fs = (await import('node:fs')).default;
  const dir = tmp();
  const file = join(dir, 'tasks.json');
  const data = { nextId: 3, tasks: [{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }] };
  const orig = fs.writeSync;
  let calls = 0;
  fs.writeSync = (fd, buf, off, len, ...r) => { calls++; return orig(fd, buf, off, calls === 1 ? Math.min(5, len) : len, ...r); };
  try { save(file, data); } finally { fs.writeSync = orig; }
  assert.ok(calls > 1);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), data);
  assert.deepEqual(readdirSync(dir), ['tasks.json']);
  rmSync(dir, { recursive: true });
});

test('save yazma hatasında eski dosyayı korur ve geçici dosyayı siler', async () => {
  const fs = (await import('node:fs')).default;
  const dir = tmp();
  const file = join(dir, 'tasks.json');
  save(file, { nextId: 2, tasks: [{ id: 1, title: 'old', done: false }] });
  const before = readFileSync(file, 'utf8');
  const orig = fs.writeSync;
  fs.writeSync = () => 0; // no progress
  try { assert.throws(() => save(file, { nextId: 9, tasks: [] })); } finally { fs.writeSync = orig; }
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(readdirSync(dir), ['tasks.json']);
  rmSync(dir, { recursive: true });
});
