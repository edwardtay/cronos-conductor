// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgentPay.sol";
import "./AgentPayGateway.sol";

/**
 * @title SettlementEngine
 * @notice Multi-leg settlement and batch transaction processor for x402
 * @dev Enables complex payment workflows with atomic execution
 */
contract SettlementEngine is ISettlementEngine, ReentrancyGuard, Ownable {
    AgentPayGateway public immutable gateway;

    // Batch storage
    mapping(bytes32 => SettlementBatch) public batches;
    mapping(bytes32 => mapping(uint256 => bool)) public batchPaymentStatus;

    // Recurring payment schedules
    struct RecurringSchedule {
        bytes32 id;
        address from;
        address to;
        address token;
        uint256 amount;
        uint256 interval;
        uint256 lastExecution;
        uint256 executionsRemaining;
        bool active;
    }

    mapping(bytes32 => RecurringSchedule) public recurringSchedules;
    mapping(address => bytes32[]) public userSchedules;

    // Multi-leg transaction
    struct MultiLegTx {
        bytes32 id;
        Leg[] legs;
        uint256 createdAt;
        MultiLegStatus status;
    }

    struct Leg {
        address from;
        address to;
        address token;
        uint256 amount;
        bool executed;
    }

    enum MultiLegStatus {
        Pending,
        Executing,
        Completed,
        PartialFail,
        Reverted
    }

    mapping(bytes32 => MultiLegTx) public multiLegTxs;

    uint256 private nonce;

    event RecurringScheduleCreated(bytes32 indexed scheduleId, address indexed from, address indexed to, uint256 amount);
    event RecurringPaymentExecuted(bytes32 indexed scheduleId, bytes32 paymentId);
    event MultiLegTxCreated(bytes32 indexed txId, uint256 legCount);
    event MultiLegTxCompleted(bytes32 indexed txId);

    constructor(address _gateway) Ownable(msg.sender) {
        gateway = AgentPayGateway(payable(_gateway));
    }

    // ============ Batch Settlement ============

    /**
     * @notice Create a batch of payments for atomic settlement
     */
    function createBatch(bytes32[] calldata paymentIds) external returns (bytes32 batchId) {
        require(paymentIds.length > 0, "Empty batch");
        require(paymentIds.length <= 100, "Batch too large");

        batchId = keccak256(abi.encodePacked(msg.sender, paymentIds.length, nonce++, block.timestamp));

        batches[batchId] = SettlementBatch({
            id: batchId,
            paymentIds: paymentIds,
            createdAt: block.timestamp,
            executedAt: 0,
            status: BatchStatus.Pending
        });

        emit BatchCreated(batchId, paymentIds.length);
    }

    /**
     * @notice Execute all payments in a batch
     */
    function executeBatch(bytes32 batchId) external nonReentrant {
        SettlementBatch storage batch = batches[batchId];
        require(batch.status == BatchStatus.Pending, "Invalid batch status");

        batch.status = BatchStatus.Processing;
        uint256 successCount = 0;
        uint256 failCount = 0;

        for (uint256 i = 0; i < batch.paymentIds.length; i++) {
            try gateway.executePayment(batch.paymentIds[i], "") {
                batchPaymentStatus[batchId][i] = true;
                successCount++;
            } catch {
                batchPaymentStatus[batchId][i] = false;
                failCount++;
            }
        }

        batch.executedAt = block.timestamp;
        batch.status = failCount == 0 ? BatchStatus.Completed : BatchStatus.Failed;

        emit BatchExecuted(batchId, successCount, failCount);
    }

    function getBatch(bytes32 batchId) external view returns (SettlementBatch memory) {
        return batches[batchId];
    }

    // ============ Recurring Payments ============

    /**
     * @notice Create a recurring payment schedule
     * @param to Recipient address
     * @param token Token address (address(0) for native CRO)
     * @param amount Payment amount per execution
     * @param interval Time between payments in seconds
     * @param executionCount Total number of payments (0 for unlimited)
     */
    function createRecurringSchedule(
        address to,
        address token,
        uint256 amount,
        uint256 interval,
        uint256 executionCount
    ) external returns (bytes32 scheduleId) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(interval >= 60, "Interval too short"); // Min 1 minute

        scheduleId = keccak256(abi.encodePacked(msg.sender, to, amount, nonce++, block.timestamp));

        recurringSchedules[scheduleId] = RecurringSchedule({
            id: scheduleId,
            from: msg.sender,
            to: to,
            token: token,
            amount: amount,
            interval: interval,
            lastExecution: 0,
            executionsRemaining: executionCount,
            active: true
        });

        userSchedules[msg.sender].push(scheduleId);

        emit RecurringScheduleCreated(scheduleId, msg.sender, to, amount);
    }

    /**
     * @notice Execute a recurring payment (callable by anyone/keepers)
     */
    function executeRecurringPayment(bytes32 scheduleId) external nonReentrant {
        RecurringSchedule storage schedule = recurringSchedules[scheduleId];
        require(schedule.active, "Schedule inactive");
        require(
            schedule.lastExecution == 0 ||
            block.timestamp >= schedule.lastExecution + schedule.interval,
            "Too early"
        );

        if (schedule.executionsRemaining > 0) {
            schedule.executionsRemaining--;
            if (schedule.executionsRemaining == 0) {
                schedule.active = false;
            }
        }

        schedule.lastExecution = block.timestamp;

        // Create and execute payment through gateway
        bytes32 paymentId = gateway.createPayment{value: schedule.token == address(0) ? schedule.amount : 0}(
            schedule.to,
            schedule.token,
            schedule.amount,
            block.timestamp + 3600, // 1 hour deadline
            bytes32(0)
        );

        gateway.executePayment(paymentId, "");

        emit RecurringPaymentExecuted(scheduleId, paymentId);
    }

    /**
     * @notice Cancel a recurring schedule
     */
    function cancelRecurringSchedule(bytes32 scheduleId) external {
        RecurringSchedule storage schedule = recurringSchedules[scheduleId];
        require(schedule.from == msg.sender, "Not owner");
        schedule.active = false;
    }

    // ============ Multi-Leg Transactions ============

    /**
     * @notice Create a multi-leg transaction for complex payment flows
     * @dev All legs execute atomically - if one fails, all revert
     */
    function createMultiLegTx(
        address[] calldata froms,
        address[] calldata tos,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external returns (bytes32 txId) {
        require(froms.length == tos.length && tos.length == tokens.length && tokens.length == amounts.length, "Array mismatch");
        require(froms.length > 0 && froms.length <= 10, "Invalid leg count");

        txId = keccak256(abi.encodePacked(msg.sender, froms.length, nonce++, block.timestamp));

        MultiLegTx storage mlTx = multiLegTxs[txId];
        mlTx.id = txId;
        mlTx.createdAt = block.timestamp;
        mlTx.status = MultiLegStatus.Pending;

        for (uint256 i = 0; i < froms.length; i++) {
            mlTx.legs.push(Leg({
                from: froms[i],
                to: tos[i],
                token: tokens[i],
                amount: amounts[i],
                executed: false
            }));
        }

        emit MultiLegTxCreated(txId, froms.length);
    }

    /**
     * @notice Execute all legs of a multi-leg transaction
     */
    function executeMultiLegTx(bytes32 txId, bytes[] calldata proofs) external nonReentrant {
        MultiLegTx storage mlTx = multiLegTxs[txId];
        require(mlTx.status == MultiLegStatus.Pending, "Invalid status");
        require(proofs.length == mlTx.legs.length, "Proof count mismatch");

        mlTx.status = MultiLegStatus.Executing;

        // Execute all legs
        for (uint256 i = 0; i < mlTx.legs.length; i++) {
            Leg storage leg = mlTx.legs[i];

            // Create payment for this leg
            bytes32 paymentId = gateway.createPayment{value: leg.token == address(0) ? leg.amount : 0}(
                leg.to,
                leg.token,
                leg.amount,
                block.timestamp + 3600,
                keccak256(proofs[i])
            );

            gateway.executePayment(paymentId, proofs[i]);
            leg.executed = true;
        }

        mlTx.status = MultiLegStatus.Completed;
        emit MultiLegTxCompleted(txId);
    }

    // ============ View Functions ============

    function getMultiLegTx(bytes32 txId) external view returns (
        bytes32 id,
        uint256 legCount,
        uint256 createdAt,
        MultiLegStatus status
    ) {
        MultiLegTx storage mlTx = multiLegTxs[txId];
        return (mlTx.id, mlTx.legs.length, mlTx.createdAt, mlTx.status);
    }

    function getUserSchedules(address user) external view returns (bytes32[] memory) {
        return userSchedules[user];
    }

    receive() external payable {}
}
