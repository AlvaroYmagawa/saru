---
name: polish
description: MANDATORY before any message to a person, client, team or channel is written, sent or posted — Slack, email, DM, Notion comment, WhatsApp — and it comes BEFORE slack:slack-messaging or any tool that sends: those only deliver; this writes the words. Rewrites the draft (any language) into natural, native text in the user's voice using Saru's stored rules for the user, the recipient and the channel. Triggers on "send this to <name>", "reply to <name>", "write a message to <name>", "answer this on Slack", "how do I say this", "polish this", "manda isso pro <nome>", "responde o <nome>", "escreve uma mensagem pra <nome>", "como eu falo isso", and on drafts the agent writes itself. Also for changing Saru's notes ("add a rule for <name>: …", "<name> is our CFO now").
---

# Saru · polish

Run this first whenever a message to someone is about to be written or sent; a sending skill or
tool (Slack, email, Notion) only delivers the text this skill produced, after the user approved it.

Saru keeps notes on whose voice to write in (**You**), the people the user writes to, and the
places they write (channel kinds such as Slack DM or email, and named channels), each with a list
of rules. This skill reads those notes and writes the message the way `references/rules.md` says.

The notes are read and changed with Saru's command, run with node:

```sh
SARU="node ${CLAUDE_PLUGIN_ROOT}/scripts/saru.cjs"
$SARU context --channel <where> [--to "Name, Name"]   # everything a polish needs, as text
$SARU add-rule --person <slug> | --channel <id> | --profile "<rule in a sentence>"
$SARU tell "<a sentence about a person>"              # change a person's details, or add one
$SARU path                                             # where the notes live
```

`<where>` is `slack-dm`, `slack-channel`, `email`, `whatsapp`, `other`, or a named channel such as
`#x-dev`. If the command fails because Saru isn't set up, say so in one line and polish with the
rules file alone.

## Polishing

1. **Who and where.** Take the recipients from the draft's greeting and the request ("send this to
   Ana"), and the place from the request. If the place is unknown, ask once, in one line: *"Where's
   this going — DM, a channel (which), email?"*
2. **Read the notes:** `$SARU context --channel <where> --to "<names>"`. Find each name under
   *People you write to* (full name, then alias, then first name). One match: use it. Several:
   ask which, in one line. None: carry on at intimacy 2 and offer, after the message, to add them.
3. **Write it** by `references/rules.md`, using the rules in the context: the recipients' rules,
   then the named channel's, then the channel kind's, then yours. Say only what the user said.
4. **Present it** exactly like this, and nothing else:

   ````
   **Polished — copy the block below:**

   ```
   <the whole message, plain text, ready to paste>
   ```

   _Notes: <one line, only if something needs checking>_
   ````

   - Always the whole message, also after a small change.
   - Plain text inside the block (no Markdown: Slack shows it literally).
   - If the polish worked against a person's stored intimacy, add one line: *"Heads up — <name>'s
     notes say intimacy X but this read more like Y. Want me to update?"*

## Replying in a thread

Build the reply on their **latest** comment: answer what they just said, check each claim they
made against the code or data before confirming it, then give the update and close.

## Mentions when posting through a tool

When you post the message yourself (Slack, Notion), mention the recipients so they're notified:
Slack `<@SLACK_USER_ID>`, Notion `<mention url="user://<notion_user_id>" />`, from the ids in the
context. In the copy block, show them as `@Name`.

## Changing the notes

Only when the user asks ("add a rule for Ana: never use 'kindly'", "Ana is the CFO now", "bump
Bo to 4"): run `add-rule` for a writing rule, `tell` for a person's details, then confirm in one
line with what changed. Saru's app syncs the notes to the user's private repo by itself.
