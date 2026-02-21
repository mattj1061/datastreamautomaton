import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_DIST_ROOT = path.resolve(THIS_DIR, "../../../dist");

function normalizeSubpath(subpath: string): string {
  return subpath.replace(/^\.?\/*/, "").replace(/\\/g, "/");
}

export async function importAutomatonModule<T>(subpath: string): Promise<T> {
  const normalized = normalizeSubpath(subpath);
  const packageSpecifier = `@conway/automaton/${normalized}`;

  try {
    return (await import(packageSpecifier)) as T;
  } catch (packageError) {
    const fallbackPath = path.resolve(FALLBACK_DIST_ROOT, normalized);
    if (!fs.existsSync(fallbackPath)) {
      const packageErrorMessage =
        packageError instanceof Error ? packageError.message : String(packageError);
      throw new Error(
        `Unable to resolve ${packageSpecifier}. Fallback path is also missing: ${fallbackPath}. Build the runtime first (repo root: npx tsc). Package error: ${packageErrorMessage}`,
      );
    }

    const fallbackUrl = pathToFileURL(fallbackPath).href;
    return (await import(fallbackUrl)) as T;
  }
}
