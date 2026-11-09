export type AtlasPlatform = "desktop" | "hosted" | "preview";

/** Display guidance only: the original transport error and credentials stay unchanged. */
export function repositoryHelp(message: string, platform: AtlasPlatform) {
  if (message === "No repository snapshot") return {
    title: "No GitHub evidence yet",
    detail: platform === "preview"
      ? "No repository data is saved on this device. Refresh to check public repositories. This local preview cannot read private repositories; use the desktop app’s GitHub connection for private access."
      : platform === "hosted"
      ? "Refresh GitHub data to check this repository. If it is private, the site owner must configure access through the server’s GitHub token."
      : "Refresh GitHub data to check this repository. If it is private, check your saved token and selected repositories in Settings → GitHub access.",
  };
  const privateAccess = /private or not found/i.test(message);
  if (!privateAccess) return { title: "GitHub connection needs attention", detail: message };
  if (platform === "preview") return {
    title: "Private repository unavailable in this preview",
    detail: "This local preview reads public repositories only. Open the Atlas desktop app and use Settings → GitHub access to connect this private repository. A missing or renamed repository can also return this response.",
  };
  if (platform === "hosted") return {
    title: "Server connection cannot read this repository",
    detail: "The site owner needs to check the server’s GitHub token and its selected repositories in Cloudflare. Tokens are never entered into this browser. The repository may also have moved or been removed.",
  };
  return {
    title: "Private repository access needs checking",
    detail: "In Settings → GitHub access, check your saved token includes this repository with read-only Contents, Metadata and Actions permissions. Then refresh GitHub data. The repository may also have moved or been removed.",
  };
}
