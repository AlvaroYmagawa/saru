import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { formatZodError } from "./schema";

export const DEFAULT_SHORTCUT = "Alt+Command+P";

export const Settings = z.object({
  /** Light, dark, or follow macOS. */
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** Electron accelerator that starts a polish. */
  shortcut: z.string().min(1).default(DEFAULT_SHORTCUT),
  /** `claude --model`. */
  model: z.string().min(1).default("sonnet"),
  /** Absolute path to `claude`; empty = found through the login shell. */
  claudePath: z.string().default(""),
  /** Seconds before a draft, a change or a rule request is abandoned. */
  timeoutSeconds: z.number().positive().max(600).default(90),
  /** How long the other app gets to answer a copy or paste keystroke. */
  keystrokeDelayMs: z.number().int().min(50).max(2000).default(180),
  /** Folder holding Saru's data; a clone of `dataRepo` when sync is on. */
  dataDir: z.string().default(""),
  /** The private GitHub repo the data syncs to, as `owner/name`; empty = no sync. */
  dataRepo: z.string().regex(/^$|^[\w.-]+\/[\w.-]+$/, "use owner/name").default(""),
  /** Seconds to wait after a change before committing and pushing, so a burst is one commit. */
  syncDelaySeconds: z.number().min(1).max(3600).default(20),
});
export type Settings = z.infer<typeof Settings>;

export function configPath(): string {
  const env = process.env.SARU_CONFIG;
  if (env) return env;
  return path.join(os.homedir(), ".config", "saru", "config.json");
}

export function defaultDataDir(): string {
  return path.join(os.homedir(), ".local", "share", "saru");
}

export function resolveDataDir(s: Settings): string {
  const dir = process.env.SARU_DATA_DIR || s.dataDir || defaultDataDir();
  return dir.startsWith("~/") ? path.join(os.homedir(), dir.slice(2)) : dir;
}

export async function loadSettings(file = configPath()): Promise<Settings> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`${file} isn't valid JSON: fix or delete it`);
    }
  }
  const r = Settings.safeParse(raw);
  if (!r.success) throw new Error(`${file}: ${formatZodError(r.error)}`);
  return r.data;
}

export async function saveSettings(s: Settings, file = configPath()): Promise<Settings> {
  const r = Settings.safeParse(s);
  if (!r.success) throw new Error(formatZodError(r.error));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(r.data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
  return r.data;
}
