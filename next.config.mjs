/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    SAGELLM_BASE_URL: process.env.SAGELLM_BASE_URL,
    SAGELLM_API_KEY: process.env.SAGELLM_API_KEY,
    APP_BRAND_NAME: process.env.APP_BRAND_NAME,
    APP_BRAND_LOGO: process.env.APP_BRAND_LOGO,
    APP_ACCENT_COLOR: process.env.APP_ACCENT_COLOR,
  },
};

export default nextConfig;
