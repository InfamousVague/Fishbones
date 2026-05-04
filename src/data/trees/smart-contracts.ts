/// Auto-split from the original `src/data/trees.ts` monolith — see
/// `scripts/split-trees.mjs` for the splitter. The shape of the data
/// is unchanged; only the file boundaries moved.
import type { SkillTree } from "./_core";
export const SMART_CONTRACTS: SkillTree = {
  id: "smart-contracts",
  title: "Smart Contracts & Web3",
  short: "Web3",
  audience: "specialty",
  accent: "#ffba66",
  description:
    "EVM mental model up through DeFi primitives — AMMs, flash loans, governance, proxies. Pulls from Mastering Ethereum.",
  nodes: [
    {
      id: "evm-mental-model",
      label: "EVM Mental Model",
      summary: "Accounts, contracts, gas, the world state.",
      prereqs: [],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-reading" },
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-evm-model" },
      ],
    },
    {
      id: "solidity-storage",
      label: "Storage",
      summary: "State variables, slot layout, storage / memory / calldata.",
      prereqs: ["evm-mental-model"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-storage" },
      ],
    },
    {
      id: "solidity-functions",
      label: "Functions",
      summary: "Visibility, return values, state mutability.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-constructors" },
      ],
    },
    {
      id: "solidity-events",
      label: "Events",
      summary: "emit, indexed parameters, reading from off-chain.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-events" },
        { courseId: "vyper-fundamentals", lessonId: "r1" },
      ],
    },
    {
      id: "modifiers",
      label: "Modifiers",
      summary: "Pre/post hooks, onlyOwner, parametrised access control.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch07-smart-contracts-and-solidity-reading-modifiers" },
      ],
    },
    {
      id: "erc20-basics",
      label: "ERC-20 Basics",
      summary: "transfer, balanceOf, total supply.",
      prereqs: ["solidity-storage", "solidity-events", "modifiers"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch05-reading" },
      ],
    },
    {
      id: "erc20-allowance",
      label: "ERC-20 Allowance",
      summary: "approve / transferFrom flow, allowance race condition.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-erc20-deep" },
      ],
    },
    {
      id: "erc721-nfts",
      label: "ERC-721 NFTs",
      summary: "ownerOf, approvals, safeTransferFrom.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-erc721" },
      ],
    },
    {
      id: "erc1155-batch",
      label: "ERC-1155",
      summary: "Multi-token, batch ops.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch10-tokens-reading-beyond-erc20" },
      ],
    },
    {
      id: "security-cei",
      label: "Checks-Effects-Interactions",
      summary: "The pattern that defangs reentrancy.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch09-smart-contract-security-reading-reentrancy" },
      ],
    },
    {
      id: "security-reentrancy",
      label: "Reentrancy",
      summary: "The DAO bug, mutex guards, untrusted external calls.",
      prereqs: ["security-cei"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch09-smart-contract-security-reading-reentrancy" },
      ],
    },
    {
      id: "security-overflow",
      label: "Overflow Safety",
      summary: "Default checked arithmetic since 0.8, unchecked blocks.",
      prereqs: ["solidity-functions"],
      matches: [],
      gapNote: "No dedicated overflow / unchecked-block lesson yet. Could fold into the Mastering Ethereum security chapter.",
    },
    {
      id: "gas-storage-cost",
      label: "Gas & Storage",
      summary: "How gas maps to opcodes, slot packing, hot vs cold.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-packing" },
      ],
    },
    {
      id: "factories-create2",
      label: "CREATE2 Factories",
      summary: "Deterministic addresses for counterfactual deploys.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-create2" },
      ],
    },
    {
      id: "proxies-uups",
      label: "Proxies (UUPS)",
      summary: "Delegatecall, storage layout discipline, upgradability.",
      prereqs: ["factories-create2", "solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch14-the-evm-reading-delegatecall" },
      ],
    },
    {
      id: "amm-basics",
      label: "AMM Basics",
      summary: "Constant-product invariant, slippage, LP tokens.",
      prereqs: ["erc20-basics"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch13-decentralized-finance-reading-amm" },
        { courseId: "mastering-ethereum", lessonId: "ch13-decentralized-finance-reading-defi-intro" },
      ],
    },
    {
      id: "flash-loans",
      label: "Flash Loans",
      summary: "Single-tx borrow + repay, callback-driven.",
      prereqs: ["amm-basics"],
      matches: [],
      gapNote: "No dedicated flash-loan lesson. Host in `mastering-ethereum` DeFi chapter.",
    },
    {
      id: "governance-multisig",
      label: "Governance & Multisig",
      summary: "Proposal lifecycles, timelocks, n-of-m signing.",
      prereqs: ["modifiers"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch12-decentralized-applications-reading-governance" },
        { courseId: "mastering-ethereum", lessonId: "ch12-decentralized-applications-reading-multisig" },
      ],
    },
    {
      id: "merkle-airdrops",
      label: "Merkle Airdrops",
      summary: "Verifying inclusion proofs on-chain.",
      prereqs: ["solidity-storage"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-cryptography-reading-merkle" },
        { courseId: "cryptography-fundamentals", lessonId: "r1" },
      ],
    },
    {
      id: "eip712",
      label: "EIP-712 Signatures",
      summary: "Typed structured signing, domain separator, permit pattern.",
      prereqs: ["solidity-functions"],
      matches: [
        { courseId: "mastering-ethereum", lessonId: "ch04-cryptography-reading-eip712" },
        { courseId: "cryptography-fundamentals", lessonId: "r1" },
        { courseId: "viem-ethers", lessonId: "r28" },
      ],
    },
  ],
};
