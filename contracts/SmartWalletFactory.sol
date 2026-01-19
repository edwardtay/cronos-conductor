// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SmartWallet
 * @dev Minimal smart wallet with owner signature verification
 */
contract SmartWallet {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public owner;
    uint256 public nonce;

    event Executed(address indexed target, uint256 value, bytes data, uint256 nonce);

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {}

    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata signature
    ) external returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(address(this), to, value, data, nonce, block.chainid));
        bytes32 ethHash = hash.toEthSignedMessageHash();
        address signer = ethHash.recover(signature);
        require(signer == owner, "Invalid signature");

        nonce++;
        (bool success, bytes memory result) = to.call{value: value}(data);
        require(success, "Execution failed");

        emit Executed(to, value, data, nonce - 1);
        return result;
    }

    function executeFromOwner(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "Only owner");
        (bool success, bytes memory result) = to.call{value: value}(data);
        require(success, "Execution failed");
        emit Executed(to, value, data, nonce);
        return result;
    }
}

/**
 * @title SmartWalletFactory
 * @dev Factory for deploying minimal smart wallets with CREATE2
 */
contract SmartWalletFactory {
    event WalletCreated(address indexed wallet, address indexed owner);

    /**
     * @dev Deploy a new wallet (or return existing)
     */
    function createWallet(address owner) external returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(owner));
        address addr = getWalletAddress(owner);

        uint256 codeSize;
        assembly { codeSize := extcodesize(addr) }
        if (codeSize > 0) return addr;

        SmartWallet wallet = new SmartWallet{salt: salt}(owner);
        emit WalletCreated(address(wallet), owner);
        return address(wallet);
    }

    /**
     * @dev Compute counterfactual wallet address
     */
    function getWalletAddress(address owner) public view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(owner));
        bytes memory bytecode = abi.encodePacked(
            type(SmartWallet).creationCode,
            abi.encode(owner)
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
