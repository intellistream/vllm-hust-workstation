import type { AppConfig } from "@/types";

export function getAppConfig(): AppConfig {
  return {
    brandName: process.env.APP_BRAND_NAME || "SageLLM 工作站",
    brandLogo: process.env.APP_BRAND_LOGO || null,
    accentColor: process.env.APP_ACCENT_COLOR || "#6366f1",
    baseUrl: process.env.SAGELLM_BASE_URL || "http://localhost:8080",
    defaultModel: process.env.DEFAULT_MODEL || "default",
  };
}

export const SERVER_CONFIG = {
  baseUrl: process.env.SAGELLM_BASE_URL || "http://localhost:8080",
  apiKey: process.env.SAGELLM_API_KEY || "not-required",
};
