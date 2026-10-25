// Load the repo-root .env before anything reads process.env. Variables already set win,
// and a missing file is fine: every setting has a local default.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env: run on the defaults
}
