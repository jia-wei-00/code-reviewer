import { Octokit } from "@octokit/rest";
import { z } from "zod";

const prMetaSchema = z.object({
  title: z.string(),
  body: z.string().nullable().optional(),
});

export interface PullRequestRef {
  owner: string;
  repo: string;
  pull_number: number;
  commit_sha: string;
}

export interface PullRequestMeta {
  title: string;
  body: string;
  diff: string;
}

export interface InlineCommentInput {
  path: string;
  line: number;
  body: string;
}

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: "code-reviewer-bot/1.0",
    });
  }

  async fetchPullRequest(ref: PullRequestRef): Promise<PullRequestMeta> {
    const { owner, repo, pull_number } = ref;

    const [metaRes, diffRes] = await Promise.all([
      this.octokit.pulls.get({ owner, repo, pull_number }),
      this.octokit.pulls.get({
        owner,
        repo,
        pull_number,
        mediaType: { format: "diff" },
      }),
    ]);

    const meta = prMetaSchema.parse(metaRes.data);
    const diff = typeof diffRes.data === "string" ? diffRes.data : String(diffRes.data);

    return {
      title: meta.title,
      body: meta.body ?? "",
      diff,
    };
  }

  async postInlineComment(
    ref: PullRequestRef,
    comment: InlineCommentInput,
  ): Promise<void> {
    await this.octokit.pulls.createReviewComment({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pull_number,
      commit_id: ref.commit_sha,
      path: comment.path,
      line: comment.line,
      body: comment.body,
    });
  }

  async postIssueComment(ref: PullRequestRef, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.pull_number,
      body,
    });
  }
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid REPO "${repo}", expected "owner/name"`);
  return { owner, name };
}
