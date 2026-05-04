/// Shared types for the Bitcoin runtime.
///
/// Mirrors the layered shape of the EVM runtime's types: an internal
/// chain shell (`buildChain.ts`) plus a singleton service
/// (`lib/bitcoin/chainService.ts`) sharing these public snapshot
/// shapes with the UI dock + the test harness.
///
/// The chain is a regtest-style UTXO simulator — there's no real PoW
/// or P2P gossip. Pre-funded learner accounts hold UTXOs from a
/// synthetic genesis coinbase; tests broadcast raw transactions, the
/// shell validates structurally + monetarily, and `mine()` rolls the
/// mempool into a new block.
///
/// Keep all chain types in this one file so the runtime, the
/// service, and the dock UI import from a single source-of-truth.

/// A regtest learner account. Each account holds a single keypair
/// (BIP340/Schnorr-compatible secp256k1) plus convenience addresses
/// for the three common Bitcoin output types so test exercises can
/// pick whichever flavour fits the lesson without re-deriving.
export interface BitcoinAccount {
  /// 32-byte private key, hex-encoded with `0x` prefix. Tests can
  /// hand this to @scure/btc-signer's signing APIs directly.
  privateKey: `0x${string}`;
  /// 33-byte compressed secp256k1 public key, hex-encoded.
  publicKey: `0x${string}`;
  /// 20-byte hash160(publicKey), hex-encoded. The "public-key-hash"
  /// embedded in P2PKH and P2WPKH outputs.
  pubkeyHash: `0x${string}`;
  /// Legacy P2PKH address — `1...` on mainnet, `m.../n...` on testnet,
  /// `m.../n...` on regtest. We use regtest format throughout.
  p2pkhAddress: string;
  /// Native SegWit P2WPKH address — `bc1q...` on mainnet, `bcrt1q...`
  /// on regtest. The default address tests bind to when picking "an
  /// address" for an account.
  p2wpkhAddress: string;
  /// Display label used by the dock UI ("Account #0", "Default
  /// sender", etc.).
  label: string;
}

/// One unspent output. Keyed in the chain's UTXO map by
/// `${txid}:${vout}`. Carries enough metadata for tests to construct
/// signing pre-images without re-fetching previous transactions.
export interface BitcoinUtxo {
  /// 32-byte txid, hex-encoded with `0x` prefix.
  txid: `0x${string}`;
  /// Output index within that tx.
  vout: number;
  /// Output value in satoshis.
  value: bigint;
  /// Locking script (`scriptPubKey`), hex-encoded with `0x` prefix.
  scriptPubKey: `0x${string}`;
  /// Block height the output landed in. Genesis-funded UTXOs report
  /// height 0; later spends reset to whatever block they confirm in.
  height: number;
  /// Optional address derived from `scriptPubKey` when it matches a
  /// well-known template (P2PKH / P2WPKH / P2SH / P2WSH). Lessons
  /// that need to match UTXOs against an account use this.
  address?: string;
}

export type BitcoinTxKind =
  | "coinbase"
  | "p2pkh"
  | "p2wpkh"
  | "p2sh"
  | "p2wsh"
  | "other";

/// One transaction snapshot, as the dock + tests want to see it.
/// Distinct from the raw `Transaction` shape @scure/btc-signer
/// produces — that one carries internal flags / signing state we
/// don't expose.
export interface BitcoinTxSnapshot {
  /// 32-byte txid, hex-encoded with `0x` prefix.
  txid: `0x${string}`;
  /// Best-effort classification for the dock's tx-row badges. A tx
  /// that mixes types (e.g. P2PKH input + P2WPKH output) is tagged
  /// by its dominant *output* type since that's what learners reason
  /// about ("I sent to a SegWit address").
  kind: BitcoinTxKind;
  /// Sum of input values minus sum of output values. Coinbase
  /// transactions have a `null` fee (newly-minted, no inputs).
  feeSats: bigint | null;
  /// Total input value in satoshis (omitted on coinbase).
  totalInSats: bigint;
  /// Total output value in satoshis.
  totalOutSats: bigint;
  /// Number of inputs / outputs. Saves the dock a pass over the raw
  /// tx for the row's "1→2" badge.
  inCount: number;
  outCount: number;
  /// Block this tx confirmed in (null while still in the mempool).
  blockHeight: number | null;
  /// Wallclock when the tx was broadcast / mined. Drives "5s ago".
  timestamp: number;
  /// Raw hex (`0x...`) so the chain dock can pop a "decode" view
  /// without going back to the chain.
  rawHex: `0x${string}`;
}

/// One mined block. We only keep recent blocks (last 30) — the chain
/// shell is for teaching, not auditing.
export interface BitcoinBlockSnapshot {
  height: number;
  /// Block hash — for v0 we synthesize this as
  /// `sha256(prevHash || merkleRoot || height)` so it's deterministic
  /// and unique. Not a real PoW hash; lessons about mining will
  /// call out the simplification.
  hash: `0x${string}`;
  prevHash: `0x${string}`;
  /// Wallclock when `mine()` was called.
  timestamp: number;
  /// txids included in this block, in order. The first is always
  /// the coinbase.
  txids: `0x${string}`[];
}

/// Read-model the dock + lessons subscribe to. Mutated by the chain
/// shell on every successful broadcast / mine; React listeners pick
/// up changes via `revision`-bumping.
export interface BitcoinChainSnapshot {
  scope: "singleton" | "ephemeral";
  /// Current tip height. 0 immediately after the genesis-funding
  /// pseudo-block; bumps once per `mine()` call.
  height: number;
  /// Tip block hash (or all-zero on a fresh chain before genesis).
  tipHash: `0x${string}`;
  accounts: BitcoinAccount[];
  /// Unspent outputs the dock surfaces. Last 30 by recency; the
  /// chain shell holds the full UTXO set internally.
  utxos: BitcoinUtxo[];
  /// Pending transactions (mempool). Cleared on mine.
  mempool: BitcoinTxSnapshot[];
  /// Mined transactions, last 30 by recency.
  txs: BitcoinTxSnapshot[];
  /// Last 30 mined blocks.
  blocks: BitcoinBlockSnapshot[];
  /// Bumped on every mutation so React `useSyncExternalStore`
  /// listeners can debounce identity-only churn.
  revision: number;
}

// ── Test-harness API ─────────────────────────────────────────────

/// Result of a script-execution call (`chain.script.run`). Drives the
/// btcdeb-style trace pane in the dock and the per-test pass/fail
/// rendering in the lesson runner.
export interface BitcoinScriptResult {
  /// Did the script complete with truthy top-of-stack? Mirrors
  /// Bitcoin Core's `verify` return.
  success: boolean;
  /// Reason for failure, when `success` is false. Pulled from
  /// libauth's verify error string (e.g. "OP_VERIFY", "Invalid
  /// signature", etc.).
  error?: string;
  /// Human-readable opcode trace. Each element is one step of
  /// execution as `"OP_DUP" / stack: [<top>, ...]`. Lessons can
  /// snapshot this string for "show me the stack" assertions.
  trace: string[];
  /// Final stack after execution, top-of-stack first. Hex-encoded
  /// stack items.
  finalStack: string[];
}

/// The `chain` global tests execute against. Two layers:
///   • Convenience: `send`, `balance`, `utxos`, `mine` — for
///     transaction-level lessons that don't need to touch the raw
///     Script VM.
///   • Low-level: `broadcast`, `script.run` — for lessons about
///     Script semantics, signatures, and tx encoding.
///
/// Both layers operate on the same UTXO map; tests can mix them.
export interface BitcoinChainHarness {
  /// 10 pre-funded regtest accounts.
  accounts: BitcoinAccount[];

  /// Read APIs.
  height(): number;
  utxos(address?: string): BitcoinUtxo[];
  balance(address: string): bigint;
  getTx(txid: string): BitcoinTxSnapshot | null;
  mempool(): BitcoinTxSnapshot[];

  /// Mutating APIs.
  /// Builds + signs a P2WPKH spend from `fromAccount` to
  /// `toAddress`, sized at `amountSats`, fee defaulted to 1000 sats.
  /// Returns the new txid so tests can assert against it.
  /// Convenience wrapper — under the hood, calls broadcast().
  send(
    fromAccount: BitcoinAccount,
    toAddress: string,
    amountSats: bigint,
    feeSats?: bigint,
  ): { txid: `0x${string}` };
  /// Push a pre-built raw tx into the mempool. Validates UTXO
  /// existence and value conservation; does NOT validate scripts
  /// (use `script.run` for that). Throws if validation fails.
  broadcast(rawTxHex: string): { txid: `0x${string}` };
  /// Move every mempool tx into a new block. With `n > 1`, mines `n`
  /// blocks back-to-back (the extras are empty besides their
  /// coinbase). Returns the freshly-mined block snapshots.
  mine(n?: number): BitcoinBlockSnapshot[];
  /// Drop the entire mempool without mining. Useful for tests that
  /// want to assert "this tx would have failed" then move on.
  flushMempool(): void;

  /// Snapshot/revert hooks for test isolation. `snapshot()` returns
  /// an opaque id; `revert(id)` rewinds the UTXO map, mempool, block
  /// list, and revision counter to the captured point.
  snapshot(): string;
  revert(id: string): void;

  /// Script-VM access. `run(scriptPubKey, scriptSig, witness?, prevOutValue?)`
  /// executes the locking + unlocking pair through libauth and
  /// returns a stepwise trace. Used by Script-focused lessons.
  script: {
    run(
      scriptPubKey: string,
      scriptSig: string,
      opts?: {
        witness?: string[];
        prevOutValueSats?: bigint;
      },
    ): BitcoinScriptResult;
  };

  /// Network constants. Always `"regtest"` for v0 — once we add
  /// testnet/mainnet examples, lessons that need to render bech32
  /// addresses with the right HRP can read this.
  network: "regtest";
}
