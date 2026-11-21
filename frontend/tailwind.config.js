/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Class-based dark mode: the console toggles `dark` on <html>
  // (see App.tsx) and the CSS variables in index.css follow it,
  // so light and dark stay on the same NEXUS palette.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // NEXUS brand palette — single source of truth is theme.ts;
        // these Tailwind names mirror it exactly.
        nexus: {
          navy: '#142B4A',
          navyLight: '#1D3A5F',
          navyMuted: '#8AA0B8',
          navyDeep: '#0E1F36',
          teal: '#167C80',
          tealDark: '#0F5E62',
          tealSoft: '#E6F2F3',
          cloud: '#F5F7FA',
          cloudDeep: '#F1F5F9',
          slate: '#667085',
          slateDark: '#344054',
          border: '#E5EAF0',
          success: '#218568',
          warning: '#D99536',
          critical: '#C64D4D',
          info: '#3D6C9A',
          pending: '#7959C7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
