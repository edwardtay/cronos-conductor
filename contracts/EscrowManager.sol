// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgentPay.sol";

/**
 * @title EscrowManager
 * @notice Escrow system for conditional and time-locked payments
 * @dev Supports AI agent arbitration and multi-party escrows
 */
contract EscrowManager is IEscrowManager, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Escrow storage
    mapping(bytes32 => Escrow) public escrows;
    mapping(address => bytes32[]) public userEscrows;

    // Milestone-based escrow
    struct MilestoneEscrow {
        bytes32 id;
        address depositor;
        address beneficiary;
        address arbiter;
        address token;
        uint256 totalAmount;
        Milestone[] milestones;
        uint256 releasedAmount;
        MilestoneEscrowStatus status;
    }

    struct Milestone {
        string description;
        uint256 amount;
        bool completed;
        bool released;
    }

    enum MilestoneEscrowStatus {
        Active,
        Completed,
        Cancelled
    }

    mapping(bytes32 => MilestoneEscrow) public milestoneEscrows;

    // Protocol fee
    uint256 public protocolFee = 50; // 0.5%
    address public feeRecipient;

    uint256 private nonce;

    event MilestoneEscrowCreated(bytes32 indexed id, address indexed depositor, address indexed beneficiary, uint256 totalAmount);
    event MilestoneCompleted(bytes32 indexed escrowId, uint256 milestoneIndex);
    event MilestoneReleased(bytes32 indexed escrowId, uint256 milestoneIndex, uint256 amount);

    constructor(address _feeRecipient) Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
    }

    // ============ Standard Escrow ============

    /**
     * @notice Create a new escrow
     * @param beneficiary Recipient when conditions are met
     * @param arbiter Third party that can resolve disputes
     * @param token Token address (address(0) for native CRO)
     * @param amount Escrow amount
     * @param releaseTime Timestamp when auto-release is enabled
     * @param conditionHash Hash of condition for release
     */
    function createEscrow(
        address beneficiary,
        address arbiter,
        address token,
        uint256 amount,
        uint256 releaseTime,
        bytes32 conditionHash
    ) external payable nonReentrant returns (bytes32 escrowId) {
        require(beneficiary != address(0), "Invalid beneficiary");
        require(amount > 0, "Invalid amount");

        escrowId = keccak256(abi.encodePacked(msg.sender, beneficiary, amount, nonce++, block.timestamp));

        // Handle token transfer
        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient CRO");
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        escrows[escrowId] = Escrow({
            id: escrowId,
            depositor: msg.sender,
            beneficiary: beneficiary,
            arbiter: arbiter,
            token: token,
            amount: amount,
            releaseTime: releaseTime,
            conditionHash: conditionHash,
            status: EscrowStatus.Active
        });

        userEscrows[msg.sender].push(escrowId);
        userEscrows[beneficiary].push(escrowId);

        emit EscrowCreated(escrowId, msg.sender, beneficiary, amount);
    }

    /**
     * @notice Release escrow to beneficiary
     * @param escrowId The escrow ID
     * @param proof Proof that condition is met
     */
    function releaseEscrow(bytes32 escrowId, bytes calldata proof) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.status == EscrowStatus.Active, "Invalid status");

        // Check authorization
        bool isAuthorized = msg.sender == escrow.depositor ||
            msg.sender == escrow.arbiter ||
            (escrow.releaseTime > 0 && block.timestamp >= escrow.releaseTime);
        require(isAuthorized, "Not authorized");

        // Verify condition if set
        if (escrow.conditionHash != bytes32(0) && msg.sender != escrow.arbiter) {
            require(keccak256(proof) == escrow.conditionHash, "Condition not met");
        }

        escrow.status = EscrowStatus.Released;

        // Calculate and transfer
        uint256 fee = (escrow.amount * protocolFee) / 10000;
        uint256 netAmount = escrow.amount - fee;

        if (escrow.token == address(0)) {
            (bool success, ) = escrow.beneficiary.call{value: netAmount}("");
            require(success, "Transfer failed");
            if (fee > 0) {
                (success, ) = feeRecipient.call{value: fee}("");
                require(success, "Fee transfer failed");
            }
        } else {
            IERC20(escrow.token).safeTransfer(escrow.beneficiary, netAmount);
            if (fee > 0) {
                IERC20(escrow.token).safeTransfer(feeRecipient, fee);
            }
        }

        emit EscrowReleased(escrowId);
    }

    /**
     * @notice Refund escrow to depositor
     */
    function refundEscrow(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.status == EscrowStatus.Active, "Invalid status");
        require(msg.sender == escrow.beneficiary || msg.sender == escrow.arbiter, "Not authorized");

        escrow.status = EscrowStatus.Refunded;

        if (escrow.token == address(0)) {
            (bool success, ) = escrow.depositor.call{value: escrow.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(escrow.token).safeTransfer(escrow.depositor, escrow.amount);
        }

        emit EscrowRefunded(escrowId);
    }

    /**
     * @notice Mark escrow as disputed
     */
    function disputeEscrow(bytes32 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.status == EscrowStatus.Active, "Invalid status");
        require(msg.sender == escrow.depositor || msg.sender == escrow.beneficiary, "Not party");
        require(escrow.arbiter != address(0), "No arbiter");

        escrow.status = EscrowStatus.Disputed;
        emit EscrowDisputed(escrowId);
    }

    // ============ Milestone Escrow ============

    /**
     * @notice Create milestone-based escrow for project payments
     */
    function createMilestoneEscrow(
        address beneficiary,
        address arbiter,
        address token,
        string[] calldata descriptions,
        uint256[] calldata amounts
    ) external payable nonReentrant returns (bytes32 escrowId) {
        require(descriptions.length == amounts.length, "Array mismatch");
        require(descriptions.length > 0 && descriptions.length <= 20, "Invalid milestone count");

        uint256 totalAmount;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }

        // Handle token transfer
        if (token == address(0)) {
            require(msg.value >= totalAmount, "Insufficient CRO");
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        }

        escrowId = keccak256(abi.encodePacked(msg.sender, beneficiary, totalAmount, nonce++, block.timestamp));

        MilestoneEscrow storage mEscrow = milestoneEscrows[escrowId];
        mEscrow.id = escrowId;
        mEscrow.depositor = msg.sender;
        mEscrow.beneficiary = beneficiary;
        mEscrow.arbiter = arbiter;
        mEscrow.token = token;
        mEscrow.totalAmount = totalAmount;
        mEscrow.status = MilestoneEscrowStatus.Active;

        for (uint256 i = 0; i < descriptions.length; i++) {
            mEscrow.milestones.push(Milestone({
                description: descriptions[i],
                amount: amounts[i],
                completed: false,
                released: false
            }));
        }

        emit MilestoneEscrowCreated(escrowId, msg.sender, beneficiary, totalAmount);
    }

    /**
     * @notice Mark a milestone as completed (by depositor or arbiter)
     */
    function completeMilestone(bytes32 escrowId, uint256 milestoneIndex) external {
        MilestoneEscrow storage mEscrow = milestoneEscrows[escrowId];
        require(mEscrow.status == MilestoneEscrowStatus.Active, "Invalid status");
        require(msg.sender == mEscrow.depositor || msg.sender == mEscrow.arbiter, "Not authorized");
        require(milestoneIndex < mEscrow.milestones.length, "Invalid index");
        require(!mEscrow.milestones[milestoneIndex].completed, "Already completed");

        mEscrow.milestones[milestoneIndex].completed = true;
        emit MilestoneCompleted(escrowId, milestoneIndex);
    }

    /**
     * @notice Release funds for a completed milestone
     */
    function releaseMilestone(bytes32 escrowId, uint256 milestoneIndex) external nonReentrant {
        MilestoneEscrow storage mEscrow = milestoneEscrows[escrowId];
        require(mEscrow.status == MilestoneEscrowStatus.Active, "Invalid status");
        require(milestoneIndex < mEscrow.milestones.length, "Invalid index");

        Milestone storage milestone = mEscrow.milestones[milestoneIndex];
        require(milestone.completed, "Not completed");
        require(!milestone.released, "Already released");

        milestone.released = true;
        mEscrow.releasedAmount += milestone.amount;

        // Calculate fee
        uint256 fee = (milestone.amount * protocolFee) / 10000;
        uint256 netAmount = milestone.amount - fee;

        if (mEscrow.token == address(0)) {
            (bool success, ) = mEscrow.beneficiary.call{value: netAmount}("");
            require(success, "Transfer failed");
            if (fee > 0) {
                (success, ) = feeRecipient.call{value: fee}("");
                require(success, "Fee transfer failed");
            }
        } else {
            IERC20(mEscrow.token).safeTransfer(mEscrow.beneficiary, netAmount);
            if (fee > 0) {
                IERC20(mEscrow.token).safeTransfer(feeRecipient, fee);
            }
        }

        // Check if all milestones are released
        bool allReleased = true;
        for (uint256 i = 0; i < mEscrow.milestones.length; i++) {
            if (!mEscrow.milestones[i].released) {
                allReleased = false;
                break;
            }
        }
        if (allReleased) {
            mEscrow.status = MilestoneEscrowStatus.Completed;
        }

        emit MilestoneReleased(escrowId, milestoneIndex, netAmount);
    }

    // ============ View Functions ============

    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function getUserEscrows(address user) external view returns (bytes32[] memory) {
        return userEscrows[user];
    }

    function getMilestoneEscrow(bytes32 escrowId) external view returns (
        bytes32 id,
        address depositor,
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 releasedAmount,
        uint256 milestoneCount,
        MilestoneEscrowStatus status
    ) {
        MilestoneEscrow storage mEscrow = milestoneEscrows[escrowId];
        return (
            mEscrow.id,
            mEscrow.depositor,
            mEscrow.beneficiary,
            mEscrow.token,
            mEscrow.totalAmount,
            mEscrow.releasedAmount,
            mEscrow.milestones.length,
            mEscrow.status
        );
    }

    function getMilestone(bytes32 escrowId, uint256 index) external view returns (
        string memory description,
        uint256 amount,
        bool completed,
        bool released
    ) {
        Milestone storage milestone = milestoneEscrows[escrowId].milestones[index];
        return (milestone.description, milestone.amount, milestone.completed, milestone.released);
    }

    receive() external payable {}
}
