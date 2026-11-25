import { useEffect, useRef, useState } from "react";
import type { Rule, RuleScope } from "../shared/api";
import { RULE_CATEGORIES, type RuleCategory } from "../core/schema";
import { useToast } from "./toast";

const saru = window.saru;

/** A scope's rules: add by prompt, edit in place, delete with undo. */
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
      setFresh(new Set(r.value.added.map((x) => x.id)));
      setRequest("");
      setAdding(false);
      const ids = r.value.added.map((x) => x.id);
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

  return (
    <div className="section" data-testid="rules">
      <div className="section-head">
        <span className="kicker">{title}</span>
        <span className="rule-line" />
        <button className="btn plus" title="Add a rule" aria-label="Add a rule" data-testid="rule-add" onClick={() => setAdding((a) => !a)}>+</button>
      </div>
      {adding ? (
        <div>
          <div className="prompt-box">
            <input
              ref={input}
              className="field"
              data-testid="rule-request"
              placeholder="Say it briefly — “never use ‘kindly’ with her”, “numbered lists for decisions”"
              value={request}
              disabled={busy}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <button className="btn primary" data-testid="rule-submit" disabled={busy || !request.trim()} onClick={() => void add()}>
              {busy ? "Writing it down…" : "Add"}
            </button>
          </div>
          <div className="hint">Saru turns it into a clear rule and saves it. You can edit it after.</div>
        </div>
      ) : null}
      <ul className="rules">
        {rules.length === 0 ? <li className="empty">{hint ?? "No rules yet."}</li> : null}
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            fresh={fresh.has(rule.id)}
            editing={editing === rule.id}
            onEdit={() => setEditing(rule.id)}
            onCancel={() => setEditing(undefined)}
            onSave={async (next) => {
              setEditing(undefined);
              if (next.text === rule.text && next.category === rule.category) return;
              const r = await saru.editRule(scope, next);
              if (!r.ok) toast.show(r.error, { bad: true });
              else toast.show("Rule saved.", { undo: async () => void (await saru.editRule(scope, rule)) });
            }}
            onDelete={() => void remove(rule.id)}
          />
        ))}
      </ul>
    </div>
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

  return (
    <li className={`rule${props.fresh ? " fresh" : ""}`} data-testid="rule" data-rule-id={rule.id}>
      {props.editing ? (
        <select className="field" value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)} data-testid="rule-category">
          {RULE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <span className={`cat ${rule.category}`}>{rule.category}</span>
      )}
      {props.editing ? (
        <textarea
          className="field"
          autoFocus
          data-testid="rule-edit"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              props.onSave({ ...rule, text: text.trim(), category });
            }
            if (e.key === "Escape") props.onCancel();
          }}
          onBlur={() => props.onSave({ ...rule, text: text.trim(), category })}
        />
      ) : (
        <span className="text" data-testid="rule-text" onClick={props.onEdit} title="Click to edit">{rule.text}</span>
      )}
      <span className="tools">
        {!props.editing ? <button className="btn ghost" title="Edit" aria-label="Edit rule" onClick={props.onEdit}>✎</button> : null}
        <button className="btn ghost" title="Delete" aria-label="Delete rule" data-testid="rule-delete" onMouseDown={(e) => e.preventDefault()} onClick={props.onDelete}>×</button>
      </span>
    </li>
  );
}
