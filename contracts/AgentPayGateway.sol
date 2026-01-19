// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgentPay.sol";

/**
 * @title AgentPayGateway
 * @notice Main payment gateway for x402 agent-triggered payments on Cronos
 * @dev Supports native CRO and ERC20 tokens with conditional execution
 */
contract AgentPayGateway is IAgentPay, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Payment storage
    mapping(bytes32 => PaymentRequest) public payments;
    mapping(address => bytes32[]) public userPayments;

    // Authorized agents that can execute payments
    mapping(address => bool) public authorizedAgents;

    // Protocol fee (basis points, 100 = 1%)
    uint256 public protocolFee = 30; // 0.3%
    address public feeRecipient;

    // Nonce for unique payment IDs
    uint256 private nonce;

    constructor(address _feeRecipient) Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
    }

    // ============ Agent Management ============

    function setAuthorizedAgent(address agent, bool authorized) external onlyOwner {
        authorizedAgents[agent] = authorized;
    }

    function setProtocolFee(uint256 _fee) external onlyOwner {
        require(_fee <= 500, "Fee too high"); // Max 5%
        protocolFee = _fee;
    }

    // ============ Payment Creation ============

    /**
     * @notice Create a new payment request
     * @param to Recipient address
     * @param token Token address (address(0) for native CRO)
     * @param amount Payment amount
     * @param deadline Execution deadline timestamp
     * @param conditionHash Hash of condition that must be met for execution
     */
    function createPayment(
        address to,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes32 conditionHash
    ) external payable nonReentrant returns (bytes32 paymentId) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(deadline > block.timestamp, "Invalid deadline");

        // Generate unique payment ID
        paymentId = keccak256(abi.encodePacked(msg.sender, to, amount, nonce++, block.timestamp));

        // Handle token transfer
        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient CRO");
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Store payment
        payments[paymentId] = PaymentRequest({
            id: paymentId,
            from: msg.sender,
            to: to,
            token: token,
            amount: amount,
            deadline: deadline,
            conditionHash: conditionHash,
            status: PaymentStatus.Pending
        });

        userPayments[msg.sender].push(paymentId);

        emit PaymentCreated(paymentId, msg.sender, to, token, amount, deadline);
    }

    /**
     * @notice Execute a pending payment (can be called by authorized agents)
     * @param paymentId The payment ID to execute
     * @param proof Proof data for condition verification
     */
    function executePayment(bytes32 paymentId, bytes calldata proof) external nonReentrant {
        PaymentRequest storage payment = payments[paymentId];

        require(payment.status == PaymentStatus.Pending, "Invalid status");
        require(block.timestamp <= payment.deadline, "Payment expired");

        // Verify caller is authorized (sender, recipient, or authorized agent)
        require(
            msg.sender == payment.from ||
            msg.sender == payment.to ||
            authorizedAgents[msg.sender],
            "Not authorized"
        );

        // Verify condition if set
        if (payment.conditionHash != bytes32(0)) {
            require(keccak256(proof) == payment.conditionHash, "Condition not met");
        }

        payment.status = PaymentStatus.Executed;

        // Calculate fee
        uint256 fee = (payment.amount * protocolFee) / 10000;
        uint256 netAmount = payment.amount - fee;

        // Transfer funds
        if (payment.token == address(0)) {
            // Native CRO
            (bool success, ) = payment.to.call{value: netAmount}("");
            require(success, "CRO transfer failed");
            if (fee > 0) {
                (success, ) = feeRecipient.call{value: fee}("");
                require(success, "Fee transfer failed");
            }
        } else {
            // ERC20 token
            IERC20(payment.token).safeTransfer(payment.to, netAmount);
            if (fee > 0) {
                IERC20(payment.token).safeTransfer(feeRecipient, fee);
            }
        }

        emit PaymentExecuted(paymentId, msg.sender);
    }

    /**
     * @notice Cancel a pending payment (only by sender before deadline)
     */
    function cancelPayment(bytes32 paymentId) external nonReentrant {
        PaymentRequest storage payment = payments[paymentId];

        require(payment.status == PaymentStatus.Pending, "Invalid status");
        require(msg.sender == payment.from, "Not sender");

        payment.status = PaymentStatus.Cancelled;

        // Refund tokens
        if (payment.token == address(0)) {
            (bool success, ) = payment.from.call{value: payment.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(payment.token).safeTransfer(payment.from, payment.amount);
        }

        emit PaymentCancelled(paymentId);
    }

    /**
     * @notice Refund an expired payment
     */
    function refundPayment(bytes32 paymentId) external nonReentrant {
        PaymentRequest storage payment = payments[paymentId];

        require(payment.status == PaymentStatus.Pending, "Invalid status");
        require(block.timestamp > payment.deadline, "Not expired");

        payment.status = PaymentStatus.Refunded;

        // Refund tokens
        if (payment.token == address(0)) {
            (bool success, ) = payment.from.call{value: payment.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(payment.token).safeTransfer(payment.from, payment.amount);
        }

        emit PaymentRefunded(paymentId);
    }

    // ============ View Functions ============

    function getPayment(bytes32 paymentId) external view returns (PaymentRequest memory) {
        return payments[paymentId];
    }

    function getUserPayments(address user) external view returns (bytes32[] memory) {
        return userPayments[user];
    }

    function getUserPaymentCount(address user) external view returns (uint256) {
        return userPayments[user].length;
    }

    // ============ x402 HTTP Payment Support ============

    /**
     * @notice Verify x402 payment header signature
     * @dev Used for HTTP-based payment verification
     */
    function verifyX402Signature(
        bytes32 paymentId,
        uint256 timestamp,
        bytes calldata signature
    ) external view returns (bool) {
        PaymentRequest memory payment = payments[paymentId];

        bytes32 messageHash = keccak256(abi.encodePacked(paymentId, timestamp));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        address signer = recoverSigner(ethSignedHash, signature);
        return signer == payment.from || authorizedAgents[signer];
    }

    function recoverSigner(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    receive() external payable {}
}
