// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentWallet
 * @notice Smart wallet with spend permissions for AI agents
 * @dev Enables autonomous agent spending within owner-defined limits
 *
 * Key Features:
 * - Owner grants agents permission to spend with limits
 * - Per-transaction and daily spending caps
 * - Allowlist of approved recipients (optional)
 * - Instant revocation
 * - Full audit trail via events
 */
contract AgentWallet is ReentrancyGuard {

    // ============ State ============

    address public owner;

    struct SpendPermission {
        bool active;
        uint256 maxPerTx;        // Max CRO per transaction
        uint256 dailyLimit;      // Max CRO per day
        uint256 spentToday;      // Amount spent today
        uint256 lastResetTime;   // Last daily reset timestamp
        uint256 totalSpent;      // Lifetime spending
        uint256 txCount;         // Number of transactions
        uint256 expiry;          // Permission expiration (0 = no expiry)
    }

    mapping(address => SpendPermission) public permissions;
    mapping(address => mapping(address => bool)) public allowedRecipients; // agent => recipient => allowed
    mapping(address => bool) public hasAllowlist; // whether agent has recipient restrictions

    address[] public agents; // List of all agents (for enumeration)
    mapping(address => bool) public isAgent;

    // ============ Events ============

    event PermissionGranted(
        address indexed agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        uint256 expiry
    );
    event PermissionRevoked(address indexed agent);
    event AgentSpend(
        address indexed agent,
        address indexed to,
        uint256 amount,
        bytes data,
        uint256 dailyRemaining
    );
    event RecipientAllowed(address indexed agent, address indexed recipient);
    event RecipientRemoved(address indexed agent, address indexed recipient);
    event Deposit(address indexed from, uint256 amount);
    event OwnerWithdraw(address indexed to, uint256 amount);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyActiveAgent() {
        SpendPermission storage perm = permissions[msg.sender];
        require(perm.active, "Not an active agent");
        require(perm.expiry == 0 || block.timestamp < perm.expiry, "Permission expired");
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
    }

    // ============ Owner Functions ============

    /**
     * @notice Grant spending permission to an agent
     * @param agent Address of the AI agent
     * @param maxPerTx Maximum CRO allowed per transaction
     * @param dailyLimit Maximum CRO allowed per day
     * @param durationSeconds How long the permission lasts (0 = forever)
     */
    function grantPermission(
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        uint256 durationSeconds
    ) external onlyOwner {
        require(agent != address(0), "Invalid agent");
        require(maxPerTx > 0, "maxPerTx must be > 0");
        require(dailyLimit >= maxPerTx, "dailyLimit must be >= maxPerTx");

        uint256 expiry = durationSeconds > 0 ? block.timestamp + durationSeconds : 0;

        permissions[agent] = SpendPermission({
            active: true,
            maxPerTx: maxPerTx,
            dailyLimit: dailyLimit,
            spentToday: 0,
            lastResetTime: block.timestamp,
            totalSpent: permissions[agent].totalSpent, // Preserve history
            txCount: permissions[agent].txCount,
            expiry: expiry
        });

        if (!isAgent[agent]) {
            agents.push(agent);
            isAgent[agent] = true;
        }

        emit PermissionGranted(agent, maxPerTx, dailyLimit, expiry);
    }

    /**
     * @notice Revoke an agent's permission
     */
    function revokePermission(address agent) external onlyOwner {
        permissions[agent].active = false;
        emit PermissionRevoked(agent);
    }

    /**
     * @notice Add allowed recipient for an agent
     */
    function addAllowedRecipient(address agent, address recipient) external onlyOwner {
        require(isAgent[agent], "Not an agent");
        allowedRecipients[agent][recipient] = true;
        hasAllowlist[agent] = true;
        emit RecipientAllowed(agent, recipient);
    }

    /**
     * @notice Remove allowed recipient
     */
    function removeAllowedRecipient(address agent, address recipient) external onlyOwner {
        allowedRecipients[agent][recipient] = false;
        emit RecipientRemoved(agent, recipient);
    }

    /**
     * @notice Owner withdraws funds
     */
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(amount <= address(this).balance, "Insufficient balance");

        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");

        emit OwnerWithdraw(to, amount);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    // ============ Agent Functions ============

    /**
     * @notice Agent executes a spend transaction
     * @param to Recipient address
     * @param amount Amount of CRO to send
     * @param data Optional calldata for contract calls
     */
    function agentExecute(
        address to,
        uint256 amount,
        bytes calldata data
    ) external onlyActiveAgent nonReentrant returns (bool success, bytes memory result) {
        SpendPermission storage perm = permissions[msg.sender];

        // Reset daily limit if new day
        if (block.timestamp >= perm.lastResetTime + 1 days) {
            perm.spentToday = 0;
            perm.lastResetTime = block.timestamp;
        }

        // Check limits
        require(amount <= perm.maxPerTx, "Exceeds per-tx limit");
        require(perm.spentToday + amount <= perm.dailyLimit, "Exceeds daily limit");
        require(amount <= address(this).balance, "Insufficient wallet balance");

        // Check allowlist if enabled
        if (hasAllowlist[msg.sender]) {
            require(allowedRecipients[msg.sender][to], "Recipient not allowed");
        }

        // Update state before external call
        perm.spentToday += amount;
        perm.totalSpent += amount;
        perm.txCount += 1;

        uint256 dailyRemaining = perm.dailyLimit - perm.spentToday;

        // Execute transaction
        (success, result) = to.call{value: amount}(data);
        require(success, "Transaction failed");

        emit AgentSpend(msg.sender, to, amount, data, dailyRemaining);

        return (success, result);
    }

    /**
     * @notice Agent executes multiple transactions atomically
     */
    function agentExecuteBatch(
        address[] calldata targets,
        uint256[] calldata amounts,
        bytes[] calldata datas
    ) external onlyActiveAgent nonReentrant returns (bool[] memory successes) {
        require(targets.length == amounts.length && amounts.length == datas.length, "Length mismatch");

        SpendPermission storage perm = permissions[msg.sender];

        // Reset daily limit if new day
        if (block.timestamp >= perm.lastResetTime + 1 days) {
            perm.spentToday = 0;
            perm.lastResetTime = block.timestamp;
        }

        // Calculate total amount
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] <= perm.maxPerTx, "Single tx exceeds per-tx limit");
            totalAmount += amounts[i];
        }

        require(perm.spentToday + totalAmount <= perm.dailyLimit, "Exceeds daily limit");
        require(totalAmount <= address(this).balance, "Insufficient wallet balance");

        successes = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            if (hasAllowlist[msg.sender]) {
                require(allowedRecipients[msg.sender][targets[i]], "Recipient not allowed");
            }

            (bool success, ) = targets[i].call{value: amounts[i]}(datas[i]);
            require(success, "Batch tx failed");
            successes[i] = success;

            emit AgentSpend(msg.sender, targets[i], amounts[i], datas[i], 0);
        }

        perm.spentToday += totalAmount;
        perm.totalSpent += totalAmount;
        perm.txCount += targets.length;

        return successes;
    }

    // ============ View Functions ============

    /**
     * @notice Get agent's remaining daily allowance
     */
    function getRemainingDaily(address agent) external view returns (uint256) {
        SpendPermission storage perm = permissions[agent];
        if (!perm.active) return 0;
        if (perm.expiry > 0 && block.timestamp >= perm.expiry) return 0;

        // Check if should reset
        if (block.timestamp >= perm.lastResetTime + 1 days) {
            return perm.dailyLimit;
        }

        if (perm.spentToday >= perm.dailyLimit) return 0;
        return perm.dailyLimit - perm.spentToday;
    }

    /**
     * @notice Check if agent can spend amount
     */
    function canSpend(address agent, uint256 amount) external view returns (bool, string memory) {
        SpendPermission storage perm = permissions[agent];

        if (!perm.active) return (false, "Agent not active");
        if (perm.expiry > 0 && block.timestamp >= perm.expiry) return (false, "Permission expired");
        if (amount > perm.maxPerTx) return (false, "Exceeds per-tx limit");
        if (amount > address(this).balance) return (false, "Insufficient wallet balance");

        uint256 spentToday = perm.spentToday;
        if (block.timestamp >= perm.lastResetTime + 1 days) {
            spentToday = 0;
        }

        if (spentToday + amount > perm.dailyLimit) return (false, "Exceeds daily limit");

        return (true, "OK");
    }

    /**
     * @notice Get all agents
     */
    function getAgents() external view returns (address[] memory) {
        return agents;
    }

    /**
     * @notice Get agent stats
     */
    function getAgentStats(address agent) external view returns (
        bool active,
        uint256 maxPerTx,
        uint256 dailyLimit,
        uint256 spentToday,
        uint256 totalSpent,
        uint256 txCount,
        uint256 expiry,
        uint256 remainingDaily
    ) {
        SpendPermission storage perm = permissions[agent];

        uint256 currentSpentToday = perm.spentToday;
        if (block.timestamp >= perm.lastResetTime + 1 days) {
            currentSpentToday = 0;
        }

        uint256 remaining = 0;
        if (perm.active && (perm.expiry == 0 || block.timestamp < perm.expiry)) {
            remaining = perm.dailyLimit > currentSpentToday ? perm.dailyLimit - currentSpentToday : 0;
        }

        return (
            perm.active,
            perm.maxPerTx,
            perm.dailyLimit,
            currentSpentToday,
            perm.totalSpent,
            perm.txCount,
            perm.expiry,
            remaining
        );
    }

    // ============ Receive ============

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
}
