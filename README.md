# ProvenLedgerVN

Polygon-based supply chain authentication system for FMCG products (modeled on Vinamilk).
Consumers scan a QR code to verify product authenticity. The smart contract tracks batch
registrations and per-unit scan counts to detect counterfeit QR codes.

---

## Prerequisites

- Node.js >= 18
- npm >= 9
- MetaMask browser extension (for the test UI)

---

## Install

```bash
npm install
```

---

## Compile

```bash
npx hardhat compile
```

---

## Run Tests

```bash
# All tests
npx hardhat test

# Single test file
npx hardhat test test/ProvenLedgerVN.js
```

The test suite covers:
- Role management (ADMIN\_ROLE, MANUFACTURER\_ROLE)
- `registerBatch` — happy path, access control, duplicate batch, invalid inputs
- `addCheckpoint` — manufacturer and admin access, unauthorised access, append ordering
- `recordScan` — cold/warm scan counts, out-of-range index, permissionless access
- View functions (`getBatch`, `getUnitScan`, `batchExists`)

---

## Run Gas Benchmark

```bash
# Start a local node in one terminal
npx hardhat node

# Run the benchmark in another terminal
npx hardhat run scripts/benchmark.js --network localhost
```

The script measures `registerBatch` gas at 100 / 1,000 / 10,000 units, measures
`recordScan` (cold and warm slot), and extrapolates to Vinamilk-scale (1.5 M units/day).
Results are printed as formatted tables. Override assumptions with env vars:

```bash
GAS_PRICE_GWEI=30 MATIC_USD=0.40 npx hardhat run scripts/benchmark.js --network localhost
```

Saved benchmark output lives in `BENCHMARK_REPORT.md`.

---

## Deploy

```bash
# Local Hardhat node (start node first — see above)
npx hardhat run scripts/deploy.js --network localhost

# Polygon Amoy testnet (requires .env)
npx hardhat run scripts/deploy.js --network polygonAmoy
```

Copy `.env.example` to `.env` and fill in your keys before deploying to a live network.

---

## DApp Frontend

The browser UI lives in `public/` and is split into three pages:

- `public/index.html` — landing page (project overview)
- `public/scan.html` — consumer Scan & Verify (read-only, no wallet required)
- `public/admin.html` — manufacturer Dashboard (Register Batch, Add Checkpoint)

Shared assets:

- `public/assets/css/styles.css` — global stylesheet
- `public/assets/js/config.js` — frontend configuration (contract address, network, RPC)
- `public/assets/js/contract.js` — ABI + ethers v6 wallet helpers

### Steps

1. Deploy the contract (Polygon Amoy or local Hardhat node):

   ```bash
   # Local
   npx hardhat node
   npx hardhat run scripts/deploy.js --network localhost

   # Polygon Amoy testnet
   npx hardhat run scripts/deploy.js --network polygonAmoy
   ```

2. Paste the deployed address into `public/assets/js/config.js`
   (`CONTRACT_ADDRESS` field). Adjust `EXPECTED_CHAIN_ID` and `PUBLIC_RPC` if
   targeting a different network.

3. Open `public/index.html` directly in your browser (no server needed),
   or serve the `public/` folder with any static host.

4. Use the dApp:
   - **Scan & Verify** — paste a Batch ID (or scan its QR code) to read the
     on-chain record. Read-only, no wallet required.
   - **Dashboard** — click **Connect Wallet** (MetaMask), then **Register
     Batch** or **Add Checkpoint** to write to the contract.

> Manufacturer actions require the wallet to hold `MANUFACTURER_ROLE`.
> Grant it from the deploy script or Hardhat console before testing writes.

---

## Project Structure

```
contracts/
  ProvenLedgerVN.sol     — main smart contract
scripts/
  deploy.js              — deployment script
  benchmark.js           — gas benchmark script
test/
  ProvenLedgerVN.js      — Hardhat/Chai unit tests
public/
  index.html             — landing page
  scan.html              — consumer Scan & Verify (read-only)
  admin.html             — manufacturer Dashboard
  assets/
    css/styles.css       — global stylesheet
    js/config.js         — contract address + network config
    js/contract.js       — ABI + ethers v6 wallet helpers
hardhat.config.js
.env.example
```

---

## Network Config

Target deployment is Polygon (Mainnet or Amoy testnet). Store credentials in `.env`:

```
PRIVATE_KEY=0x...
POLYGON_RPC_URL=https://...
POLYGON_AMOY_RPC_URL=https://...
POLYGONSCAN_API_KEY=...
```

Never commit `.env` to the repository.
