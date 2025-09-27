// tailwind.config.js
module.exports = {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: {
          900: "#070E0F", // nearly black
          800: "#0B1B1C",
          700: "#0F2426",
          600: "#123032", // hero/card base
        },
        teal: {
          300: "#55E1CF",
          400: "#2EC9B8",
          500: "#16B2A2", // accents
        },
        brand: {
          100: "#FFF4E5",
          200: "#FFE2BF",
          400: "#F4A646",
          500: "#EC8C2D", // primary orange
          600: "#D9761D",
          700: "#B95F12",
        },
        cream: {
          50: "#FEFDF9",
          100: "#FBF6EB", // heading highlight
        },
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0,0,0,0.25)",
        glow: "0 0 80px rgba(46,201,184,0.25)",
      },
      fontFamily: {
        body: ['"Plus Jakarta Sans"', "ui-sans-serif", "system-ui", "Arial", "sans-serif"],
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
