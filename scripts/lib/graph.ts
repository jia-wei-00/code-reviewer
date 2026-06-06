import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { annotateDiff } from "./diff";
import type { GitHubClient, PullRequestRef } from "./github";
import type { ReviewResult, InlineComment } from "./review-schema";
import type { ReviewEnv } from "./env";
import type { RulesClient, MatchedRule } from "./supabase";
import { buildReviewChain } from "./llm";
import { group, endGroup, info, warn } from "./logger";

const ReviewState = Annotation.Root({
  prTitle: Annotation<string>({ reducer: (_p, n) => n, default: () => "" }),
  rawDiff: Annotation<string>({ reducer: (_p, n) => n, default: () => "" }),
  annotatedDiff: Annotation<string>({ reducer: (_p, n) => n, default: () => "" }),
  rules: Annotation<MatchedRule[]>({ reducer: (_p, n) => n, default: () => [] }),
  result: Annotation<ReviewResult>({
    reducer: (_p, n) => n,
    default: () => ({ summary: "", comments: [] }),
  }),
  posted: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
});

export interface ReviewDeps {
  env: ReviewEnv;
  github: GitHubClient;
  rulesClient: RulesClient | null;
  prRef: PullRequestRef;
}

export function buildReviewGraph(deps: ReviewDeps) {
  const { env, github, rulesClient, prRef } = deps;
  const chain = buildReviewChain({
    apiKey: env.GOOGLE_API_KEY,
    model: env.LLM_MODEL,
  });

  return new StateGraph(ReviewState)
    .addNode("fetchPullRequest", async () => {
      group("Fetching PR");
      const pr = await github.fetchPullRequest(prRef);
      info(`Title: ${pr.title}`);
      info(`Diff: ${pr.diff.length} chars`);
      endGroup();
      return { prTitle: pr.title, rawDiff: pr.diff };
    })
    .addNode("annotateDiff", async (state) => {
      const truncated = state.rawDiff.slice(0, env.MAX_DIFF_CHARS);
      const annotated = annotateDiff(truncated);
      if (state.rawDiff.length > env.MAX_DIFF_CHARS) {
        warn(`Diff truncated to ${env.MAX_DIFF_CHARS} chars for review`);
      }
      return { annotatedDiff: annotated };
    })
    .addNode("retrieveRules", async (state) => {
      if (!rulesClient) {
        info("Supabase not configured — skipping rule retrieval");
        return { rules: [] };
      }
      group("Retrieving rules");
      const rules = await rulesClient.match(state.annotatedDiff, {
        count: env.RULE_MATCH_COUNT,
        threshold: env.RULE_MATCH_THRESHOLD,
      });
      info(`Matched ${rules.length} rule(s)`);
      endGroup();
      return { rules };
    })
    .addNode("generateReview", async (state) => {
      group("Generating review");
      const result = await chain.invoke({
        prTitle: state.prTitle,
        diff: state.annotatedDiff,
        rules: state.rules,
      });
      info(`Summary: ${result.summary.slice(0, 120)}…`);
      info(`Inline comments: ${result.comments.length}`);
      endGroup();
      return { result };
    })
    .addNode("postInlineComments", async (state) => {
      group("Posting inline comments");
      const posted = await postInlineComments(github, prRef, state.result.comments);
      info(`Posted ${posted}/${state.result.comments.length} inline comment(s)`);
      endGroup();
      return { posted };
    })
    .addNode("postSummary", async (state) => {
      group("Posting summary");
      const body = renderSummaryBody(state.result.summary, state.posted, prRef);
      await github.postIssueComment(prRef, body);
      info("Summary posted");
      endGroup();
      return {};
    })
    .addEdge(START, "fetchPullRequest")
    .addEdge("fetchPullRequest", "annotateDiff")
    .addEdge("annotateDiff", "retrieveRules")
    .addEdge("retrieveRules", "generateReview")
    .addEdge("generateReview", "postInlineComments")
    .addEdge("postInlineComments", "postSummary")
    .addEdge("postSummary", END)
    .compile();
}

async function postInlineComments(
  github: GitHubClient,
  prRef: PullRequestRef,
  comments: InlineComment[],
): Promise<number> {
  let posted = 0;
  for (const comment of comments) {
    try {
      await github.postInlineComment(prRef, {
        path: comment.file,
        line: comment.line,
        body: `**${comment.severity.toUpperCase()}**\n\n${comment.body}`,
      });
      info(`  ✓ ${comment.file}:${comment.line}`);
      posted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`  ✗ ${comment.file}:${comment.line} — ${msg}`);
    }
  }
  return posted;
}

function renderSummaryBody(
  summary: string,
  postedCount: number,
  prRef: PullRequestRef,
): string {
  const sourceRepo = `${prRef.owner}/code-reviewer`;
  return [
    "## 🤖 Code Review",
    "",
    summary,
    "",
    "---",
    `*${postedCount} inline comment(s) · Reviewed via [code-reviewer](https://github.com/${sourceRepo})*`,
  ].join("\n");
}
