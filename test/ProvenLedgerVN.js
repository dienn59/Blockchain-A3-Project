const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const NOW = Math.floor(Date.now() / 1000);
const EXPIRY = NOW + 180 * 24 * 3600;
const BATCH_ID = ethers.id("VNM-TEST-LOT-001");
const ORIGIN = "Vinamilk Factory - Binh Duong";
const METADATA_URI = "ipfs://test-cid";
const UNIT_COUNT = 1000;
const LOC_HCM = ethers.keccak256(ethers.toUtf8Bytes("10.7769,106.7009"));
const LOC_HN = ethers.keccak256(ethers.toUtf8Bytes("21.0285,105.8542"));

describe("ProvenLedgerVN", function () {
  async function deployFixture() {
    const [admin, manufacturer, other, scanner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ProvenLedgerVN");
    const contract = await Factory.deploy(admin.address);
    const MANUFACTURER_ROLE = await contract.MANUFACTURER_ROLE();
    const ADMIN_ROLE = await contract.ADMIN_ROLE();
    return { contract, admin, manufacturer, other, scanner, MANUFACTURER_ROLE, ADMIN_ROLE };
  }

  async function deployWithManufacturerFixture() {
    const base = await deployFixture();
    await base.contract.grantRole(base.MANUFACTURER_ROLE, base.manufacturer.address);
    return base;
  }

  async function batchRegisteredFixture() {
    const base = await deployWithManufacturerFixture();
    await base.contract.connect(base.manufacturer).registerBatch(
      BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
    );
    return base;
  }

  // ─── Role Management ──────────────────────────────────────────────────────

  describe("Role Management", function () {
    it("admin holds DEFAULT_ADMIN_ROLE and ADMIN_ROLE after deploy", async function () {
      const { contract, admin, ADMIN_ROLE } = await loadFixture(deployFixture);
      expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await contract.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("admin can grant MANUFACTURER_ROLE to another account", async function () {
      const { contract, manufacturer, MANUFACTURER_ROLE } = await loadFixture(deployFixture);
      await contract.grantRole(MANUFACTURER_ROLE, manufacturer.address);
      expect(await contract.hasRole(MANUFACTURER_ROLE, manufacturer.address)).to.be.true;
    });

    it("admin can revoke MANUFACTURER_ROLE from another account", async function () {
      const { contract, manufacturer, MANUFACTURER_ROLE } = await loadFixture(deployWithManufacturerFixture);
      expect(await contract.hasRole(MANUFACTURER_ROLE, manufacturer.address)).to.be.true;

      await contract.revokeRole(MANUFACTURER_ROLE, manufacturer.address);

      expect(await contract.hasRole(MANUFACTURER_ROLE, manufacturer.address)).to.be.false;
    });

    it("non-admin cannot grant MANUFACTURER_ROLE or ADMIN_ROLE", async function () {
      const { contract, other, manufacturer, MANUFACTURER_ROLE, ADMIN_ROLE } = await loadFixture(deployFixture);
      await expect(
        contract.connect(other).grantRole(MANUFACTURER_ROLE, manufacturer.address)
      ).to.be.reverted;
      await expect(
        contract.connect(other).grantRole(ADMIN_ROLE, manufacturer.address)
      ).to.be.reverted;
    });
  });

  // ─── registerBatch ────────────────────────────────────────────────────────

  describe("registerBatch", function () {
    it("manufacturer can register a batch and emits BatchRegistered", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.emit(contract, "BatchRegistered")
        .withArgs(BATCH_ID, manufacturer.address, UNIT_COUNT, NOW, EXPIRY, ORIGIN, METADATA_URI);

      const batch = await contract.getBatch(BATCH_ID);
      expect(batch.manufacturer).to.equal(manufacturer.address);
      expect(batch.unitCount).to.equal(UNIT_COUNT);
      expect(batch.origin).to.equal(ORIGIN);
      expect(batch.metadataURI).to.equal(METADATA_URI);
      expect(batch.exists).to.be.true;
    });

    it("batchExists returns true after registration", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      expect(await contract.batchExists(BATCH_ID)).to.be.false;
      await contract.connect(manufacturer).registerBatch(
        BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
      );
      expect(await contract.batchExists(BATCH_ID)).to.be.true;
    });

    it("reverts with AccessControl error when caller lacks MANUFACTURER_ROLE", async function () {
      const { contract, other } = await loadFixture(deployFixture);
      await expect(
        contract.connect(other).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.reverted;
    });

    it("admin without MANUFACTURER_ROLE cannot register a batch", async function () {
      const { contract, admin } = await loadFixture(deployFixture);
      await expect(
        contract.connect(admin).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.reverted;
    });

    it("revoked manufacturer can no longer register a batch", async function () {
      const { contract, manufacturer, MANUFACTURER_ROLE } = await loadFixture(deployWithManufacturerFixture);
      await contract.revokeRole(MANUFACTURER_ROLE, manufacturer.address);

      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.reverted;
    });

    it("reverts with InvalidBatchId on zero batchId", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          ethers.ZeroHash, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "InvalidBatchId");
    });

    it("reverts with BatchAlreadyExists on duplicate batchId", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await contract.connect(manufacturer).registerBatch(
        BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
      );
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "BatchAlreadyExists")
        .withArgs(BATCH_ID);
    });

    it("reverts with InvalidUnitCount when unitCount is zero", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, 0, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "InvalidUnitCount");
    });

    it("reverts with InvalidDates when expiryDate equals productionDate", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, NOW, UNIT_COUNT, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "InvalidDates");
    });

    it("reverts with InvalidDates when expiryDate is before productionDate", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, NOW - 1, UNIT_COUNT, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "InvalidDates");
    });

    it("reverts with EmptyOrigin when origin is empty string", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, "", NOW, EXPIRY, UNIT_COUNT, METADATA_URI
        )
      ).to.be.revertedWithCustomError(contract, "EmptyOrigin");
    });

    it("accepts empty metadataURI (optional field)", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      await expect(
        contract.connect(manufacturer).registerBatch(
          BATCH_ID, ORIGIN, NOW, EXPIRY, UNIT_COUNT, ""
        )
      ).to.emit(contract, "BatchRegistered");
    });
  });

  // ─── addCheckpoint ────────────────────────────────────────────────────────

  describe("addCheckpoint", function () {
    it("batch manufacturer can add a checkpoint", async function () {
      const { contract, manufacturer } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(manufacturer).addCheckpoint(BATCH_ID, "Ho Chi Minh City", "In Transit")
      ).to.emit(contract, "CheckpointAdded");

      expect(await contract.getCheckpointCount(BATCH_ID)).to.equal(1);
      const cp = await contract.getCheckpoint(BATCH_ID, 0);
      expect(cp.actor).to.equal(manufacturer.address);
      expect(cp.location).to.equal("Ho Chi Minh City");
      expect(cp.status).to.equal("In Transit");
    });

    it("ADMIN_ROLE holder can add a checkpoint to any batch", async function () {
      const { contract, admin } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(admin).addCheckpoint(BATCH_ID, "Central Warehouse", "Received")
      ).to.emit(contract, "CheckpointAdded");
      expect(await contract.getCheckpointCount(BATCH_ID)).to.equal(1);
    });

    it("reverts with NotBatchOwner when caller is neither manufacturer nor admin", async function () {
      const { contract, other } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(other).addCheckpoint(BATCH_ID, "Somewhere", "Unknown")
      ).to.be.revertedWithCustomError(contract, "NotBatchOwner")
        .withArgs(other.address, anyValue);
    });

    it("reverts with BatchNotFound for non-existent batch", async function () {
      const { contract, manufacturer } = await loadFixture(deployWithManufacturerFixture);
      const ghost = ethers.id("NONEXISTENT-BATCH");
      await expect(
        contract.connect(manufacturer).addCheckpoint(ghost, "Location", "Status")
      ).to.be.revertedWithCustomError(contract, "BatchNotFound")
        .withArgs(ghost);
    });

    it("multiple checkpoints append in order and are all retrievable", async function () {
      const { contract, manufacturer } = await loadFixture(batchRegisteredFixture);
      await contract.connect(manufacturer).addCheckpoint(BATCH_ID, "Factory Gate", "Produced");
      await contract.connect(manufacturer).addCheckpoint(BATCH_ID, "Port of Ho Chi Minh", "Shipped");
      await contract.connect(manufacturer).addCheckpoint(BATCH_ID, "Supermarket", "Delivered");

      expect(await contract.getCheckpointCount(BATCH_ID)).to.equal(3);
      const all = await contract.getCheckpoints(BATCH_ID);
      expect(all.length).to.equal(3);
      expect(all[0].status).to.equal("Produced");
      expect(all[1].status).to.equal("Shipped");
      expect(all[2].status).to.equal("Delivered");
    });

    it("getCheckpoint reverts when index is out of range", async function () {
      const { contract, manufacturer } = await loadFixture(batchRegisteredFixture);
      await contract.connect(manufacturer).addCheckpoint(BATCH_ID, "Factory", "Produced");
      await expect(contract.getCheckpoint(BATCH_ID, 1)).to.be.reverted;
    });
  });

  // ─── recordScan ───────────────────────────────────────────────────────────

  describe("recordScan", function () {
    it("anyone can scan a valid unit (permissionless)", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM)
      ).to.emit(contract, "UnitScanned");
    });

    it("emits UnitScanned with updated count and locationHash", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM)
      ).to.emit(contract, "UnitScanned")
        .withArgs(BATCH_ID, 0, scanner.address, 1, anyValue, LOC_HCM);
    });

    it("first scan initialises count=1 and firstScanAt", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM);
      const scan = await contract.getUnitScan(BATCH_ID, 0);
      expect(scan.count).to.equal(1);
      expect(scan.firstScanAt).to.be.gt(0);
      expect(scan.lastLocationHash).to.equal(LOC_HCM);
    });

    it("repeat scans increment count and update lastLocationHash (warm slot)", async function () {
      const { contract, scanner, other } = await loadFixture(batchRegisteredFixture);
      await contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM);
      await contract.connect(other).recordScan(BATCH_ID, 0, LOC_HN);

      const scan = await contract.getUnitScan(BATCH_ID, 0);
      expect(scan.count).to.equal(2);
      expect(scan.lastLocationHash).to.equal(LOC_HN);
    });

    it("firstScanAt is preserved across multiple scans", async function () {
      const { contract, scanner, other } = await loadFixture(batchRegisteredFixture);
      await contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM);
      const first = (await contract.getUnitScan(BATCH_ID, 0)).firstScanAt;
      await contract.connect(other).recordScan(BATCH_ID, 0, LOC_HN);
      const second = (await contract.getUnitScan(BATCH_ID, 0)).firstScanAt;
      expect(first).to.equal(second);
    });

    it("independent units have independent scan counts", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM);
      await contract.connect(scanner).recordScan(BATCH_ID, 0, LOC_HCM);
      await contract.connect(scanner).recordScan(BATCH_ID, 1, LOC_HCM);

      expect((await contract.getUnitScan(BATCH_ID, 0)).count).to.equal(2);
      expect((await contract.getUnitScan(BATCH_ID, 1)).count).to.equal(1);
    });

    it("reverts with UnitIndexOutOfRange when unitIndex equals unitCount", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(scanner).recordScan(BATCH_ID, UNIT_COUNT, LOC_HCM)
      ).to.be.revertedWithCustomError(contract, "UnitIndexOutOfRange")
        .withArgs(UNIT_COUNT, UNIT_COUNT);
    });

    it("reverts with BatchNotFound for unknown batch", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      const ghost = ethers.id("GHOST-BATCH");
      await expect(
        contract.connect(scanner).recordScan(ghost, 0, LOC_HCM)
      ).to.be.revertedWithCustomError(contract, "BatchNotFound")
        .withArgs(ghost);
    });

    it("accepts zero locationHash when consumer declines location sharing", async function () {
      const { contract, scanner } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.connect(scanner).recordScan(BATCH_ID, 0, ethers.ZeroHash)
      ).to.emit(contract, "UnitScanned");
    });
  });

  // ─── View functions ───────────────────────────────────────────────────────

  describe("View functions", function () {
    it("batchExists returns false for unknown batch", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.batchExists(ethers.id("UNKNOWN"))).to.be.false;
    });

    it("getBatch reverts with BatchNotFound for unknown batch", async function () {
      const { contract } = await loadFixture(deployFixture);
      const unknown = ethers.id("UNKNOWN");
      await expect(contract.getBatch(unknown))
        .to.be.revertedWithCustomError(contract, "BatchNotFound")
        .withArgs(unknown);
    });

    it("getCheckpointCount returns 0 for batch with no checkpoints", async function () {
      const { contract } = await loadFixture(batchRegisteredFixture);
      expect(await contract.getCheckpointCount(BATCH_ID)).to.equal(0);
    });

    it("getUnitScan returns zero-state for an unscanned unit", async function () {
      const { contract } = await loadFixture(batchRegisteredFixture);
      const scan = await contract.getUnitScan(BATCH_ID, 0);
      expect(scan.count).to.equal(0);
      expect(scan.firstScanAt).to.equal(0);
    });

    it("getUnitScan reverts with UnitIndexOutOfRange for out-of-range index", async function () {
      const { contract } = await loadFixture(batchRegisteredFixture);
      await expect(
        contract.getUnitScan(BATCH_ID, UNIT_COUNT)
      ).to.be.revertedWithCustomError(contract, "UnitIndexOutOfRange");
    });
  });
});
