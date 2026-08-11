import { GameCard } from '@/components/GameCard';
import { SITE_GAMES } from '@/lib/games';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="mb-10">
        <h1 className="text-[20px] font-medium text-ink">Hoş geldiniz</h1>
        <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted">
          Gerçek futbol veritabanından beslenen mini oyunlar. Günlük oyuncu tahminiyle
          başlayın; diğer modlar yakında eklenecek.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-[13px] font-medium uppercase tracking-wide text-muted-light">
          Oyunlar
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SITE_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>
    </div>
  );
}
