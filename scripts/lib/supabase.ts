import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ReviewEnv } from "./env";

const matchedRuleSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  category: z.string(),
  similarity: z.number(),
});

export type MatchedRule = z.infer<typeof matchedRuleSchema>;

const matchRpcResponseSchema = z.array(matchedRuleSchema);

interface RulesClientOptions {
  url: string;
  serviceRoleKey: string;
  embeddingModel: string;
  googleApiKey: string;
}

export class RulesClient {
  private readonly supabase: SupabaseClient;
  private readonly embeddings: GoogleGenerativeAIEmbeddings;

  constructor(opts: RulesClientOptions) {
    this.supabase = createClient(opts.url, opts.serviceRoleKey, {
      auth: { persistSession: false },
    });
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      model: opts.embeddingModel,
      apiKey: opts.googleApiKey,
    });
  }

  async match(
    query: string,
    options: { count: number; threshold: number },
  ): Promise<MatchedRule[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const [embedding] = await this.embeddings.embedDocuments([trimmed.slice(0, 2000)]);
    if (!embedding || embedding.length === 0) return [];

    const { data, error } = await this.supabase.rpc("match_rules", {
      query_embedding: embedding,
      match_threshold: options.threshold,
      match_count: options.count,
    });

    if (error) throw new Error(`Supabase match_rules failed: ${error.message}`);

    const parsed = matchRpcResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `Unexpected response from match_rules: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}

export function rulesClientFromEnv(env: ReviewEnv): RulesClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return new RulesClient({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    embeddingModel: env.EMBEDDING_MODEL,
    googleApiKey: env.GOOGLE_API_KEY,
  });
}
