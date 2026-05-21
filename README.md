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

## Run Full Local Demo

Use this flow when you want to run the whole dApp locally with a local Hardhat blockchain,
MetaMask, and the static frontend.

> **Security / network note:** The checked-in `public/assets/js/config.js` points to the
> team's Polygon Amoy demo contract. A contract address is public and is not a secret, but it
> controls which deployed contract the frontend reads from and writes to. If you are running
> locally or deploying your own instance, replace `CONTRACT_ADDRESS`, `EXPECTED_CHAIN_ID`, and
> `PUBLIC_RPC` with your own values before using the dApp. Never put private keys in `config.js`;
> private keys belong only in `.env`, which is ignored by git.

### 1. Start a Local Hardhat Node

Open terminal 1 and keep it running:

```bash
npx hardhat node
```

Hardhat will print a list of local test accounts. These accounts are public development keys
only — never use them on a live network.

### 2. Deploy the Contract Locally

Open terminal 2:

```bash
npx hardhat run scripts/deploy.cjs --network localhost
```

Copy the printed `CONTRACT_ADDRESS`. On a fresh Hardhat node this is usually:

```text
0x5FbDB2315678afecb367f032d93F642f64180aa3
```

### 3. Configure the Frontend for Localhost

Edit `public/assets/js/config.js` so it points to the local deployment:

```js
window.PROVENLEDGER_CONFIG = {
  CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  EXPECTED_CHAIN_ID: 31337n,
  EXPECTED_NETWORK_NAME: "Hardhat Localhost",
  EXPLORER_BASE: "",
  PUBLIC_RPC: "http://127.0.0.1:8545",
};
```

To switch back to Polygon Amoy, restore the Amoy contract address, chain ID `80002n`, Amoy
RPC URL, and PolygonScan explorer URL.

### 4. Add Hardhat Localhost to MetaMask

Add a custom network in MetaMask:

| Field | Value |
|---|---|
| Network name | Hardhat Localhost |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

Import the first Hardhat account into MetaMask if you want the same wallet that deployed the
contract. The deploy script grants this wallet both admin access and manufacturer access:

```text
Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

### 5. Serve the Frontend

Opening the HTML files directly works for read-only pages, but serving the `public/` folder
through localhost is more reliable for MetaMask and camera-based QR scanning:

```bash
python3 -m http.server 8080 -d public
```

Then open:

```text
http://127.0.0.1:8080
```

### 6. Try the Local Workflow

1. Open `http://127.0.0.1:8080/admin.html`.
2. Connect MetaMask using the imported Hardhat account.
3. Register a batch and copy the generated Batch ID.
4. Add one or more checkpoints for that Batch ID.
5. Open `http://127.0.0.1:8080/scan.html`.
6. Paste the Batch ID and verify the on-chain record.

If the dashboard cannot connect, confirm that `npx hardhat node` is still running, MetaMask is
on Chain ID `31337`, and `public/assets/js/config.js` contains the local contract address.

---

## DApp Frontend

The browser UI lives in `public/` and is split into three pages:

- `public/index.html` — landing page (project overview)
- `public/scan.html` — consumer Scan & Verify (read-only by default; optional relayer recording)
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
| **Consumer** | Redirected to `scan.html` — read-only verification; optional relayer records scans without wallet prompts |

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

3. Open `public/index.html` directly in your browser for a quick read-only preview,
   or serve the `public/` folder through localhost for the full MetaMask and QR scanner flow:

   ```bash
   python3 -m http.server 8080 -d public
   ```

4. Use the dApp:
   - **Scan & Verify** — paste a Batch ID or scan a QR code to read the on-chain
     record. Read-only unless the optional relayer is enabled.
   - **Dashboard** — connect a MetaMask wallet with `MANUFACTURER_ROLE` or
     `ADMIN_ROLE` to register batches, add checkpoints, and manage roles.

### Optional Gasless Scan Relayer

Consumer verification is intentionally read-only by default. If you want each scan to increase
the on-chain scan counter without asking consumers to sign MetaMask transactions, run the demo
relayer. The relayer holds a funded backend wallet and submits `recordScan()` on behalf of the
browser.

1. Configure `.env`:

   ```bash
   CONTRACT_ADDRESS=0x...
   RELAYER_PRIVATE_KEY=0x...        # funded throwaway wallet, never committed
   RELAYER_RPC_URL=http://127.0.0.1:8545
   RELAYER_PORT=8080
   ```

   For Polygon Amoy, use an Amoy RPC URL and fund the relayer wallet with testnet POL.

2. In `public/assets/js/config.js`, set:

   ```js
   RELAYER_URL: "/api",
   ```

3. Start the relayer server:

   ```bash
   npm run serve:relayer
   ```

4. Open `http://127.0.0.1:8080/scan.html` and scan/verify a Batch ID. The page still
   verifies read-only first, then automatically asks the relayer to record the scan in the background.
   Dashboard `On-Chain Scans` increases only after the relayer transaction is mined.

Do not use VSCode Live Server for relayer testing. Live Server only serves static files, so
`/api/record-scan` will not exist. Use `npm run serve:relayer` and open the dApp from the same
origin, for example `http://127.0.0.1:8080/admin.html`. Dashboard cache is stored in browser
`localStorage` per origin and contract address, so data shown on port `5500` will not automatically
appear on port `8080` unless imported or fetched again from the configured contract.

For production, add authentication, stronger rate limiting, monitoring, and key management
before exposing a relayer publicly.

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
  simulate.cjs             — anomaly detection simulation (pushes scan count above threshold) (npx hardhat run scripts/simulate.cjs --network polygonAmoy)
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
