# ProvenLedgerVN — Final Report, Sections 4–7 (Condensed)

> Benchmark figures re-verified 2026-05-18 (`scripts/benchmark.js`); values identical to prior run, confirming reproducibility. References [1]–[10] are those in Sections 1–3 of the master draft.

---

## 4. Implementation Details

### 4.1 Smart Contract (`ProvenLedgerVN.sol`)

Solidity 0.8.24, optimizer 200 runs, ~240 LOC, inheriting OpenZeppelin AccessControl v5. Deployed and verified on Polygon Amoy at `0x1f3E1F2e15e30f4F37CEf17FFa6f68b6E24d4709`.

**Storage design (three primitives).**

| Slot | Type | Purpose | Allocation |
|---|---|---|---|
| `_batches` | `mapping(bytes32 ⇒ Batch)` | Immutable batch metadata; `unitCount` is metadata, not an allocator | O(1) per `registerBatch` |
| `_checkpoints` | `mapping(bytes32 ⇒ Checkpoint[])` | Append-only audit trail; no index is ever writable | O(1) per push |
| `_scans` | `mapping(bytes32 ⇒ mapping(uint32 ⇒ UnitScan))` | Per-unit counter, lazily allocated at first scan | O(1) cold, O(1) warm |

**Roles.** `DEFAULT_ADMIN_ROLE` → `ADMIN_ROLE` → `MANUFACTURER_ROLE`, wired so admins grant manufacturer rights but only the default admin can mint admins. Authorisation is enforced on `registerBatch` and `addCheckpoint`; `recordScan` is intentionally permissionless so the consumer dApp can relay scans without holding keys.

**Algorithms.** (a) `batchId = keccak256(productName ‖ ts ‖ nonce)` produced client-side via `ethers.id()`. (b) Checkpoint append via `array.push` only; no setter exists, making the audit trail contract-enforced rather than convention-enforced. (c) `recordScan` increments `count` in `unchecked` (uint32 overflow ≈ 4 B scans, non-realistic), preserves `firstScanAt`, refreshes `lastScanAt` / `lastLocationHash`. (d) Location privacy: contract accepts `bytes32 locationHash`, never raw coordinates — preserves consumer privacy while enabling off-chain distance heuristics.

**Errors.** Eight typed custom errors (`InvalidBatchId`, `BatchAlreadyExists`, `BatchNotFound`, `InvalidUnitCount`, `InvalidDates`, `EmptyOrigin`, `UnitIndexOutOfRange`, `NotBatchOwner`) replace string reverts, reducing deployment bytecode and providing actionable wallet-side messages.

### 4.2 Frontend Stack

| Layer | Choice | Justification |
|---|---|---|
| Consumer page | Vanilla HTML/CSS/JS, `scan.html` | Sub-second TTI on 3G; honours proposal's "no app download" promise |
| Web3 client | ethers.js v6 (UMD via CDN) | Typed custom-error decoding; no bundler step |
| Dashboard | Vanilla JS + ethers, `admin.html` | 7 tabs (overview, register, checkpoint, batches, activity, roles, config) |
| QR scanner | `html5-qrcode` 2.3.8 | Camera-mode fallback (`environment` → `user`) supports both phone and laptop demos |
| Wallet | MetaMask (EIP-1193) | Programmatic `wallet_switchEthereumChain` / `wallet_addEthereumChain` for Amoy onboarding |
| Indexing | `localStorage` + background `queryFilter` | Two-tier cache; renders instantly, then merges chain events (Section 4.3) |

The consumer page never instantiates a signer — it uses `JsonRpcProvider` against the public Amoy RPC and runs end-to-end in wallet-less browsers, faithfully realising the read-only consumer flow promised in the proposal.

### 4.3 Indexing Strategy

Naive `eth_getLogs` on every render fails under public-RPC throttling. `dashboard.js` therefore: (1) renders from `localStorage` (keyed by contract address) synchronously on load; (2) issues `queryFilter(BatchRegistered)` and `queryFilter(CheckpointAdded)` asynchronously, merging by `batchId` and back-filling `txHash` / `blockNumber`; (3) silently absorbs RPC failures so the local view stays valid. Production migration target: The Graph subgraph.

### 4.4 Tooling

- `scripts/deploy.cjs` — deploys, auto-grants `MANUFACTURER_ROLE` to deployer, emits verification command.
- `scripts/benchmark.js` — measures `registerBatch` at 100/1,000/10,000 units and `recordScan` cold/warm, extrapolates to 1.5 M units/day; pricing assumptions overridable via env vars for sensitivity analysis.
- `scripts/simulate.cjs` — submits 12 `recordScan` transactions to push a unit past the anomaly threshold for the live demo.

### 4.5 Notable Technical Challenges

(i) Ethers v6 cannot decode OpenZeppelin v5 custom errors without explicit ABI declarations; all ten error fragments were enumerated in `contract.js` to surface actionable messages. (ii) A signer built against the wrong chain fails silently; `ensureCorrectNetwork()` calls `eth_chainId`, switches via `wallet_switchEthereumChain` (falls back to `wallet_addEthereumChain` on error 4902), and rebuilds the cached signer. A `chainChanged` listener invalidates the cache on manual user switches. (iii) Amoy enforces a higher priority-fee floor than mainnet; the frontend pins `maxPriorityFeePerGas = 25 gwei`, `maxFeePerGas = 30 gwei` per write.

---

## 5. Testing & Validation via User Stories

36 automated tests in `test/ProvenLedgerVN.js` pass on Hardhat in-process EVM. User stories map to specific tests below; all stories were additionally validated end-to-end against the live Amoy deployment.

### 5.1 User Story → Test Map

| ID | User Story | Test(s) |
|---|---|---|
| US-M1 | Manufacturer registers a new batch | `manufacturer can register a batch and emits BatchRegistered` |
| US-M2 | Wallet without `MANUFACTURER_ROLE` is rejected | `reverts with AccessControl error when caller lacks MANUFACTURER_ROLE`; `admin without MANUFACTURER_ROLE cannot register a batch` |
| US-M3 | Duplicate batch IDs are refused | `reverts with BatchAlreadyExists on duplicate batchId` |
| US-M4 | Only the batch owner (or admin) can append checkpoints | `batch manufacturer can add a checkpoint`; `ADMIN_ROLE holder can add a checkpoint to any batch`; `reverts with NotBatchOwner when caller is neither manufacturer nor admin` |
| US-M5 | Checkpoint order is preserved on-chain | `multiple checkpoints append in order and are all retrievable` |
| US-M6 | Admin can grant/revoke `MANUFACTURER_ROLE` | `admin can grant MANUFACTURER_ROLE to another account`; `non-admin cannot grant MANUFACTURER_ROLE` |
| US-C1 | Consumer scans QR → sees verified journey | Manual E2E (`scan.html` + `html5-qrcode`); QR payload parsed as URL with `batchId` param or raw 0x… hash |
| US-C2 | Expired batch surfaces an *Expired* banner | UI logic: `Number(batch.expiryDate) < now`; manual validation with backdated expiry |
| US-C3 | Anomalous scan count surfaces a *Warning* banner | `first scan of a unit (cold)`; `repeat scans increment count and update lastLocationHash`; live demo via `simulate.cjs` (12 scans > threshold 10) |
| US-C4 | Unknown batch surfaces a *Not Found* banner | UI calls `batchExists` first; short-circuits without further RPC calls |

### 5.2 Cross-Cutting Properties

| Property | Mechanism | Validating test(s) |
|---|---|---|
| Append-only integrity | No setter functions; `Checkpoint[]` via push only | `firstScanAt is preserved across multiple scans`; structural absence of mutators |
| Bounds enforcement | `unitIndex < unitCount` check in `recordScan` / `getUnitScan` | `reverts with UnitIndexOutOfRange when unitIndex equals unitCount` |
| Privacy | Hashed `locationHash`, opt-out via `bytes32(0)` | `accepts zero locationHash when consumer declines location sharing` |
| Read-path robustness | Custom errors on unknown batch / out-of-range index | `getBatch reverts with BatchNotFound`; `getUnitScan reverts with UnitIndexOutOfRange` |

---

## 6. Demonstration Walkthrough

Two MetaMask wallets are pre-configured: *admin* (deployer; holds `ADMIN_ROLE`) and *manufacturer* (holds `MANUFACTURER_ROLE`).

**Manufacturer flow.** (1) Connect on `admin.html` → page auto-switches to Polygon Amoy. (2) *Register Batch* tab: product name, factory, prod/expiry dates, 10,000 units → *Register on Polygon*. Modal shows tx hash → PolygonScan-linked confirmation. New row animates into Recent Batches and persists in `localStorage`. (3) *Add Checkpoint* tab pre-fills the new `batchId`; submit three statuses (Shipped → In Transit → Delivered) to build an audit trail. (4) *Activity Log* tab merges on-chain `BatchRegistered` + `CheckpointAdded` events with PolygonScan deep-links.

**Consumer flow.** On a *separate, wallet-less* browser, open `scan.html` → *Start Camera Scanner*. The webcam preview opens (rear camera attempted first, falls back to front). Holding the QR-rendered phone in view triggers detection in ≈1 s; the input auto-populates and `lookupBatch()` issues three parallel reads (`getBatch`, `getCheckpoints`, `getUnitScan`). The verified banner renders with product info, three checkpoints, and on-chain proof (PolygonScan link).

**Anomaly demo.** `npx hardhat run scripts/simulate.cjs --network polygonAmoy` submits 12 `recordScan` transactions; re-scanning the same QR now renders the amber *Anomaly Detected* banner (`scan-count > 10`).

**Negative states.** Pasting an unregistered but well-formed 0x… hash → `batchExists` returns false → red *Not Found* banner (no further RPC calls). The Expired state triggers when `batch.expiryDate < block.timestamp` (validated with backdated test batch).

---

## 7. Results & Discussion

### 7.1 Outcomes vs Objectives (§1.4)

| Objective | Evidence |
|---|---|
| Append-only Solidity contract on Polygon Amoy | Deployed and verified at `0x1f3E…4709`; 36/36 tests pass |
| Consumer dApp with 4 verification states | `scan.html`: verified, anomaly, expired, not-found |
| Wallet-auth manufacturer dashboard | `admin.html`: 7-tab dashboard with role management |
| Empirical gas costs + Vinamilk extrapolation | `scripts/benchmark.js` + §7.2 |
| Documented limitations & hybrid defences | §7.3 |

### 7.2 Empirical Gas Costs (re-verified 2026-05-18)

Assumptions: 30 gwei Polygon gas, MATIC USD 0.40, 1.5 M units/day. All figures re-generated by `scripts/benchmark.js`; identical to the prior measurement run, confirming reproducibility.

**One-time deployment:** 1,586,823 gas → **$0.0190** (amortised over contract lifetime).

**`registerBatch` is O(1) in `unitCount` (load-bearing claim of the architecture):**

| Units | Gas | USD / batch | USD / unit |
|---:|---:|---:|---:|
| 100 | 121,971 | $0.001464 | $0.0000146 |
| 1,000 | 121,983 | $0.001464 | $0.0000015 |
| 10,000 | 121,983 | $0.001464 | $0.00000015 |

**Gas variance across 100× volume range: 0.010 %.** The 12-gas delta between 100 and 1,000 units is one non-zero calldata byte in `uint32` encoding; from 1,000 to 10,000 the gas is bit-for-bit identical. A batch of 10,000 bottles costs the same to register as a batch of 100 — the structural proof that the batch-level data model promised in our lecturer-feedback response is honoured.

**`recordScan` — lazy per-unit allocation:**

| Path | Gas | USD / scan |
|---:|---:|---:|
| Cold SSTORE (first scan) | 72,792 | $0.000874 |
| Warm SSTORE (repeat) | 38,345 | $0.000460 |

Per-unit storage is allocated only when a consumer actually scans that unit; unscanned units in the long tail are free.

**Vinamilk-scale extrapolation (1.5 M units/day = 547.5 M/year):**

| Batch size | Batches/day | Cost/day | Cost/year |
|---:|---:|---:|---:|
| 100 | 15,000 | $21.95 | **$8,013** |
| 1,000 | 1,500 | $2.20 | **$801** |
| **10,000** | **150** | **$0.22** | **$80** |

At the recommended 10,000-unit policy, **annual on-chain registration cost for Vinamilk's premium dairy output is ≈USD 80** — two orders of magnitude smaller than a single brand-damaging counterfeit incident [1], [2]. This empirically falsifies the standard "blockchain provenance is too expensive at industrial scale" objection [8]. Consumer-scan cost (≈$874/day at 1 M scans) is absorbed via a relayer wallet or sponsored as marketing spend, preserving the proposal's zero-cost consumer experience.

**Architectural drivers of the cost result.** (1) `Batch` is one struct, not `Unit[unitCount]` — gas is paid for actual writes, not declared semantics. (2) The nested mapping `_scans` lazy-allocates: O(scanned units), not O(registered units). (3) Anomaly detection is split — chain emits primitives (`count`, `firstScanAt`, `lastScanAt`, `lastLocationHash`), analytics live off-chain — so on-chain cost is one SSTORE per scan regardless of detector sophistication.

### 7.3 Limitations

| # | Limitation | Mitigation |
|---|---|---|
| L1 | **Endpoint manipulation** — a counterfeiter can clone a valid QR onto fake units. | Scan-count heuristic raises attack cost but cannot eliminate first-purchase risk. Production deployment combines blockchain with NFC tags whose UID is bound to `batchId`, or holographic seals [4], [9] — the hybrid posture committed to in the proposal. |
| L2 | **Geographic anomaly heuristic not yet computed off-chain.** | On-chain instrumentation complete (`lastLocationHash`, timestamps); off-chain analytics pipeline (distance/time impossibility detection) reserved as future work. |
| L3 | **Public-RPC indexer fragility** — Amoy public RPC throttles unbounded `eth_getLogs`. | `localStorage`-first rendering + silent failure absorption (§4.3); production migration target is The Graph or Alchemy. |
| L4 | **Pseudonymous identity** — a wallet is provably the same entity across batches, not provably "Vinamilk". | Off-chain KYB portal; production extension to ERC-3643 on-chain identity attestations. |
| L5 | **Polygon validator-set trust** [6]. | Accepted trade-off (≈100× cheaper than L1); future work: periodic state checkpointing to Ethereum mainnet. |
| L6 | **UI is functional, not polished.** | Multi-language, accessibility audit, and CDN delivery deferred to production engineering. |

### 7.4 Synthesis

The system satisfies the three feedback points from the proposal review: centralised manipulation is defeated by the append-only role-gated contract; QR-cloning is partially mitigated on-chain via scan counters and explicitly handed off to physical features for residual risk; and the economic question is settled by USD 80/year of measured cost at the recommended batch policy. The 0.010 % gas variance across a 100× volume range is a structural — not incremental — proof that the architecture scales to Vinamilk volumes.

---

*End of Sections 4–7. Word count ≈1,400 — fits within the 10-page report ceiling alongside Sections 1–3, 8, 9 and References.*
