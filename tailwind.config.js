/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          50:"#ecfdf5",100:"#d1fae5",200:"#a7f3d0",300:"#6ee7b7",400:"#34d399",
          500:"#10b981",600:"#059669",700:"#047857",800:"#065f46",900:"#064e3b",
        },
        ink: {
          50:"#f8fafc",100:"#f1f5f9",200:"#e2e8f0",300:"#cbd5e1",400:"#94a3b8",
          500:"#64748b",600:"#475569",700:"#334155",800:"#1e293b",900:"#0f172a",
        },
      },
      boxShadow: { soft: "0 8px 30px rgba(2, 6, 23, 0.06)" },
      borderRadius: { xl2: "1rem" },
    },
  },
  plugins: [],
};
