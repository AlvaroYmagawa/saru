import type { z } from "zod";
import { Channel } from "./schema";

/** Each channel kind's starting rules, created on first run. Users edit them freely. */
const RAW: z.input<typeof Channel>[] = [
  {
    id: "slack-dm",
    kind: "slack-dm",
    name: "Slack DM",
    about: "A direct message: the reader already has the context.",
    rules: [
      { id: "dmshort01", category: "format", text: "Keep it short: one paragraph is usually enough." },
      { id: "dmshort02", category: "tone", text: "Skip preamble and get to the point in the first line." },
      { id: "dmshort03", category: "format", text: "No headers or sign-off; a quick follow-up needs no greeting." },
    ],
  },
  {
    id: "slack-channel",
    kind: "slack-channel",
    name: "Slack channel",
    about: "A shared channel: people scrolling past may not have the context.",
    rules: [
      { id: "chctx0001", category: "context", text: "Give a little more context than in a DM, since others are reading." },
      { id: "chctx0002", category: "tone", text: "Banter that works in a DM can read wrong in public; keep it measured." },
      { id: "chctx0003", category: "format", text: "With more than one point, put each on its own line." },
    ],
  },
  {
    id: "email",
    kind: "email",
    name: "Email",
    about: "An email: read later, often forwarded.",
    rules: [
      { id: "email0001", category: "format", text: "Open with a greeting line and close with a short sign-off and your name." },
      { id: "email0002", category: "format", text: "One topic per paragraph; lead with what you need from them." },
      { id: "email0003", category: "context", text: "Make it understandable on its own, since it may be forwarded." },
    ],
  },
  {
    id: "whatsapp",
    kind: "whatsapp",
    name: "WhatsApp",
    about: "A chat message, read on a phone.",
    rules: [
      { id: "wapp00001", category: "format", text: "Short lines, no formatting; split long thoughts into separate short messages' worth of lines." },
      { id: "wapp00002", category: "tone", text: "Conversational and warm." },
    ],
  },
  {
    id: "other",
    kind: "other",
    name: "Anywhere else",
    about: "Used when Saru can't tell where the message is going.",
    rules: [{ id: "other0001", category: "tone", text: "Polite and tidy; contractions are fine, no slang." }],
  },
];

export const DEFAULT_CHANNELS: Channel[] = RAW.map((c) => Channel.parse(c));
