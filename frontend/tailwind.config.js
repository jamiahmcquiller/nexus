/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Class-based dark mode: the console toggles `dark` on <html>
  // (see App.tsx) and the CSS variables in index.css follow it,
  // so light and dark stay on the same NULL palette.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // NULL brand palette — single source of truth is theme.ts;
        // these Tailwind names mirror it exactly. `nexus` is a
        // deprecated alias, removed when the shell migration moves
        // App.tsx off the nexus-* classes.
        null: {
          obsidian: '#071525',
          navy2: '#102b45',
          deepSlate: '#172A43',
          teal: '#17C3B2',
          tealSecondary: '#20B7AA',
          tealDark: '#0FA79B',
          tealSoft: '#E6F7F5',
          ink: '#14243a',
          muted: '#65748a',
          line: '#e1e7ee',
          cloud: '#f4f7fa',
          cloudDeep: '#EDF1F5',
          white: '#FFFFFF',
          success: '#218568',
          warning: '#D99536',
          critical: '#C64D4D',
          info: '#3D6C9A',
        },
        nexus: {
          navy: '#14243a',
          navyLight: '#102b45',
          navyMuted: '#8AA0B8',
          navyDeep: '#071525',
          teal: '#17C3B2',
          tealDark: '#0FA79B',
          tealSoft: '#E6F7F5',
          cloud: '#f4f7fa',
          cloudDeep: '#EDF1F5',
          slate: '#65748a',
          slateDark: '#14243a',
          border: '#e1e7ee',
          success: '#218568',
          warning: '#D99536',
          critical: '#C64D4D',
          info: '#3D6C9A',
          pending: '#3D6C9A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
