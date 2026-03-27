/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'accent': '#63b3ed',      // Airy Star Blue
        'celestial': '#1e90ff',   // Deep Cosmic Blue
        'glimmer': '#a5f3fc',     // Cold Glimmer Cyan
        'silver': '#e2e8f0',      // Diagrammatic Silver
        'obsidian': '#000000',    // Perfect Black
      },
    },
  },
  plugins: [],
}
