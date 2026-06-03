import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing env vars. Ensure .env.local is present with GOOGLE_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
  );
}

const DEFAULT_RULES: { category: string; content: string }[] = [
  // ── security ──────────────────────────────────────────────────────────────
  {
    category: "security",
    content:
      "Never hardcode secrets, API keys, tokens, or passwords directly in source code. Use environment variables or a secrets manager.",
  },
  {
    category: "security",
    content:
      "Always validate and sanitize user input before processing. Never trust data from external sources without validation.",
  },
  {
    category: "security",
    content:
      "Use parameterized queries or ORM methods to prevent SQL injection. Never concatenate user input into SQL strings.",
  },
  {
    category: "security",
    content:
      "Avoid using eval(), Function(), or any dynamic code execution with user-controlled input as it can lead to remote code execution.",
  },
  {
    category: "security",
    content:
      "Ensure sensitive data (passwords, tokens) is never logged. Redact or mask before writing to logs.",
  },
  {
    category: "security",
    content:
      "Always use HTTPS for external API calls. Never disable SSL/TLS certificate verification.",
  },
  {
    category: "security",
    content:
      "Apply the principle of least privilege — request only the permissions and scopes actually needed.",
  },
  {
    category: "security",
    content:
      "Sanitize any content rendered to HTML to prevent XSS. Use framework escaping mechanisms rather than raw innerHTML.",
  },

  // ── performance ──────────────────────────────────────────────────────────
  {
    category: "performance",
    content:
      "Avoid N+1 query patterns. Batch or join database queries instead of querying inside loops.",
  },
  {
    category: "performance",
    content:
      "Use pagination or cursor-based queries for endpoints that return lists. Never return unbounded result sets.",
  },
  {
    category: "performance",
    content:
      "Cache expensive computations or repeated identical API/DB calls where the data does not change frequently.",
  },
  {
    category: "performance",
    content:
      "Avoid blocking the event loop with synchronous heavy computation. Offload CPU-intensive work to worker threads or background jobs.",
  },
  {
    category: "performance",
    content:
      "Use lazy loading and code splitting for frontend assets. Do not import entire libraries when only one utility function is needed.",
  },
  {
    category: "performance",
    content:
      "Always add database indexes on columns used in WHERE clauses, JOIN conditions, and ORDER BY for large tables.",
  },
  {
    category: "performance",
    content:
      "Prefer streaming responses over buffering entire large payloads in memory.",
  },

  // ── style ────────────────────────────────────────────────────────────────
  {
    category: "style",
    content:
      "Use descriptive, self-explaining variable and function names. Avoid abbreviations and single-letter names except for loop counters.",
  },
  {
    category: "style",
    content:
      "Keep functions short and focused on a single responsibility. A function that does more than one thing should be split.",
  },
  {
    category: "style",
    content:
      "Avoid deep nesting (more than 3 levels). Use early returns and guard clauses to flatten control flow.",
  },
  {
    category: "style",
    content:
      "Remove dead code, commented-out blocks, and unused imports rather than leaving them in the codebase.",
  },
  {
    category: "style",
    content:
      "Magic numbers and strings should be named constants. Define them once and reference by name.",
  },
  {
    category: "style",
    content:
      "Keep line length under 120 characters for readability. Break long expressions into named intermediates.",
  },
  {
    category: "style",
    content:
      "Maintain consistent formatting enforced by the project linter/formatter. Do not mix styles within a file.",
  },

  // ── best-practices ────────────────────────────────────────────────────────
  {
    category: "best-practices",
    content:
      "Handle all promise rejections and async errors explicitly. Never let unhandled rejections silently fail.",
  },
  {
    category: "best-practices",
    content:
      "Prefer immutability — avoid mutating function arguments or shared state. Return new values instead.",
  },
  {
    category: "best-practices",
    content:
      "Always handle edge cases: empty arrays, null/undefined inputs, zero values, and empty strings.",
  },
  {
    category: "best-practices",
    content:
      "Use TypeScript strict mode. Avoid using 'any' type — prefer 'unknown' and narrow with type guards.",
  },
  {
    category: "best-practices",
    content:
      "Prefer explicit error types over generic Error. Include enough context in error messages to debug without a debugger.",
  },
  {
    category: "best-practices",
    content:
      "Do not swallow exceptions with empty catch blocks. At minimum log the error with sufficient context.",
  },
  {
    category: "best-practices",
    content:
      "Avoid side effects in pure functions. Functions that compute values should not modify external state.",
  },
  {
    category: "best-practices",
    content:
      "Use const by default, let only when reassignment is needed, and never use var.",
  },

  // ── architecture ─────────────────────────────────────────────────────────
  {
    category: "architecture",
    content:
      "Follow separation of concerns. Keep business logic out of HTTP handlers, UI components, and database layers.",
  },
  {
    category: "architecture",
    content:
      "Depend on abstractions, not concrete implementations. Use interfaces or abstract classes at module boundaries.",
  },
  {
    category: "architecture",
    content:
      "Keep modules loosely coupled. A module should not reach into the internals of another module.",
  },
  {
    category: "architecture",
    content:
      "Avoid circular dependencies between modules. If two modules depend on each other, extract the shared logic into a third.",
  },
  {
    category: "architecture",
    content:
      "Configuration should be externalized — not embedded in business logic. Read from environment variables or config files.",
  },
  {
    category: "architecture",
    content:
      "Design for failure. External API calls and DB operations should have timeouts, retries with back-off, and fallback behavior.",
  },
  {
    category: "architecture",
    content:
      "Keep API responses consistent in shape. Use a standard envelope (data, error, metadata) across all endpoints.",
  },

  // ── testing ──────────────────────────────────────────────────────────────
  {
    category: "testing",
    content:
      "Each test should test one behavior. Split tests that assert multiple unrelated things into separate test cases.",
  },
  {
    category: "testing",
    content:
      "Test behavior, not implementation. Tests should not break when internal implementation changes without behavior change.",
  },
  {
    category: "testing",
    content:
      "Avoid testing third-party libraries. Mock external services and focus tests on your own logic.",
  },
  {
    category: "testing",
    content:
      "Use descriptive test names that explain what is being tested and what the expected outcome is.",
  },
  {
    category: "testing",
    content:
      "Ensure tests are deterministic and do not rely on order, shared mutable state, or external network calls.",
  },
  {
    category: "testing",
    content:
      "Cover edge cases in tests: empty inputs, maximum values, null/undefined, and error conditions.",
  },
  {
    category: "testing",
    content:
      "Integration tests should use real dependencies (DB, queues) in an isolated environment, not mocks of those systems.",
  },
];

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-2",
  apiKey: GOOGLE_API_KEY,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log(`Seeding ${DEFAULT_RULES.length} rules…\n`);

let inserted = 0;
let skipped = 0;

for (const rule of DEFAULT_RULES) {
  // Skip if identical content already exists
  const { data: existing } = await supabase
    .from("rules")
    .select("id")
    .eq("content", rule.content)
    .maybeSingle();

  if (existing) {
    console.log(`  skip [${rule.category}] ${rule.content.slice(0, 60)}…`);
    skipped++;
    continue;
  }

  const [embedding] = await embeddings.embedDocuments([rule.content]);

  const { error } = await supabase
    .from("rules")
    .insert({ content: rule.content, category: rule.category, embedding });

  if (error) {
    console.error(`  ERROR [${rule.category}]: ${error.message}`);
  } else {
    console.log(`  ✓ [${rule.category}] ${rule.content.slice(0, 60)}…`);
    inserted++;
  }
}

console.log(`\nDone — ${inserted} inserted, ${skipped} already existed.`);
