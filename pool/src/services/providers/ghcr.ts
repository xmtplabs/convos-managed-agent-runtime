/**
 * Resolve a GHCR image tag to its immutable sha256 digest.
 * This avoids Railway serving a stale cached layer when deploying by tag.
 *
 * Only applies to ghcr.io images — all others pass through unchanged.
 */
export async function resolveImageDigest(imageRef: string): Promise<string> {
  // Strip accidental protocol prefix (users sometimes paste full URLs)
  imageRef = imageRef.replace(/^https?:\/\//, "");
  // Only handle ghcr.io images
  const match = imageRef.match(/^ghcr\.io\/([^:@]+?)(?::([^@]+))?$/);
  if (!match) return imageRef;

  const repo = match[1]; // e.g. "xmtplabs/convos-runtime"
  const tag = match[2] || "latest";

  try {
    // Get anonymous bearer token scoped to this repo
    const tokenRes = await fetch(
      `https://ghcr.io/token?scope=repository:${repo}:pull`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!tokenRes.ok) throw new Error(`token endpoint ${tokenRes.status}`);
    const { token } = (await tokenRes.json()) as { token: string };

    // HEAD the manifest to get Docker-Content-Digest without downloading the blob
    const manifestRes = await fetch(
      `https://ghcr.io/v2/${repo}/manifests/${tag}`,
      {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: [
            "application/vnd.oci.image.index.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.docker.distribution.manifest.v2+json",
          ].join(", "),
        },
      },
    );
    if (!manifestRes.ok) throw new Error(`manifest HEAD ${manifestRes.status}`);

    const digest = manifestRes.headers.get("docker-content-digest");
    if (!digest || !digest.startsWith("sha256:")) {
      throw new Error(`unexpected digest header: ${digest}`);
    }

    const resolved = `ghcr.io/${repo}@${digest}`;
    console.log(`[ghcr] Resolved ${imageRef} → ${resolved}`);
    return resolved;
  } catch (err: any) {
    console.warn(`[ghcr] Failed to resolve digest for ${imageRef}: ${err.message} — using tag`);
    return imageRef;
  }
}
