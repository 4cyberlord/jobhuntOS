// Update delivery for a PRIVATE GitHub repository. Installed apps cannot read private releases, so they ask this API (signed in, like
// everything else) and it reads the release with a GitHub token kept in the database. The token never reaches the app.

/** Compares dotted versions numerically: -1, 0 or 1. Anything non-numeric (a pre-release suffix) is ignored. */
export function compareVersions(a: string, b: string) {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

export type LatestJson = { version: string; notes?: string; pub_date?: string; platforms: Record<string, { signature: string; url: string }> };
export type ReleaseAsset = { id: number; name: string };

/** Builds the response Tauri's updater expects, or null when the installed version is already current (the endpoint then answers 204). */
export function updateFor(opts: { latest: LatestJson; assets: ReleaseAsset[]; current: string; target: string; arch: string; assetUrl: (id: number) => string }) {
  const { latest, assets, current, target, arch, assetUrl } = opts;
  if (compareVersions(latest.version, current) <= 0) return null;
  const platform = latest.platforms[`${target}-${arch}`] ?? latest.platforms[`${target}-universal`] ?? latest.platforms[target];
  if (!platform) return null;
  const file = decodeURIComponent(platform.url.split("?")[0].split("/").pop() ?? "");
  const asset = assets.find((a) => a.name === file) ?? assets.find((a) => a.name.replace(/\s+/g, ".") === file.replace(/\s+/g, "."));
  if (!asset) return null;
  return { version: latest.version, notes: latest.notes ?? "", pub_date: latest.pub_date, url: assetUrl(asset.id), signature: platform.signature };
}
