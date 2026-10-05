import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_LINE_LIMIT = 600;
const excluded = new Set([
  ".git", "node_modules", "vendor", "dist", "runtime", "artifacts", ".venv",
  "__pycache__", "coverage", "build", "python-runtime", "codex-schema",
]);
const extensions = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".vue", ".css", ".go", ".py",
  ".sh", ".bash", ".sql", ".rs", ".c", ".cpp", ".h", ".html",
]);
export function physicalLines(source: string): number {
  if (!source) return 0;
  return source.split("\n").length - Number(source.endsWith("\n"));
}
export function isSource(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/");
  return !segments.some(segment => excluded.has(segment)) &&
    extensions.has(extname(path)) && !/\.d\.ts$|\.min\.(js|css)$|\.pb\.go$/.test(path);
}
export async function sourceInventory(root: string): Promise<Array<{ path: string; lines: number }>> {
  const result: Array<{ path: string; lines: number }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && isSource(path)) {
        result.push({ path: relative(root, path).replaceAll("\\", "/"), lines: physicalLines(await readFile(path, "utf8")) });
      }
    }
  }
  await visit(root);
  return result.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = await sourceInventory(process.cwd());
  const violations = files.filter(file => file.lines > SOURCE_LINE_LIMIT);
  console.log(JSON.stringify({ limit: SOURCE_LINE_LIMIT, files: files.length, largest: files.slice(0, 5), violations }, null, 2));
  if (violations.length) process.exitCode = 1;
}
