// Gas benchmark for ProvenLedgerVN.
// Measures registerBatch at 100/1,000/10,000 units and recordScan (cold +
// warm SSTORE), then extrapolates Polygon mainnet costs at Vinamilk-scale
// daily output.
//
// Run: npx hardhat run scripts/benchmark.js
//
// Override pricing assumptions via env vars:
//   GAS_PRICE_GWEI=30 MATIC_USD=0.40 npx hardhat run scripts/benchmark.js

const hre = require("hardhat");
const { ethers } = hre;

const REGISTER_VOLUMES = [100, 1_000, 10_000];

const GAS_PRICE_GWEI = Number(process.env.GAS_PRICE_GWEI || 30);
const MATIC_USD = Number(process.env.MATIC_USD || 0.4);

const VINAMILK_DAILY_UNITS = 1_500_000;

function costUsd(gasUsed) {
  const gas = typeof gasUsed === "bigint" ? gasUsed : BigInt(gasUsed);
  const weiPerGas = BigInt(Math.round(GAS_PRICE_GWEI * 1e9));
  const totalWei = gas * weiPerGas;
  const matic = Number(totalWei) / 1e18;
  return matic * MATIC_USD;
}

function fmtUsd(n) {
  if (n >= 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(6);
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

async function main() {
  const [admin, manufacturer, scanner] = await ethers.getSigners();

  console.log("\n=== ProvenLedgerVN Gas Benchmark ===");
  console.log(`Network: ${hre.network.name}`);
  console.log(`Assumptions: gas price = ${GAS_PRICE_GWEI} gwei, MATIC = $${MATIC_USD}\n`);

  const Factory = await ethers.getContractFactory("ProvenLedgerVN");
  const contract = await Factory.deploy(admin.address);
  await contract.waitForDeployment();
  const deployReceipt = await contract.deploymentTransaction().wait();
  const deployGas = deployReceipt.gasUsed;
  console.log(`Deployed at: ${await contract.getAddress()}`);
  console.log(`Deployment gas: ${deployGas.toString()} (${fmtUsd(costUsd(deployGas))} on Polygon)\n`);

  const MANUFACTURER_ROLE = await contract.MANUFACTURER_ROLE();
  await (await contract.grantRole(MANUFACTURER_ROLE, manufacturer.address)).wait();

  const asMfg = contract.connect(manufacturer);
  const nowSec = Math.floor(Date.now() / 1000);

  const registerResults = [];
  for (const unitCount of REGISTER_VOLUMES) {
    const batchId = ethers.id(`VNM-LOT-${unitCount}-${nowSec}`);
    const tx = await asMfg.registerBatch(
      batchId,
      "Vinamilk Factory - Binh Duong",
      nowSec,
      nowSec + 180 * 24 * 3600,
      unitCount,
      "ipfs://placeholder-metadata-cid"
    );
    const receipt = await tx.wait();
    registerResults.push({
      unitCount,
      gasUsed: receipt.gasUsed,
      batchId,
    });
  }

  const scanBatchId = registerResults[0].batchId;
  const locHashHCM = ethers.keccak256(ethers.toUtf8Bytes("10.7769,106.7009"));
  const locHashHanoi = ethers.keccak256(ethers.toUtf8Bytes("21.0285,105.8542"));

  const scanCold = await (await contract.connect(scanner).recordScan(scanBatchId, 0, locHashHCM)).wait();
  const scanWarm = await (await contract.connect(scanner).recordScan(scanBatchId, 0, locHashHanoi)).wait();

  console.log("--- registerBatch gas vs. unitCount ---");
  console.log(pad("Units", 10) + pad("gasUsed", 12) + pad("USD / batch", 16) + "USD / unit");
  console.log("-".repeat(60));
  for (const r of registerResults) {
    const c = costUsd(r.gasUsed);
    console.log(
      pad(r.unitCount.toLocaleString(), 10) +
      pad(r.gasUsed.toString(), 12) +
      pad(fmtUsd(c), 16) +
      fmtUsd(c / r.unitCount)
    );
  }

  console.log("\n--- recordScan gas ---");
  console.log(pad("Scenario", 28) + pad("gasUsed", 12) + "USD / scan");
  console.log("-".repeat(60));
  console.log(
    pad("First scan of a unit (cold)", 28) +
    pad(scanCold.gasUsed.toString(), 12) +
    fmtUsd(costUsd(scanCold.gasUsed))
  );
  console.log(
    pad("Repeat scan (warm slot)", 28) +
    pad(scanWarm.gasUsed.toString(), 12) +
    fmtUsd(costUsd(scanWarm.gasUsed))
  );

  console.log(`\n--- Vinamilk-scale extrapolation (${VINAMILK_DAILY_UNITS.toLocaleString()} units/day) ---`);
  console.log(pad("Batch size", 12) + pad("Batches/day", 14) + pad("Cost/day", 14) + "Cost/year");
  console.log("-".repeat(60));
  for (const r of registerResults) {
    const batchesPerDay = Math.ceil(VINAMILK_DAILY_UNITS / r.unitCount);
    const dailyCost = batchesPerDay * costUsd(r.gasUsed);
    const annualCost = dailyCost * 365;
    console.log(
      pad(r.unitCount.toLocaleString(), 12) +
      pad(batchesPerDay.toLocaleString(), 14) +
      pad(fmtUsd(dailyCost), 14) +
      fmtUsd(annualCost)
    );
  }

  const baseGas = Number(registerResults[0].gasUsed);
  const maxGas = Number(registerResults[registerResults.length - 1].gasUsed);
  const variancePct = ((maxGas - baseGas) / baseGas) * 100;
  console.log(`\nGas variance across 100 -> 10,000 units: ${variancePct.toFixed(3)} %`);
  console.log("(Variance is zero or near-zero -> registerBatch cost is O(1) in unitCount.)");

  const summary = {
    network: hre.network.name,
    assumptions: { gasPriceGwei: GAS_PRICE_GWEI, maticUsd: MATIC_USD, vinamilkDailyUnits: VINAMILK_DAILY_UNITS },
    deployment: { gasUsed: deployGas.toString(), costUsd: costUsd(deployGas) },
    registerBatch: registerResults.map((r) => ({
      unitCount: r.unitCount,
      gasUsed: r.gasUsed.toString(),
      costUsdPerBatch: costUsd(r.gasUsed),
      costUsdPerUnit: costUsd(r.gasUsed) / r.unitCount,
    })),
    recordScan: {
      cold: { gasUsed: scanCold.gasUsed.toString(), costUsd: costUsd(scanCold.gasUsed) },
      warm: { gasUsed: scanWarm.gasUsed.toString(), costUsd: costUsd(scanWarm.gasUsed) },
    },
    gasVariancePctRegisterBatch: variancePct,
  };
  console.log("\n--- JSON summary ---");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
