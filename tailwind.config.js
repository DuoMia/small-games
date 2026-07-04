/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        coral: {
          DEFAULT: "#FF5E5B",
          dark: "#E8453F",
          light: "#FF8A87",
        },
        ink: {
          DEFAULT: "#1B1340",
          soft: "#3A2D5C",
          muted: "#6B5D8A",
        },
        cream: {
          DEFAULT: "#FFF9F0",
          dark: "#F5EDDC",
        },
        sun: "#FFD23F",
        mint: "#3DDC97",
        warn: "#FF8C42",
      },
      fontFamily: {
        display: ['"ZCOOL KuaiLe"', "system-ui", "sans-serif"],
        body: ['"Noto Sans SC"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        doodle: "16px",
        blob: "24px",
      },
      borderWidth: {
        3: "3px",
      },
      boxShadow: {
        soft: "0 4px 16px rgba(27, 19, 64, 0.08)",
        pop: "0 6px 0 rgba(27, 19, 64, 0.15)",
        card: "0 8px 24px rgba(27, 19, 64, 0.12)",
        inset: "inset 0 2px 8px rgba(27, 19, 64, 0.06)",
      },
      animation: {
        "bounce-in": "bounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "slide-up": "slideUp 0.4s ease-out",
        "slide-right": "slideRight 0.4s ease-out",
        "pulse-scale": "pulseScale 0.8s ease-in-out infinite",
        "shake": "shake 0.4s ease-in-out",
        "float": "float 3s ease-in-out infinite",
        "confetti": "confetti 3s linear infinite",
        "countdown": "countdown 1s ease-in-out",
      },
      keyframes: {
        bounceIn: {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "70%": { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideRight: {
          "0%": { transform: "translateX(-30px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        pulseScale: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.15)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-8px)" },
          "75%": { transform: "translateX(8px)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
        confetti: {
          "0%": { transform: "translateY(-100vh) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(100vh) rotate(720deg)", opacity: "0" },
        },
        countdown: {
          "0%": { transform: "scale(1.5)", opacity: "0" },
          "50%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(0.8)", opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
};
