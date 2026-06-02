import type { Sandbox } from "@cloudflare/sandbox";

export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  GOOGLE_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  LANGSMITH_API_KEY: string;
  LANGSMITH_PROJECT: string;
}
