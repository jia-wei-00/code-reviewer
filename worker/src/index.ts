import { verifyGitHubSignature } from "./webhook";
import { fetchPRDiff, postReview } from "./github";
import { reviewCode } from "./reviewer";
import type { Env } from "./types";

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256") ?? "";

    const valid = await verifyGitHubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET);
    if (!valid) return new Response("Unauthorized", { status: 401 });

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const event = request.headers.get("x-github-event");
    if (event !== "pull_request") return new Response("OK", { status: 200 });

    const action = payload.action as string;
    if (action !== "opened" && action !== "synchronize") {
      return new Response("OK", { status: 200 });
    }

    const pr = payload.pull_request as Record<string, unknown>;
    const repo = payload.repository as Record<string, unknown>;
    const owner = (repo.owner as Record<string, string>).login;
    const repoName = repo.name as string;
    const prNumber = pr.number as number;
    const commitId = (pr.head as Record<string, string>).sha;

    ctx.waitUntil(
      (async () => {
        try {
          const diff = await fetchPRDiff(owner, repoName, prNumber, env.GITHUB_TOKEN);
          const review = await reviewCode(diff, env);
          await postReview(owner, repoName, prNumber, commitId, review, env.GITHUB_TOKEN);
        } catch (err) {
          console.error("Review pipeline failed:", err);
        }
      })()
    );

    return new Response("OK", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
