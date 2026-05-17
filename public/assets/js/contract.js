// ProvenLedgerVN — shared ABI + wallet helpers.
// Depends on ethers v6 (UMD bundle loaded before this script) and config.js.

window.PROVENLEDGER_ABI = [
  // ── Write functions ────────────────────────────────────────────────────────
  "function registerBatch(bytes32 batchId, string origin, uint64 productionDate, uint64 expiryDate, uint32 unitCount, string metadataURI) external",
  "function addCheckpoint(bytes32 batchId, string location, string status) external",
  "function recordScan(bytes32 batchId, uint32 unitIndex, bytes32 locationHash) external",
  // ── Read functions ─────────────────────────────────────────────────────────
  "function getBatch(bytes32 batchId) external view returns (tuple(address manufacturer, uint64 productionDate, uint64 expiryDate, uint32 unitCount, bool exists, string origin, string metadataURI))",
  "function batchExists(bytes32 batchId) external view returns (bool)",
  "function getCheckpointCount(bytes32 batchId) external view returns (uint256)",
  "function getCheckpoint(bytes32 batchId, uint256 index) external view returns (tuple(address actor, uint64 timestamp, string location, string status))",
  "function getCheckpoints(bytes32 batchId) external view returns (tuple(address actor, uint64 timestamp, string location, string status)[])",
  "function getUnitScan(bytes32 batchId, uint32 unitIndex) external view returns (tuple(uint32 count, uint64 firstScanAt, uint64 lastScanAt, bytes32 lastLocationHash))",
  "function MANUFACTURER_ROLE() external view returns (bytes32)",
  "function ADMIN_ROLE() external view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
  // ── Custom errors — without these ethers v6 cannot decode revert reasons
  //    and every failure surfaces as the opaque "missing revert data" message.
  // Contract errors
  "error BatchAlreadyExists(bytes32 batchId)",
  "error BatchNotFound(bytes32 batchId)",
  "error InvalidBatchId()",
  "error InvalidUnitCount()",
  "error InvalidDates()",
  "error EmptyOrigin()",
  "error UnitIndexOutOfRange(uint32 unitIndex, uint32 unitCount)",
  "error NotBatchOwner(address caller, address manufacturer)",
  // OpenZeppelin AccessControl v5 errors
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error AccessControlBadConfirmation()",
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

  // Switches MetaMask to the expected chain if it is on a different one.
  // Adds the network to MetaMask automatically if it has never been added (error 4902).
  // Always rebuilds provider + signer after a switch so the cached objects are fresh.
  async ensureCorrectNetwork() {
    if (!window.ethereum) throw new Error("Không phát hiện MetaMask.");
    const cfg = this._cfg();
    const hexChainId = '0x' + cfg.EXPECTED_CHAIN_ID.toString(16);
    const current = await window.ethereum.request({ method: 'eth_chainId' });
    if (BigInt(current) === cfg.EXPECTED_CHAIN_ID) return; // already on correct chain

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        // Chain not yet in MetaMask — add it, which also switches to it
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hexChainId,
            chainName: cfg.EXPECTED_NETWORK_NAME,
            rpcUrls: [cfg.PUBLIC_RPC],
            nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
            blockExplorerUrls: [cfg.EXPLORER_BASE],
          }],
        });
      } else {
        throw switchErr;
      }
    }

    // Rebuild provider + signer so they reflect the newly active chain
    this.provider = new ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();
  },

  async connectWallet() {
    if (!window.ethereum) {
      throw new Error("Không phát hiện MetaMask. Vui lòng cài đặt MetaMask.");
    }
    // Request accounts first (shows unlock popup if MetaMask is locked)
    this.provider = new ethers.BrowserProvider(window.ethereum);
    await this.provider.send("eth_requestAccounts", []);

    // Switch to Polygon Amoy if on a different network
    await this.ensureCorrectNetwork();

    // Always build a fresh provider + signer on the (now correct) chain
    this.provider = new ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();

    // If the user manually switches networks while the page is open, clear the
    // stale signer so the next transaction re-triggers this flow.
    window.ethereum.on('chainChanged', () => {
      this.signer = null;
      this.address = null;
      this.provider = null;
    });

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
