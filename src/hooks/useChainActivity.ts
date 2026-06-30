import { useSyncExternalStore } from "react";
import {
  evmChainHasActivity,
  getSnapshot as getEvmSnapshot,
  subscribe as subscribeEvm,
} from "@/lib/evm/chainService";
import {
  bitcoinChainHasActivity,
  getBitcoinChainSnapshot,
  subscribeBitcoinChain,
} from "@/lib/bitcoin/chainService";

/// Reactive booleans for "is there a transaction the user could see
/// right now?" on each in-process chain. Drives the dock visibility
/// gates on lesson view + Playground without forcing the gate
/// component to re-implement the snapshot subscription each time.
///
/// Both chains are singletons that persist across view changes, so
/// once a learner runs a lesson that puts the chain in motion,
/// these flags stay true until they explicitly hit "Reset" on the
/// dock. That's the intended UX: the dock follows you between
/// views as long as there's state worth showing.
///
/// Returns boolean primitives (not objects) so React's identity
/// check on `useSyncExternalStore` doesn't churn — flips are rare
/// (`false → true` once per session), so re-renders only happen
/// when the answer genuinely changes.
export interface ChainActivity {
  evm: boolean;
  bitcoin: boolean;
}

/// Two independent subscriptions composed into one hook output.
/// We intentionally keep them separate primitives rather than
/// merging into one snapshot — a parent that only cares about
/// `bitcoin` re-renders only when bitcoin flips, not when EVM
/// activity churns.
export function useChainActivity(): ChainActivity {
  const evm = useSyncExternalStore(
    (cb) => subscribeEvm(() => cb()),
    () => evmChainHasActivity(getEvmSnapshot()),
    () => false,
  );
  const bitcoin = useSyncExternalStore(
    (cb) => subscribeBitcoinChain(() => cb()),
    () => bitcoinChainHasActivity(getBitcoinChainSnapshot()),
    () => false,
  );
  return { evm, bitcoin };
}
