# StatPal bulk import — yol haritası

## Adım 0 — Keşif ✅
- Lig ID eşleştirmesi doğrulandı (`npm run explore-statpal`)
- Geçmiş maçlarda lineup/event verisi mevcut (`/matches/stats?date=DD.MM.YYYY`)
- `/user-request-count` kotaya dahil değil

## Adım 1 — Şema ✅
- `player_season_stats`: genişletilmiş kolonlar (key_passes, rating, stat_source, …)
- `transfers.price`, `player_trophies`, `players.market_value_eur`
- `match_lineups`, `player_teammates`
- `statpal_fetch_state`, `statpal_fetched_players`

## Adım 2 — statpalClient ✅
- Auth (`STATPAL_ACCESS_KEY`), kota takibi (100 istekte bir `/user-request-count`, dur @ 48k)

## Adım 3 — Import pipeline ✅
Öncelik: CL → PL → PD → SL → BL1 → SA → FL1 → EL → PPL → DED → ECL  
Sezonlar: `2024-2025`, `2025-2026`, `2026-2027`  
Fazlar: `teams` → `players` → `matches` → `lineups` → `teammates`

```bash
# Docker (önerilen)
COMPETITION=CL SEASON=2024-2025 npm run docker:statpal-import

# Yerel
cd data-pipeline && npm run statpal-import -- --competition=CL --season=2024-2025
```

## Adım 4 — Özet log ✅
Her competition+season bitince takım/oyuncu/transfer/maç/lineup sayısı + API kullanımı loglanır.

## Resume
`statpal_fetch_state` tablosu faz bazında `partial`/`done` durumu ve `cursor_json` ile kaldığı yerden devam eder.
