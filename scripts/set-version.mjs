// Sets the app version everywhere it is declared: node scripts/set-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/set-version.mjs <major.minor.patch>");
  process.exit(1);
}

const edit = (file, from, to) => {
  const text = readFileSync(file, "utf8");
  if (!from.test(text)) throw new Error(`No version found in ${file}`);
  writeFileSync(file, text.replace(from, to));
};

edit("package.json", /"version": "[^"]+"/, `"version": "${version}"`);
edit("src-tauri/tauri.conf.json", /"version": "[^"]+"/, `"version": "${version}"`);
edit("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
execSync("npm install --package-lock-only --ignore-scripts", { stdio: "inherit" });
execSync("cargo update --manifest-path src-tauri/Cargo.toml --package ai-ops-atlas", { stdio: "inherit" });
console.log(`Version set to ${version}. Commit, merge, then tag v${version} on main.`);
