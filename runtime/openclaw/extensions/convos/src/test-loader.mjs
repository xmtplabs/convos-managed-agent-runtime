import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      err?.code !== "ERR_MODULE_NOT_FOUND" ||
      !specifier.endsWith(".js") ||
      !context.parentURL?.startsWith("file:")
    ) {
      throw err;
    }

    const parentPath = fileURLToPath(context.parentURL);
    const tsPath = path.resolve(path.dirname(parentPath), specifier.replace(/\.js$/, ".ts"));
    try {
      await access(tsPath);
    } catch {
      throw err;
    }
    return {
      url: pathToFileURL(tsPath).href,
      shortCircuit: true,
    };
  }
}
