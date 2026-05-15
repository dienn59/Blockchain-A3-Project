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

## Test UI

A minimal browser interface in `frontend-test/` lets you interact with a deployed contract
without writing any additional code.

### Steps

1. Start a local Hardhat node and deploy the contract:

   ```bash
   npx hardhat node
   # in another terminal:
   npx hardhat run scripts/deploy.js --network localhost
   # note the contract address printed in the output
   ```

2. Add the Hardhat localhost network to MetaMask:
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency: ETH

3. Import a Hardhat test account into MetaMask using one of the private keys printed
   by `npx hardhat node` (Account #0 is the admin; grant yourself MANUFACTURER\_ROLE
   from the deploy script or Hardhat console).

4. Open `frontend-test/index.html` directly in your browser (no server needed):
   - On Windows: drag the file into Chrome/Edge, or use `File > Open`.

5. In the UI:
   - Click **Connect MetaMask** and approve the connection.
   - Paste the deployed contract address and click **Load Contract**.
   - Use **Register Batch** to create a batch (Batch ID auto-generates if left blank).
   - Use **Record Scan** to simulate a consumer scan.
   - Use **Query Scan Count** to read the on-chain scan count for any unit.

---

## Project Structure

```
contracts/
  ProvenLedgerVN.sol   — main smart contract
scripts/
  deploy.js            — deployment script
  benchmark.js         — gas benchmark script
test/
  ProvenLedgerVN.js    — Hardhat/Chai unit tests
frontend-test/
  index.html           — minimal test UI
  app.js               — ethers.js v6 frontend logic
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
