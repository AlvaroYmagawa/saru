import type { Channel, Person, Profile, Rule, RuleCategory } from "../core/schema";
import type { Settings } from "../core/config";
import type { SyncStatus } from "../core/sync";
import type { RuleScope } from "../core/agents";

export type { Channel, Person, Profile, Rule, RuleCategory, Settings, SyncStatus, RuleScope };

export interface PanelState {
  phase: "loading" | "ready" | "changing" | "error";
  original: string;
  /** Where Saru thinks it's going, e.g. "Slack DM · Hana Mori". */
  channel: string;
  message?: string;
  recipient?: string | null;
  note?: string | null;
  error?: string;
}

export interface DataSnapshot {
  profile: Profile;
  people: Person[];
  channels: Channel[];
  invalid: { file: string; reason: string }[];
  dataDir: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ShortcutResult {
  shortcut: string;
  /** Why it couldn't be used (another app holds it, or it isn't a valid shortcut). */
  refused?: string;
}

/** What the renderer can ask the main process for (exposed as `window.saru`). */
export interface SaruApi {
  view: "panel" | "app";
  // Panel
  onPanel(fn: (s: PanelState) => void): () => void;
  accept(): Promise<void>;
  change(text: string): Promise<void>;
  closePanel(): Promise<void>;
  resizePanel(height: number): Promise<void>;
  onTab(fn: (tab: string) => void): () => void;
  // Data
  getData(): Promise<DataSnapshot>;
  onData(fn: (d: DataSnapshot) => void): () => void;
  addRules(scope: RuleScope, request: string): Promise<Result<{ added: Rule[]; note: string | null }>>;
  editRule(scope: RuleScope, rule: Rule): Promise<Result<Rule[]>>;
  deleteRule(scope: RuleScope, id: string): Promise<Result<{ rule: Rule; index: number }>>;
  restoreRule(scope: RuleScope, rule: Rule, index: number): Promise<Result<Rule[]>>;
  tellPerson(request: string, selected?: string): Promise<Result<{ action: string; before?: Person; after?: Person; note: string | null }>>;
  restorePerson(before: Person | undefined, after: Person): Promise<Result<void>>;
  deletePerson(slug: string): Promise<Result<Person>>;
  savePerson(p: Person): Promise<Result<Person>>;
  addChannel(request: string): Promise<Result<{ channel?: Channel; note: string | null }>>;
  deleteChannel(id: string): Promise<Result<Channel>>;
  saveChannel(c: Channel): Promise<Result<Channel>>;
  saveProfile(p: Profile): Promise<Result<Profile>>;
  // Settings
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Result<Settings>>;
  setShortcut(accelerator: string): Promise<ShortcutResult>;
  /** Pauses the global shortcut while the recorder listens, so pressing it records it. */
  suspendShortcut(on: boolean): Promise<void>;
  getSync(): Promise<SyncStatus>;
  onSync(fn: (s: SyncStatus) => void): () => void;
  syncNow(): Promise<SyncStatus>;
  accessibility(): Promise<{ trusted: boolean }>;
  openAccessibility(): Promise<void>;
  /** e2e only: starts a polish as the shortcut would. */
  testTrigger?(): Promise<void>;
}
