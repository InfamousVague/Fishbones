#!/usr/bin/env node
/// Smoke test for the Bitcoin runtime built in Phase 1.
///
/// Imports the chain shell directly (no Tauri / no DOM) and runs a
/// handful of operations end-to-end:
///   1. Build a fresh chain → 10 pre-funded accounts, each with
///      50 BTC in a P2WPKH UTXO.
///   2. `chain.balance(...)` reports 50 BTC for each.
///   3. `chain.send(account[0], account[1].p2wpkhAddress, 0.5 BTC)`
///      lands in the mempool.
///   4. `chain.mine()` confirms it.
///   5. Account 0's balance dropped by 0.5 BTC + fee; account 1's
///      grew by 0.5 BTC.
///   6. `chain.snapshot()` + a second send + `chain.revert(id)`
///      cleanly rolls the chain back.
///
/// Run with:
///   node scripts/smoke-bitcoin-runtime.mjs
///
/// Exits 0 on every assertion passing, 1 (with detail) on any
/// failure.

import { buildBitcoinChain } from "../src/runtimes/bitcoin/buildChain.ts";

const SATS_PER_BTC = 100_000_000n;

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const chain = buildBitcoinChain();

// 1. Genesis funding
assert(chain.accounts.length === 10, "10 accounts derived");
const a0 = chain.accounts[0];
const a1 = chain.accounts[1];
assert(
  chain.balance(a0.p2wpkhAddress) === 50n * SATS_PER_BTC,
  `account 0 starts with 50 BTC (got ${chain.balance(a0.p2wpkhAddress)})`,
);
assert(
  chain.balance(a1.p2wpkhAddress) === 50n * SATS_PER_BTC,
  "account 1 starts with 50 BTC",
);

// 2. Send 0.5 BTC from 0 → 1
const halfBtc = 50_000_000n;
const fee = 1_000n;
const before0 = chain.balance(a0.p2wpkhAddress);
const before1 = chain.balance(a1.p2wpkhAddress);

const { txid } = chain.send(a0, a1.p2wpkhAddress, halfBtc, fee);
assert(typeof txid === "string" && txid.startsWith("0x"), "send returned txid");

// In mempool until mine
assert(chain.mempool().length === 1, "tx in mempool before mine");
assert(
  chain.balance(a1.p2wpkhAddress) === before1,
  "recipient balance unchanged before mine",
);

const blocks = chain.mine();
assert(blocks.length === 1, "mine() produced 1 block");
assert(blocks[0].txids.length === 1, "block contains 1 tx");
assert(chain.mempool().length === 0, "mempool drained after mine");
assert(chain.height() === 1, `tip height bumped to 1 (got ${chain.height()})`);

// 3. Balances reflect the spend
const after0 = chain.balance(a0.p2wpkhAddress);
const after1 = chain.balance(a1.p2wpkhAddress);
assert(
  after1 - before1 === halfBtc,
  `account 1 grew by 0.5 BTC (delta ${after1 - before1})`,
);
assert(
  before0 - after0 === halfBtc + fee,
  `account 0 shrank by 0.5 BTC + fee (delta ${before0 - after0})`,
);

// 4. Snapshot/revert round-trip
const snapId = chain.snapshot();
const beforeSnap0 = chain.balance(a0.p2wpkhAddress);
chain.send(a0, a1.p2wpkhAddress, 25_000_000n, fee);
chain.mine();
assert(
  chain.balance(a0.p2wpkhAddress) < beforeSnap0,
  "balance dropped after the post-snapshot send",
);
chain.revert(snapId);
assert(
  chain.balance(a0.p2wpkhAddress) === beforeSnap0,
  "revert restored the post-mine balance",
);
assert(chain.height() === 1, "revert restored the tip height");

// 5. UTXO listing
const a0Utxos = chain.utxos(a0.p2wpkhAddress);
assert(
  a0Utxos.length >= 1,
  `account 0 has at least 1 UTXO (got ${a0Utxos.length})`,
);
assert(
  a0Utxos.every((u) => u.address === a0.p2wpkhAddress),
  "every listed UTXO belongs to account 0",
);

console.log("\n✓ Bitcoin runtime smoke test passed.");
console.log(
  `  height=${chain.height()}  accounts=${chain.accounts.length}  total UTXOs=${chain.utxos().length}`,
);
