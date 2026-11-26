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
      },
    },
  },
  plugins: [],
}
