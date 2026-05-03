// Smoke test: confirm litesvm sendTransaction works end-to-end via
// @solana/kit (web3.js v2 — what litesvm internally expects).

import { LiteSVM } from "litesvm";
import {
  generateKeyPairSigner,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

const svm = new LiteSVM();

const sender = await generateKeyPairSigner();
const recipient = await generateKeyPairSigner();

svm.airdrop(sender.address, 10n * 1_000_000_000n);

console.log("sender    pre :", svm.getBalance(sender.address));
console.log("recipient pre :", svm.getBalance(recipient.address));

const blockhash = svm.latestBlockhash();

const txMsg = pipe(
  createTransactionMessage({ version: "legacy" }),
  (m) => setTransactionMessageFeePayer(sender.address, m),
  (m) =>
    setTransactionMessageLifetimeUsingBlockhash(
      { blockhash, lastValidBlockHeight: 100n },
      m,
    ),
  (m) =>
    appendTransactionMessageInstructions(
      [
        getTransferSolInstruction({
          source: sender,
          destination: recipient.address,
          amount: 1_500_000_000n,
        }),
      ],
      m,
    ),
);

const signed = await signTransactionMessageWithSigners(txMsg);
const result = svm.sendTransaction(signed);

console.log("tx result:", result.constructor.name);
console.log("sender    post:", svm.getBalance(sender.address));
console.log("recipient post:", svm.getBalance(recipient.address));
