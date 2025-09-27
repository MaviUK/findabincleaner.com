// tailwind.config.js
module.exports = {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Fresh + punchy
          primary: "#16C172",      // lively bin green
          primary600: "#0DAA63",
          primary700: "#0B8C52",
          navy: "#0B1B2A",         // deep, trustworthy base
          navy600: "#0E2437",
          aqua: "#37D9E6",         // soapy/aqua accent
          lime: "#B7F399",         // soft highlight for tags/accents
          cream: "#F5FFF9",        // clean background
          ink: "#0D1321",          // headings/body on light
          slate: "#6B778A",        // secondary text
          danger: "#FF6B6B",       // error/destructive
          amber: "#FFB703"         // CTA hover accent
        },
      },
      boxShadow: {
        soft: "0 8px 24px rgba(11, 27, 42, 0.08)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      backgroundImage: {
        "hero-bubbles":
          "radial-gradient(1200px 600px at 80% -10%, rgba(55,217,230,0.20), transparent 60%), radial-gradient(900px 500px at -10% 20%, rgba(22,193,114,0.18), transparent 55%)",
      },
    },
  },
  plugins: [],
};
