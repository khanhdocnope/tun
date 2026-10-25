/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#121316',
        card: '#18191d',
        sidebar: '#141518',
        toolbar: '#1a1b20',
        border: '#272930',
        primary: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
        muted: '#94a3b8',
        text: '#f1f5f9',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        comic: ['Bangers', 'Comic Neue', 'Anime Ace', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
