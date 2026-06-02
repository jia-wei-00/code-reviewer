"use client";

import { useEffect, useState } from "react";

const CATEGORIES = [
  "security",
  "performance",
  "style",
  "best-practices",
  "architecture",
  "testing",
] as const;

type Category = (typeof CATEGORIES)[number];

type Rule = {
  id: string;
  content: string;
  category: Category;
  created_at: string;
};

export default function Home() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<Category>("best-practices");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  async function loadRules() {
    const res = await fetch("/api/rules");
    if (res.ok) setRules(await res.json());
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, category }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to add rule");
      }
      const newRule: Rule = await res.json();
      setRules((prev) => [newRule, ...prev]);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  const grouped = CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = rules.filter((r) => r.category === cat);
      return acc;
    },
    {} as Record<Category, Rule[]>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-10">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Code Review Rules
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Rules are embedded and stored in Supabase. The reviewer retrieves
            relevant ones per PR.
          </p>
        </div>

        <form
          onSubmit={handleAdd}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-3"
        >
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g. Never store secrets in environment variables committed to the repo."
            rows={3}
            required
            className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500 placeholder:text-zinc-400"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center gap-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="ml-auto text-sm font-medium px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-40 transition-colors"
            >
              {submitting ? "Embedding…" : "Add Rule"}
            </button>
          </div>
        </form>

        <div className="space-y-8">
          {CATEGORIES.map((cat) => {
            const catRules = grouped[cat];
            if (!catRules.length) return null;
            return (
              <section key={cat}>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
                  {cat}
                  <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400">
                    ({catRules.length})
                  </span>
                </h2>
                <ul className="space-y-2">
                  {catRules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex items-start gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-3"
                    >
                      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {rule.content}
                      </span>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        aria-label="Delete rule"
                        className="shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {rules.length === 0 && (
            <p className="text-sm text-zinc-400 text-center py-8">
              No rules yet. Add one above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
