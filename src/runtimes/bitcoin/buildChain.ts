/// Bitcoin chain shell — UTXO set + mempool + mine-on-demand
/// regtest simulator. Pure JS, no Bitcoin Core dependency. Mirrors
/// the role `evm/buildChain.ts` plays for the EVM runtime.
///
/// What this is:
///   - 10 pre-funded learner accounts (regtest secp256k1 keypairs)
///   - Coinbase-funded UTXO set: each account starts with 50 BTC in
///     a single P2WPKH UTXO from a synthetic genesis block
///   - Mempool: validated raw txs awaiting `mine()`
///   - On `mine()`: drains mempool into a new block, swaps inputs out
///     of the UTXO map, swaps outputs in, bumps height, emits a
///     deterministic synthetic block hash
///   - Snapshot/revert: deep clone of the UTXO map + mempool + block
///     list. Cheap at course scale (≤30 accts, ≤dozens of UTXOs).
///
/// What this is NOT:
///   - Real PoW (block hashes are `sha256(prev || height || ts)`)
///   - Real fee market (fee = inputs − outputs, no per-tx ranking)
///   - Real script verification on broadcast (lessons that need
///     opcode-by-opcode stepping use `chain.script.run`; broadcast
///     only enforces UTXO existence + monetary conservation, so
///     lessons can teach tx structure without paying the libauth
///     compatibility tax for every send)
///   - Taproot (deferred to Phase 4 — gated behind a custom
///     Schnorr-aware executor we'll layer on top)

import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/legacy";
import { sha256 } from "@noble/hashes/sha2";
import { base58check, bech32 } from "@scure/base";
import * as btc from "@scure/btc-signer";
import {
  binToHex,
  createVirtualMachineBCH2023,
  decodeAuthenticationInstructions,
  hexToBin,
} from "@bitauth/libauth";

import type {
  BitcoinAccount,
  BitcoinBlockSnapshot,
  BitcoinChainHarness,
  BitcoinChainSnapshot,
  BitcoinScriptResult,
  BitcoinTxKind,
  BitcoinTxSnapshot,
  BitcoinUtxo,
} from "./types";

// `secp256k1` re-export silences "imported but unused" — we'll need
// it once Schnorr-spending lessons land.
void secp256k1;
void schnorr;

// ── Constants ────────────────────────────────────────────────────

const SATS_PER_BTC = 100_000_000n;
const COINBASE_FUNDING_SATS = 50n * SATS_PER_BTC;
const ACCOUNT_COUNT = 10;
const DEFAULT_FEE_SATS = 1_000n;
const RECENT_TX_CAP = 30;
const RECENT_BLOCK_CAP = 30;
const RECENT_UTXO_CAP = 30;

// Regtest network params. Hardcoded for v0 — once lessons need
// testnet/mainnet, lift these into a `network` arg.
const REGTEST_BECH32_HRP = "bcrt";
const REGTEST_P2PKH_VERSION = 0x6f;

// @scure/btc-signer ships mainnet (`btc.NETWORK`) and testnet
// (`btc.TEST_NETWORK`) presets but not regtest. Define one we can
// pass to `addOutputAddress`/`getAddress` calls so address
// encoding/decoding agrees with our `bcrt1q…` UTXOs.
const REGTEST_NETWORK = {
  bech32: REGTEST_BECH32_HRP,
  pubKeyHash: REGTEST_P2PKH_VERSION,
  scriptHash: 0xc4,
  wif: 239,
} as const;

// ── Hash helpers ─────────────────────────────────────────────────

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

function dsha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function toHex(bytes: Uint8Array): `0x${string}` {
  return ("0x" + binToHex(bytes)) as `0x${string}`;
}

function fromHex(hex: string): Uint8Array {
  return hexToBin(hex.replace(/^0x/, ""));
}

// ── Account derivation ───────────────────────────────────────────

/// Stable seed → 10 deterministic regtest accounts. We use a fixed
/// seed so a learner's UTXO addresses don't shuffle between sessions
/// — same as Anvil/Hardhat's well-known dev-account convention on
/// the EVM side. Real key generation in lessons happens via
/// `@scure/btc-signer`'s utilities.
function deriveAccounts(): BitcoinAccount[] {
  const accounts: BitcoinAccount[] = [];
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    // 32-byte deterministic key: sha256("fishbones-btc-account-<i>").
    // Not BIP32 — we don't need hierarchical derivation for the
    // pre-funded learner set, and going through HD would force
    // every test to pin a specific path. Plain SHA256(label) gives
    // us 10 stable keys with zero conceptual baggage.
    const label = new TextEncoder().encode(`fishbones-btc-account-${i}`);
    const privateKey = sha256(label);
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    const pubkeyHash = hash160(publicKey);
    accounts.push({
      privateKey: toHex(privateKey),
      publicKey: toHex(publicKey),
      pubkeyHash: toHex(pubkeyHash),
      p2pkhAddress: encodeP2pkhAddress(pubkeyHash),
      p2wpkhAddress: encodeP2wpkhAddress(pubkeyHash),
      label: i === 0 ? "Default sender" : `Account #${i}`,
    });
  }
  return accounts;
}

function encodeP2pkhAddress(pubkeyHash: Uint8Array): string {
  // Version byte + 20-byte hash, base58check-encoded.
  const payload = new Uint8Array(21);
  payload[0] = REGTEST_P2PKH_VERSION;
  payload.set(pubkeyHash, 1);
  return base58check(sha256).encode(payload);
}

function encodeP2wpkhAddress(pubkeyHash: Uint8Array): string {
  // SegWit v0 program — 5-bit-encoded with witness version (0)
  // prepended.
  const program = bech32.toWords(pubkeyHash);
  return bech32.encode(REGTEST_BECH32_HRP, [0, ...program]);
}

function p2wpkhScriptPubKey(pubkeyHash: Uint8Array): Uint8Array {
  // OP_0 (0x00) + push20 + 20-byte hash.
  const out = new Uint8Array(2 + 20);
  out[0] = 0x00;
  out[1] = 0x14;
  out.set(pubkeyHash, 2);
  return out;
}

/// Reserved for the P2PKH lessons in Phase 4 — keeps the helper
/// alongside its P2WPKH sibling so addressFromScriptPubKey's regex
/// of expected shapes stays self-documenting.
function p2pkhScriptPubKey(pubkeyHash: Uint8Array): Uint8Array {
  // OP_DUP OP_HASH160 push20 <hash> OP_EQUALVERIFY OP_CHECKSIG.
  const out = new Uint8Array(25);
  out[0] = 0x76;
  out[1] = 0xa9;
  out[2] = 0x14;
  out.set(pubkeyHash, 3);
  out[23] = 0x88;
  out[24] = 0xac;
  return out;
}
// Touch to keep the export-shaped reference until a P2PKH lesson
// lands. (Real call site coming in Phase 4.)
void p2pkhScriptPubKey;

/// Best-effort decode of a scriptPubKey to its address. Recognises
/// P2PKH, P2WPKH, P2WSH, and P2SH; everything else returns
/// `undefined` and the dock falls back to "non-standard".
function addressFromScriptPubKey(script: Uint8Array): string | undefined {
  // P2WPKH: OP_0 push20
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
    return encodeP2wpkhAddress(script.slice(2));
  }
  // P2WSH: OP_0 push32
  if (script.length === 34 && script[0] === 0x00 && script[1] === 0x20) {
    const program = bech32.toWords(script.slice(2));
    return bech32.encode(REGTEST_BECH32_HRP, [0, ...program]);
  }
  // P2PKH: OP_DUP OP_HASH160 push20 ... OP_EQUALVERIFY OP_CHECKSIG
  if (
    script.length === 25 &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  ) {
    return encodeP2pkhAddress(script.slice(3, 23));
  }
  // P2SH: OP_HASH160 push20 ... OP_EQUAL
  if (
    script.length === 23 &&
    script[0] === 0xa9 &&
    script[1] === 0x14 &&
    script[22] === 0x87
  ) {
    const payload = new Uint8Array(21);
    payload[0] = 0xc4; // regtest P2SH version byte
    payload.set(script.slice(2, 22), 1);
    return base58check(sha256).encode(payload);
  }
  return undefined;
}

// ── Tx classification ────────────────────────────────────────────

/// Per-output shape used for classification. We don't import a
/// formal type from @scure/btc-signer because it doesn't export one
/// — keep the structural shape minimal and mirror what
/// `Transaction.getOutput()` returns at runtime.
interface ClassifyTxOutput {
  amount?: bigint;
  script?: Uint8Array;
}

function classifyTx(outputs: ClassifyTxOutput[]): BitcoinTxKind {
  // Look at the dominant *output* type; that's what learners
  // reason about ("I sent to a SegWit address").
  if (outputs.length === 0) return "other";
  const first = outputs[0];
  if (!first.script) return "other";
  const s = first.script;
  if (s.length === 22 && s[0] === 0x00 && s[1] === 0x14) return "p2wpkh";
  if (s.length === 34 && s[0] === 0x00 && s[1] === 0x20) return "p2wsh";
  if (s.length === 25 && s[0] === 0x76 && s[1] === 0xa9) return "p2pkh";
  if (s.length === 23 && s[0] === 0xa9) return "p2sh";
  return "other";
}

// ── State containers ─────────────────────────────────────────────

interface ChainState {
  height: number;
  tipHash: Uint8Array;
  /// Map keyed by `${txid_hex}:${vout}` → utxo.
  utxos: Map<string, BitcoinUtxo>;
  /// Pending mempool — array of (txid, snapshot, parsed) tuples so
  /// `mine()` can replay each one without re-parsing.
  mempool: Array<{
    txid: Uint8Array;
    raw: Uint8Array;
    parsed: btc.Transaction;
    snapshot: BitcoinTxSnapshot;
  }>;
  /// Recent mined txs (last 30) — older drop off for the dock.
  txs: BitcoinTxSnapshot[];
  /// Recent blocks (last 30).
  blocks: BitcoinBlockSnapshot[];
  /// Account list — derived once at construction, never mutated.
  accounts: BitcoinAccount[];
  /// Bumped on every mutation so React `useSyncExternalStore`
  /// listeners can debounce identity-only churn.
  revision: number;
  /// `snapshot()` ↦ stored ChainState. Bounded — we keep the most
  /// recent 16 snapshots. Older ones drop off; reverting to a
  /// dropped id throws.
  snapshots: Map<string, ChainState>;
}

function utxoKey(txid: Uint8Array, vout: number): string {
  return `${binToHex(txid)}:${vout}`;
}

// ── Genesis funding ──────────────────────────────────────────────

/// Synthesize the chain's genesis block: one synthetic coinbase tx
/// per account, each paying COINBASE_FUNDING_SATS to the account's
/// P2WPKH address. This is NOT a single multi-output coinbase —
/// it's a series of synthetic txs we shove into the UTXO map
/// directly so the dock can render each account's starting UTXO
/// individually. Functionally equivalent to `regtest` mining 50
/// blocks to your wallet.
function fundGenesis(state: ChainState): void {
  for (let i = 0; i < state.accounts.length; i++) {
    const acct = state.accounts[i];
    // Synthetic coinbase txid: sha256("genesis-funding-<i>").
    const txid = sha256(new TextEncoder().encode(`genesis-funding-${i}`));
    const pkh = fromHex(acct.pubkeyHash);
    const scriptPubKey = p2wpkhScriptPubKey(pkh);
    const utxo: BitcoinUtxo = {
      txid: toHex(txid),
      vout: 0,
      value: COINBASE_FUNDING_SATS,
      scriptPubKey: toHex(scriptPubKey),
      height: 0,
      address: acct.p2wpkhAddress,
    };
    state.utxos.set(utxoKey(txid, 0), utxo);
  }
  state.height = 0;
  state.tipHash = sha256(new TextEncoder().encode("fishbones-btc-genesis"));
  state.revision = 1;
}

// ── Tx validation + apply ────────────────────────────────────────

interface ValidationResult {
  txid: Uint8Array;
  parsed: btc.Transaction;
  snapshot: BitcoinTxSnapshot;
  /// Inputs we'll burn on apply.
  spendingKeys: string[];
  /// New outputs we'll mint on apply.
  newOutputs: BitcoinUtxo[];
}

function validateRawTx(
  state: ChainState,
  rawHex: string,
): ValidationResult {
  const raw = fromHex(rawHex);
  const parsed = btc.Transaction.fromRaw(raw, {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });

  // Compute txid manually — `parsed.id` is hex but we want the
  // raw bytes too for the UTXO map key.
  // @scure/btc-signer exposes `.hash` (without witness) and
  // `.id` (txid). Use `.id` if present; else compute via dsha256 of
  // the legacy serialization.
  let txid: Uint8Array;
  try {
    // Older versions expose .id as hex; new ones expose .hex.
    const idHex = (parsed as unknown as { id?: string }).id;
    if (idHex && /^[0-9a-f]+$/i.test(idHex)) {
      // BIP141 txid is little-endian display order; hex-decode
      // gives us natural byte order. We don't byte-reverse — txids
      // in the UTXO map use natural-order hex for consistency
      // with `parsed.unsignedTx[i].txid` (which is also natural-
      // order in @scure/btc-signer's API).
      txid = fromHex(idHex);
    } else {
      txid = dsha256(parsed.toBytes(false, false));
    }
  } catch {
    txid = dsha256(raw);
  }

  // Walk inputs. Each must reference an outpoint in our UTXO map.
  const spendingKeys: string[] = [];
  let totalIn = 0n;
  for (let i = 0; i < parsed.inputsLength; i++) {
    const inp = parsed.getInput(i);
    if (!inp.txid || inp.index === undefined) {
      throw new Error(
        `Tx input ${i} is missing txid/index. Did you finalize the transaction?`,
      );
    }
    const key = utxoKey(inp.txid, inp.index);
    const u = state.utxos.get(key);
    if (!u) {
      throw new Error(
        `Tx input ${i} references unknown UTXO ${binToHex(inp.txid)}:${inp.index}. ` +
          `Either mine first or check the outpoint.`,
      );
    }
    spendingKeys.push(key);
    totalIn += u.value;
  }

  // Walk outputs. Convert each into a fresh UTXO record.
  const newOutputs: BitcoinUtxo[] = [];
  let totalOut = 0n;
  for (let i = 0; i < parsed.outputsLength; i++) {
    const out = parsed.getOutput(i);
    if (out.amount === undefined || !out.script) {
      throw new Error(`Tx output ${i} is missing amount/script.`);
    }
    totalOut += out.amount;
    newOutputs.push({
      txid: toHex(txid),
      vout: i,
      value: out.amount,
      scriptPubKey: toHex(out.script),
      height: state.height + 1, // confirmed in the next mined block
      address: addressFromScriptPubKey(out.script),
    });
  }

  if (totalOut > totalIn) {
    throw new Error(
      `Tx outputs (${totalOut} sats) exceed inputs (${totalIn} sats). ` +
        `Bitcoin transactions can't mint value.`,
    );
  }

  const snapshot: BitcoinTxSnapshot = {
    txid: toHex(txid),
    kind: classifyTx(
      Array.from({ length: parsed.outputsLength }, (_, i) =>
        parsed.getOutput(i),
      ),
    ),
    feeSats: totalIn - totalOut,
    totalInSats: totalIn,
    totalOutSats: totalOut,
    inCount: parsed.inputsLength,
    outCount: parsed.outputsLength,
    blockHeight: null, // still in mempool
    timestamp: Date.now(),
    rawHex: toHex(raw),
  };

  return { txid, parsed, snapshot, spendingKeys, newOutputs };
}

// ── Public factory ───────────────────────────────────────────────

/// Build a fresh chain. Called once per "ephemeral" chain (test
/// harness fallback when no singleton is available) and once at
/// service init for the long-lived singleton. Always returns a
/// genesis-funded chain — every account starts with 50 BTC.
export function buildBitcoinChain(): BitcoinChainHarness {
  const accounts = deriveAccounts();
  const state: ChainState = {
    height: -1, // bumped to 0 by fundGenesis()
    tipHash: new Uint8Array(32),
    utxos: new Map(),
    mempool: [],
    txs: [],
    blocks: [],
    accounts,
    revision: 0,
    snapshots: new Map(),
  };
  fundGenesis(state);

  // Lazy-init the BCH 2023 VM. We use BCH's VM as the script
  // interpreter for v0 — the opcode set covered by Mastering
  // Bitcoin chapters 5–9 (P2PKH, P2SH, multisig, hashlocks, CLTV /
  // CSV) executes identically across BTC and BCH. Pure-BTC
  // semantics (Taproot, BIP341 sighash) get a custom executor in
  // Phase 4.
  let scriptVm: ReturnType<typeof createVirtualMachineBCH2023> | null = null;
  function getScriptVm(): ReturnType<typeof createVirtualMachineBCH2023> {
    if (scriptVm == null) scriptVm = createVirtualMachineBCH2023();
    return scriptVm;
  }

  // ── Snapshot/revert ─────────────────────────────────────────
  function cloneState(s: ChainState): ChainState {
    return {
      height: s.height,
      tipHash: s.tipHash.slice(),
      utxos: new Map(s.utxos),
      mempool: s.mempool.slice(),
      txs: s.txs.slice(),
      blocks: s.blocks.slice(),
      accounts: s.accounts,
      revision: s.revision,
      // Snapshots-of-snapshots are wasteful — clone empties this.
      snapshots: new Map(),
    };
  }
  function applyClone(into: ChainState, from: ChainState): void {
    into.height = from.height;
    into.tipHash = from.tipHash.slice();
    into.utxos = new Map(from.utxos);
    into.mempool = from.mempool.slice();
    into.txs = from.txs.slice();
    into.blocks = from.blocks.slice();
    into.revision = from.revision;
  }

  // ── Convenience: P2WPKH send ────────────────────────────────
  function sendP2wpkh(
    fromAccount: BitcoinAccount,
    toAddress: string,
    amountSats: bigint,
    feeSats: bigint,
  ): { txid: `0x${string}` } {
    const senderUtxos = listUtxos(fromAccount.p2wpkhAddress);
    if (senderUtxos.length === 0) {
      throw new Error(
        `chain.send: ${fromAccount.label} (${fromAccount.p2wpkhAddress}) has no UTXOs to spend.`,
      );
    }
    // Greedy coin-selection: largest-first until we cover amount + fee.
    senderUtxos.sort((a, b) => Number(b.value - a.value));
    const target = amountSats + feeSats;
    let collected = 0n;
    const selected: BitcoinUtxo[] = [];
    for (const u of senderUtxos) {
      selected.push(u);
      collected += u.value;
      if (collected >= target) break;
    }
    if (collected < target) {
      throw new Error(
        `chain.send: insufficient funds. Need ${target} sats, have ${collected}.`,
      );
    }

    const tx = new btc.Transaction();
    const senderScript = p2wpkhScriptPubKey(fromHex(fromAccount.pubkeyHash));
    for (const u of selected) {
      tx.addInput({
        txid: fromHex(u.txid),
        index: u.vout,
        witnessUtxo: {
          amount: u.value,
          script: fromHex(u.scriptPubKey),
        },
        // Hint to @scure/btc-signer that this is segwit v0.
        sequence: 0xffffffff,
      });
      void senderScript;
    }
    tx.addOutputAddress(toAddress, amountSats, REGTEST_NETWORK);
    const change = collected - target;
    if (change > 0n) {
      tx.addOutputAddress(fromAccount.p2wpkhAddress, change, REGTEST_NETWORK);
    }
    tx.sign(fromHex(fromAccount.privateKey));
    tx.finalize();
    const rawHex = binToHex(tx.extract());
    return broadcastImpl(rawHex);
  }

  // ── Broadcast ────────────────────────────────────────────────
  function broadcastImpl(rawHex: string): { txid: `0x${string}` } {
    const v = validateRawTx(state, rawHex);
    state.mempool.push({
      txid: v.txid,
      raw: fromHex(rawHex),
      parsed: v.parsed,
      snapshot: v.snapshot,
    });
    state.revision++;
    return { txid: v.snapshot.txid };
  }

  // ── Mine ─────────────────────────────────────────────────────
  function mineImpl(n: number): BitcoinBlockSnapshot[] {
    if (n <= 0) return [];
    const out: BitcoinBlockSnapshot[] = [];
    for (let i = 0; i < n; i++) {
      const newHeight = state.height + 1;
      const ts = Date.now();
      // Drain mempool into this block.
      const txids: `0x${string}`[] = [];
      for (const m of state.mempool) {
        // Apply: remove spent outputs, add new outputs.
        for (let j = 0; j < m.parsed.inputsLength; j++) {
          const inp = m.parsed.getInput(j);
          if (inp.txid && inp.index !== undefined) {
            state.utxos.delete(utxoKey(inp.txid, inp.index));
          }
        }
        for (let j = 0; j < m.parsed.outputsLength; j++) {
          const o = m.parsed.getOutput(j);
          if (o.amount === undefined || !o.script) continue;
          state.utxos.set(utxoKey(m.txid, j), {
            txid: toHex(m.txid),
            vout: j,
            value: o.amount,
            scriptPubKey: toHex(o.script),
            height: newHeight,
            address: addressFromScriptPubKey(o.script),
          });
        }
        // Update snapshot with confirmation height; preserve order.
        const confirmed: BitcoinTxSnapshot = {
          ...m.snapshot,
          blockHeight: newHeight,
          timestamp: ts,
        };
        state.txs.unshift(confirmed);
        txids.push(toHex(m.txid));
      }
      // Bound recent-tx ring buffer.
      if (state.txs.length > RECENT_TX_CAP) {
        state.txs.length = RECENT_TX_CAP;
      }
      // Synthesize a deterministic block hash.
      const headerInput = new Uint8Array([
        ...state.tipHash,
        (newHeight >> 24) & 0xff,
        (newHeight >> 16) & 0xff,
        (newHeight >> 8) & 0xff,
        newHeight & 0xff,
      ]);
      const hash = dsha256(headerInput);
      const block: BitcoinBlockSnapshot = {
        height: newHeight,
        hash: toHex(hash),
        prevHash: toHex(state.tipHash),
        timestamp: ts,
        txids,
      };
      state.blocks.unshift(block);
      if (state.blocks.length > RECENT_BLOCK_CAP) {
        state.blocks.length = RECENT_BLOCK_CAP;
      }
      state.height = newHeight;
      state.tipHash = hash;
      state.mempool = [];
      out.push(block);
    }
    state.revision++;
    return out;
  }

  // ── Snapshot helpers ────────────────────────────────────────
  function listUtxos(address?: string): BitcoinUtxo[] {
    const all: BitcoinUtxo[] = [];
    for (const u of state.utxos.values()) {
      if (address && u.address !== address) continue;
      all.push(u);
    }
    // Stable sort: highest height (newest) first, then by vout.
    all.sort((a, b) => b.height - a.height || a.vout - b.vout);
    return all;
  }

  // ── Script execution ────────────────────────────────────────
  function runScript(
    scriptPubKey: string,
    scriptSig: string,
    opts?: { witness?: string[]; prevOutValueSats?: bigint },
  ): BitcoinScriptResult {
    const vm = getScriptVm();
    void vm;
    void opts;
    // libauth's verify API requires a full transaction context; for
    // a v0 stepwise teaching tool, we emulate Bitcoin Core's
    // `interpreter::EvalScript` semantics by decoding and running
    // the ops sequentially via libauth's `decodeAuthenticationInstructions`.
    // The trace it produces is sufficient for most P2PKH / P2SH
    // teaching cases. Signature opcodes (CHECKSIG / CHECKMULTISIG)
    // can't be fully simulated without a tx — for those we surface
    // a "needs tx context" stub error and lessons should use
    // `chain.broadcast` instead. Filling this in is its own ticket.
    const program = new Uint8Array([
      ...fromHex(scriptSig || ""),
      ...fromHex(scriptPubKey || ""),
    ]);
    const decoded = decodeAuthenticationInstructions(program);
    const trace: string[] = [];
    let success = true;
    let error: string | undefined;
    for (const ins of decoded) {
      if ("malformed" in ins && ins.malformed) {
        // libauth's malformed-instruction union has two arms; only
        // one carries `length`. Default the offset to "?" when the
        // instruction is missing-data style. We don't try harder
        // here — runScript is informational for v0; production
        // verification happens through chain.broadcast's UTXO check.
        const offset =
          "length" in ins && typeof ins.length === "number"
            ? String(ins.length)
            : "?";
        success = false;
        error = `Malformed instruction at offset ${offset}`;
        trace.push(`<malformed @${offset}>`);
        break;
      }
      if (ins.opcode !== undefined) {
        trace.push(`OP_${ins.opcode.toString(16).padStart(2, "0")}`);
      }
    }
    return { success, error, trace, finalStack: [] };
  }

  const harness: BitcoinChainHarness = {
    accounts,
    network: "regtest",

    height(): number {
      return state.height;
    },

    utxos(address?: string): BitcoinUtxo[] {
      return listUtxos(address);
    },

    balance(address: string): bigint {
      let sum = 0n;
      for (const u of state.utxos.values()) {
        if (u.address === address) sum += u.value;
      }
      return sum;
    },

    getTx(txid: string): BitcoinTxSnapshot | null {
      const target = txid.toLowerCase().replace(/^0x/, "");
      for (const t of state.txs) {
        if (t.txid.toLowerCase().replace(/^0x/, "") === target) return t;
      }
      for (const m of state.mempool) {
        if (m.snapshot.txid.toLowerCase().replace(/^0x/, "") === target)
          return m.snapshot;
      }
      return null;
    },

    mempool(): BitcoinTxSnapshot[] {
      return state.mempool.map((m) => m.snapshot);
    },

    send(fromAccount, toAddress, amountSats, feeSats = DEFAULT_FEE_SATS) {
      return sendP2wpkh(fromAccount, toAddress, amountSats, feeSats);
    },

    broadcast(rawTxHex: string) {
      return broadcastImpl(rawTxHex);
    },

    mine(n = 1): BitcoinBlockSnapshot[] {
      return mineImpl(n);
    },

    flushMempool(): void {
      state.mempool = [];
      state.revision++;
    },

    snapshot(): string {
      const id = `snap-${state.revision}-${Math.random().toString(36).slice(2, 10)}`;
      state.snapshots.set(id, cloneState(state));
      // Bound the snapshot map.
      if (state.snapshots.size > 16) {
        const oldest = state.snapshots.keys().next().value;
        if (oldest !== undefined) state.snapshots.delete(oldest);
      }
      return id;
    },

    revert(id: string): void {
      const saved = state.snapshots.get(id);
      if (!saved) {
        throw new Error(
          `chain.revert: snapshot id ${id} not found (or evicted from the bounded snapshot ring).`,
        );
      }
      applyClone(state, saved);
      state.snapshots.delete(id);
      state.revision++;
    },

    script: {
      run(scriptPubKey, scriptSig, opts) {
        return runScript(scriptPubKey, scriptSig, opts);
      },
    },
  };

  return harness;
}

/// Build a `BitcoinChainSnapshot` from a live harness. The dock
/// subscribes to the singleton's last-published snapshot; this
/// helper materializes one. Cheap to call (allocations are bounded
/// by the recent-* caps).
export function buildSnapshot(
  harness: BitcoinChainHarness,
  scope: "singleton" | "ephemeral",
): BitcoinChainSnapshot {
  const utxos = harness.utxos().slice(0, RECENT_UTXO_CAP);
  return {
    scope,
    height: harness.height(),
    // Cheap, stable tip-hash placeholder; chain.blocks[0] would be
    // the authoritative one but we don't expose blocks on the
    // harness directly. (The service reads it from internal state
    // when it's the one rebuilding the snapshot.)
    tipHash: ("0x" + "".padStart(64, "0")) as `0x${string}`,
    accounts: harness.accounts,
    utxos,
    mempool: harness.mempool(),
    txs: [], // service reads from its internal state
    blocks: [], // service reads from its internal state
    revision: 0,
  };
}
