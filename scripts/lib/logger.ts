const inGitHubActions = process.env.GITHUB_ACTIONS === "true";

export function group(name: string): void {
  if (inGitHubActions) console.log(`::group::${name}`);
  else console.log(`\n── ${name} ──`);
}

export function endGroup(): void {
  if (inGitHubActions) console.log("::endgroup::");
}

export function info(message: string): void {
  console.log(message);
}

export function warn(message: string): void {
  if (inGitHubActions) console.log(`::warning::${message}`);
  else console.warn(`! ${message}`);
}

export function error(message: string): void {
  if (inGitHubActions) console.log(`::error::${message}`);
  else console.error(`x ${message}`);
}
