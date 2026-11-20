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
