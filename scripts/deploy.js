// Deployment script for ProvenLedgerVN.
//
// Usage:
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/deploy.js --network polygonAmoy
//   npx hardhat run scripts/deploy.js --network polygon
//
// After deploy, copy the printed contract address into frontend-test/index.html
// or set CONTRACT_ADDRESS in your .env for other scripts.

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  console.log("=== ProvenLedgerVN Deployment ===");
  console.log(`Network:   ${network}`);
  console.log(`Deployer:  ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH/MATIC\n`);

  if (balance === 0n) {
    throw new Error("Deployer has zero balance — fund the account before deploying.");
  }

  // Deploy: deployer becomes admin
  const Factory = await ethers.getContractFactory("ProvenLedgerVN");
  console.log("Deploying contract...");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log(`\nContract deployed at: ${address}`);
  console.log(`Transaction hash:     ${receipt.hash}`);
  console.log(`Gas used:             ${receipt.gasUsed.toString()}`);

  // Grant MANUFACTURER_ROLE to deployer so they can register batches immediately.
  // On a real deployment you would grant this to your manufacturer wallets instead.
  const MANUFACTURER_ROLE = await contract.MANUFACTURER_ROLE();
  const grantTx = await contract.grantRole(MANUFACTURER_ROLE, deployer.address);
  await grantTx.wait();
  console.log(`\nMANUFACTURER_ROLE granted to deployer (${deployer.address})`);

  // Print copy-paste ready summary
  console.log("\n=== Copy these values into your .env or test UI ===");
  console.log(`CONTRACT_ADDRESS=${address}`);
  console.log(`MANUFACTURER_ROLE=${MANUFACTURER_ROLE}`);
  console.log(`ADMIN_ADDRESS=${deployer.address}`);

  // Verify hint for testnets
  if (network !== "hardhat" && network !== "localhost") {
    console.log(`\nTo verify on Polygonscan:`);
    console.log(`  npx hardhat verify --network ${network} ${address} "${deployer.address}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
