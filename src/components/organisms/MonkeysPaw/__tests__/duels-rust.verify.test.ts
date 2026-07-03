/// Monkey's Paw RUST content verifier — proves every rust duel's cheat
/// ladder behaves as designed against REAL rustc, using the same
/// `joinCodeAndTests` merge the in-app runtime uses:
///
///   - every cheat compiles, PASSES the duel's starter tests (so it
///     can survive round 1 of the story), and FAILS the killer suite
///     (so it is killable),
///   - the reference passes BOTH suites (the fairness oracle).
///
/// Also asserts the ladder metadata: 10 duels, ids prefixed
/// `paw-rust-`, rank 1-10 with the rank→tier mapping (1-2 novice,
/// 3-4 apprentice, 5-6 journeyman, 7-8 master, 9-10 grandmaster),
/// and 3-5 cheats per duel.
///
/// Gated behind PAW_VERIFY=1 because it shells out to rustc dozens of
/// times (a couple of minutes) — far too slow for the default
/// `npm test` loop. Run it whenever rust duel content changes:
///
///   PAW_VERIFY=1 npx vitest run src/components/organisms/MonkeysPaw/__tests__/duels-rust.verify.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { joinCodeAndTests } from "@/runtimes/rust";
import { RUST_DUELS } from "@/components/organisms/MonkeysPaw/duels/rust";
import type { PawDifficulty } from "@/components/organisms/MonkeysPaw/duels";

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

/// rank → expected difficulty tier (two ranks per tier).
const TIER_BY_RANK: readonly PawDifficulty[] = [
  "novice",
  "novice",
  "apprentice",
  "apprentice",
  "journeyman",
  "journeyman",
  "master",
  "master",
  "grandmaster",
  "grandmaster",
];

/// Compile `code` + `tests` as a single --test crate and run it.
/// Returns true when every #[test] passed (exit code 0).
function suitePasses(code: string, tests: string, label: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "paw-verify-rust-"));
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
  it("ships a coherent 10-duel ladder", () => {
    expect(RUST_DUELS.length).toBe(10);
    expect(new Set(RUST_DUELS.map((d) => d.id)).size).toBe(10);
    for (const duel of RUST_DUELS) {
      expect(duel.language, duel.id).toBe("rust");
      expect(duel.id.startsWith("paw-rust-"), `${duel.id}: id prefix`).toBe(true);
      expect(duel.rank, `${duel.id}: rank in 1..=10`).toBeGreaterThanOrEqual(1);
      expect(duel.rank, `${duel.id}: rank in 1..=10`).toBeLessThanOrEqual(10);
      expect(
        duel.difficulty,
        `${duel.id}: rank ${duel.rank} must map to tier ${TIER_BY_RANK[duel.rank - 1]}`,
      ).toBe(TIER_BY_RANK[duel.rank - 1]);
      expect(duel.cheats.length, `${duel.id}: 3-5 cheats`).toBeGreaterThanOrEqual(3);
      expect(duel.cheats.length, `${duel.id}: 3-5 cheats`).toBeLessThanOrEqual(5);
      expect(
        new Set(duel.cheats.map((c) => c.id)).size,
        `${duel.id}: cheat ids unique`,
      ).toBe(duel.cheats.length);
    }
  });

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
