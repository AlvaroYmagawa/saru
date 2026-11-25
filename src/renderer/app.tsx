import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Channel, DataSnapshot, Person, Profile, SaruApi, Settings, SyncStatus } from "../shared/api";
import { CHANNEL_KINDS, KIND_LABELS } from "../core/schema";
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
const TABS: { id: Tab; num: string; label: string }[] = [
  { id: "people", num: "一", label: "People" },
  { id: "channels", num: "二", label: "Channels" },
  { id: "you", num: "三", label: "You" },
  { id: "settings", num: "四", label: "Settings" },
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

  return (
    <div className="shell">
      <nav className="side washi">
        <div className="brand">
          <span className="seal lg" aria-hidden>猿</span>
          <div><b>Saru</b><small>speak no ill</small></div>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`nav${tab === t.id ? " on" : ""}`} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}>
            <span className="num">{t.num}</span>{t.label}
          </button>
        ))}
        <div className="foot" data-testid="sync-foot">
          <SyncLine s={sync} />
        </div>
      </nav>
      {!data ? <div /> : tab === "people" ? <PeoplePage data={data} /> : tab === "channels" ? <ChannelsPage data={data} /> : tab === "you" ? <YouPage profile={data.profile} /> : <SettingsPage sync={sync} />}
    </div>
  );
}

export function SyncLine({ s }: { s?: SyncStatus }) {
  if (!s || s.state === "off") return <span><i className="dot" />Not synced</span>;
  const cls = s.state === "idle" ? "ok" : s.state === "error" || s.state === "refused" ? "bad" : "busy";
  const text = s.state === "idle" ? `Synced to ${s.repo}` : s.state === "refused" ? "Sync refused" : s.state === "error" ? "Sync failed" : "Syncing…";
  return <span title={s.message}><i className={`dot ${cls}`} />{text}</span>;
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
    <div className="page">
      <aside className="list">
        <div className="row" style={{ padding: "0 10px" }}>
          <span className="kicker">{data.people.length === 1 ? "1 person" : `${data.people.length} people`}</span>
        </div>
        {data.invalid.length ? <div className="banner" style={{ margin: 10 }}>Skipped {data.invalid.length} file(s) that don't parse: {data.invalid.map((i) => i.file).join(", ")}</div> : null}
        {groups.map(([org, people]) => (
          <div key={org}>
            <h4 className="kicker">{org}</h4>
            {people.map((p) => (
              <button key={p.slug} className={`item${person?.slug === p.slug ? " on" : ""}`} data-testid={`person-${p.slug}`} onClick={() => setSelected(p.slug)}>
                <span className="avatar">{initials(p.fullName)}</span>
                <span>
                  <div>{p.fullName}</div>
                  <div className="sub">{p.role || "—"} · {n(p.rules.length, "rule")}</div>
                </span>
              </button>
            ))}
          </div>
        ))}
        {data.people.length === 0 ? <p className="empty" style={{ padding: 10 }}>Nobody yet. Tell Saru about someone below.</p> : null}
      </aside>
      <section className="detail">
        {person ? <PersonDetail key={person.slug} person={person} /> : <h1>People</h1>}
        <div className="section">
          <div className="section-head"><span className="kicker">Tell Saru</span><span className="rule-line" /></div>
          <div className="prompt-box">
            <input
              className="field"
              data-testid="tell"
              placeholder={person ? `“${person.fullName.split(" ")[0]} is our CFO now”, “new: Ana Lima, legal at Acme, keep it formal”` : "“new: Ana Lima, legal at Acme, keep it formal”"}
              value={tell}
              disabled={busy}
              onChange={(e) => setTell(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submitTell()}
            />
            <button className="btn primary" data-testid="tell-submit" disabled={busy || !tell.trim()} onClick={() => void submitTell()}>{busy ? "Thinking…" : "Tell"}</button>
          </div>
          <div className="hint">Changes a person's details, or adds someone new. Writing rules go in Rules above.</div>
        </div>
      </section>
    </div>
  );
}

function TextField({ label, value, onSave, testId, placeholder }: { label: string; value?: string; onSave(v: string): void; testId?: string; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <label>
      {label}
      <input className="field" data-testid={testId} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? "") && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function Intimacy({ value, onChange }: { value: number | undefined; onChange(n: number | undefined): void }) {
  const labels = ["", "cold contact", "polite, tidy", "regular colleague", "teammate", "close friend"];
  return (
    <div className="intimacy" data-testid="intimacy">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={value && n <= value ? "on" : ""} aria-label={`Intimacy ${n}`} onClick={() => onChange(n)} />
      ))}
      <span>{value ? `${value} · ${labels[value]}` : "not set"}</span>
    </div>
  );
}

function PersonDetail({ person }: { person: Person }) {
  const toast = useToast();
  const save = async (patch: Partial<Person>) => {
    const next = { ...person, ...patch };
    const r = await saru.savePerson(next);
    if (!r.ok) toast.show(r.error, { bad: true });
  };
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const [about, setAbout] = useState(person.about);
  useEffect(() => setAbout(person.about), [person.about]);
  return (
    <>
      <h1 data-testid="person-name">{person.fullName}</h1>
      <p className="lede">{[person.role, person.org].filter(Boolean).join(" · ") || "No role yet"}</p>
      <div className="grid">
        <TextField label="Role" value={person.role} testId="person-role" onSave={(v) => void save({ role: opt(v) })} />
        <TextField label="Org" value={person.org} onSave={(v) => void save({ org: opt(v) })} />
        <TextField label="Also called" value={person.aliases.join(", ")} onSave={(v) => void save({ aliases: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
        <TextField label="Writes in" value={person.outputLanguage} placeholder="your default" onSave={(v) => void save({ outputLanguage: opt(v) })} />
        <TextField label="Native language" value={person.nativeLanguage} onSave={(v) => void save({ nativeLanguage: opt(v) })} />
        <TextField label="Time zone" value={person.timezone} onSave={(v) => void save({ timezone: opt(v) })} />
      </div>
      <div className="section">
        <div className="section-head"><span className="kicker">Intimacy</span><span className="rule-line" /></div>
        <Intimacy value={person.intimacy} onChange={(n) => n && void save({ intimacy: n })} />
      </div>
      <div className="section">
        <div className="section-head"><span className="kicker">Who they are</span><span className="rule-line" /></div>
        <textarea className="field" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== person.about && void save({ about })} />
      </div>
      <RulesEditor scope={{ type: "person", slug: person.slug }} rules={person.rules} title={`How to write to ${person.fullName.split(" ")[0]}`} hint="No rules yet: press + and say one in a sentence." />
      <div className="section">
        <button
          className="btn ghost"
          data-testid="person-delete"
          onClick={async () => {
            const r = await saru.deletePerson(person.slug);
            if (!r.ok) return toast.show(r.error, { bad: true });
            toast.show(`Removed ${person.fullName}.`, { undo: async () => void (await saru.restorePerson(r.value, r.value)) });
          }}
        >
          Remove {person.fullName.split(" ")[0]}
        </button>
      </div>
    </>
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────────────────────

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
    <div className="page">
      <aside className="list">
        <div className="row" style={{ padding: "0 10px", justifyContent: "space-between" }}>
          <span className="kicker">Where you write</span>
          <button className="btn plus" title="Add a channel" data-testid="channel-add" onClick={() => setAdding((a) => !a)}>+</button>
        </div>
        {adding ? (
          <div style={{ padding: "8px 10px" }}>
            <input className="field" style={{ width: "100%" }} autoFocus data-testid="channel-request" disabled={busy} placeholder="“#x-acme-dev, client channel, keep it formal”" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
            <div className="hint">{busy ? "Setting it up…" : "Enter to add"}</div>
          </div>
        ) : null}
        {CHANNEL_KINDS.map((kind) => {
          const named = data.channels.filter((c) => c.kind === kind && c.match);
          const base = data.channels.find((c) => c.id === kind);
          return (
            <div key={kind}>
              <h4 className="kicker">{KIND_LABELS[kind]}</h4>
              {base ? <ChannelItem c={base} on={channel?.id === base.id} label={kind === "other" ? "Anywhere else" : `Every ${KIND_LABELS[kind]}`} onClick={() => setSelected(base.id)} /> : null}
              {named.map((c) => <ChannelItem key={c.id} c={c} on={channel?.id === c.id} label={c.name} onClick={() => setSelected(c.id)} />)}
            </div>
          );
        })}
      </aside>
      <section className="detail">{channel ? <ChannelDetail key={channel.id} channel={channel} onDeleted={() => setSelected(channel.kind)} /> : null}</section>
    </div>
  );
}

function ChannelItem({ c, on, label, onClick }: { c: Channel; on: boolean; label: string; onClick(): void }) {
  return (
    <button className={`item${on ? " on" : ""}`} data-testid={`channel-${c.id}`} onClick={onClick}>
      <span>
        <div>{label}</div>
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
  const [about, setAbout] = useState(channel.about);
  useEffect(() => setAbout(channel.about), [channel.about]);
  return (
    <>
      <h1 data-testid="channel-name">{isKind ? (channel.kind === "other" ? "Anywhere else" : `Every ${KIND_LABELS[channel.kind]}`) : channel.name}</h1>
      <p className="lede">{isKind ? "These rules apply to every message of this kind." : `A named ${KIND_LABELS[channel.kind]}: its rules add to “Every ${KIND_LABELS[channel.kind]}”.`}</p>
      {!isKind ? (
        <div className="grid">
          <TextField label="Window title calls it" value={channel.match} onSave={(v) => v.trim() && void save({ match: v.trim(), name: v.trim() })} />
        </div>
      ) : null}
      <div className="section">
        <div className="section-head"><span className="kicker">Intimacy when nobody is named</span><span className="rule-line" /></div>
        <Intimacy value={channel.intimacy} onChange={(n) => void save({ intimacy: n })} />
      </div>
      <div className="section">
        <div className="section-head"><span className="kicker">About</span><span className="rule-line" /></div>
        <textarea className="field" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== channel.about && void save({ about })} />
      </div>
      <RulesEditor scope={{ type: "channel", id: channel.id }} rules={channel.rules} title="How to write here" />
      {!isKind ? (
        <div className="section">
          <button
            className="btn ghost"
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
  const [about, setAbout] = useState(profile.about);
  useEffect(() => setAbout(profile.about), [profile.about]);
  return (
    <div className="page single">
      <section className="detail">
        <h1>{profile.name || "You"}</h1>
        <p className="lede">Saru writes in your voice. Everything here applies to every message.</p>
        <div className="grid">
          <TextField label="Your name" value={profile.name} testId="you-name" onSave={(v) => void save({ name: v.trim() })} />
          <TextField label="Native language" value={profile.nativeLanguage} placeholder="e.g. pt-BR" onSave={(v) => void save({ nativeLanguage: v.trim() })} />
          <TextField label="Saru writes in" value={profile.outputLanguage} placeholder="e.g. en-GB" testId="you-output" onSave={(v) => v.trim() && void save({ outputLanguage: v.trim() })} />
        </div>
        <div className="section">
          <div className="section-head"><span className="kicker">About you</span><span className="rule-line" /></div>
          <textarea className="field" placeholder="“Tech lead at a London software house. Dry, direct, warm where it counts.”" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== profile.about && void save({ about })} />
        </div>
        <RulesEditor scope={{ type: "profile" }} rules={profile.rules} title="Your rules" hint="Rules for every message, e.g. “never use exclamation marks”." />
      </section>
    </div>
  );
}

// ── Mount ────────────────────────────────────────────────────────────────────────────────────

function Root() {
  const ref = useRef(false);
  if (!ref.current) {
    document.body.classList.toggle("panel", saru.view === "panel");
    ref.current = true;
  }
  return <ToastHost>{saru.view === "panel" ? <Panel /> : <App />}</ToastHost>;
}

createRoot(document.getElementById("root")!).render(<Root />);

export type { Settings };
