const GH_API = "https://api.github.com";

function ghHeaders(token: string, accept = "application/vnd.github.v3+json") {
  return {
    Authorization: `token ${token}`,
    Accept: accept,
    "User-Agent": "code-reviewer-bot/1.0",
    "Content-Type": "application/json",
  };
}

export async function fetchPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: ghHeaders(token, "application/vnd.github.v3.diff"),
  });
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status}`);
  return res.text();
}

export async function postReview(
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  body: string,
  token: string
): Promise<void> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({ commit_id: commitId, body, event: "COMMENT" }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub review post failed: ${res.status} ${text}`);
  }
}
