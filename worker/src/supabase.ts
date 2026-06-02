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
  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-exp-03-07",
    apiKey: env.GOOGLE_API_KEY,
  });

  // Embed only the first 2000 chars of the diff to stay within token limits
  const [queryEmbedding] = await embeddings.embedDocuments([query.slice(0, 2000)]);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("match_rules", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: matchCount,
  });

  if (error) throw new Error(`Supabase match_rules error: ${error.message}`);
  return (data as MatchedRule[]) ?? [];
}
