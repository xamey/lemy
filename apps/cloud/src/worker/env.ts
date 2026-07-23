import type { LemyProjectAgent } from "./project-agent";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  LOADER?: WorkerLoader;
  LEMY_AGENT?: DurableObjectNamespace<LemyProjectAgent>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PUBLIC_APP_URL: string;
  PROJECT_SECRETS_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ACCESS_REQUEST_ORIGINS: string;
  ADMIN_LOGIN: string;
  ADMIN_PASSWORD: string;
  ACCESS_APPROVAL_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  LEMY_MODEL_CATALOG_JSON?: string;
  MAX_DYNAMIC_WORKERS_PER_MONTH?: string;
  LOCAL_DEV_MODE?: string;
  RATE_LIMITS_DISABLED?: string;
  AUTH_RATE_LIMITER?: RateLimit;
  ACCESS_REQUEST_RATE_LIMITER?: RateLimit;
  CONTROL_RATE_LIMITER?: RateLimit;
  MUTATION_RATE_LIMITER?: RateLimit;
  LIFECYCLE_RATE_LIMITER?: RateLimit;
  RUNTIME_PROJECT_RATE_LIMITER?: RateLimit;
  RUNTIME_PRINCIPAL_RATE_LIMITER?: RateLimit;
}
