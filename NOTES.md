# Football — Web & Pipeline Notes

## Web sitesi (Next.js)

SQLite veritabanı `data-pipeline/data/football.db` dosyasından **salt okunur** okunur.

```bash
docker compose build web
docker compose up web
```

Tarayıcı: http://localhost:3000

`docker compose build web` sonrası sayfa bozuksa (JS chunk ERR_CONNECTION_RESET):
container yeniden ayağa kalkana kadar bekleyin, ardından **Ctrl+Shift+R** ile hard refresh yapın.

### Yerel geliştirme (Docker olmadan)

Windows'ta `better-sqlite3` native derleme gerektirir. Docker önerilir.

```bash
cd web
npm install
# DB_PATH varsayılan: ../data-pipeline/data/football.db
npm run dev
```

## Veri pipeline

```bash
docker compose build
docker compose --profile tools run --rm migrate
docker compose run --rm pilot
docker compose --profile tools run --rm -e COMPETITION=EC,WC -e FROM=2024 -e TO=2026 backfill
```
