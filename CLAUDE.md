# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ProvenLedgerVN** — a Polygon-based supply chain authentication system for FMCG products (modeled on Vinamilk). Consumers scan a QR code to verify product authenticity; the smart contract tracks batch registrations and per-unit scan counts to detect counterfeiting.

## Reference Documents
- **Core Requirements**: Refer to `2026 A3 Blockchains (Group Project) (1).pdf` for grading criteria and implementation requirements.
- **Business Logic**: Refer to `Group 6 proposal.pdf` for the ProvenLedgerVN data model and instructor-approved solutions for scaling and anti-counterfeiting in `Lecture feedback about project proposal and our respond.txt`.

## Development Rules
- **Strict Branching**: ALWAYS work on the `back-end` branch. Never commit directly to `main`.
- **Commit Style**: Use Conventional Commits (e.g., `feat:`, `fix:`, `docs:`).
- **Repository Cleanliness (Git):** - ONLY push source code, scripts, and necessary configuration files (Hardhat, package.json, etc.).
    - DO NOT commit/push reference documents (`.pdf`, `.txt` feedback) to the repository.
    - Ensure `.gitignore` includes `.env`, `artifacts/`, `cache/`, and the PDF/TXT reference files.
- **No AI Attribution**: Do not include "Co-authored-by: Claude" in commit messages.
- **Language**: Communications in Vietnamese; Code comments and Commits in English.

## Commands

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run all tests
npx hardhat test

# Run a single test file
npx hardhat test test/<filename>.js

# Start local Hardhat node
npx hardhat node

# Deploy to local network
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Polygon (requires .env with PRIVATE_KEY and RPC_URL)
npx hardhat run scripts/deploy.js --network polygon

# Run gas benchmarking script
npx hardhat run scripts/benchmark.js --network localhost
```

## Architecture

Hardhat 3 project — contracts go in `contracts/`, tests in `test/`, deploy/benchmark scripts in `scripts/`.

**On-chain design (batch-level, not unit-level):**
- Registration is at the batch level so that millions of daily units require only ~100 transactions, keeping gas costs manageable on Polygon.
- Each unit carries a unique ID derived from its batch. The contract tracks scan counts per unit ID; a spike in scan count for one ID (or scans from geographically inconsistent locations) flags a cloned/counterfeit QR code.
- All state transitions are append-only; no record can be overwritten, making tampering cryptographically evident.

- Frontend for Testing: If a UI is needed for functionality testing, create a minimalist, single-page HTML/JS interface only. Focus on functionality over aesthetics. The final polished UI will be integrated from a teammate's work later.

**Key benchmarking requirement:**
- A Hardhat script must call the batch-registration function across volumes (100 / 1,000 / 10,000 units), record gas consumed, and extrapolate to Vinamilk-scale daily output as a cost table. This is a graded deliverable.

## Network Config

Target deployment is Polygon (Mainnet or Mumbai testnet). Store `PRIVATE_KEY`, `POLYGON_RPC_URL`, and any API keys in a `.env` file (never commit it). Use `dotenv` or Hardhat's `vars` to load them in `hardhat.config.js`.
