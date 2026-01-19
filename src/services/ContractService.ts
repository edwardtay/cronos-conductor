import { ethers, Contract, Signer, Provider } from "ethers";

// Contract ABIs (simplified for key functions)
const GATEWAY_ABI = [
  "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
  "function executePayment(bytes32 paymentId, bytes proof) external",
  "function cancelPayment(bytes32 paymentId) external",
  "function refundPayment(bytes32 paymentId) external",
  "function getPayment(bytes32 paymentId) external view returns (tuple(bytes32 id, address from, address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash, uint8 status))",
  "function getUserPayments(address user) external view returns (bytes32[])",
  "function setAuthorizedAgent(address agent, bool authorized) external",
  "event PaymentCreated(bytes32 indexed id, address indexed from, address indexed to, address token, uint256 amount, uint256 deadline)",
  "event PaymentExecuted(bytes32 indexed id, address indexed executor)",
];

const SETTLEMENT_ABI = [
  "function createBatch(bytes32[] paymentIds) external returns (bytes32)",
  "function executeBatch(bytes32 batchId) external",
  "function createRecurringSchedule(address to, address token, uint256 amount, uint256 interval, uint256 executionCount) external returns (bytes32)",
  "function executeRecurringPayment(bytes32 scheduleId) external",
  "function cancelRecurringSchedule(bytes32 scheduleId) external",
  "function createMultiLegTx(address[] froms, address[] tos, address[] tokens, uint256[] amounts) external returns (bytes32)",
  "function executeMultiLegTx(bytes32 txId, bytes[] proofs) external",
];

const ESCROW_ABI = [
  "function createEscrow(address beneficiary, address arbiter, address token, uint256 amount, uint256 releaseTime, bytes32 conditionHash) external payable returns (bytes32)",
  "function releaseEscrow(bytes32 escrowId, bytes proof) external",
  "function refundEscrow(bytes32 escrowId) external",
  "function disputeEscrow(bytes32 escrowId) external",
  "function createMilestoneEscrow(address beneficiary, address arbiter, address token, string[] descriptions, uint256[] amounts) external payable returns (bytes32)",
  "function completeMilestone(bytes32 escrowId, uint256 milestoneIndex) external",
  "function releaseMilestone(bytes32 escrowId, uint256 milestoneIndex) external",
  "function getEscrow(bytes32 escrowId) external view returns (tuple(bytes32 id, address depositor, address beneficiary, address arbiter, address token, uint256 amount, uint256 releaseTime, bytes32 conditionHash, uint8 status))",
];

export interface PaymentRequest {
  id: string;
  from: string;
  to: string;
  token: string;
  amount: bigint;
  deadline: bigint;
  conditionHash: string;
  status: number;
}

export interface ContractAddresses {
  gateway: string;
  settlement: string;
  escrow: string;
}

export class ContractService {
  private provider: Provider;
  private signer: Signer | null = null;
  private gateway: Contract;
  private settlement: Contract;
  private escrow: Contract;
  private addresses: ContractAddresses;

  constructor(provider: Provider, addresses: ContractAddresses) {
    this.provider = provider;
    this.addresses = addresses;
    this.gateway = new Contract(addresses.gateway, GATEWAY_ABI, provider);
    this.settlement = new Contract(addresses.settlement, SETTLEMENT_ABI, provider);
    this.escrow = new Contract(addresses.escrow, ESCROW_ABI, provider);
  }

  connect(signer: Signer): ContractService {
    this.signer = signer;
    this.gateway = this.gateway.connect(signer) as Contract;
    this.settlement = this.settlement.connect(signer) as Contract;
    this.escrow = this.escrow.connect(signer) as Contract;
    return this;
  }

  // ============ Payment Gateway ============

  async createPayment(
    to: string,
    token: string,
    amount: bigint,
    deadlineSeconds: number,
    conditionHash: string = ethers.ZeroHash
  ): Promise<{ txHash: string; paymentId: string }> {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    const value = token === ethers.ZeroAddress ? amount : 0n;

    const tx = await this.gateway.createPayment(to, token, amount, deadline, conditionHash, { value });
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: any) => {
      try {
        return this.gateway.interface.parseLog(log)?.name === "PaymentCreated";
      } catch {
        return false;
      }
    });

    const parsedEvent = this.gateway.interface.parseLog(event);
    return {
      txHash: receipt.hash,
      paymentId: parsedEvent?.args[0] || "",
    };
  }

  async executePayment(paymentId: string, proof: string = "0x"): Promise<string> {
    const tx = await this.gateway.executePayment(paymentId, proof);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async cancelPayment(paymentId: string): Promise<string> {
    const tx = await this.gateway.cancelPayment(paymentId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getPayment(paymentId: string): Promise<PaymentRequest> {
    return await this.gateway.getPayment(paymentId);
  }

  async getUserPayments(address: string): Promise<string[]> {
    return await this.gateway.getUserPayments(address);
  }

  // ============ Settlement Engine ============

  async createBatch(paymentIds: string[]): Promise<{ txHash: string; batchId: string }> {
    const tx = await this.settlement.createBatch(paymentIds);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, batchId: "" }; // Parse from events
  }

  async executeBatch(batchId: string): Promise<string> {
    const tx = await this.settlement.executeBatch(batchId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async createRecurringPayment(
    to: string,
    token: string,
    amount: bigint,
    intervalSeconds: number,
    executionCount: number = 0
  ): Promise<{ txHash: string; scheduleId: string }> {
    const tx = await this.settlement.createRecurringSchedule(to, token, amount, intervalSeconds, executionCount);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, scheduleId: "" };
  }

  async executeRecurring(scheduleId: string): Promise<string> {
    const tx = await this.settlement.executeRecurringPayment(scheduleId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async createMultiLegTransaction(
    legs: { from: string; to: string; token: string; amount: bigint }[]
  ): Promise<{ txHash: string; txId: string }> {
    const froms = legs.map((l) => l.from);
    const tos = legs.map((l) => l.to);
    const tokens = legs.map((l) => l.token);
    const amounts = legs.map((l) => l.amount);

    const tx = await this.settlement.createMultiLegTx(froms, tos, tokens, amounts);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, txId: "" };
  }

  // ============ Escrow Manager ============

  async createEscrow(
    beneficiary: string,
    arbiter: string,
    token: string,
    amount: bigint,
    releaseTimeSeconds: number,
    conditionHash: string = ethers.ZeroHash
  ): Promise<{ txHash: string; escrowId: string }> {
    const releaseTime = BigInt(Math.floor(Date.now() / 1000) + releaseTimeSeconds);
    const value = token === ethers.ZeroAddress ? amount : 0n;

    const tx = await this.escrow.createEscrow(beneficiary, arbiter, token, amount, releaseTime, conditionHash, {
      value,
    });
    const receipt = await tx.wait();
    return { txHash: receipt.hash, escrowId: "" };
  }

  async releaseEscrow(escrowId: string, proof: string = "0x"): Promise<string> {
    const tx = await this.escrow.releaseEscrow(escrowId, proof);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async createMilestoneEscrow(
    beneficiary: string,
    arbiter: string,
    token: string,
    milestones: { description: string; amount: bigint }[]
  ): Promise<{ txHash: string; escrowId: string }> {
    const descriptions = milestones.map((m) => m.description);
    const amounts = milestones.map((m) => m.amount);
    const totalAmount = amounts.reduce((a, b) => a + b, 0n);
    const value = token === ethers.ZeroAddress ? totalAmount : 0n;

    const tx = await this.escrow.createMilestoneEscrow(beneficiary, arbiter, token, descriptions, amounts, { value });
    const receipt = await tx.wait();
    return { txHash: receipt.hash, escrowId: "" };
  }

  async completeMilestone(escrowId: string, index: number): Promise<string> {
    const tx = await this.escrow.completeMilestone(escrowId, index);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async releaseMilestone(escrowId: string, index: number): Promise<string> {
    const tx = await this.escrow.releaseMilestone(escrowId, index);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ============ Utilities ============

  getAddresses(): ContractAddresses {
    return this.addresses;
  }

  getProvider(): Provider {
    return this.provider;
  }
}
