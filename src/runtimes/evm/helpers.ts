/// Pure helpers extracted from the original `runtimes/evm.ts`
/// monolith. None of them touch the chain singleton or any closure
/// state — moving them out keeps the main file focused on the VM /
/// dispatch logic and lets the test-harness `expect` module reuse
/// `stringify` without importing the whole runtime.

/// Normalise the args a learner passes to a viem-style contract call.
///
/// Two equivalent shapes show up across the courseware:
///
///     await c.read.foo(1n, 2n)
///     await c.read.foo([1n, 2n])
///
/// Both should round-trip to the same calldata. `(...callArgs)` capture
/// gives `[arg1, arg2]` for positional and `[[arg1, arg2]]` for array
/// — we detect the latter and unwrap when it's unambiguous.
///
/// Heuristic: only unwrap when the wrapping array's length matches the
/// abi's expected input count, AND the function isn't taking a single
/// top-level array argument (where `c.read.foo([1,2,3])` for `foo(uint[3])`
/// is naturally the right shape).
export function normalizeContractArgs(
  callArgs: unknown[],
  inputs: readonly { type: string }[],
): unknown[] {
  if (callArgs.length !== 1 || !Array.isArray(callArgs[0])) return callArgs;
  if (inputs.length === 0) return callArgs;
  const wrapped = callArgs[0];
  // Single-arg function whose arg is itself an array type: don't unwrap.
  if (inputs.length === 1) {
    const t = inputs[0].type;
    if (/\[/.test(t)) return callArgs;
    // Single non-array arg: unwrap iff caller wrapped a single value.
    if (wrapped.length === 1) return wrapped;
    return callArgs;
  }
  // Multi-arg function: unwrap iff the wrapping length matches.
  if (wrapped.length === inputs.length) return wrapped;
  return callArgs;
}

/// Stringify a value for assertion-failure messages and console
/// formatting. Handles the EVM-specific oddballs (`bigint` becomes
/// `123n` so it round-trips when copy-pasted into a test;
/// `Uint8Array` becomes a `0x…` hex string for readability).
export function stringify(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, jsonReplacer);
  } catch {
    return String(v);
  }
}

/// JSON.stringify replacer that knows about the EVM types that
/// don't have a built-in JSON representation. Exported because
/// callers occasionally use it directly (when they want to format
/// nested structures into a stable string for hashing / diffing).
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString() + "n";
  if (value instanceof Uint8Array) {
    return "0x" + Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return value;
}
