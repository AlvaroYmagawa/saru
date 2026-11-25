// Renders Saru's icon, menu-bar glyph and README banners from art.html.
// Run: npx electron scripts/art/render.cjs   (then: iconutil makes the .icns, see below)
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1800, height: 3000, show: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, "art.html"));
  // The mark has one source, resources/monkey.svg, put into every .mark here.
  const svg = fs.readFileSync(path.join(root, "resources", "monkey.svg"), "utf8");
  await win.webContents.executeJavaScript(`document.querySelectorAll(".mark").forEach((el) => { el.innerHTML = ${JSON.stringify(svg)}; })`);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await new Promise((r) => setTimeout(r, 300));
  const rect = (id) => win.webContents.executeJavaScript(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const shot = async (id, out, size) => {
    let img = await win.webContents.capturePage(await rect(id));
    if (size) img = img.resize({ width: size, height: size, quality: "best" });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.toPNG());
  };
  const iconset = path.join(root, "build", "icon.iconset");
  fs.mkdirSync(iconset, { recursive: true });
  for (const s of [16, 32, 128, 256, 512]) {
    await shot("icon", path.join(iconset, `icon_${s}x${s}.png`), s);
    await shot("icon", path.join(iconset, `icon_${s}x${s}@2x.png`), s * 2);
  }
  await shot("icon", path.join(root, "build", "icon.png"), 1024);
  await shot("icon", path.join(root, "docs", "art", "icon.png"), 256);
  await shot("banner-light", path.join(root, "docs", "art", "banner-light.png"));
  await shot("banner-dark", path.join(root, "docs", "art", "banner-dark.png"));
  // Template images use alpha only: ink stays, the light face becomes a hole.
  const tray = async (out, size) => {
    const img = (await win.webContents.capturePage(await rect("tray"))).resize({ width: size, height: size, quality: "best" });
    const bmp = img.toBitmap();
    for (let i = 0; i < bmp.length; i += 4) {
      const lum = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      bmp[i + 3] = Math.round((bmp[i + 3] * (255 - lum)) / 255);
      bmp[i] = bmp[i + 1] = bmp[i + 2] = 0;
    }
    fs.writeFileSync(out, nativeImage.createFromBitmap(bmp, { width: size, height: size }).toPNG());
  };
  await tray(path.join(root, "resources", "trayTemplate@2x.png"), 36);
  await tray(path.join(root, "resources", "trayTemplate.png"), 18);
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build", "icon.icns")]);
  fs.rmSync(iconset, { recursive: true });
  app.quit();
});
