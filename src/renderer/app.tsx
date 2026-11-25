import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Channel, DataSnapshot, Person, Profile, SaruApi, SyncStatus } from "../shared/api";
import { CHANNEL_KINDS, KIND_LABELS } from "../core/schema";
import { Mark } from "./mark";
import { Panel } from "./panel";
import { RulesEditor } from "./rules";
import { ToastHost, useToast } from "./toast";
import { SettingsPage } from "./settings";

declare global {
  interface Window {
    saru: SaruApi;
  }
}
const saru = window.saru;
const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Tab = "people" | "channels" | "you" | "settings";
const TABS: { id: Tab; kanji: string; label: string }[] = [
  { id: "people", kanji: "人", label: "People" },
  { id: "channels", kanji: "場", label: "Channels" },
  { id: "you", kanji: "我", label: "You" },
  { id: "settings", kanji: "設", label: "Settings" },
];

function useData(): DataSnapshot | undefined {
  const [d, setD] = useState<DataSnapshot>();
  useEffect(() => {
    void saru.getData().then(setD);
    return saru.onData(setD);
  }, []);
  return d;
}

function App() {
  const initial = (new URLSearchParams(location.search).get("tab") as Tab) || "people";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "people");
  const data = useData();
  const [sync, setSync] = useState<SyncStatus>();
  useEffect(() => saru.onTab((t) => setTab(t as Tab)), []);
  useEffect(() => {
    void saru.getSync().then(setSync);
    return saru.onSync(setSync);
  }, []);

  const single = tab === "you" || tab === "settings";
  return (
    <div className={`shell${single ? " single" : ""}`}>
      <nav className="rail" aria-label="Sections">
        <span className="rail-mark" title="Saru"><Mark /></span>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} data-testid={`tab-${t.id}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <span className="k" aria-hidden>{t.kanji}</span>
            <span className="t">{t.label}</span>
          </button>
        ))}
        <div className="sync" data-testid="sync-foot"><SyncLine s={sync} /></div>
      </nav>
      {!data ? <div /> : tab === "people" ? <PeoplePage data={data} /> : tab === "channels" ? <ChannelsPage data={data} /> : tab === "you" ? <YouPage profile={data.profile} /> : <SettingsPage sync={sync} />}
    </div>
  );
}

export function SyncLine({ s }: { s?: SyncStatus }) {
  if (!s || s.state === "off") return <><i className="dot" /><span>Not synced</span></>;
  const cls = s.state === "idle" ? "ok" : s.state === "error" || s.state === "refused" ? "bad" : "busy";
  const text = s.state === "idle" ? `Synced to ${s.repo}` : s.state === "refused" ? "Sync refused" : s.state === "error" ? "Sync failed" : "Syncing…";
  return <><i className={`dot ${cls}`} /><span title={s.message}>{text}</span></>;
}

function Block({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="block">
      <div className="block-head"><h3>{title}</h3>{hint ? <span className="hint">{hint}</span> : null}{action}</div>
      {children}
    </section>
  );
}

// ── People ───────────────────────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function PeoplePage({ data }: { data: DataSnapshot }) {
  const toast = useToast();
  const [selected, setSelected] = useState<string | undefined>(data.people[0]?.slug);
  const [tell, setTell] = useState("");
  const [busy, setBusy] = useState(false);
  const person = data.people.find((p) => p.slug === selected) ?? data.people[0];
  const groups = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of data.people) {
      const org = p.org || "No org";
      m.set(org, [...(m.get(org) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.people]);

  const submitTell = async () => {
    const text = tell.trim();
    if (!text || busy) return;
    setBusy(true);
    const r = await saru.tellPerson(text, person?.slug);
    setBusy(false);
    if (!r.ok) return toast.show(r.error, { bad: true });
    const v = r.value;
    if (v.action === "none" || !v.after) return toast.show(v.note ?? "Nothing to change.");
    setTell("");
    setSelected(v.after.slug);
    const after = v.after;
    toast.show(v.note ?? (v.action === "create" ? `Added ${after.fullName}.` : `Updated ${after.fullName}.`), {
      undo: async () => void (await saru.restorePerson(v.before, after)),
    });
  };

  return (
    <>
      <aside className="list">
        <div className="list-head"><h2>People</h2><span className="label">{data.people.length === 1 ? "1 person" : `${data.people.length} people`}</span></div>
        {data.invalid.length ? <div className="banner">Skipped {data.invalid.length} file(s) that don't parse: {data.invalid.map((i) => i.file).join(", ")}</div> : null}
        {groups.map(([org, people]) => (
          <div key={org}>
            <div className="group">{org}</div>
            {people.map((p) => (
              <button key={p.slug} className={`item${person?.slug === p.slug ? " on" : ""}`} data-testid={`person-${p.slug}`} onClick={() => setSelected(p.slug)}>
                <span className="avatar">{initials(p.fullName)}</span>
                <span>
                  <div className="name">{p.fullName}</div>
                  <div className="sub">{p.role || "No role"} · {n(p.rules.length, "rule")}</div>
                </span>
              </button>
            ))}
          </div>
        ))}
        {data.people.length === 0 ? <p className="empty" style={{ padding: 8 }}>Nobody yet. Tell Saru about someone on the right.</p> : null}
      </aside>
      <main className="sheet">
        <div className="sheet-inner">
          {person ? <PersonDetail key={person.slug} person={person} /> : <div className="title"><h1>People</h1><p>Everyone you write to, and how to write to them.</p></div>}
          <Block title="Tell Saru" hint="Change someone's details, or add someone new">
            <div className="adder">
              <div className="row">
                <input
                  className="field"
                  data-testid="tell"
                  placeholder={person ? `${person.fullName.split(" ")[0]} is our CFO now` : "New: Ana Lima, legal at Acme, keep it formal"}
                  value={tell}
                  disabled={busy}
                  onChange={(e) => setTell(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submitTell()}
                />
                <button className="btn primary" data-testid="tell-submit" disabled={busy || !tell.trim()} onClick={() => void submitTell()}>{busy ? "Updating…" : "Tell"}</button>
              </div>
            </div>
          </Block>
        </div>
      </main>
    </>
  );
}

function TextField({ label, value, onSave, testId, placeholder }: { label: string; value?: string; onSave(v: string): void; testId?: string; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <label>
      <span className="label">{label}</span>
      <input className="field" data-testid={testId} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? "") && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

const INTIMACY = ["", "Cold contact", "Polite and tidy", "Regular colleague", "Teammate", "Close friend"];

function Intimacy({ value, onChange }: { value: number | undefined; onChange(n: number | undefined): void }) {
  return (
    <div className="intimacy" data-testid="intimacy">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} className={value && i <= value ? "on" : ""} aria-label={`Intimacy ${i}: ${INTIMACY[i]}`} onClick={() => onChange(i)} />
      ))}
      <span>{value ? `${value} · ${INTIMACY[value]}` : "Not set"}</span>
    </div>
  );
}

function AboutField({ value, placeholder, onSave }: { value: string; placeholder?: string; onSave(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="field" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />;
}

function PersonDetail({ person }: { person: Person }) {
  const toast = useToast();
  const save = async (patch: Partial<Person>) => {
    const r = await saru.savePerson({ ...person, ...patch });
    if (!r.ok) toast.show(r.error, { bad: true });
  };
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const first = person.fullName.split(" ")[0];
  return (
    <>
      <div className="title">
        <h1 data-testid="person-name">{person.fullName}</h1>
        <p>{[person.role, person.org].filter(Boolean).join(", ") || "No role yet"}</p>
      </div>
      <RulesEditor scope={{ type: "person", slug: person.slug }} rules={person.rules} title={`How to write to ${first}`} hint={`No rules for ${first} yet. Press + and say one in a sentence.`} />
      <Block title="How close you are">
        <Intimacy value={person.intimacy} onChange={(v) => v && void save({ intimacy: v })} />
      </Block>
      <Block title="Details">
        <div className="grid">
          <TextField label="Role" value={person.role} testId="person-role" onSave={(v) => void save({ role: opt(v) })} />
          <TextField label="Org" value={person.org} onSave={(v) => void save({ org: opt(v) })} />
          <TextField label="Also called" value={person.aliases.join(", ")} onSave={(v) => void save({ aliases: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
          <TextField label="Reads in" value={person.outputLanguage} placeholder="Your default" onSave={(v) => void save({ outputLanguage: opt(v) })} />
          <TextField label="Native language" value={person.nativeLanguage} onSave={(v) => void save({ nativeLanguage: opt(v) })} />
          <TextField label="Time zone" value={person.timezone} onSave={(v) => void save({ timezone: opt(v) })} />
        </div>
      </Block>
      <Block title={`Who ${first} is`}>
        <AboutField value={person.about} onSave={(about) => void save({ about })} />
      </Block>
      <div>
        <button
          className="btn quiet danger"
          data-testid="person-delete"
          onClick={async () => {
            const r = await saru.deletePerson(person.slug);
            if (!r.ok) return toast.show(r.error, { bad: true });
            toast.show(`Removed ${person.fullName}.`, { undo: async () => void (await saru.restorePerson(r.value, r.value)) });
          }}
        >
          Remove {first}
        </button>
      </div>
    </>
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────────────────────

function kindTitle(c: Channel): string {
  if (c.match) return c.name;
  return c.kind === "other" ? "Anywhere else" : `Every ${KIND_LABELS[c.kind]}`;
}

function ChannelsPage({ data }: { data: DataSnapshot }) {
  const toast = useToast();
  const [selected, setSelected] = useState<string>("slack-dm");
  const [request, setRequest] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const channel = data.channels.find((c) => c.id === selected) ?? data.channels[0];

  const add = async () => {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    const r = await saru.addChannel(text);
    setBusy(false);
    if (!r.ok) return toast.show(r.error, { bad: true });
    if (!r.value.channel) return toast.show(r.value.note ?? "That doesn't look like a channel.");
    const c = r.value.channel;
    setRequest("");
    setAdding(false);
    setSelected(c.id);
    toast.show(r.value.note ?? `Added ${c.name}.`, { undo: async () => void (await saru.deleteChannel(c.id)) });
  };

  return (
    <>
      <aside className="list">
        <div className="list-head">
          <h2>Channels</h2>
          <button className="btn round" title="Add a channel" aria-label="Add a channel" data-testid="channel-add" onClick={() => setAdding((a) => !a)}>+</button>
        </div>
        {adding ? (
          <div className="adder">
            <input className="field" autoFocus data-testid="channel-request" disabled={busy} placeholder="#x-acme-dev, the client's channel, formal" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
            <span className="hint">{busy ? "Adding it…" : "Describe it in a sentence, then Enter"}</span>
          </div>
        ) : null}
        {CHANNEL_KINDS.map((kind) => {
          const named = data.channels.filter((c) => c.kind === kind && c.match);
          const base = data.channels.find((c) => c.id === kind);
          return (
            <div key={kind}>
              <div className="group">{KIND_LABELS[kind]}</div>
              {base ? <ChannelItem c={base} on={channel?.id === base.id} onClick={() => setSelected(base.id)} /> : null}
              {named.map((c) => <ChannelItem key={c.id} c={c} on={channel?.id === c.id} onClick={() => setSelected(c.id)} />)}
            </div>
          );
        })}
      </aside>
      <main className="sheet">
        <div className="sheet-inner">{channel ? <ChannelDetail key={channel.id} channel={channel} onDeleted={() => setSelected(channel.kind)} /> : null}</div>
      </main>
    </>
  );
}

function ChannelItem({ c, on, onClick }: { c: Channel; on: boolean; onClick(): void }) {
  return (
    <button className={`item${on ? " on" : ""}`} data-testid={`channel-${c.id}`} onClick={onClick}>
      <span>
        <div className="name">{kindTitle(c)}</div>
        <div className="sub">{n(c.rules.length, "rule")}{c.intimacy ? ` · intimacy ${c.intimacy}` : ""}</div>
      </span>
    </button>
  );
}

function ChannelDetail({ channel, onDeleted }: { channel: Channel; onDeleted(): void }) {
  const toast = useToast();
  const isKind = !channel.match;
  const save = async (patch: Partial<Channel>) => {
    const r = await saru.saveChannel({ ...channel, ...patch });
    if (!r.ok) toast.show(r.error, { bad: true });
  };
  return (
    <>
      <div className="title">
        <h1 data-testid="channel-name">{kindTitle(channel)}</h1>
        <p>{isKind ? "These rules apply to every message of this kind." : `Its rules add to those for every ${KIND_LABELS[channel.kind]}.`}</p>
      </div>
      <RulesEditor scope={{ type: "channel", id: channel.id }} rules={channel.rules} title="How to write here" />
      {!isKind ? (
        <Block title="Window title calls it">
          <div className="grid"><TextField label="Name in the title" value={channel.match} onSave={(v) => v.trim() && void save({ match: v.trim(), name: v.trim() })} /></div>
        </Block>
      ) : null}
      <Block title="How close the readers are" hint="Used when nobody is named">
        <Intimacy value={channel.intimacy} onChange={(v) => void save({ intimacy: v })} />
      </Block>
      <Block title="About">
        <AboutField value={channel.about} onSave={(about) => void save({ about })} />
      </Block>
      {!isKind ? (
        <div>
          <button
            className="btn quiet danger"
            data-testid="channel-delete"
            onClick={async () => {
              const r = await saru.deleteChannel(channel.id);
              if (!r.ok) return toast.show(r.error, { bad: true });
              onDeleted();
              toast.show(`Removed ${channel.name}.`, { undo: async () => void (await saru.saveChannel(r.value)) });
            }}
          >
            Remove {channel.name}
          </button>
        </div>
      ) : null}
    </>
  );
}

// ── You ──────────────────────────────────────────────────────────────────────────────────────

function YouPage({ profile }: { profile: Profile }) {
  const toast = useToast();
  const save = async (patch: Partial<Profile>) => {
    const r = await saru.saveProfile({ ...profile, ...patch });
    if (!r.ok) toast.show(r.error, { bad: true });
  };
  return (
    <main className="sheet">
      <div className="sheet-inner">
        <div className="title">
          <h1>{profile.name || "You"}</h1>
          <p>Saru writes in your voice. What's here applies to every message.</p>
        </div>
        <RulesEditor scope={{ type: "profile" }} rules={profile.rules} title="Your rules" hint="Rules for every message, such as “never use exclamation marks”." />
        <Block title="Your voice">
          <div className="grid">
            <TextField label="Your name" value={profile.name} testId="you-name" onSave={(v) => void save({ name: v.trim() })} />
            <TextField label="Native language" value={profile.nativeLanguage} placeholder="pt-BR" onSave={(v) => void save({ nativeLanguage: v.trim() })} />
            <TextField label="Saru writes in" value={profile.outputLanguage} placeholder="en-GB" testId="you-output" onSave={(v) => v.trim() && void save({ outputLanguage: v.trim() })} />
          </div>
        </Block>
        <Block title="About you">
          <AboutField value={profile.about} placeholder="Tech lead at a London software house. Dry, direct, warm where it counts." onSave={(about) => void save({ about })} />
        </Block>
      </div>
    </main>
  );
}

// ── Mount ────────────────────────────────────────────────────────────────────────────────────

function Root() {
  document.body.classList.toggle("panel", saru.view === "panel");
  return <ToastHost>{saru.view === "panel" ? <Panel /> : <App />}</ToastHost>;
}

createRoot(document.getElementById("root")!).render(<Root />);
