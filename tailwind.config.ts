import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}", // Tämä yksi rivi kattaa kaikki alikansiot
  ],
  theme: {
    extend: {
      colors: {
        'klvl-blue': '#0072bc',
        'klvl-yellow': '#ffcb05',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
export default config;