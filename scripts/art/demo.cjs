// Renders docs/art/demo.gif from demo.html: one frame per 1/10 s, then ffmpeg with a palette.
// Run: bun run build && npx electron scripts/art/demo.cjs   (needs ffmpeg)
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const FPS = 10;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 720, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, "demo.html"));
  const svg = fs.readFileSync(path.join(root, "resources", "monkey.svg"), "utf8");
  await win.webContents.executeJavaScript(`document.querySelectorAll(".mark").forEach((el) => { el.innerHTML = ${JSON.stringify(svg)}; }); document.fonts.ready.then(() => true)`);
  const total = await win.webContents.executeJavaScript("window.TOTAL");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saru-demo-"));
  const n = Math.round(total * FPS);
  for (let i = 0; i < n; i++) {
    await win.webContents.executeJavaScript(`window.render(${i / FPS}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 720 });
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, "0")}.png`), img.toPNG());
  }
  const out = path.join(root, "docs", "art", "demo.gif");
  const filter = `fps=${FPS},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"), "-vf", filter, "-loop", "0", out]);
  fs.rmSync(dir, { recursive: true });
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${n} frames)`);
  app.quit();
});
