import { readFileSync } from "node:fs";

let version = "0.9.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (pkg.version) {
    version = pkg.version;
  }
} catch {
  // fallback
}

export const appMetadata = {
  cliName: "fortify",
  displayName: "Fortify",
  description: "AI-powered developer assistant CLI",
  version,
};
