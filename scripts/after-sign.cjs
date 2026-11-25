// electron-builder afterSign hook: when SARU_SIGN_IDENTITY is set (release builds in CI), re-signs
// the app with Saru's release certificate before the DMG is made. Every release then has the same
// designated requirement, so macOS keeps the user's Accessibility grant across updates.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  const identity = process.env.SARU_SIGN_IDENTITY;
  if (!identity || context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const args = ["--force", "--deep", "--timestamp=none", "--sign", identity];
  if (process.env.SARU_SIGN_KEYCHAIN) args.push("--keychain", process.env.SARU_SIGN_KEYCHAIN);
  execFileSync("codesign", [...args, app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  const req = execFileSync("codesign", ["-dr", "-", app], { encoding: "utf8" });
  console.log(`  • signed with Saru's release certificate: ${req.trim().split("\n").pop()}`);
};
