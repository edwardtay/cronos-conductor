/**
 * ERC-4337 Account Abstraction Service
 * Enables gasless transactions, batched operations, and smart account features
 */

import { ethers } from "ethers";

// UserOperation struct as per ERC-4337
export interface UserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: string;
  signature: string;
}

// Packed UserOperation for v0.7
export interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string; // packed callGasLimit and verificationGasLimit
  preVerificationGas: bigint;
  gasFees: string; // packed maxPriorityFeePerGas and maxFeePerGas
  paymasterAndData: string;
  signature: string;
}

// Entry Point ABI (simplified for key functions)
const ENTRYPOINT_ABI = [
  "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external",
  "function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) op) external view returns (bytes32)",
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function depositTo(address account) external payable",
];

// Simple Account ABI
const SIMPLE_ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func) external",
  "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
  "function owner() external view returns (address)",
];

// Account Factory ABI
const ACCOUNT_FACTORY_ABI = [
  "function createAccount(address owner, uint256 salt) external returns (address)",
  "function getAddress(address owner, uint256 salt) external view returns (address)",
];

// Known addresses on Cronos Testnet
const CRONOS_TESTNET_CONFIG = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // ERC-4337 v0.7 EntryPoint
  simpleAccountFactory: "", // Deploy or use existing
  paymaster: "", // Optional: gasless paymaster
};

export class ERC4337Service {
  private provider: ethers.Provider;
  private entryPoint: ethers.Contract;
  private chainId: bigint;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    this.entryPoint = new ethers.Contract(
      CRONOS_TESTNET_CONFIG.entryPoint,
      ENTRYPOINT_ABI,
      provider
    );
    this.chainId = 338n; // Cronos Testnet
  }

  /**
   * Build a UserOperation for an x402 payment
   */
  async buildPaymentUserOp(params: {
    smartAccount: string;
    gatewayAddress: string;
    recipient: string;
    amount: bigint;
    deadline: number;
    conditionHash: string;
    signer: ethers.Wallet;
  }): Promise<PackedUserOperation> {
    const { smartAccount, gatewayAddress, recipient, amount, deadline, conditionHash, signer } = params;

    // Encode the payment call
    const gatewayInterface = new ethers.Interface([
      "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
    ]);

    const callData = this.encodeExecute(
      gatewayAddress,
      amount,
      gatewayInterface.encodeFunctionData("createPayment", [
        recipient,
        ethers.ZeroAddress, // Native CRO
        amount,
        deadline,
        conditionHash,
      ])
    );

    // Get nonce
    const nonce = await this.getNonce(smartAccount);

    // Estimate gas
    const feeData = await this.provider.getFeeData();

    const userOp: PackedUserOperation = {
      sender: smartAccount,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: this.packGasLimits(200000n, 100000n),
      preVerificationGas: 50000n,
      gasFees: this.packGasFees(
        feeData.maxPriorityFeePerGas || 1000000000n,
        feeData.maxFeePerGas || 5000000000n
      ),
      paymasterAndData: "0x", // No paymaster - user pays gas
      signature: "0x", // Will be signed below
    };

    // Sign the UserOperation
    const userOpHash = await this.getUserOpHash(userOp);
    const signature = await signer.signMessage(ethers.getBytes(userOpHash));
    userOp.signature = signature;

    return userOp;
  }

  /**
   * Build a batched UserOperation for multiple payments
   */
  async buildBatchPaymentUserOp(params: {
    smartAccount: string;
    gatewayAddress: string;
    payments: Array<{
      recipient: string;
      amount: bigint;
      deadline: number;
      conditionHash: string;
    }>;
    signer: ethers.Wallet;
  }): Promise<PackedUserOperation> {
    const { smartAccount, gatewayAddress, payments, signer } = params;

    const gatewayInterface = new ethers.Interface([
      "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
    ]);

    const destinations: string[] = [];
    const values: bigint[] = [];
    const calldatas: string[] = [];

    for (const payment of payments) {
      destinations.push(gatewayAddress);
      values.push(payment.amount);
      calldatas.push(
        gatewayInterface.encodeFunctionData("createPayment", [
          payment.recipient,
          ethers.ZeroAddress,
          payment.amount,
          payment.deadline,
          payment.conditionHash,
        ])
      );
    }

    const callData = this.encodeExecuteBatch(destinations, values, calldatas);
    const nonce = await this.getNonce(smartAccount);
    const feeData = await this.provider.getFeeData();

    const userOp: PackedUserOperation = {
      sender: smartAccount,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: this.packGasLimits(BigInt(200000 * payments.length), 100000n),
      preVerificationGas: 50000n,
      gasFees: this.packGasFees(
        feeData.maxPriorityFeePerGas || 1000000000n,
        feeData.maxFeePerGas || 5000000000n
      ),
      paymasterAndData: "0x",
      signature: "0x",
    };

    const userOpHash = await this.getUserOpHash(userOp);
    const signature = await signer.signMessage(ethers.getBytes(userOpHash));
    userOp.signature = signature;

    return userOp;
  }

  /**
   * Submit UserOperation to bundler
   */
  async submitUserOp(userOp: PackedUserOperation): Promise<string> {
    // In production, this would send to a bundler RPC
    // For now, we'll use the EntryPoint directly (requires ETH for gas)
    const signer = new ethers.Wallet(
      process.env.PRIVATE_KEY || "",
      this.provider
    );

    const entryPointWithSigner = this.entryPoint.connect(signer) as ethers.Contract;

    const tx = await entryPointWithSigner.handleOps(
      [userOp],
      await signer.getAddress()
    );

    return tx.hash;
  }

  /**
   * Get the counterfactual address for a smart account
   */
  async getSmartAccountAddress(owner: string, salt: bigint = 0n): Promise<string> {
    if (!CRONOS_TESTNET_CONFIG.simpleAccountFactory) {
      throw new Error("Account factory not deployed");
    }

    const factory = new ethers.Contract(
      CRONOS_TESTNET_CONFIG.simpleAccountFactory,
      ACCOUNT_FACTORY_ABI,
      this.provider
    );

    return await factory.getAddress(owner, salt);
  }

  /**
   * Get nonce for smart account
   */
  private async getNonce(sender: string): Promise<bigint> {
    try {
      return await this.entryPoint.getNonce(sender, 0);
    } catch {
      return 0n;
    }
  }

  /**
   * Calculate UserOp hash
   */
  private async getUserOpHash(userOp: PackedUserOperation): Promise<string> {
    const packed = ethers.solidityPackedKeccak256(
      ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        userOp.sender,
        userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
        ethers.keccak256(userOp.paymasterAndData),
      ]
    );

    return ethers.solidityPackedKeccak256(
      ["bytes32", "address", "uint256"],
      [packed, CRONOS_TESTNET_CONFIG.entryPoint, this.chainId]
    );
  }

  /**
   * Encode execute call for SimpleAccount
   */
  private encodeExecute(dest: string, value: bigint, data: string): string {
    const iface = new ethers.Interface(SIMPLE_ACCOUNT_ABI);
    return iface.encodeFunctionData("execute", [dest, value, data]);
  }

  /**
   * Encode batch execute call for SimpleAccount
   */
  private encodeExecuteBatch(dests: string[], values: bigint[], datas: string[]): string {
    const iface = new ethers.Interface(SIMPLE_ACCOUNT_ABI);
    return iface.encodeFunctionData("executeBatch", [dests, values, datas]);
  }

  /**
   * Pack gas limits into bytes32
   */
  private packGasLimits(callGasLimit: bigint, verificationGasLimit: bigint): string {
    return ethers.solidityPacked(
      ["uint128", "uint128"],
      [verificationGasLimit, callGasLimit]
    );
  }

  /**
   * Pack gas fees into bytes32
   */
  private packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): string {
    return ethers.solidityPacked(
      ["uint128", "uint128"],
      [maxPriorityFeePerGas, maxFeePerGas]
    );
  }
}

/**
 * Helper to create x402 payment with account abstraction
 */
export async function createAAPayment(params: {
  provider: ethers.Provider;
  smartAccount: string;
  gatewayAddress: string;
  recipient: string;
  amount: string;
  deadline: number;
  condition?: string;
  signer: ethers.Wallet;
}): Promise<{ userOpHash: string; txHash: string }> {
  const service = new ERC4337Service(params.provider);

  const conditionHash = params.condition
    ? ethers.keccak256(ethers.toUtf8Bytes(params.condition))
    : ethers.ZeroHash;

  const userOp = await service.buildPaymentUserOp({
    smartAccount: params.smartAccount,
    gatewayAddress: params.gatewayAddress,
    recipient: params.recipient,
    amount: ethers.parseEther(params.amount),
    deadline: params.deadline,
    conditionHash,
    signer: params.signer,
  });

  const txHash = await service.submitUserOp(userOp);
  const userOpHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes", "bytes"],
      [userOp.sender, userOp.nonce, userOp.initCode, userOp.callData]
    )
  );

  return { userOpHash, txHash };
}

export default ERC4337Service;
