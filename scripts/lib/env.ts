import { z } from "zod";

const reviewEnvSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1),
  GH_TOKEN: z.string().min(1),
  PR_NUMBER: z.coerce.number().int().positive(),
  REPO: z.string().regex(/^[^/]+\/[^/]+$/, "REPO must be 'owner/name'"),
  COMMIT_SHA: z.string().min(7),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  LANGSMITH_API_KEY: z.string().min(1).optional(),
  LANGSMITH_PROJECT: z.string().min(1).default("code-reviewer"),
  LANGSMITH_TRACING: z.string().optional(),

  LLM_MODEL: z.string().default("gemma-4-31b-it"),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
  MAX_DIFF_CHARS: z.coerce.number().int().positive().default(14_000),
  RULE_MATCH_COUNT: z.coerce.number().int().positive().default(10),
  RULE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
});

const seedEnvSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
});

export type ReviewEnv = z.infer<typeof reviewEnvSchema>;
export type SeedEnv = z.infer<typeof seedEnvSchema>;

function normalize(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {
    ...raw,
    SUPABASE_URL: raw.SUPABASE_URL ?? raw.NEXT_PUBLIC_SUPABASE_URL,
  };
  // GitHub Actions forwards unset secrets as "" rather than undefined, which
  // would fail .optional() checks. Strip blanks so optional fields stay absent.
  for (const key of Object.keys(merged)) {
    if (merged[key] === "") delete merged[key];
  }
  return merged;
}

export function loadReviewEnv(raw: NodeJS.ProcessEnv = process.env): ReviewEnv {
  const parsed = reviewEnvSchema.safeParse(normalize(raw));
  if (!parsed.success) {
    throw new Error(`Invalid environment for review: ${formatIssues(parsed.error)}`);
  }
  configureLangSmith(parsed.data);
  return parsed.data;
}

export function loadSeedEnv(raw: NodeJS.ProcessEnv = process.env): SeedEnv {
  const parsed = seedEnvSchema.safeParse(normalize(raw));
  if (!parsed.success) {
    throw new Error(`Invalid environment for seeding: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function configureLangSmith(env: ReviewEnv): void {
  if (!env.LANGSMITH_API_KEY) return;
  process.env.LANGSMITH_TRACING = env.LANGSMITH_TRACING ?? "true";
  process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  process.env.LANGCHAIN_TRACING_V2 = "true";
  process.env.LANGCHAIN_PROJECT = env.LANGSMITH_PROJECT;
}
