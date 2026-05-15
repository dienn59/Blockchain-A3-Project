// ProvenLedgerVN — shared ABI + wallet helpers.
// Depends on ethers v6 (UMD bundle loaded before this script) and config.js.

window.PROVENLEDGER_ABI = [
  "function registerBatch(bytes32 batchId, string origin, uint64 productionDate, uint64 expiryDate, uint32 unitCount, string metadataURI) external",
  "function addCheckpoint(bytes32 batchId, string location, string status) external",
  "function recordScan(bytes32 batchId, uint32 unitIndex, bytes32 locationHash) external",
  "function getBatch(bytes32 batchId) external view returns (tuple(address manufacturer, uint64 productionDate, uint64 expiryDate, uint32 unitCount, bool exists, string origin, string metadataURI))",
  "function batchExists(bytes32 batchId) external view returns (bool)",
  "function getCheckpointCount(bytes32 batchId) external view returns (uint256)",
  "function getCheckpoint(bytes32 batchId, uint256 index) external view returns (tuple(address actor, uint64 timestamp, string location, string status))",
  "function getCheckpoints(bytes32 batchId) external view returns (tuple(address actor, uint64 timestamp, string location, string status)[])",
  "function getUnitScan(bytes32 batchId, uint32 unitIndex) external view returns (tuple(uint32 count, uint64 firstScanAt, uint64 lastScanAt, bytes32 lastLocationHash))",
  "function MANUFACTURER_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

window.PROVENLEDGER = {
  provider: null,
  signer: null,
  address: null,

  _cfg() {
    const cfg = window.PROVENLEDGER_CONFIG;
    if (!cfg) throw new Error("config.js not loaded");
    const placeholder = "0x0000000000000000000000000000000000000000";
    if (!ethers.isAddress(cfg.CONTRACT_ADDRESS) || cfg.CONTRACT_ADDRESS === placeholder) {
      throw new Error("CONTRACT_ADDRESS chưa được cấu hình trong public/assets/js/config.js");
    }
    return cfg;
  },

  async connectWallet() {
    if (!window.ethereum) {
      throw new Error("Không phát hiện MetaMask. Vui lòng cài đặt MetaMask.");
    }
    this.provider = new ethers.BrowserProvider(window.ethereum);
    await this.provider.send("eth_requestAccounts", []);
    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();
    return this.address;
  },

  getReadContract() {
    const cfg = this._cfg();
    const readProvider = window.ethereum
      ? new ethers.BrowserProvider(window.ethereum)
      : new ethers.JsonRpcProvider(cfg.PUBLIC_RPC);
    return new ethers.Contract(cfg.CONTRACT_ADDRESS, window.PROVENLEDGER_ABI, readProvider);
  },

  getWriteContract() {
    if (!this.signer) throw new Error("Vui lòng kết nối ví trước.");
    const cfg = this._cfg();
    return new ethers.Contract(cfg.CONTRACT_ADDRESS, window.PROVENLEDGER_ABI, this.signer);
  },

  shortAddr(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  },

  shortHash(hash) {
    if (!hash) return "";
    return hash.slice(0, 6) + "…" + hash.slice(-4);
  },

  // Auto-generate a 32-byte batchId from product name + timestamp.
  makeBatchId(productName) {
    const seed = (productName || "BATCH").trim() + "|" + Date.now() + "|" + Math.random();
    return ethers.id(seed);
  },

  // Pack location name + lat/lng into the single string accepted by the contract.
  packLocation(name, lat, lng) {
    name = (name || "").trim();
    lat = (lat || "").toString().trim();
    lng = (lng || "").toString().trim();
    if (lat && lng) return `${name} (${lat},${lng})`;
    return name;
  },
};
