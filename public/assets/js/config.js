// ProvenLedgerVN — Frontend configuration.
// After running `npx hardhat run scripts/deploy.js --network polygonAmoy`,
// paste the deployed contract address into CONTRACT_ADDRESS below.
window.PROVENLEDGER_CONFIG = {
  CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
  EXPECTED_CHAIN_ID: 80002n, // Polygon Amoy testnet
  EXPECTED_NETWORK_NAME: "Polygon Amoy",
  EXPLORER_BASE: "https://amoy.polygonscan.com",
  PUBLIC_RPC: "https://rpc-amoy.polygon.technology",
};
