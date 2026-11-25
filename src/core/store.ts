import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Channel, CHANNEL_KINDS, formatZodError, Person, Profile } from "./schema";
import { DEFAULT_CHANNELS } from "./defaults";

export class StoreError extends Error {}

export interface Loaded<T> {
  items: T[];
  /** Files that exist but don't parse or validate: shown to the user, never silently dropped. */
  invalid: { file: string; reason: string }[];
}

type Listener = (relPath: string) => void;

/**
 * Saru's data: one JSON file per entity in a folder (normally a clone of the user's private data
 * repo). Every write validates first and lands atomically (temp file + rename).
 */
export class FileStore {
  private listeners = new Set<Listener>();

  constructor(readonly dir: string) {}

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Creates the folder, the profile and each channel kind's defaults when missing. */
  async ensureSeed(): Promise<void> {
    await fs.mkdir(path.join(this.dir, "people"), { recursive: true });
    await fs.mkdir(path.join(this.dir, "channels"), { recursive: true });
    if (!(await exists(this.file("profile.json")))) await this.saveProfile(Profile.parse({}));
    for (const ch of DEFAULT_CHANNELS) {
      if (!(await exists(this.file(`channels/${ch.id}.json`)))) await this.saveChannel(ch);
    }
  }

  async getProfile(): Promise<Profile> {
    const raw = await this.readJson("profile.json");
    return raw === undefined ? Profile.parse({}) : this.validate(Profile, raw, "profile.json");
  }

  async saveProfile(p: Profile): Promise<Profile> {
    const value = this.validate(Profile, p, "profile.json");
    await this.writeJson("profile.json", value);
    return value;
  }

  listPeople(): Promise<Loaded<Person>> {
    return this.loadFolder("people", Person, (p, file) => p.slug === file);
  }

  async getPerson(slug: string): Promise<Person | undefined> {
    const raw = await this.readJson(`people/${slug}.json`);
    return raw === undefined ? undefined : this.validate(Person, raw, `people/${slug}.json`);
  }

  async savePerson(p: Person): Promise<Person> {
    const value = this.validate(Person, p, `people/${p.slug}.json`);
    await this.writeJson(`people/${value.slug}.json`, value);
    return value;
  }

  async deletePerson(slug: string): Promise<void> {
    await this.remove(`people/${slug}.json`);
  }

  listChannels(): Promise<Loaded<Channel>> {
    return this.loadFolder("channels", Channel, (c, file) => c.id === file);
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    const raw = await this.readJson(`channels/${id}.json`);
    return raw === undefined ? undefined : this.validate(Channel, raw, `channels/${id}.json`);
  }

  async saveChannel(c: Channel): Promise<Channel> {
    const value = this.validate(Channel, c, `channels/${c.id}.json`);
    if (value.match === undefined && value.id !== value.kind) {
      throw new StoreError(`channels/${value.id}.json: a channel without a name to match must be its kind's defaults (id ${value.kind})`);
    }
    await this.writeJson(`channels/${value.id}.json`, value);
    return value;
  }

  async deleteChannel(id: string): Promise<void> {
    if ((CHANNEL_KINDS as readonly string[]).includes(id)) {
      throw new StoreError(`${id} holds a channel kind's defaults and can't be deleted; clear its rules instead`);
    }
    await this.remove(`channels/${id}.json`);
  }

  private file(rel: string): string {
    return path.join(this.dir, rel);
  }

  private validate<T>(schema: z.ZodType<T>, value: unknown, rel: string): T {
    const r = schema.safeParse(value);
    if (!r.success) throw new StoreError(`${rel}: ${formatZodError(r.error)}`);
    return r.data;
  }

  private async readJson(rel: string): Promise<unknown> {
    let text: string;
    try {
      text = await fs.readFile(this.file(rel), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new StoreError(`${rel}: not valid JSON`);
    }
  }

  private async writeJson(rel: string, value: unknown): Promise<void> {
    const target = this.file(rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(tmp, target);
    this.emit(rel);
  }

  private async remove(rel: string): Promise<void> {
    try {
      await fs.unlink(this.file(rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new StoreError(`${rel} doesn't exist`);
      throw e;
    }
    this.emit(rel);
  }

  private emit(rel: string): void {
    for (const fn of this.listeners) fn(rel);
  }

  private async loadFolder<T>(folder: string, schema: z.ZodType<T>, nameMatches: (v: T, file: string) => boolean): Promise<Loaded<T>> {
    let names: string[];
    try {
      names = (await fs.readdir(this.file(folder))).filter((n) => n.endsWith(".json")).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], invalid: [] };
      throw e;
    }
    const out: Loaded<T> = { items: [], invalid: [] };
    for (const name of names) {
      const rel = `${folder}/${name}`;
      try {
        const value = this.validate(schema, await this.readJson(rel), rel);
        if (!nameMatches(value, name.slice(0, -5))) throw new StoreError(`${rel}: file name doesn't match its id`);
        out.items.push(value);
      } catch (e) {
        out.invalid.push({ file: rel, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
