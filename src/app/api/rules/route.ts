import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { supabaseAdmin } from "@/lib/supabase";

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-2",
  apiKey: process.env.GOOGLE_API_KEY!,
});

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("rules")
    .select("id, content, category, created_at")
    .order("category")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { content, category } = await req.json();

  if (!content?.trim() || !category) {
    return NextResponse.json({ error: "content and category are required" }, { status: 400 });
  }

  const [embedding] = await embeddings.embedDocuments([content]);

  const { data, error } = await supabaseAdmin
    .from("rules")
    .insert({ content: content.trim(), category, embedding })
    .select("id, content, category, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
