/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.9)', opacity: '0.4' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.15' },
        },
      },
      animation: {
        pop: 'pop 160ms ease-out',
        blink: 'blink 700ms ease-out',
      },
      fontFamily: {
        brutal: ['"Archivo Black"', '"Space Mono"', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;