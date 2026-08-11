import type { Config } from 'tailwindcss';

export default {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        page: '#FFFFFF',
        sidebar: '#FAFAF8',
        brand: '#3B6D11',
        'brand-light': '#EAF3DE',
        'brand-dark': '#27500A',
        'brand-darker': '#173404',
        'brand-border': '#97C459',
        'miss-light': '#FCEBEB',
        'miss-dark': '#791F1F',
        'hint-light': '#FAEEDA',
        'hint-dark': '#633806',
        muted: '#6B6A63',
        'muted-light': '#A8A79C',
        ink: '#1A1A18',
        line: '#E8E8E6',
      },
      borderRadius: {
        pill: '999px',
        card: '8px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
