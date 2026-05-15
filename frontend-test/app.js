const ABI = [
  "function registerBatch(bytes32 batchId, string calldata origin, uint64 productionDate, uint64 expiryDate, uint32 unitCount, string calldata metadataURI) external",
  "function recordScan(bytes32 batchId, uint32 unitIndex, bytes32 locationHash) external",
  "function getUnitScan(bytes32 batchId, uint32 unitIndex) external view returns (tuple(uint32 count, uint64 firstScanAt, uint64 lastScanAt, bytes32 lastLocationHash))",
  "function getBatch(bytes32 batchId) external view returns (tuple(address manufacturer, uint64 productionDate, uint64 expiryDate, uint32 unitCount, bool exists, string origin, string metadataURI))",
  "function batchExists(bytes32 batchId) external view returns (bool)",
  "function MANUFACTURER_ROLE() external view returns (bytes32)",
];

let provider, signer, contract;

function show(id, html, cls) {
  const el = document.getElementById(id);
  el.style.display = "block";
  el.className = "result" + (cls ? " " + cls : "");
  el.innerHTML = html;
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

document.getElementById("connectBtn").addEventListener("click", async () => {
  if (!window.ethereum) {
    show("walletInfo", "MetaMask not found. Install it and connect to the Hardhat localhost network.", "error");
    return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    const addr = await signer.getAddress();
    const network = await provider.getNetwork();
    show("walletInfo", `Connected: ${addr}\nChain ID: ${network.chainId}`, "ok");
  } catch (e) {
    show("walletInfo", "Error: " + e.message, "error");
  }
});

document.getElementById("loadBtn").addEventListener("click", async () => {
  if (!signer) {
    show("contractStatus", "Connect wallet first.", "error");
    return;
  }
  const addr = val("contractAddr");
  if (!addr) {
    show("contractStatus", "Enter a contract address.", "error");
    return;
  }
  try {
    contract = new ethers.Contract(addr, ABI, signer);
    const mfrRole = await contract.MANUFACTURER_ROLE();
    show("contractStatus", `Contract loaded at ${addr}\nMANUFACTURER_ROLE: ${mfrRole}`, "ok");
  } catch (e) {
    show("contractStatus", "Error loading contract: " + e.message, "error");
  }
});

document.getElementById("registerBtn").addEventListener("click", async () => {
  if (!contract) { show("registerResult", "Load contract first.", "error"); return; }

  let batchId = val("regBatchId");
  if (!batchId) {
    batchId = ethers.id("VNM-LOT-" + Date.now());
  }

  const origin = val("regOrigin");
  const prodDate = val("regProdDate") ? parseInt(val("regProdDate")) : nowTs();
  const expiry = val("regExpiry") ? parseInt(val("regExpiry")) : prodDate + 180 * 24 * 3600;
  const unitCount = parseInt(val("regUnitCount")) || 1000;
  const metaURI = val("regMetaURI");

  show("registerResult", "Sending transaction...");
  try {
    const tx = await contract.registerBatch(batchId, origin, prodDate, expiry, unitCount, metaURI);
    show("registerResult", `Tx sent: ${tx.hash}\nWaiting for confirmation...`);
    const receipt = await tx.wait();
    show(
      "registerResult",
      `Batch registered!\nBatch ID: ${batchId}\nTx: ${receipt.hash}\nGas used: ${receipt.gasUsed}`,
      "ok"
    );
    // Pre-fill batch ID in scan forms
    document.getElementById("scanBatchId").value = batchId;
    document.getElementById("queryScanBatchId").value = batchId;
  } catch (e) {
    show("registerResult", "Error: " + (e.reason || e.message), "error");
  }
});

document.getElementById("scanBtn").addEventListener("click", async () => {
  if (!contract) { show("scanResult", "Load contract first.", "error"); return; }

  const batchId = val("scanBatchId");
  const unitIndex = parseInt(val("scanUnitIndex")) || 0;
  const locationText = val("scanLocation");
  const locationHash = locationText
    ? ethers.keccak256(ethers.toUtf8Bytes(locationText))
    : ethers.ZeroHash;

  show("scanResult", "Sending transaction...");
  try {
    const tx = await contract.recordScan(batchId, unitIndex, locationHash);
    show("scanResult", `Tx sent: ${tx.hash}\nWaiting...`);
    const receipt = await tx.wait();
    show(
      "scanResult",
      `Scan recorded!\nBatch: ${batchId}  Unit: ${unitIndex}\nLocation hash: ${locationHash}\nGas used: ${receipt.gasUsed}`,
      "ok"
    );
  } catch (e) {
    show("scanResult", "Error: " + (e.reason || e.message), "error");
  }
});

document.getElementById("queryBtn").addEventListener("click", async () => {
  if (!contract) { show("queryResult", "Load contract first.", "error"); return; }

  const batchId = val("queryScanBatchId");
  const unitIndex = parseInt(val("queryScanIndex")) || 0;

  try {
    const scan = await contract.getUnitScan(batchId, unitIndex);
    const first = scan.firstScanAt > 0n
      ? new Date(Number(scan.firstScanAt) * 1000).toISOString()
      : "never";
    const last = scan.lastScanAt > 0n
      ? new Date(Number(scan.lastScanAt) * 1000).toISOString()
      : "never";
    show(
      "queryResult",
      `Unit ${unitIndex} scan info:\n  count:           ${scan.count}\n  firstScanAt:     ${first}\n  lastScanAt:      ${last}\n  lastLocationHash: ${scan.lastLocationHash}`,
      "ok"
    );
  } catch (e) {
    show("queryResult", "Error: " + (e.reason || e.message), "error");
  }
});
