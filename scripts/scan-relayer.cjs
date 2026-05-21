// Minimal gasless scan relayer for ProvenLedgerVN.
//
// Serves public/ and exposes POST /api/record-scan. The browser can verify a
// batch read-only, then ask this relayer to submit recordScan() so consumers do
// not need MetaMask or testnet funds during demos.

require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const { ethers } = require("ethers");

const PORT = Number(process.env.RELAYER_PORT || process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const RPC_URL =
  process.env.RELAYER_RPC_URL ||
  process.env.POLYGON_AMOY_RPC_URL ||
  process.env.POLYGON_RPC_URL ||
  "http://127.0.0.1:8545";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const RATE_LIMIT_MS = Number(process.env.RELAYER_RATE_LIMIT_MS || 3000);

const ABI = [
  "function batchExists(bytes32 batchId) view returns (bool)",
  "function getUnitScan(bytes32 batchId, uint32 unitIndex) view returns (tuple(uint32 count, uint64 firstScanAt, uint64 lastScanAt, bytes32 lastLocationHash))",
  "function recordScan(bytes32 batchId, uint32 unitIndex, bytes32 locationHash) external",
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const recentRequests = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function sendStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validateScanInput(body) {
  const batchId = String(body.batchId || "").trim();
  const unitIndex = Number(body.unitIndex || 0);
  const locationHash = String(body.locationHash || ethers.ZeroHash).trim();

  if (!batchId.startsWith("0x") || batchId.length !== 66) {
    throw new Error("Invalid batchId; expected 32-byte hex string.");
  }
  if (!Number.isInteger(unitIndex) || unitIndex < 0 || unitIndex > 4294967295) {
    throw new Error("Invalid unitIndex; expected uint32.");
  }
  if (!locationHash.startsWith("0x") || locationHash.length !== 66) {
    throw new Error("Invalid locationHash; expected 32-byte hex string.");
  }
  return { batchId, unitIndex, locationHash };
}

function clientKey(req, scan) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  return `${ip}:${scan.batchId}:${scan.unitIndex}`;
}

async function handleRecordScan(req, res) {
  if (!ethers.isAddress(CONTRACT_ADDRESS)) {
    return sendJson(res, 503, { ok: false, error: "CONTRACT_ADDRESS is not configured for the relayer." });
  }
  if (!RELAYER_PRIVATE_KEY) {
    return sendJson(res, 503, { ok: false, error: "RELAYER_PRIVATE_KEY or PRIVATE_KEY is not configured." });
  }

  let scan;
  try {
    scan = validateScanInput(await readJsonBody(req));
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const key = clientKey(req, scan);
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < RATE_LIMIT_MS) {
    return sendJson(res, 429, { ok: false, error: "Please wait before recording this scan again." });
  }
  recentRequests.set(key, now);

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const exists = await contract.batchExists(scan.batchId);
    if (!exists) {
      return sendJson(res, 404, { ok: false, error: "Batch not found on the configured contract." });
    }

    const tx = await contract.recordScan(scan.batchId, scan.unitIndex, scan.locationHash);
    const receipt = await tx.wait();
    const unitScan = await contract.getUnitScan(scan.batchId, scan.unitIndex);

    return sendJson(res, 200, {
      ok: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      scanCount: Number(unitScan.count),
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: err.reason || err.shortMessage || err.message || String(err),
    });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }
  if (req.method === "POST" && req.url === "/api/record-scan") {
    return handleRecordScan(req, res);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return sendStatic(req, res);
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ProvenLedgerVN relayer serving public/ on port ${PORT}`);
  console.log(`POST /api/record-scan -> recordScan()`);
  console.log(`Contract: ${CONTRACT_ADDRESS || "(missing CONTRACT_ADDRESS)"}`);
  console.log(`RPC:      ${RPC_URL}`);
});
