// Anomaly Detection Demo — Simulation Script
//
// Calls recordScan() 12 times on a single unit to push its scan count past the
// frontend anomaly threshold (> 10), triggering the amber warning banner in scan.html.
//
// Usage:
//   1. Register a batch in admin.html and copy the full 0x… Batch ID.
//   2. Paste it into BATCH_ID below.
//   3. Run: npx hardhat run scripts/simulate.cjs --network polygonAmoy

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

// ─── PASTE YOUR BATCH ID HERE ────────────────────────────────────────────────
const BATCH_ID = "0x075f8ba9ba62fb6b9f8e6ddf7a52c29b86be49590c28cc44ad50221fd0331e6c";
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const UNIT_INDEX = 0;   // unit #0 is the representative unit tracked by scan.html
const SCAN_COUNT = 12;  // must exceed ANOMALY_THRESHOLD (10) set in scan.html

const ABI = [
  "function recordScan(bytes32 batchId, uint32 unitIndex, bytes32 locationHash) external",
];

async function main() {
  // ── Pre-flight checks ──────────────────────────────────────────────────────
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "CONTRACT_ADDRESS is not set. Add it to your .env file:\n  CONTRACT_ADDRESS=0x…"
    );
  }
  if (BATCH_ID === "PASTE_YOUR_BATCH_ID_HERE") {
    throw new Error(
      "You must paste a real Batch ID into the BATCH_ID constant at the top of this script."
    );
  }
  if (!BATCH_ID.startsWith("0x") || BATCH_ID.length !== 66) {
    throw new Error(
      `Invalid Batch ID format. Expected a 66-character hex string (0x + 64 hex chars), got: "${BATCH_ID}"`
    );
  }

  const [signer] = await ethers.getSigners();
  const network = hre.network.name;

  console.log("\n════════════════════════════════════════════════════");
  console.log("  ProvenLedgerVN — Anomaly Detection Simulation");
  console.log("════════════════════════════════════════════════════");
  console.log(`  Network:   ${network}`);
  console.log(`  Signer:    ${signer.address}`);
  console.log(`  Contract:  ${CONTRACT_ADDRESS}`);
  console.log(`  Batch ID:  ${BATCH_ID.slice(0, 10)}…${BATCH_ID.slice(-6)}`);
  console.log(`  Unit:      #${UNIT_INDEX}`);
  console.log(`  Scans:     ${SCAN_COUNT} (threshold is > 10)`);
  console.log("════════════════════════════════════════════════════\n");

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  console.log(`🚀 Starting anomaly simulation for Batch ${BATCH_ID.slice(0, 10)}…\n`);

  for (let i = 1; i <= SCAN_COUNT; i++) {
    process.stdout.write(`   Submitting scan ${i}/${SCAN_COUNT}… `);
    const tx = await contract.recordScan(BATCH_ID, UNIT_INDEX, ethers.ZeroHash, {
      maxPriorityFeePerGas: ethers.parseUnits("25", "gwei"),
      maxFeePerGas:         ethers.parseUnits("30", "gwei"),
    });
    const receipt = await tx.wait();
    console.log(`✅  Scan ${i}/${SCAN_COUNT} confirmed  (gas: ${receipt.gasUsed.toString()})`);
  }

  console.log(`\n🏁 All ${SCAN_COUNT} scans recorded on-chain.`);
  console.log("────────────────────────────────────────────────────");
  console.log("  Next step: open scan.html in your browser and");
  console.log(`  look up Batch ID:`);
  console.log(`  ${BATCH_ID}`);
  console.log("  → You should see the ⚠ Anomaly Detected banner.");
  console.log("════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ Simulation failed:", err.message || err);
  process.exit(1);
});
