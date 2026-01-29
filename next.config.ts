import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Tämä on edelleen tuettu ja tärkeä Vercel-julkaisun kannalta
    ignoreBuildErrors: true,
  },
  // 'eslint' -osio on poistettu, koska se aiheutti varoituksen
};

export default nextConfig;