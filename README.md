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

Hata durumunda (örn. bilinmeyen id) komut `1` çıkış koduyla biter.

Eşzamanlı `add`/`done` çağrıları veri dosyasının yanındaki gizli bir kilit dosyasıyla (`.lock-*.lock`; büyük/küçük harf duyarsız dizinlerde dizin başına tek kilit, `.lock-dir.lock`) sıralanır; kilit 5 saniye içinde alınamazsa açık bir hata verilir (süreç çökmüşse eski kilit dosyasını elle silin). Yazma, aynı dizinde benzersiz bir geçici dosyaya yapılıp `rename` ile yerine konur.

Veri dosyasındaki `nextId` pozitif bir güvenli tam sayı (en çok `Number.MAX_SAFE_INTEGER`) ve mevcut tüm id'lerden büyük olmalıdır; aksi halde dosya reddedilir. Id'ler `Number.MAX_SAFE_INTEGER` sınırını aşamaz; sınıra ulaşılınca `add` hata verir. `help` ve bilinmeyen komutlar veri dosyası okunmadan çalışır.

### Testler

```bash
npm test      # veya: node --test
```
