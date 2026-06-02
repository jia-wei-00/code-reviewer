-- Run this once in the Supabase SQL editor: https://supabase.com/dashboard/project/zedatttxryusgxjtgojx/sql

-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Rules table
--    gemini-embedding-exp-03-07 outputs 768 dimensions
create table if not exists rules (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  category   text not null check (category in (
               'security', 'performance', 'style',
               'best-practices', 'architecture', 'testing'
             )),
  embedding  vector(768),
  created_at timestamptz default now()
);

-- 3. Vector similarity index
create index if not exists rules_embedding_idx
  on rules using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. match_rules RPC — called by the Cloudflare Worker
create or replace function match_rules(
  query_embedding vector(768),
  match_threshold float default 0.5,
  match_count     int   default 10
)
returns table (
  id         uuid,
  content    text,
  category   text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    rules.id,
    rules.content,
    rules.category,
    1 - (rules.embedding <=> query_embedding) as similarity
  from rules
  where 1 - (rules.embedding <=> query_embedding) > match_threshold
  order by rules.embedding <=> query_embedding
  limit match_count;
end;
$$;
