// tailwind.config.js
module.exports = {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#EDFFF6",
          100: "#D6FFE9",
          200: "#B8F7D5",
          300: "#7FEAB5",
          400: "#2FD28B",
          500: "#16C172", // primary
          600: "#0DAA63",
          700: "#0B8C52",
          800: "#0A7345",
          900: "#075737",
        },
        ink: {
          50:  "#F5FFF9", // clean “cream”
          100: "#EAF7F3",
          200: "#D8EAE8",
          300: "#C5D6D8",
          400: "#A2B6C1",
          500: "#6B778A", // secondary text
          600: "#465469",
          700: "#243145",
          800: "#142233",
          900: "#0B1B2A", // deep navy body text on light
        },
        aqua: {
          50:  "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          300: "#67E8F9",
          400: "#37D9E6",
          500: "#22CCDB",
          600: "#14B3C2",
          700: "#0F8E9B",
          800: "#0D717C",
          900: "#0B5862",
        },
      },
      boxShadow: {
        soft: "0 8px 24px rgba(11, 27, 42, 0.08)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
