import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import type { Env } from "./types";

export interface MatchedRule {
  content: string;
  category: string;
  similarity: number;
}

export async function matchRules(
  query: string,
  env: Env,
  matchCount = 10,
  threshold = 0.5
): Promise<MatchedRule[]> {
  if (!query.trim()) {
    console.log("[matchRules] empty query — skipping rule match, using defaults");
    return [];
  }

  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-2",
    apiKey: env.GOOGLE_API_KEY,
  });

  const [queryEmbedding] = await embeddings.embedDocuments([query.slice(0, 2000)]);

  console.log(`[matchRules] embedding dims: ${queryEmbedding?.length ?? 0}`);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    console.warn("[matchRules] Gemini returned empty embedding — using defaults");
    return [];
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("match_rules", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: matchCount,
  });

  if (error) throw new Error(`Supabase match_rules error: ${error.message}`);
  return (data as MatchedRule[]) ?? [];
}
