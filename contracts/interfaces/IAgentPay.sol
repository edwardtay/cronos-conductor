// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAgentPay
 * @notice Interface for x402 Agent Payment Protocol on Cronos
 */
interface IAgentPay {
    struct PaymentRequest {
        bytes32 id;
        address from;
        address to;
        address token;
        uint256 amount;
        uint256 deadline;
        bytes32 conditionHash;
        PaymentStatus status;
    }

    enum PaymentStatus {
        Pending,
        Executed,
        Cancelled,
        Refunded
    }

    event PaymentCreated(
        bytes32 indexed id,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount,
        uint256 deadline
    );

    event PaymentExecuted(bytes32 indexed id, address indexed executor);
    event PaymentCancelled(bytes32 indexed id);
    event PaymentRefunded(bytes32 indexed id);

    function createPayment(
        address to,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes32 conditionHash
    ) external payable returns (bytes32 paymentId);

    function executePayment(bytes32 paymentId, bytes calldata proof) external;
    function cancelPayment(bytes32 paymentId) external;
    function refundPayment(bytes32 paymentId) external;
    function getPayment(bytes32 paymentId) external view returns (PaymentRequest memory);
}

interface ISettlementEngine {
    struct SettlementBatch {
        bytes32 id;
        bytes32[] paymentIds;
        uint256 createdAt;
        uint256 executedAt;
        BatchStatus status;
    }

    enum BatchStatus {
        Pending,
        Processing,
        Completed,
        Failed
    }

    event BatchCreated(bytes32 indexed batchId, uint256 paymentCount);
    event BatchExecuted(bytes32 indexed batchId, uint256 successCount, uint256 failCount);

    function createBatch(bytes32[] calldata paymentIds) external returns (bytes32 batchId);
    function executeBatch(bytes32 batchId) external;
    function getBatch(bytes32 batchId) external view returns (SettlementBatch memory);
}

interface IEscrowManager {
    struct Escrow {
        bytes32 id;
        address depositor;
        address beneficiary;
        address arbiter;
        address token;
        uint256 amount;
        uint256 releaseTime;
        bytes32 conditionHash;
        EscrowStatus status;
    }

    enum EscrowStatus {
        Active,
        Released,
        Refunded,
        Disputed
    }

    event EscrowCreated(
        bytes32 indexed id,
        address indexed depositor,
        address indexed beneficiary,
        uint256 amount
    );
    event EscrowReleased(bytes32 indexed id);
    event EscrowRefunded(bytes32 indexed id);
    event EscrowDisputed(bytes32 indexed id);

    function createEscrow(
        address beneficiary,
        address arbiter,
        address token,
        uint256 amount,
        uint256 releaseTime,
        bytes32 conditionHash
    ) external payable returns (bytes32 escrowId);

    function releaseEscrow(bytes32 escrowId, bytes calldata proof) external;
    function refundEscrow(bytes32 escrowId) external;
    function disputeEscrow(bytes32 escrowId) external;
}
