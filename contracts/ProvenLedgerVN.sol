// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProvenLedgerVN - FMCG batch provenance and anti-counterfeit ledger
/// @notice Append-only registry. Manufacturers register batches; supply-chain
///         checkpoints accumulate; per-unit scan counts surface cloned QRs.
/// @dev Designed for Polygon. Batch-level storage keeps gas per registered
///      unit negligible at Vinamilk-scale daily output.
contract ProvenLedgerVN is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");

    struct Batch {
        address manufacturer;
        uint64 productionDate;
        uint64 expiryDate;
        uint32 unitCount;
        bool exists;
        string origin;
        string metadataURI;
    }

    struct Checkpoint {
        address actor;
        uint64 timestamp;
        string location;
        string status;
    }

    struct UnitScan {
        uint32 count;
        uint64 firstScanAt;
        uint64 lastScanAt;
        bytes32 lastLocationHash;
    }

    mapping(bytes32 => Batch) private _batches;
    mapping(bytes32 => Checkpoint[]) private _checkpoints;
    mapping(bytes32 => mapping(uint32 => UnitScan)) private _scans;

    event BatchRegistered(
        bytes32 indexed batchId,
        address indexed manufacturer,
        uint32 unitCount,
        uint64 productionDate,
        uint64 expiryDate,
        string origin,
        string metadataURI
    );

    event CheckpointAdded(
        bytes32 indexed batchId,
        uint256 indexed sequence,
        address indexed actor,
        uint64 timestamp,
        string location,
        string status
    );

    event UnitScanned(
        bytes32 indexed batchId,
        uint32 indexed unitIndex,
        address indexed scanner,
        uint32 newCount,
        uint64 timestamp,
        bytes32 locationHash
    );

    error BatchAlreadyExists(bytes32 batchId);
    error BatchNotFound(bytes32 batchId);
    error InvalidBatchId();
    error InvalidUnitCount();
    error InvalidDates();
    error EmptyOrigin();
    error UnitIndexOutOfRange(uint32 unitIndex, uint32 unitCount);
    error NotBatchOwner(address caller, address manufacturer);

    /// @param admin Initial holder of DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _setRoleAdmin(MANUFACTURER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /// @notice Register a new batch. One transaction covers an arbitrary
    ///         number of units (the count is metadata, not a loop).
    /// @param batchId Off-chain-assigned unique identifier (e.g. keccak256 of
    ///        manufacturer-internal SKU + lot code).
    /// @param origin Free-form factory location string.
    /// @param productionDate Unix timestamp of production.
    /// @param expiryDate Unix timestamp of expiry; must be > productionDate.
    /// @param unitCount Number of consumer units in this batch.
    /// @param metadataURI IPFS / HTTPS URI for extended metadata (optional).
    function registerBatch(
        bytes32 batchId,
        string calldata origin,
        uint64 productionDate,
        uint64 expiryDate,
        uint32 unitCount,
        string calldata metadataURI
    ) external onlyRole(MANUFACTURER_ROLE) {
        if (batchId == bytes32(0)) revert InvalidBatchId();
        if (_batches[batchId].exists) revert BatchAlreadyExists(batchId);
        if (unitCount == 0) revert InvalidUnitCount();
        if (expiryDate <= productionDate) revert InvalidDates();
        if (bytes(origin).length == 0) revert EmptyOrigin();

        _batches[batchId] = Batch({
            manufacturer: msg.sender,
            productionDate: productionDate,
            expiryDate: expiryDate,
            unitCount: unitCount,
            exists: true,
            origin: origin,
            metadataURI: metadataURI
        });

        emit BatchRegistered(
            batchId,
            msg.sender,
            unitCount,
            productionDate,
            expiryDate,
            origin,
            metadataURI
        );
    }

    /// @notice Append a supply-chain checkpoint to a batch. Restricted to the
    ///         batch's manufacturer or an ADMIN_ROLE holder; the append-only
    ///         array means past checkpoints can never be edited or removed.
    function addCheckpoint(
        bytes32 batchId,
        string calldata location,
        string calldata status
    ) external {
        Batch storage b = _batches[batchId];
        if (!b.exists) revert BatchNotFound(batchId);
        if (msg.sender != b.manufacturer && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotBatchOwner(msg.sender, b.manufacturer);
        }

        uint64 ts = uint64(block.timestamp);
        _checkpoints[batchId].push(Checkpoint({
            actor: msg.sender,
            timestamp: ts,
            location: location,
            status: status
        }));

        emit CheckpointAdded(
            batchId,
            _checkpoints[batchId].length - 1,
            msg.sender,
            ts,
            location,
            status
        );
    }

    /// @notice Record a consumer scan of a single unit. Permissionless so the
    ///         consumer dApp can relay scans on the user's behalf.
    /// @dev    Each call increments scan.count. A unit scanned more times than
    ///         physically plausible (or from inconsistent locationHash values)
    ///         is the on-chain signal that the QR has been cloned. Detection
    ///         thresholds are enforced off-chain by the dApp / indexer.
    /// @param locationHash Hash of approximate geo coords supplied by the
    ///        dApp; zero if the consumer declined location sharing.
    function recordScan(
        bytes32 batchId,
        uint32 unitIndex,
        bytes32 locationHash
    ) external {
        Batch storage b = _batches[batchId];
        if (!b.exists) revert BatchNotFound(batchId);
        if (unitIndex >= b.unitCount) {
            revert UnitIndexOutOfRange(unitIndex, b.unitCount);
        }

        UnitScan storage s = _scans[batchId][unitIndex];
        uint64 ts = uint64(block.timestamp);
        unchecked {
            s.count += 1;
        }
        if (s.firstScanAt == 0) {
            s.firstScanAt = ts;
        }
        s.lastScanAt = ts;
        s.lastLocationHash = locationHash;

        emit UnitScanned(batchId, unitIndex, msg.sender, s.count, ts, locationHash);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        if (!_batches[batchId].exists) revert BatchNotFound(batchId);
        return _batches[batchId];
    }

    function batchExists(bytes32 batchId) external view returns (bool) {
        return _batches[batchId].exists;
    }

    function getCheckpointCount(bytes32 batchId) external view returns (uint256) {
        return _checkpoints[batchId].length;
    }

    function getCheckpoint(bytes32 batchId, uint256 index)
        external
        view
        returns (Checkpoint memory)
    {
        Checkpoint[] storage arr = _checkpoints[batchId];
        require(index < arr.length, "Checkpoint index out of range");
        return arr[index];
    }

    function getCheckpoints(bytes32 batchId)
        external
        view
        returns (Checkpoint[] memory)
    {
        return _checkpoints[batchId];
    }

    function getUnitScan(bytes32 batchId, uint32 unitIndex)
        external
        view
        returns (UnitScan memory)
    {
        Batch storage b = _batches[batchId];
        if (!b.exists) revert BatchNotFound(batchId);
        if (unitIndex >= b.unitCount) {
            revert UnitIndexOutOfRange(unitIndex, b.unitCount);
        }
        return _scans[batchId][unitIndex];
    }
}
