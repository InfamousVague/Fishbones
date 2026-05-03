#!/usr/bin/env node
/// Compile every Solana program under tests/svm-runtime/programs/<name>/
/// to a `.so` that litesvm can load. Each program is its own Cargo
/// crate — drop a directory containing Cargo.toml + src/lib.rs and
/// it gets picked up automatically.
///
/// `cargo-build-sbf` is the Solana-flavoured cargo subcommand that
/// targets the SBF (Solana Berkeley Packet Filter) bytecode the
/// runtime executes. It's installed alongside the `solana` CLI; if
/// the binary isn't on PATH we look for it at the standard install
/// location.
///
/// Output: each program ends up at
///   tests/svm-runtime/programs/<name>/target/deploy/<crate>.so
/// The harness's `svm.deployProgram(id, name)` resolves these paths
/// at runtime.
///
/// Usage:
///   node tests/svm-runtime/programs/build.mjs
///   node tests/svm-runtime/programs/build.mjs counter   # one program

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRAMS_DIR = __dirname;

/// `cargo-build-sbf` puts itself on PATH if the user sourced the
/// install script, but we don't assume that — fall back to the
/// canonical install location (`~/.local/share/solana/...`).
function resolveCargoBuildSbf() {
  const candidates = [
    "cargo-build-sbf",
    join(homedir(), ".local/share/solana/install/active_release/bin/cargo-build-sbf"),
  ];
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    if (r.status === 0) return c;
  }
  console.error(
    "cargo-build-sbf not found. Install the Solana CLI:\n" +
    "  sh -c \"$(curl -sSfL https://release.anza.xyz/stable/install)\"",
  );
  process.exit(1);
}

function listPrograms() {
  return readdirSync(PROGRAMS_DIR)
    .filter((name) => {
      const p = join(PROGRAMS_DIR, name);
      return (
        statSync(p).isDirectory() &&
        existsSync(join(p, "Cargo.toml"))
      );
    });
}

function buildProgram(cargoBuildSbf, name) {
  const dir = join(PROGRAMS_DIR, name);
  console.log(`\n[build:svm] ▶ ${name}`);
  const t0 = Date.now();
  const r = spawnSync(cargoBuildSbf, [], {
    cwd: dir,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`[build:svm] ✗ ${name} failed`);
    process.exit(1);
  }
  console.log(`[build:svm] ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const cargoBuildSbf = resolveCargoBuildSbf();
const filter = process.argv[2];
const programs = listPrograms().filter((p) => !filter || p === filter);

if (programs.length === 0) {
  console.error(`No programs to build${filter ? ` matching "${filter}"` : ""}.`);
  process.exit(1);
}

console.log(`Building ${programs.length} program(s) with ${cargoBuildSbf}…`);
for (const p of programs) buildProgram(cargoBuildSbf, p);
console.log("\n[build:svm] all done.");
