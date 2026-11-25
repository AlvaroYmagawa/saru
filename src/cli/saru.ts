import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addRulesByPrompt, Polisher } from "../core/agents";
import { buildContext, renderContext } from "../core/context";
import { parseWindow, type WindowContext } from "../core/channel";
import { findInLoginShell } from "../core/claude";
import { loadSettings, resolveDataDir } from "../core/config";
import { contentItemCount, importPerson, importTarget } from "../core/migrate";
import { CHANNEL_KINDS, type ChannelKind } from "../core/schema";
import { FileStore } from "../core/store";
import { DataSync } from "../core/sync";

const USAGE = `saru <command>

  path                         print the data folder
  context --channel <c> [--to "Name, Name"]
                               print what a polish would know (c: slack-dm, slack-channel,
                               email, whatsapp, other, or a named channel such as #x-dev)
  migrate --from <dir> [--dry-run]
                               import Markdown notes: <dir>/people/*.md, <dir>/targets/*/config.md
  polish --app <app> --title <title> --draft <text>
  add-rule --person <slug> | --channel <id> | --profile  <request>
  sync                         connect the data folder to the configured repo and push`;

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const settings = await loadSettings();
  const store = new FileStore(resolveDataDir(settings));
  switch (cmd) {
    case "path":
      console.log(store.dir);
      return 0;
    case "context":
      return context(store, rest);
    case "migrate":
      return migrate(store, rest);
    case "sync": {
      if (!settings.dataRepo) throw new Error("set dataRepo (owner/name) in the config first");
      await store.ensureSeed();
      const login = await findInLoginShell("git");
      const sync = new DataSync(store.dir, settings.dataRepo, 0, { git: login?.path ?? "git", env: login ? { ...process.env, PATH: login.envPath } : process.env });
      let st = await sync.connect();
      if (st.state !== "refused" && st.state !== "error") st = await sync.syncNow();
      sync.stop();
      console.log(JSON.stringify(st, null, 2));
      return st.state === "idle" ? 0 : 1;
    }
    case "polish":
    case "add-rule": {
      const claude = settings.claudePath || (await findInLoginShell("claude"))?.path;
      if (!claude) throw new Error("claude not found: set claudePath in the config");
      const env = { claudePath: claude, model: settings.model, timeoutSeconds: settings.timeoutSeconds, rulesFile: rulesFile() };
      await store.ensureSeed();
      if (cmd === "polish") {
        const { values } = parseArgs({ args: rest, options: { app: { type: "string" }, title: { type: "string" }, draft: { type: "string" } } });
        const d = await new Polisher(store, env).draft(parseWindow(values.app ?? "", values.title ?? ""), values.draft ?? "");
        console.log(JSON.stringify(d, null, 2));
        return 0;
      }
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { person: { type: "string" }, channel: { type: "string" }, profile: { type: "boolean" } } });
      const scope = values.person ? { type: "person" as const, slug: values.person } : values.channel ? { type: "channel" as const, id: values.channel } : { type: "profile" as const };
      console.log(JSON.stringify(await addRulesByPrompt(store, scope, positionals.join(" "), env), null, 2));
      return 0;
    }
    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

/** From dist/cli.cjs (the repo) or plugin/scripts/saru.cjs (the plugin). */
function rulesFile(): string {
  const rel = ["skills", "polish", "references", "rules.md"];
  const inPlugin = path.join(__dirname, "..", ...rel);
  return existsSync(inPlugin) ? inPlugin : path.join(__dirname, "..", "plugin", ...rel);
}

async function context(store: FileStore, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { channel: { type: "string" }, to: { type: "string" } } });
  const c = values.channel ?? "other";
  let window: WindowContext;
  if ((CHANNEL_KINDS as readonly string[]).includes(c)) {
    window = { app: "", title: "", kind: c as ChannelKind, name: c === "slack-dm" ? values.to : undefined };
  } else {
    window = { app: "", title: "", kind: "slack-channel", name: c.startsWith("#") ? c : `#${c}` };
  }
  const [profile, channels, people] = await Promise.all([store.getProfile(), store.listChannels(), store.listPeople()]);
  const ctx = buildContext(window, profile, channels.items, people.items);
  if (values.to && window.kind !== "slack-dm") {
    const names = values.to.split(",").map((s) => s.trim());
    ctx.recipients = people.items.filter((p) => names.some((n) => [p.fullName, ...p.aliases].some((x) => x.toLowerCase() === n.toLowerCase())));
  }
  console.log(renderContext(ctx));
  for (const bad of [...channels.invalid, ...people.invalid]) console.error(`skipped ${bad.file}: ${bad.reason}`);
  return 0;
}

async function migrate(store: FileStore, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { from: { type: "string" }, "dry-run": { type: "boolean" } } });
  if (!values.from) throw new Error("--from <dir> is required");
  const dry = values["dry-run"] === true;
  if (!dry) await store.ensureSeed();
  let ok = 0;
  let lost = 0;
  const report: string[] = [];
  const peopleDir = path.join(values.from, "people");
  for (const name of (await fs.readdir(peopleDir).catch(() => [])).filter((n) => n.endsWith(".md")).sort()) {
    const text = await fs.readFile(path.join(peopleDir, name), "utf8");
    const { value, unmapped } = importPerson(name.slice(0, -3), text);
    const before = contentItemCount(text);
    const after = value.rules.length + (value.about ? value.about.split("\n\n").length : 0);
    if (before !== after) lost++;
    report.push(`person  ${value.slug.padEnd(28)} items ${before} → ${after} (${value.rules.length} rules)${unmapped.length ? ` unmapped: ${unmapped.join(", ")}` : ""}`);
    if (!dry) await store.savePerson(value);
    ok++;
  }
  const targetsDir = path.join(values.from, "targets");
  for (const name of (await fs.readdir(targetsDir).catch(() => [])).sort()) {
    const file = path.join(targetsDir, name, "config.md");
    const text = await fs.readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const { value, unmapped } = importTarget(name, text);
    const before = contentItemCount(text);
    const after = value.rules.length + value.about.split("\n\n").filter(Boolean).length - (value.about.startsWith("Audience:") ? 1 : 0);
    if (before !== after) lost++;
    report.push(`channel ${value.id.padEnd(28)} items ${before} → ${after} (${value.rules.length} rules)${unmapped.length ? ` unmapped: ${unmapped.join(", ")}` : ""}`);
    if (!dry) await store.saveChannel(value);
    ok++;
  }
  console.log(report.join("\n"));
  console.log(`${dry ? "would import" : "imported"} ${ok} notes into ${store.dir}; ${lost} with an item count mismatch`);
  return lost ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
