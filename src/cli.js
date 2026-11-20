#!/usr/bin/env node
import { join } from 'node:path';
import { load, update, addTask, completeTask, listTasks, formatTask } from './store.js';

const USAGE = `Kullanım:
  task add <başlık>      Görev ekle
  task list [--pending]  Görevleri listele
  task done <id>         Görevi tamamla
Veri dosyası: $TASKS_FILE (varsayılan: ./tasks.json)`;

export function run(argv, env = process.env, out = console.log) {
  const file = env.TASKS_FILE || join(process.cwd(), 'tasks.json');
  const [cmd, ...rest] = argv;
  if (!['add', 'list', 'done'].includes(cmd)) {
    out(USAGE);
    if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
    return;
  }
  switch (cmd) {
    case 'add': {
      const t = update(file, (data) => addTask(data, rest.join(' ')));
      out(`Eklendi: #${t.id} ${t.title}`);
      return;
    }
    case 'list': {
      const tasks = listTasks(load(file), { onlyPending: rest.includes('--pending') });
      if (!tasks.length) out('Görev yok.');
      else tasks.forEach((t) => out(formatTask(t)));
      return;
    }
    case 'done': {
      const t = update(file, (data) => completeTask(data, rest[0]));
      out(`Tamamlandı: #${t.id} ${t.title}`);
      return;
    }
  }
}

try {
  run(process.argv.slice(2));
} catch (e) {
  console.error('Hata: ' + e.message);
  process.exitCode = 1;
}
