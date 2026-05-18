# ProvenLedgerVN

Polygon-based supply chain authentication system for FMCG products (modeled on Vinamilk).
Consumers scan a QR code to verify product authenticity. The smart contract tracks batch
registrations and per-unit scan counts to detect counterfeit QR codes.

---

## Prerequisites

- Node.js >= 18
- npm >= 9
- MetaMask browser extension (for Dashboard access)

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

---

## Deploy

```bash
# Local Hardhat node (start node first — see above)
npx hardhat run scripts/deploy.cjs --network localhost

# Polygon Amoy testnet (requires .env)
npx hardhat run scripts/deploy.cjs --network polygonAmoy
```

Copy `.env.example` to `.env` and fill in your keys before deploying to a live network.

The deploy script automatically grants `MANUFACTURER_ROLE` to the deployer address for convenience during development.

---

## DApp Frontend

The browser UI lives in `public/` and is split into three pages:

- `public/index.html` — landing page (project overview)
- `public/scan.html` — consumer Scan & Verify (read-only, no wallet required)
- `public/admin.html` — Dashboard for Manufacturers and Admins (role-gated)

Shared assets:

- `public/assets/css/styles.css` — global stylesheet
- `public/assets/js/config.js` — frontend configuration (contract address, network, RPC)
- `public/assets/js/contract.js` — ABI + ethers v6 wallet helpers (includes `getRoleLabel`)
- `public/assets/js/dashboard.js` — on-chain event fetching and dashboard data rendering

### Role-Based Access

The Dashboard enforces role-based access on page load:

| Role | Access |
|---|---|
| **Admin** | Full dashboard — register batches, add checkpoints, grant/revoke roles |
| **Manufacturer** | Full dashboard — register batches, add checkpoints for own batches |
| **Consumer** | Redirected to `scan.html` — read-only verification only |

Roles are determined on-chain via OpenZeppelin `AccessControl`. Identity is the connected
MetaMask wallet address — no login or account registration required.

### Setup Steps

1. Deploy the contract:

   ```bash
   # Local
   npx hardhat node
   npx hardhat run scripts/deploy.cjs --network localhost

   # Polygon Amoy testnet
   npx hardhat run scripts/deploy.cjs --network polygonAmoy
   ```

2. Paste the deployed address into `public/assets/js/config.js`
   (`CONTRACT_ADDRESS` field). Adjust `EXPECTED_CHAIN_ID` and `PUBLIC_RPC` if
   targeting a different network.

3. Open `public/index.html` directly in your browser (no server needed),
   or serve the `public/` folder with any static host.

4. Use the dApp:
   - **Scan & Verify** — paste a Batch ID or scan a QR code to read the on-chain
     record. Read-only, no wallet required.
   - **Dashboard** — connect a MetaMask wallet with `MANUFACTURER_ROLE` or
     `ADMIN_ROLE` to register batches, add checkpoints, and manage roles.

### QR Code Format

The scanner accepts two formats:

```
Raw Batch ID:   0x83196d4d75cc7d8d896a3713f6ae822ceba101978798867d501ce115c2c88267
URL parameter:  https://yourdomain.com/scan.html?batchId=0x83196d4d...
```

To test: register a batch in the Dashboard, copy the Batch ID, generate a QR code from
it using any online QR generator, then scan it with `scan.html`.

---

## Project Structure

```
contracts/
  ProvenLedgerVN.sol       — main smart contract (AccessControl, batch + checkpoint + scan)
scripts/
  deploy.cjs               — deployment + role setup script
  benchmark.js             — gas benchmark script
  simulate.cjs             — anomaly detection simulation (pushes scan count above threshold)
test/
  ProvenLedgerVN.js        — Hardhat/Chai unit tests
public/
  index.html               — landing page
  scan.html                — consumer Scan & Verify (read-only)
  admin.html               — manufacturer/admin Dashboard (role-gated)
  assets/
    css/styles.css         — global stylesheet
    js/config.js           — contract address + network config
    js/contract.js         — ABI + ethers v6 wallet helpers
    js/dashboard.js        — dashboard data loader (localStorage + on-chain events)
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
