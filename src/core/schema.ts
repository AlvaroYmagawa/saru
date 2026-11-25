import { z } from "zod";

/** What a rule is about; lets the UI group rules and the prompt order them. */
export const RULE_CATEGORIES = ["tone", "format", "vocabulary", "avoid", "context"] as const;
export const RuleCategory = z.enum(RULE_CATEGORIES);
export type RuleCategory = z.infer<typeof RuleCategory>;

export const Rule = z.object({
  id: z.string().regex(/^[a-z0-9]{6,16}$/, "rule id must be 6–16 lower-case letters or digits"),
  text: z.string().trim().min(1, "a rule needs text").max(600, "a rule is a sentence or two (≤600 characters)"),
  category: RuleCategory,
});
export type Rule = z.infer<typeof Rule>;

export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lower-case letters, digits and single hyphens");

/** How close you are to someone: 1 cold contact … 5 close friend. */
export const Intimacy = z.number().int().min(1).max(5);

export const Person = z.object({
  slug: Slug,
  fullName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  role: z.string().trim().optional(),
  org: z.string().trim().optional(),
  intimacy: Intimacy,
  nativeLanguage: z.string().trim().optional(),
  /** Set only when they read in another language than your default output language. */
  outputLanguage: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  slackUserId: z.string().trim().optional(),
  notionUserId: z.string().trim().optional(),
  about: z.string().trim().default(""),
  rules: z.array(Rule).default([]),
});
export type Person = z.infer<typeof Person>;

export const CHANNEL_KINDS = ["slack-dm", "slack-channel", "email", "notion", "whatsapp", "other"] as const;
export const ChannelKind = z.enum(CHANNEL_KINDS);
export type ChannelKind = z.infer<typeof ChannelKind>;

export const KIND_LABELS: Record<ChannelKind, string> = {
  "slack-dm": "Slack DM",
  "slack-channel": "Slack channel",
  email: "Email",
  notion: "Notion comment",
  whatsapp: "WhatsApp",
  other: "Anywhere else",
};

/**
 * A channel is either a kind's defaults (`match` absent, id = the kind) or one named place of
 * that kind (`match` = how the window title names it, e.g. `#x-dev`), whose rules add to the kind's.
 */
export const Channel = z.object({
  id: Slug,
  kind: ChannelKind,
  name: z.string().trim().min(1),
  match: z.string().trim().min(1).optional(),
  intimacy: Intimacy.optional(),
  /** Slugs of the people usually reading it. */
  members: z.array(Slug).default([]),
  slackChannelId: z.string().trim().optional(),
  about: z.string().trim().default(""),
  rules: z.array(Rule).default([]),
});
export type Channel = z.infer<typeof Channel>;

/** You: whose voice Saru writes in. */
export const Profile = z.object({
  name: z.string().trim().default(""),
  nativeLanguage: z.string().trim().default(""),
  /** The language and variant Saru writes in unless a person says otherwise, e.g. `en-GB`. */
  outputLanguage: z.string().trim().min(2).default("en-GB"),
  about: z.string().trim().default(""),
  rules: z.array(Rule).default([]),
});
export type Profile = z.infer<typeof Profile>;

export function newRuleId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

/** `Fernanda Albuquerque` → `fernanda-albuquerque` (accents dropped). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
}
