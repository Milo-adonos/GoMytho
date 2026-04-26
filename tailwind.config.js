/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-bg': '#0A0E1A',
        'secondary-bg': '#141826',
        'lime': '#C6FF3C',
        'lime-hover': '#9FE831',
        'text-primary': '#F5F5F0',
        'text-secondary': '#8A8FA0',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
