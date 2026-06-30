/// Monkey's Paw content verifier — proves every duel's cheat ladder
/// behaves as designed against REAL rustc, using the same
/// `joinCodeAndTests` merge the in-app runtime uses:
///
///   - every cheat compiles, PASSES the duel's starter tests (so it
///     can survive round 1 of the story), and FAILS the killer suite
///     (so it is killable),
///   - the reference passes BOTH suites (the fairness oracle).
///
/// Gated behind PAW_VERIFY=1 because it shells out to rustc ~50 times
/// (a couple of minutes) — far too slow for the default `npm test`
/// loop. Run it whenever duel content changes:
///
///   PAW_VERIFY=1 npx vitest run src/components/MonkeysPaw/__tests__/duels.verify.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { joinCodeAndTests } from "@/runtimes/rust";
import { RUST_DUELS } from "@/components/organisms/MonkeysPaw/duels";

const RUSTC = (() => {
  const candidates = [
    join(homedir(), ".cargo", "bin", "rustc"),
    "/usr/local/bin/rustc",
    "rustc",
  ];
  for (const c of candidates) {
    if (c === "rustc" || existsSync(c)) return c;
  }
  return "rustc";
})();

/// Compile `code` + `tests` as a single --test crate and run it.
/// Returns true when every #[test] passed (exit code 0).
function suitePasses(code: string, tests: string, label: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "paw-verify-"));
  try {
    const src = join(dir, "duel.rs");
    const bin = join(dir, "duel-test");
    writeFileSync(src, joinCodeAndTests(code, tests), "utf-8");
    try {
      execFileSync(RUSTC, ["--edition", "2021", "--test", "-o", bin, src], {
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch (err) {
      const e = err as { stderr?: Buffer };
      throw new Error(
        `[${label}] failed to COMPILE:\n${e.stderr?.toString().slice(0, 2000)}`,
      );
    }
    try {
      execFileSync(bin, ["--test-threads", "1"], { stdio: "pipe", timeout: 30_000 });
      return true;
    } catch {
      return false; // at least one test failed (or panicked)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.PAW_VERIFY)("Monkey's Paw rust duels", () => {
  for (const duel of RUST_DUELS) {
    it(
      `${duel.id} — ladder is coherent and winnable`,
      { timeout: 300_000 },
      () => {
        // Fairness oracle: the reference passes both suites.
        expect(
          suitePasses(duel.reference, duel.starterTests, `${duel.id}/reference vs starter`),
          `${duel.id}: reference must pass the starter tests`,
        ).toBe(true);
        expect(
          suitePasses(duel.reference, duel.killerTests, `${duel.id}/reference vs killer`),
          `${duel.id}: reference must pass the killer suite (duel must be winnable)`,
        ).toBe(true);

        for (const cheat of duel.cheats) {
          expect(
            suitePasses(cheat.code, duel.starterTests, `${duel.id}/${cheat.id} vs starter`),
            `${duel.id}: cheat "${cheat.id}" must PASS the starter tests (or it can never appear)`,
          ).toBe(true);
          expect(
            suitePasses(cheat.code, duel.killerTests, `${duel.id}/${cheat.id} vs killer`),
            `${duel.id}: cheat "${cheat.id}" must FAIL the killer suite (or the duel is unwinnable)`,
          ).toBe(false);
        }
      },
    );
  }
});
