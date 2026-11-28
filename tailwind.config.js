/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        dash: {
          DEFAULT: '#008CE7',
          dark: '#006bb3',
          light: '#33a0f0',
          400: '#75d0ff',
          500: '#3aacff',
        },
        // Design tokens — use these instead of raw hex utilities going forward.
        page: '#0b1220',        // page background
        surface: '#111a2e',     // cards / panels
        surface2: '#18233c',    // subtle fills / chips
        line: '#22304e',        // borders / dividers
        text: '#e8edf7',        // primary text
        muted: '#93a1bd',       // secondary text
        input: 'var(--input-border)', // input borders (--input-border = #62749b)
      },
    },
  },
  plugins: [],
}
