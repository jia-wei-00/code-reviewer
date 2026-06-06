import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEmbeddings } from "@/lib/embeddings";
import { getSupabaseAdmin } from "@/lib/supabase";
import { RULE_CATEGORIES } from "@/lib/rule-categories";

const createRuleSchema = z.object({
  content: z.string().trim().min(1, "content is required"),
  category: z.enum(RULE_CATEGORIES),
});

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .select("id, content, category, created_at")
    .order("category")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const [embedding] = await getEmbeddings().embedDocuments([parsed.data.content]);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .insert({
      content: parsed.data.content,
      category: parsed.data.category,
      embedding,
    })
    .select("id, content, category, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
