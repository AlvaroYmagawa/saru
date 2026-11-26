import { contextBridge, ipcRenderer } from "electron";
import type { SaruApi } from "../shared/api";

const on = <T>(channel: string) => (fn: (v: T) => void) => {
  const handler = (_: unknown, v: T) => fn(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const view = new URLSearchParams(location.search).get("view") === "panel" ? "panel" : "app";

const api: SaruApi = {
  view,
  onPanel: on("panel:state"),
  accept: invoke("panel:accept") as SaruApi["accept"],
  change: invoke("panel:change") as SaruApi["change"],
  closePanel: invoke("panel:close") as SaruApi["closePanel"],
  addFromPanel: invoke("panel:add") as SaruApi["addFromPanel"],
  resizePanel: invoke("panel:resize") as SaruApi["resizePanel"],
  onTab: on("app:tab"),
  getData: invoke("data:get") as SaruApi["getData"],
  onData: on("data:changed"),
  addRules: invoke("rules:add") as SaruApi["addRules"],
  editRule: invoke("rules:edit") as SaruApi["editRule"],
  deleteRule: invoke("rules:delete") as SaruApi["deleteRule"],
  restoreRule: invoke("rules:restore") as SaruApi["restoreRule"],
  tellPerson: invoke("person:tell") as SaruApi["tellPerson"],
  restorePerson: invoke("person:restore") as SaruApi["restorePerson"],
  deletePerson: invoke("person:delete") as SaruApi["deletePerson"],
  savePerson: invoke("person:save") as SaruApi["savePerson"],
  addChannel: invoke("channel:add") as SaruApi["addChannel"],
  deleteChannel: invoke("channel:delete") as SaruApi["deleteChannel"],
  saveChannel: invoke("channel:save") as SaruApi["saveChannel"],
  saveProfile: invoke("profile:save") as SaruApi["saveProfile"],
  tellProfile: invoke("profile:tell") as SaruApi["tellProfile"],
  learnStyle: invoke("profile:learn") as SaruApi["learnStyle"],
  onLearning: on("profile:learning"),
  getSettings: invoke("settings:get") as SaruApi["getSettings"],
  saveSettings: invoke("settings:save") as SaruApi["saveSettings"],
  setShortcut: invoke("shortcut:set") as SaruApi["setShortcut"],
  suspendShortcut: invoke("shortcut:suspend") as SaruApi["suspendShortcut"],
  getSync: invoke("sync:get") as SaruApi["getSync"],
  onSync: on("sync:status"),
  syncNow: invoke("sync:now") as SaruApi["syncNow"],
  accessibility: invoke("os:accessibility") as SaruApi["accessibility"],
  openAccessibility: invoke("os:open-accessibility") as SaruApi["openAccessibility"],
};
if (process.argv.includes("--saru-e2e")) {
  api.testTrigger = invoke("test:trigger") as NonNullable<SaruApi["testTrigger"]>;
  api.testTranslate = invoke("test:translate") as NonNullable<SaruApi["testTranslate"]>;
}

contextBridge.exposeInMainWorld("saru", api);
