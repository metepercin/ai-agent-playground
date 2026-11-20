# ai-agent-playground

## Görev Yöneticisi CLI

Yalnızca Node.js yerleşik modüllerini kullanan basit bir komut satırı görev yöneticisi. Harici bağımlılık yoktur. Görevler yerel bir JSON dosyasında saklanır.

### Kullanım

```bash
node src/cli.js add Süt al          # Eklendi: #1 Süt al
node src/cli.js add "Rapor yaz"     # Eklendi: #2 Rapor yaz
node src/cli.js list                #   1  [ ] Süt al
node src/cli.js done 1              # Tamamlandı: #1 Süt al
node src/cli.js list --pending      # yalnızca bekleyenler
```

Veri dosyası varsayılan olarak çalışma dizinindeki `tasks.json`'dır; `TASKS_FILE` ortam değişkeniyle değiştirilebilir:

```bash
TASKS_FILE=~/gorevler.json node src/cli.js list
```

`add` ve `done` işlemleri veri dosyasının yanındaki `<dosya>.lock` kilit dosyasıyla süreçler arasında sıraya alınır (en fazla ~5 sn beklenir, sonra hata verilir). Yazma, aynı dizindeki benzersiz bir geçici dosya üzerinden atomik `rename` ile yapılır. `nextId` pozitif bir tam sayı ve mevcut tüm id'lerden büyük olmalıdır; aksi halde dosya reddedilir. `help` ve bilinmeyen komutlar veri dosyasını okumaz.

Hata durumunda (örn. bilinmeyen id) komut `1` çıkış koduyla biter.

### Testler

```bash
npm test      # veya: node --test
```
