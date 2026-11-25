import { useEffect, useRef, useState } from "react";
import type { Rule, RuleScope } from "../shared/api";
import { RULE_CATEGORIES, type RuleCategory } from "../core/schema";
import { useToast } from "./toast";

const saru = window.saru;

const CATEGORY_NAMES: Record<RuleCategory, string> = {
  tone: "Tone",
  format: "Format",
  vocabulary: "Words to use",
  avoid: "Avoid",
  context: "Keep in mind",
};

/** A scope's rules, grouped by kind: add by prompt, edit in place, delete with undo. */
export function RulesEditor({ scope, rules, title = "Rules", hint }: { scope: RuleScope; rules: Rule[]; title?: string; hint?: string }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    setAdding(false);
    setRequest("");
    setEditing(undefined);
  }, [scopeKey]);
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const add = async () => {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    const r = await saru.addRules(scope, text);
    setBusy(false);
    if (!r.ok) return toast.show(r.error, { bad: true });
    if (r.value.added.length) {
      const ids = r.value.added.map((x) => x.id);
      setFresh(new Set(ids));
      setRequest("");
      setAdding(false);
      toast.show(r.value.note ?? `Added ${ids.length === 1 ? "a rule" : `${ids.length} rules`}.`, {
        undo: async () => {
          for (const id of ids) await saru.deleteRule(scope, id);
        },
      });
    } else {
      toast.show(r.value.note ?? "Nothing to add.");
    }
  };

  const remove = async (id: string) => {
    const r = await saru.deleteRule(scope, id);
    if (!r.ok) return toast.show(r.error, { bad: true });
    toast.show("Rule deleted.", { undo: async () => void (await saru.restoreRule(scope, r.value.rule, r.value.index)) });
  };

  const save = async (rule: Rule, next: Rule) => {
    setEditing(undefined);
    if (!next.text || (next.text === rule.text && next.category === rule.category)) return;
    const r = await saru.editRule(scope, next);
    if (!r.ok) toast.show(r.error, { bad: true });
    else toast.show("Rule saved.", { undo: async () => void (await saru.editRule(scope, rule)) });
  };

  const groups = RULE_CATEGORIES.map((c) => ({ c, rules: rules.filter((r) => r.category === c) })).filter((g) => g.rules.length);

  return (
    <section className="block" data-testid="rules">
      <div className="block-head">
        <h3>{title}</h3>
        <span className="hint">{rules.length ? `${rules.length} rule${rules.length === 1 ? "" : "s"}` : ""}</span>
        <button className="btn round" title="Add a rule" aria-label="Add a rule" aria-expanded={adding} data-testid="rule-add" onClick={() => setAdding((a) => !a)}>+</button>
      </div>
      {adding ? (
        <div className="adder">
          <div className="row">
            <input
              ref={input}
              className="field"
              data-testid="rule-request"
              placeholder="Say it in a sentence: she hates emoji, sign off with just K"
              value={request}
              disabled={busy}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <button className="btn primary" data-testid="rule-submit" disabled={busy || !request.trim()} onClick={() => void add()}>
              {busy ? "Writing it down…" : "Add rule"}
            </button>
          </div>
          <span className="hint">Saru turns it into clear rules and saves them. Click a rule to edit it.</span>
        </div>
      ) : null}
      {rules.length === 0 ? <p className="empty">{hint ?? "No rules yet."}</p> : null}
      {groups.map(({ c, rules: rs }) => (
        <div key={c} className={`cat-group cat-${c}`} data-testid={`rules-${c}`}>
          <h4>{CATEGORY_NAMES[c]}</h4>
          <ul className="rules">
            {rs.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                fresh={fresh.has(rule.id)}
                editing={editing === rule.id}
                onEdit={() => setEditing(rule.id)}
                onCancel={() => setEditing(undefined)}
                onSave={(next) => void save(rule, next)}
                onDelete={() => void remove(rule.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function RuleRow(props: {
  rule: Rule; fresh: boolean; editing: boolean;
  onEdit(): void; onCancel(): void; onSave(r: Rule): void; onDelete(): void;
}) {
  const { rule } = props;
  const [text, setText] = useState(rule.text);
  const [category, setCategory] = useState<RuleCategory>(rule.category);
  useEffect(() => {
    setText(rule.text);
    setCategory(rule.category);
  }, [rule.text, rule.category, props.editing]);
  const commit = () => props.onSave({ ...rule, text: text.trim(), category });

  return (
    <li className={`rule${props.fresh ? " fresh" : ""}`} data-testid="rule" data-rule-id={rule.id}>
      {props.editing ? (
        <div className="editing">
          <textarea
            className="field"
            autoFocus
            data-testid="rule-edit"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") props.onCancel();
            }}
          />
          <div className="row">
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)} data-testid="rule-category" aria-label="Kind of rule">
              {RULE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_NAMES[c]}</option>)}
            </select>
            <button className="btn primary" onClick={commit}>Save</button>
            <button className="btn quiet" onClick={props.onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <span className="text" data-testid="rule-text" role="button" tabIndex={0} onClick={props.onEdit} onKeyDown={(e) => e.key === "Enter" && props.onEdit()} title="Click to edit">{rule.text}</span>
      )}
      <span className="tools">
        <button className="btn quiet danger" title="Delete" aria-label="Delete rule" data-testid="rule-delete" onMouseDown={(e) => e.preventDefault()} onClick={props.onDelete}>×</button>
      </span>
    </li>
  );
}
