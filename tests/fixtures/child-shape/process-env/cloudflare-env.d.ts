declare namespace NodeJS {
  interface ProcessEnv {
    PAYLOAD_SECRET: string
    GEMINI_API_KEY: string
    CLOUDFLARE_ENV: string
    LINE_CHANNEL_ACCESS_TOKEN: string
    LINE_CHANNEL_SECRET: string
    COPILOT_LLM_CLASSIFIER_ENABLED: string
    COPILOT_ROLLING_SUMMARY_ENABLED: string
    COPILOT_AI_DEBUG_ENABLED: string
  }
}
