/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0E0506',
          900: '#160809',
          800: '#1F0D0F',
          700: '#2B1316',
          600: '#3A1D21',
          500: '#4F2A2F',
        },
        blood: {
          900: '#3A0C11',
          700: '#8A1220',
          600: '#B3131F',
          500: '#D91E2B',
          400: '#F0434B',
          300: '#FF7A7F',
        },
        ember: { 700: '#C75A0B', 500: '#FF7A1A', 300: '#FFA85C' },
        sun: { 700: '#C99410', 500: '#FFC83D', 300: '#FFE08A' },
        cream: { 100: '#FFF1EE', 300: '#C9A9AA', 500: '#8F7274' },
      },
      fontFamily: {
        display: ['Fredoka', 'ui-rounded', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
