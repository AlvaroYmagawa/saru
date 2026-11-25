import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Keeps the data folder in a private GitHub repo: it is a git clone, and each change is committed
 * and pushed with the user's own git credentials (Saru never sees or stores a token).
 */
export type SyncState = "off" | "idle" | "pending" | "syncing" | "error" | "refused";

export interface SyncStatus {
  state: SyncState;
  repo: string;
  message?: string;
  lastSyncAt?: string;
}

export type Visibility = "public" | "private-or-missing" | "unknown";

/** Anyone can read a public repo anonymously; a private (or missing) one answers 404. */
export async function repoVisibility(repo: string, fetchImpl: typeof fetch = fetch): Promise<Visibility> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "saru-app" } });
    if (res.status === 200) return "public";
    if (res.status === 404) return "private-or-missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface GitEnv {
  git: string;
  env?: NodeJS.ProcessEnv;
  /** Overrides the remote URL (tests use a local bare repo). */
  remoteUrl?: (repo: string) => string;
  visibility?: (repo: string) => Promise<Visibility>;
  now?: () => Date;
}

function run(g: GitEnv, cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(g.git, args, { cwd, env: { ...(g.env ?? process.env), GIT_TERMINAL_PROMPT: "0" }, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split("\n").slice(-3).join(" ")));
      else resolve(stdout.trim());
    });
  });
}

export class DataSync {
  private status: SyncStatus;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private again = false;
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private readonly dir: string,
    private readonly repo: string,
    private readonly delayMs: number,
    private readonly g: GitEnv,
  ) {
    this.status = { state: repo ? "idle" : "off", repo };
  }

  get current(): SyncStatus {
    return this.status;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...s };
    for (const fn of this.listeners) fn(this.status);
  }

  private url(): string {
    return this.g.remoteUrl ? this.g.remoteUrl(this.repo) : `https://github.com/${this.repo}.git`;
  }

  /**
   * Makes the data folder a clone of the repo. When the repo already has data and the folder
   * holds people of its own, the folder is copied aside first so nothing is lost.
   */
  async connect(): Promise<SyncStatus> {
    if (!this.repo) return this.status;
    const vis = await (this.g.visibility ?? repoVisibility)(this.repo);
    if (vis === "public") {
      this.set({ state: "refused", message: `${this.repo} is public: Saru only syncs to a private repo, since your notes about people are personal. Make it private on GitHub, or pick another repo.` });
      return this.status;
    }
    try {
      await fs.mkdir(this.dir, { recursive: true });
      if (!existsSync(path.join(this.dir, ".git"))) {
        await run(this.g, this.dir, ["init", "-q", "-b", "main"]);
        await run(this.g, this.dir, ["remote", "add", "origin", this.url()]);
      } else {
        await run(this.g, this.dir, ["remote", "set-url", "origin", this.url()]).catch(() => run(this.g, this.dir, ["remote", "add", "origin", this.url()]));
      }
      await run(this.g, this.dir, ["fetch", "-q", "origin"]);
      const remoteHasMain = await run(this.g, this.dir, ["rev-parse", "--verify", "-q", "origin/main"]).then(() => true, () => false);
      const localHasCommit = await run(this.g, this.dir, ["rev-parse", "--verify", "-q", "HEAD"]).then(() => true, () => false);
      if (remoteHasMain && !localHasCommit) {
        const backup = await this.backupIfHasPeople();
        await run(this.g, this.dir, ["checkout", "-q", "-f", "-B", "main", "origin/main"]);
        await run(this.g, this.dir, ["clean", "-q", "-fd"]);
        this.set({ state: "idle", message: backup ? `Took the data in ${this.repo}; your local copy is in ${backup}.` : undefined });
      } else {
        this.set({ state: "idle", message: undefined });
        this.schedule(0);
      }
    } catch (e) {
      this.set({ state: "error", message: `Couldn't reach ${this.repo}: ${(e as Error).message}` });
    }
    return this.status;
  }

  private async backupIfHasPeople(): Promise<string | undefined> {
    const people = path.join(this.dir, "people");
    const names = existsSync(people) ? (await fs.readdir(people)).filter((n) => n.endsWith(".json")) : [];
    if (!names.length) return undefined;
    const stamp = (this.g.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const backup = `${this.dir}.local-${stamp}`;
    await fs.cp(this.dir, backup, { recursive: true });
    return backup;
  }

  /** Call after every change; changes within the delay become one commit. */
  changed(): void {
    if (this.status.state === "off" || this.status.state === "refused") return;
    this.set({ state: "pending" });
    this.schedule(this.delayMs);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
    this.timer.unref?.();
  }

  async syncNow(): Promise<SyncStatus> {
    if (!this.repo || this.status.state === "refused") return this.status;
    if (this.running) {
      this.again = true;
      await this.running;
      return this.status;
    }
    this.running = this.doSync().finally(() => {
      this.running = undefined;
    });
    await this.running;
    if (this.again) {
      this.again = false;
      return this.syncNow();
    }
    return this.status;
  }

  private async doSync(): Promise<void> {
    this.set({ state: "syncing" });
    try {
      await run(this.g, this.dir, ["add", "-A"]);
      const dirty = (await run(this.g, this.dir, ["status", "--porcelain"])).length > 0;
      if (dirty) {
        const changed = (await run(this.g, this.dir, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
        const subject = changed.length === 1 ? `saru: update ${changed[0]}` : `saru: update ${changed.length} files`;
        await run(this.g, this.dir, ["-c", "user.name=Saru", "-c", "user.email=saru@localhost", "commit", "-q", "-m", subject]);
      }
      const remoteHasMain = await run(this.g, this.dir, ["ls-remote", "--heads", "origin", "main"]).then((o) => o.length > 0);
      if (remoteHasMain) await run(this.g, this.dir, ["-c", "user.name=Saru", "-c", "user.email=saru@localhost", "pull", "-q", "--rebase", "origin", "main"]);
      const hasCommit = await run(this.g, this.dir, ["rev-parse", "--verify", "-q", "HEAD"]).then(() => true, () => false);
      if (hasCommit) await run(this.g, this.dir, ["push", "-q", "origin", "HEAD:main"]);
      this.set({ state: "idle", message: undefined, lastSyncAt: (this.g.now?.() ?? new Date()).toISOString() });
    } catch (e) {
      this.set({ state: "error", message: `Sync failed, will retry in a minute: ${(e as Error).message}` });
      this.schedule(60_000);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
