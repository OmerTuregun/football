import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Sidebar } from '@/components/Sidebar';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Futbolistan',
  description: 'Futbol istatistik veritabanından beslenen mini oyunlar',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-page font-sans text-ink antialiased`}
      >
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="relative flex-1 overflow-y-auto bg-page px-6 py-8 md:px-10 md:py-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
