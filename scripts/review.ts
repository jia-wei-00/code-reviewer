import { loadReviewEnv } from "./lib/env";
import { GitHubClient, parseRepo, type PullRequestRef } from "./lib/github";
import { rulesClientFromEnv } from "./lib/supabase";
import { buildReviewGraph } from "./lib/graph";
import { error, info } from "./lib/logger";

async function main(): Promise<void> {
  const env = loadReviewEnv();
  const { owner, name } = parseRepo(env.REPO);
  const prRef: PullRequestRef = {
    owner,
    repo: name,
    pull_number: env.PR_NUMBER,
    commit_sha: env.COMMIT_SHA,
  };

  const github = new GitHubClient(env.GH_TOKEN);
  const rulesClient = rulesClientFromEnv(env);

  if (!rulesClient) {
    info("Supabase credentials not set — running without RAG rule retrieval.");
  }

  const graph = buildReviewGraph({ env, github, rulesClient, prRef });
  await graph.invoke(
    {},
    {
      runName: "CodeReview",
      metadata: {
        repo: env.REPO,
        pr: env.PR_NUMBER,
        sha: env.COMMIT_SHA,
      },
      tags: ["github-action", "code-review"],
    },
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  error(`Review failed: ${msg}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
