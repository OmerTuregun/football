import { GameCard } from '@/components/GameCard';
import { SITE_GAMES } from '@/lib/games';

export default function HomePage() {
  return (
    <div className="relative mx-auto max-w-4xl">
      <section className="site-hero mb-10 overflow-hidden rounded-[16px] border border-line/60 px-6 py-8 sm:px-8 sm:py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-dark/80">
          Futbolistan
        </p>
        <h1 className="mt-2 max-w-xl text-[28px] font-semibold tracking-tight text-ink sm:text-[32px]">
          Sahadan gelen günlük oyunlar
        </h1>
        <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted">
          Gerçek maç ve oyuncu verisiyle kısa turlar. Tahmin et, bağla, sırala — test değil,
          maç temposu.
        </p>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
            Oyun seç
          </h2>
          <span className="text-[12px] text-muted-light">{SITE_GAMES.length} mod</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SITE_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>
    </div>
  );
}
