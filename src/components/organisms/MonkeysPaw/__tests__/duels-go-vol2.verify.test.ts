/// Monkey's Paw Go volume-2 content verifier — proves every duel's
/// cheat ladder behaves as designed against the REAL go toolchain,
/// using the same `joinCodeAndTests` merge the in-app runtime uses:
///
///   - every cheat compiles, PASSES the duel's starter tests (so it
///     can survive round 1 of the story), and FAILS the killer suite
///     (so it is killable),
///   - the reference passes BOTH suites (the fairness oracle).
///
/// Each suite run writes the merged `package main` source into a
/// throwaway module and runs `go test` on it — test functions are
/// standard `func TestXxx(t *testing.T)` bodies, exactly what the
/// runtime merges. Gated behind PAW_VERIFY=1 because it shells out
/// to `go test` ~100 times. Run it whenever Go vol-2 content changes:
///
///   PAW_VERIFY=1 npx vitest run src/components/organisms/MonkeysPaw/__tests__/duels-go-vol2.verify.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinCodeAndTests } from "@/runtimes/go";
import { GO_DUELS_VOL2 } from "@/components/organisms/MonkeysPaw/duels/go-vol2";

const GO = (() => {
  const candidates = ["/opt/homebrew/bin/go", "/usr/local/go/bin/go", "go"];
  for (const c of candidates) {
    if (c === "go" || existsSync(c)) return c;
  }
  return "go";
})();

/// Merge `code` + `tests` the way the app runtime does, drop the
/// result into a throwaway Go module as a _test.go file, and run
/// `go test`. Returns true when every TestXxx passed (exit code 0).
/// A compile failure is an authoring bug, not a test verdict — it
/// throws so the duel can't accidentally "fail the killer suite" by
/// simply not building.
function suitePasses(code: string, tests: string, label: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "paw-go-vol2-verify-"));
  try {
    writeFileSync(join(dir, "go.mod"), "module pawduel\n\ngo 1.21\n", "utf-8");
    writeFileSync(join(dir, "duel_test.go"), joinCodeAndTests(code, tests), "utf-8");
    try {
      execFileSync(GO, ["test", "-count=1", "-timeout", "30s", "."], {
        cwd: dir,
        stdio: "pipe",
        timeout: 120_000,
      });
      return true;
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const out = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
      if (out.includes("[build failed]") || out.includes("[setup failed]")) {
        throw new Error(`[${label}] failed to COMPILE:\n${out.slice(0, 2000)}`);
      }
      return false; // at least one test failed (or panicked / timed out)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.PAW_VERIFY)("Monkey's Paw go duels (vol 2)", () => {
  it("ships a complete rank 1..10 ladder", () => {
    expect(GO_DUELS_VOL2).toHaveLength(10);
    const ranks = [...GO_DUELS_VOL2].map((d) => d.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const duel of GO_DUELS_VOL2) {
      expect(duel.language).toBe("go");
      expect(duel.id).toMatch(/^paw-go-/);
      expect(duel.cheats.length).toBeGreaterThanOrEqual(3);
      expect(duel.cheats.length).toBeLessThanOrEqual(5);
    }
  });

  for (const duel of GO_DUELS_VOL2) {
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
