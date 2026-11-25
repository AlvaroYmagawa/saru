import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DataSync, repoVisibility } from "../src/core/sync";
import { FileStore } from "../src/core/store";
import { Person } from "../src/core/schema";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function bare(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "saru-remote-"));
  git(dir, "init", "-q", "--bare", "-b", "main");
  return dir;
}
const env = (remote: string, visibility: "public" | "private-or-missing" = "private-or-missing") => ({
  git: "git", remoteUrl: () => remote, visibility: async () => visibility,
});

describe("R17 — changes are committed and pushed to the data repo", () => {
  it("pushes the seed on connect, then each change as a commit", async () => {
    const remote = bare();
    const store = new FileStore(path.join(mkdtempSync(path.join(os.tmpdir(), "saru-")), "data"));
    await store.ensureSeed();
    const sync = new DataSync(store.dir, "me/saru-data", 10, env(remote));
    expect((await sync.connect()).state).toBe("idle");
    await sync.syncNow();
    expect(git(remote, "ls-tree", "-r", "--name-only", "main")).toContain("channels/email.json");

    await store.savePerson(Person.parse({ slug: "ana-lima", fullName: "Ana Lima", intimacy: 3 }));
    expect((await sync.syncNow()).state).toBe("idle");
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("saru: update people/ana-lima.json");
  });

  it("a second Mac connecting to the same repo takes its data and keeps its own aside", async () => {
    const remote = bare();
    const a = new FileStore(path.join(mkdtempSync(path.join(os.tmpdir(), "saru-")), "data"));
    await a.ensureSeed();
    await a.savePerson(Person.parse({ slug: "ana-lima", fullName: "Ana Lima", intimacy: 3 }));
    const sa = new DataSync(a.dir, "me/saru-data", 10, env(remote));
    await sa.connect();
    await sa.syncNow();

    const b = new FileStore(path.join(mkdtempSync(path.join(os.tmpdir(), "saru-")), "data"));
    await b.ensureSeed();
    await b.savePerson(Person.parse({ slug: "bo-chen", fullName: "Bo Chen", intimacy: 2 }));
    const sb = new DataSync(b.dir, "me/saru-data", 10, env(remote));
    const st = await sb.connect();
    expect(st.message).toMatch(/your local copy is in .*data\.local-/);
    expect(readdirSync(path.join(b.dir, "people"))).toEqual(["ana-lima.json"]);
    const backup = st.message!.split(" is in ")[1]!.replace(/\.$/, "");
    expect(existsSync(path.join(backup, "people", "bo-chen.json"))).toBe(true);
  });

  it("an unreachable remote is reported and retried, not lost", async () => {
    const store = new FileStore(path.join(mkdtempSync(path.join(os.tmpdir(), "saru-")), "data"));
    await store.ensureSeed();
    const sync = new DataSync(store.dir, "me/saru-data", 10, env("/nonexistent/remote.git"));
    const st = await sync.connect();
    expect(st.state).toBe("error");
    expect(st.message).toMatch(/Couldn't reach me\/saru-data/);
    sync.stop();
  });
});

describe("R18 — a public data repo is refused", () => {
  it("refuses to connect and writes nothing", async () => {
    const remote = bare();
    const store = new FileStore(path.join(mkdtempSync(path.join(os.tmpdir(), "saru-")), "data"));
    await store.ensureSeed();
    const sync = new DataSync(store.dir, "me/open-notes", 10, env(remote, "public"));
    const st = await sync.connect();
    expect(st.state).toBe("refused");
    expect(st.message).toMatch(/is public/);
    expect(existsSync(path.join(store.dir, ".git"))).toBe(false);
    await sync.syncNow();
    expect(git(remote, "branch", "--list")).toBe("");
  });

  it("reads visibility from GitHub's anonymous API", async () => {
    const fake = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await repoVisibility("a/b", fake(200))).toBe("public");
    expect(await repoVisibility("a/b", fake(404))).toBe("private-or-missing");
    expect(await repoVisibility("a/b", fake(500))).toBe("unknown");
  });
});

