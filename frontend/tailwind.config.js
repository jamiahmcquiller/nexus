/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#142B4A", 950: "#0E1F36", 900: "#142B4A", 800: "#1D3A60", 700: "#2A4B75", 300: "#93A6C1" },
        teal: { DEFAULT: "#167C80", 700: "#11666A", 600: "#167C80", 100: "#D7EEEE", 50: "#EDF7F7" },
        cloud: "#F1F5F9",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)" },
    },
  },
  plugins: [],
}
