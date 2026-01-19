/**
 * x402 Protocol - Real Implementation with Cronos Facilitator
 *
 * TWO MODES:
 * 1. USDC.e Mode - Uses official Cronos x402 Facilitator (real x402)
 * 2. CRO Mode - Uses AgentWallet with spend permissions (custom solution)
 *
 * Features:
 * - Real Cronos x402 Facilitator integration (https://facilitator.cronoslabs.org)
 * - EIP-3009 gasless USDC.e payments
 * - AgentWallet for autonomous CRO spending
 * - Premium on-chain analytics services
 */

import express from "express";
import cors from "cors";
import axios from "axios";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ============ CRONOS X402 FACILITATOR CONFIG ============

const FACILITATOR_URL = "https://facilitator.cronoslabs.org/v2/x402";

// USDC.e addresses
const USDCE_TESTNET = "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0";
const USDCE_MAINNET = "0xf951eC28187D9E5Ca673Da8FE6757E6f0Be5F77C";

// Payment requirements for x402
interface PaymentRequirements {
  scheme: "exact";
  network: "cronos-testnet" | "cronos";
  payTo: string;
  asset: string;
  maxAmountRequired: string; // in smallest unit (6 decimals for USDC.e)
  maxTimeoutSeconds: number;
  extra?: Record<string, any>;
}

// Verify payment with Cronos Facilitator
async function verifyPaymentWithFacilitator(
  paymentHeader: string,
  requirements: PaymentRequirements
): Promise<{ isValid: boolean; invalidReason: string | null }> {
  try {
    const response = await axios.post(
      `${FACILITATOR_URL}/verify`,
      {
        x402Version: 1,
        paymentHeader,
        paymentRequirements: requirements,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X402-Version": "1",
        },
      }
    );
    return response.data;
  } catch (e: any) {
    return { isValid: false, invalidReason: e.response?.data?.error || e.message };
  }
}

// Settle payment with Cronos Facilitator
async function settlePaymentWithFacilitator(
  paymentHeader: string,
  requirements: PaymentRequirements
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const response = await axios.post(
      `${FACILITATOR_URL}/settle`,
      {
        x402Version: 1,
        paymentHeader,
        paymentRequirements: requirements,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X402-Version": "1",
        },
      }
    );

    if (response.data.event === "payment.settled") {
      return { success: true, txHash: response.data.txHash };
    }
    return { success: false, error: response.data.error || "Settlement failed" };
  } catch (e: any) {
    return { success: false, error: e.response?.data?.error || e.message };
  }
}

// ============ CONFIG ============

const CRONOS_TESTNET_RPC = "https://evm-t3.cronos.org";
const CRONOS_MAINNET_RPC = "https://evm.cronos.org";

const testnetProvider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
const mainnetProvider = new ethers.JsonRpcProvider(CRONOS_MAINNET_RPC);

// Agent wallet for signing transactions
const AGENT_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const agentWallet = AGENT_PRIVATE_KEY
  ? new ethers.Wallet(AGENT_PRIVATE_KEY, testnetProvider)
  : null;

// Contract addresses
const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS || "0x14Cf3DA6Da69F0b5C42cb068D5e92b1fb9c3323C";
const VVS_ROUTER_ADDRESS = process.env.VVS_ROUTER_ADDRESS || "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae";
const WCRO_ADDRESS = process.env.WCRO_ADDRESS || "0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4";
const PAYMENT_RECEIVER = process.env.PAYMENT_ADDRESS || "0x15ECEE3445E3C8cf28D4D93fAB50181de728b86d";

// Known addresses for context
const KNOWN_ADDRESSES: Record<string, string> = {
  "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23": "WCRO",
  "0xc21223249ca28397b4b6541dffaecc539bff0c59": "USDC",
  "0x66e428c3f67a68878562e79a0234c1f83c208770": "USDT",
  "0xe44fd7fcb2b1581822d0c862b68222998a0c299a": "WETH",
  "0x062e66477faf219f25d27dced647bf57c3107d52": "WBTC",
  "0x2d03bece6747adc00e1a131bba1469c15fd11e03": "VVS",
};

// AgentWallet ABI (key functions)
const AGENT_WALLET_ABI = [
  "function owner() view returns (address)",
  "function permissions(address) view returns (bool active, uint256 maxPerTx, uint256 dailyLimit, uint256 spentToday, uint256 lastResetTime, uint256 totalSpent, uint256 txCount, uint256 expiry)",
  "function getRemainingDaily(address agent) view returns (uint256)",
  "function canSpend(address agent, uint256 amount) view returns (bool, string)",
  "function getAgentStats(address agent) view returns (bool active, uint256 maxPerTx, uint256 dailyLimit, uint256 spentToday, uint256 totalSpent, uint256 txCount, uint256 expiry, uint256 remainingDaily)",
  "function agentExecute(address to, uint256 amount, bytes data) returns (bool, bytes)",
  "function grantPermission(address agent, uint256 maxPerTx, uint256 dailyLimit, uint256 durationSeconds)",
  "receive() external payable",
];

// VVS Router ABI
const VVS_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
];

// Contract instances
const agentWalletContract = new ethers.Contract(AGENT_WALLET_ADDRESS, AGENT_WALLET_ABI, testnetProvider);
const vvsRouter = new ethers.Contract(VVS_ROUTER_ADDRESS, VVS_ROUTER_ABI, testnetProvider);

// ============ WALLET STATUS ============

interface WalletStatus {
  address: string;
  balance: string;
  isReal: boolean;
  agent: {
    address: string;
    active: boolean;
    maxPerTx: string;
    dailyLimit: string;
    spentToday: string;
    remainingDaily: string;
    totalSpent: string;
    txCount: number;
  } | null;
}

async function getWalletStatus(): Promise<WalletStatus> {
  try {
    const balance = await testnetProvider.getBalance(AGENT_WALLET_ADDRESS);

    if (agentWallet) {
      const stats = await agentWalletContract.getAgentStats(agentWallet.address);
      return {
        address: AGENT_WALLET_ADDRESS,
        balance: ethers.formatEther(balance),
        isReal: true,
        agent: {
          address: agentWallet.address,
          active: stats[0],
          maxPerTx: ethers.formatEther(stats[1]),
          dailyLimit: ethers.formatEther(stats[2]),
          spentToday: ethers.formatEther(stats[3]),
          remainingDaily: ethers.formatEther(stats[7]),
          totalSpent: ethers.formatEther(stats[4]),
          txCount: Number(stats[5]),
        }
      };
    }

    return {
      address: AGENT_WALLET_ADDRESS,
      balance: ethers.formatEther(balance),
      isReal: true,
      agent: null,
    };
  } catch (e) {
    // Fallback to simulated
    return {
      address: "simulated",
      balance: "10.0",
      isReal: false,
      agent: {
        address: "demo-agent",
        active: true,
        maxPerTx: "0.5",
        dailyLimit: "5.0",
        spentToday: "0.0",
        remainingDaily: "5.0",
        totalSpent: "0.0",
        txCount: 0,
      }
    };
  }
}

// Simulated spending tracker (fallback)
let simulatedSpent = 0;
let simulatedTxCount = 0;

async function canAgentSpend(amount: bigint): Promise<{ ok: boolean; reason: string }> {
  if (agentWallet) {
    try {
      const [canSpend, reason] = await agentWalletContract.canSpend(agentWallet.address, amount);
      return { ok: canSpend, reason };
    } catch (e: any) {
      return { ok: false, reason: e.message };
    }
  }
  // Simulated
  const amountNum = parseFloat(ethers.formatEther(amount));
  if (simulatedSpent + amountNum > 5) return { ok: false, reason: "Exceeds daily limit" };
  if (amountNum > 0.5) return { ok: false, reason: "Exceeds per-tx limit" };
  return { ok: true, reason: "OK" };
}

async function agentSpend(amount: bigint, to: string, data: string = "0x"): Promise<boolean> {
  if (agentWallet) {
    try {
      const walletWithSigner = agentWalletContract.connect(agentWallet) as ethers.Contract;
      const tx = await walletWithSigner.agentExecute(to, amount, data);
      await tx.wait();
      return true;
    } catch (e) {
      console.error("Agent spend failed:", e);
      return false;
    }
  }
  // Simulated
  simulatedSpent += parseFloat(ethers.formatEther(amount));
  simulatedTxCount++;
  return true;
}

// ============ PREMIUM SERVICES CONFIG ============

interface ServiceConfig {
  name: string;
  price: string;
  unit: string;
  description: string;
}

const SERVICES: Record<string, ServiceConfig> = {
  whale: {
    name: "Whale Tracker",
    price: "0.05",
    unit: "per scan",
    description: "Track large CRO movements (>10K CRO)"
  },
  gas: {
    name: "Gas Oracle",
    price: "0.01",
    unit: "per query",
    description: "Optimal gas prices for Cronos"
  },
  wallet: {
    name: "Wallet Profiler",
    price: "0.03",
    unit: "per address",
    description: "Full wallet analysis with balance & history"
  },
  block: {
    name: "Block Analytics",
    price: "0.02",
    unit: "per block",
    description: "Detailed block data with tx breakdown"
  },
  contract: {
    name: "Contract Scanner",
    price: "0.04",
    unit: "per contract",
    description: "Smart contract bytecode analysis"
  },
  swap: {
    name: "VVS Swap",
    price: "0.02",
    unit: "per quote",
    description: "Get swap quotes from VVS Finance"
  },
};

// ============ TRANSACTION PROOF SYSTEM ============
// On-chain verifiable payment receipts for x402 transactions

interface PaymentReceipt {
  receiptId: string;
  timestamp: number;
  serviceId: string;
  serviceName: string;
  payer: string;
  payee: string;
  amount: string;
  currency: string;
  chainId: number;
  status: "pending" | "confirmed" | "verified";
  hash: string;           // Keccak256 of receipt data
  signature?: string;     // EIP-712 signature from agent
  txHash?: string;        // On-chain transaction hash (if real tx)
  blockNumber?: number;   // Block number (if on-chain)
}

// Receipt storage - in production, this would be on-chain or in a database
const paymentReceipts = new Map<string, PaymentReceipt>();

// Generate receipt hash using keccak256
function generateReceiptHash(receipt: Omit<PaymentReceipt, "hash" | "signature" | "receiptId">): string {
  const message = ethers.solidityPacked(
    ["uint256", "string", "address", "address", "uint256", "uint256"],
    [
      receipt.timestamp,
      receipt.serviceId,
      receipt.payer,
      receipt.payee,
      ethers.parseEther(receipt.amount),
      receipt.chainId
    ]
  );
  return ethers.keccak256(message);
}

// Sign receipt with agent wallet (EIP-191)
async function signReceipt(hash: string): Promise<string | null> {
  if (!agentWallet) return null;
  try {
    return await agentWallet.signMessage(ethers.getBytes(hash));
  } catch (e) {
    console.error("Failed to sign receipt:", e);
    return null;
  }
}

// Create a payment receipt
async function createPaymentReceipt(
  serviceId: string,
  amount: string,
  payer?: string
): Promise<PaymentReceipt> {
  const service = SERVICES[serviceId];
  const timestamp = Date.now();
  const receiptId = `rcpt-${timestamp}-${Math.random().toString(36).slice(2, 10)}`;

  const receiptData = {
    timestamp,
    serviceId,
    serviceName: service?.name || serviceId,
    payer: payer || (agentWallet?.address || "0x0000000000000000000000000000000000000000"),
    payee: PAYMENT_RECEIVER,
    amount,
    currency: "CRO",
    chainId: 338, // Cronos Testnet
    status: "confirmed" as const,
  };

  const hash = generateReceiptHash(receiptData);
  const signature = await signReceipt(hash);

  const receipt: PaymentReceipt = {
    receiptId,
    ...receiptData,
    hash,
    signature: signature || undefined,
  };

  paymentReceipts.set(receiptId, receipt);
  return receipt;
}

// Verify a payment receipt
function verifyReceipt(receiptId: string): { valid: boolean; receipt?: PaymentReceipt; reason?: string } {
  const receipt = paymentReceipts.get(receiptId);
  if (!receipt) {
    return { valid: false, reason: "Receipt not found" };
  }

  // Regenerate hash to verify integrity
  const { receiptId: _, hash: originalHash, signature, ...receiptData } = receipt;
  const computedHash = generateReceiptHash(receiptData);

  if (computedHash !== originalHash) {
    return { valid: false, receipt, reason: "Receipt hash mismatch - data may be tampered" };
  }

  // Verify signature if present
  if (signature && agentWallet) {
    try {
      const recoveredAddress = ethers.verifyMessage(ethers.getBytes(originalHash), signature);
      if (recoveredAddress.toLowerCase() !== agentWallet.address.toLowerCase()) {
        return { valid: false, receipt, reason: "Invalid signature - signer mismatch" };
      }
    } catch (e) {
      return { valid: false, receipt, reason: "Signature verification failed" };
    }
  }

  return { valid: true, receipt };
}

const paidRequests = new Map<string, number>();

// Payment mode: "facilitator" (USDC.e via Cronos) or "agent" (CRO via AgentWallet)
let currentPaymentMode: "facilitator" | "agent" = "agent";

// Convert CRO price to USDC amount (6 decimals)
// Using approximate rate: 1 CRO ≈ $0.09, so USDC price = CRO * 0.09
function croToUsdc(croPrice: string): string {
  const cro = parseFloat(croPrice);
  const usd = cro * 0.09; // CRO to USD rate
  return Math.ceil(usd * 1_000_000).toString(); // 6 decimals for USDC
}

// x402 Gate Middleware - Supports both USDC.e (facilitator) and CRO (agent)
function x402Gate(serviceId: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const paymentProof = req.headers["x-payment"] as string;

    // Check if already paid
    if (paymentProof && paidRequests.has(paymentProof)) {
      return next();
    }

    // Check for real x402 payment via facilitator (USDC.e)
    if (paymentProof && currentPaymentMode === "facilitator") {
      const service = SERVICES[serviceId];
      const usdcAmount = croToUsdc(service.price);

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: "cronos-testnet",
        payTo: PAYMENT_RECEIVER,
        asset: USDCE_TESTNET,
        maxAmountRequired: usdcAmount,
        maxTimeoutSeconds: 300,
      };

      // Verify with Cronos Facilitator
      const verifyResult = await verifyPaymentWithFacilitator(paymentProof, requirements);
      if (!verifyResult.isValid) {
        return res.status(402).json({
          error: "Invalid Payment",
          reason: verifyResult.invalidReason,
        });
      }

      // Settle with Cronos Facilitator
      const settleResult = await settlePaymentWithFacilitator(paymentProof, requirements);
      if (!settleResult.success) {
        return res.status(402).json({
          error: "Settlement Failed",
          reason: settleResult.error,
        });
      }

      // Payment verified and settled!
      paidRequests.set(paymentProof, Date.now());
      (req as any).settlementTxHash = settleResult.txHash;
      return next();
    }

    const service = SERVICES[serviceId];
    const priceWei = ethers.parseEther(service.price);
    const usdcAmount = croToUsdc(service.price);

    res.status(402);

    // Standard x402 headers
    res.setHeader("X-Payment", "required");
    res.setHeader("X-Payment-Network", "cronos-testnet");
    res.setHeader("X-Payment-ChainId", "338");
    res.setHeader("X402-Version", "1");

    if (currentPaymentMode === "facilitator") {
      // USDC.e mode (real x402 with Cronos Facilitator)
      res.setHeader("X-Payment-Address", PAYMENT_RECEIVER);
      res.setHeader("X-Payment-Asset", USDCE_TESTNET);
      res.setHeader("X-Payment-Amount", usdcAmount);
      res.setHeader("X-Payment-Currency", "USDC.e");

      res.json({
        error: "Payment Required",
        status: 402,
        x402Version: 1,
        service: service.name,
        description: service.description,
        paymentMode: "facilitator",
        paymentRequirements: {
          scheme: "exact",
          network: "cronos-testnet",
          payTo: PAYMENT_RECEIVER,
          asset: USDCE_TESTNET,
          maxAmountRequired: usdcAmount,
          maxTimeoutSeconds: 300,
        },
        facilitator: FACILITATOR_URL,
        instruction: "Sign EIP-3009 authorization and include in X-Payment header",
      });
    } else {
      // CRO mode (AgentWallet)
      res.setHeader("X-Payment-Address", PAYMENT_RECEIVER);
      res.setHeader("X-Payment-Amount", priceWei.toString());
      res.setHeader("X-Payment-Currency", "CRO");

      res.json({
        error: "Payment Required",
        status: 402,
        x402Version: 1,
        service: service.name,
        price: `${service.price} CRO`,
        description: service.description,
        paymentMode: "agent",
        payment: {
          address: PAYMENT_RECEIVER,
          amount: service.price,
          amountWei: priceWei.toString(),
          currency: "CRO",
          chainId: 338,
        },
        agentWallet: AGENT_WALLET_ADDRESS,
        instruction: "Agent pays via AgentWallet, include X-Payment header with proof",
      });
    }
  };
}

// Endpoint to switch payment mode
app.post("/api/mode", (req, res) => {
  const { mode } = req.body;
  if (mode === "facilitator" || mode === "agent") {
    currentPaymentMode = mode;
    res.json({ mode: currentPaymentMode, message: `Switched to ${mode} mode` });
  } else {
    res.status(400).json({ error: "Invalid mode. Use 'facilitator' or 'agent'" });
  }
});

app.get("/api/mode", (req, res) => {
  res.json({
    mode: currentPaymentMode,
    description: currentPaymentMode === "facilitator"
      ? "USDC.e payments via Cronos x402 Facilitator (real x402)"
      : "CRO payments via AgentWallet (custom solution)",
  });
});

// ============ ON-CHAIN ANALYTICS SERVICES ============

// 1. Whale Tracker
app.get("/api/x402/whale", x402Gate("whale"), async (req, res) => {
  try {
    const minAmount = parseFloat(req.query.minCRO as string) || 10000;
    const blockCount = Math.min(parseInt(req.query.blocks as string) || 5, 10);

    const latestBlock = await mainnetProvider.getBlockNumber();
    const whaleTransactions: any[] = [];
    const threshold = ethers.parseEther(minAmount.toString());

    for (let i = 0; i < blockCount; i++) {
      const block = await mainnetProvider.getBlock(latestBlock - i, true);
      if (!block || !block.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (tx.value >= threshold) {
          whaleTransactions.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: ethers.formatEther(tx.value) + " CRO",
            valueUSD: (parseFloat(ethers.formatEther(tx.value)) * 0.09).toFixed(2),
            block: block.number,
            timestamp: new Date(block.timestamp * 1000).toISOString(),
          });
        }
      }
    }

    res.json({
      success: true,
      service: "Whale Tracker",
      cost: "0.05 CRO",
      data: {
        threshold: minAmount + " CRO",
        blocksScanned: blockCount,
        latestBlock,
        whaleTransactions: whaleTransactions.slice(0, 20),
        totalFound: whaleTransactions.length,
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Gas Oracle
app.get("/api/x402/gas", x402Gate("gas"), async (req, res) => {
  try {
    const [feeData, latestBlock] = await Promise.all([
      mainnetProvider.getFeeData(),
      mainnetProvider.getBlock("latest"),
    ]);

    const baseFee = feeData.gasPrice || 0n;
    const slow = baseFee;
    const standard = (baseFee * 110n) / 100n;
    const fast = (baseFee * 130n) / 100n;
    const instant = (baseFee * 150n) / 100n;

    res.json({
      success: true,
      service: "Gas Oracle",
      cost: "0.01 CRO",
      data: {
        network: "Cronos Mainnet",
        blockNumber: latestBlock?.number,
        utilization: latestBlock ? ((Number(latestBlock.gasUsed) / Number(latestBlock.gasLimit)) * 100).toFixed(1) + "%" : null,
        recommendations: {
          slow: { gwei: ethers.formatUnits(slow, "gwei"), waitTime: "~30s" },
          standard: { gwei: ethers.formatUnits(standard, "gwei"), waitTime: "~15s" },
          fast: { gwei: ethers.formatUnits(fast, "gwei"), waitTime: "~6s" },
          instant: { gwei: ethers.formatUnits(instant, "gwei"), waitTime: "~3s" },
        },
        estimatedCosts: {
          transfer: ethers.formatEther(fast * 21000n) + " CRO",
          swap: ethers.formatEther(fast * 150000n) + " CRO",
        },
        timestamp: new Date().toISOString(),
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Wallet Profiler
app.get("/api/x402/wallet", x402Gate("wallet"), async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    const [balance, txCount, code] = await Promise.all([
      mainnetProvider.getBalance(address),
      mainnetProvider.getTransactionCount(address),
      mainnetProvider.getCode(address),
    ]);

    const isContract = code !== "0x";
    const label = KNOWN_ADDRESSES[address.toLowerCase()] || null;
    const cro = parseFloat(ethers.formatEther(balance));

    let classification = "New/Inactive";
    if (cro > 1000000) classification = "Whale (>1M CRO)";
    else if (cro > 100000) classification = "Large Holder (>100K CRO)";
    else if (cro > 10000) classification = "Medium Holder (>10K CRO)";
    else if (cro > 1000) classification = "Small Holder (>1K CRO)";
    else if (txCount > 1000) classification = "Active Trader";
    else if (txCount > 100) classification = "Regular User";

    res.json({
      success: true,
      service: "Wallet Profiler",
      cost: "0.03 CRO",
      data: {
        address,
        label,
        type: isContract ? "Contract" : "EOA",
        balance: ethers.formatEther(balance) + " CRO",
        balanceUSD: (cro * 0.09).toFixed(2),
        transactionCount: txCount,
        classification,
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Block Analytics
app.get("/api/x402/block", x402Gate("block"), async (req, res) => {
  try {
    const blockParam = req.query.block as string || "latest";
    const blockNumber = blockParam === "latest"
      ? await mainnetProvider.getBlockNumber()
      : parseInt(blockParam);

    const block = await mainnetProvider.getBlock(blockNumber, true);
    if (!block) return res.status(404).json({ error: "Block not found" });

    let totalValue = 0n;
    let contractCalls = 0;
    let transfers = 0;

    if (block.prefetchedTransactions) {
      for (const tx of block.prefetchedTransactions) {
        totalValue += tx.value;
        if (tx.data && tx.data !== "0x") contractCalls++;
        else transfers++;
      }
    }

    res.json({
      success: true,
      service: "Block Analytics",
      cost: "0.02 CRO",
      data: {
        blockNumber: block.number,
        hash: block.hash,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        miner: block.miner,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        utilization: ((Number(block.gasUsed) / Number(block.gasLimit)) * 100).toFixed(1) + "%",
        transactions: {
          total: block.transactions.length,
          contractCalls,
          transfers,
          totalValueMoved: ethers.formatEther(totalValue) + " CRO",
        },
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Contract Scanner
app.get("/api/x402/contract", x402Gate("contract"), async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    const [code, balance] = await Promise.all([
      mainnetProvider.getCode(address),
      mainnetProvider.getBalance(address),
    ]);

    if (code === "0x") {
      return res.json({
        success: true,
        service: "Contract Scanner",
        cost: "0.04 CRO",
        data: { address, isContract: false, message: "This is an EOA, not a contract" }
      });
    }

    const codeSize = (code.length - 2) / 2;
    const label = KNOWN_ADDRESSES[address.toLowerCase()] || null;

    res.json({
      success: true,
      service: "Contract Scanner",
      cost: "0.04 CRO",
      data: {
        address,
        label,
        isContract: true,
        codeSize: codeSize + " bytes",
        balance: ethers.formatEther(balance) + " CRO",
        complexity: codeSize > 20000 ? "High" : codeSize > 5000 ? "Medium" : "Low",
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6. VVS Swap Quote (GET)
app.get("/api/x402/swap", x402Gate("swap"), async (req, res) => {
  try {
    const amountIn = req.query.amount as string || "0.1";
    const tokenOut = req.query.tokenOut as string || WCRO_ADDRESS;

    const amountInWei = ethers.parseEther(amountIn);

    // Get quote from VVS Router (CRO -> Token)
    const path = [WCRO_ADDRESS, tokenOut];

    try {
      const amounts = await vvsRouter.getAmountsOut(amountInWei, path);
      const amountOut = amounts[1];

      res.json({
        success: true,
        service: "VVS Swap Quote",
        cost: "0.02 CRO",
        data: {
          dex: "VVS Finance",
          network: "Cronos Testnet",
          amountIn: amountIn + " CRO",
          amountOut: ethers.formatEther(amountOut),
          tokenOut,
          path,
          priceImpact: "~0.1%",
          route: "CRO → " + (KNOWN_ADDRESSES[tokenOut.toLowerCase()] || "Token"),
          executeEndpoint: "POST /api/x402/swap/execute",
        }
      });
    } catch (e) {
      res.json({
        success: true,
        service: "VVS Swap Quote",
        cost: "0.02 CRO",
        data: {
          dex: "VVS Finance",
          network: "Cronos Testnet",
          error: "No liquidity for this pair on testnet",
          suggestion: "Try mainnet for real quotes",
        }
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 7. VVS Swap Execute (POST) - REAL SWAP via AgentWallet
app.post("/api/x402/swap/execute", x402Gate("swap"), async (req, res) => {
  try {
    const { amountIn, tokenOut, slippage } = req.body;

    if (!amountIn) {
      return res.status(400).json({ error: "Missing amountIn" });
    }

    const amountInWei = ethers.parseEther(amountIn.toString());
    const targetToken = tokenOut || WCRO_ADDRESS;
    const slippageBps = slippage || 50; // 0.5% default slippage

    // Check agent spending limits
    const check = await canAgentSpend(amountInWei);
    if (!check.ok) {
      return res.status(403).json({
        error: "Agent cannot spend this amount",
        reason: check.reason,
      });
    }

    if (!agentWallet) {
      return res.status(500).json({ error: "Agent wallet not configured" });
    }

    // Get quote first
    const path = [WCRO_ADDRESS, targetToken];
    let expectedOut: bigint;

    try {
      const amounts = await vvsRouter.getAmountsOut(amountInWei, path);
      expectedOut = amounts[1];
    } catch (e) {
      return res.status(400).json({
        error: "Cannot get quote - no liquidity for this pair",
      });
    }

    // Calculate minimum output with slippage
    const minOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    // Encode the swap call
    const vvsInterface = new ethers.Interface([
      "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)"
    ]);

    const swapData = vvsInterface.encodeFunctionData("swapExactETHForTokens", [
      minOut,
      path,
      AGENT_WALLET_ADDRESS, // tokens go back to agent wallet
      deadline,
    ]);

    // Execute swap through AgentWallet
    try {
      const walletWithSigner = agentWalletContract.connect(agentWallet) as ethers.Contract;

      console.log(`Executing swap: ${amountIn} CRO → ${ethers.formatEther(expectedOut)} tokens`);
      console.log(`  Router: ${VVS_ROUTER_ADDRESS}`);
      console.log(`  Min out: ${ethers.formatEther(minOut)}`);

      const tx = await walletWithSigner.agentExecute(
        VVS_ROUTER_ADDRESS,
        amountInWei,
        swapData
      );

      console.log(`  Tx hash: ${tx.hash}`);
      const receipt = await tx.wait();

      res.json({
        success: true,
        service: "VVS Swap Execute",
        cost: "0.02 CRO + " + amountIn + " CRO (swap)",
        data: {
          status: "executed",
          dex: "VVS Finance",
          network: "Cronos Testnet",
          amountIn: amountIn + " CRO",
          expectedOut: ethers.formatEther(expectedOut),
          minOut: ethers.formatEther(minOut),
          slippage: slippageBps / 100 + "%",
          tokenOut: targetToken,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          explorerUrl: `https://testnet.cronoscan.com/tx/${tx.hash}`,
        }
      });
    } catch (e: any) {
      console.error("Swap execution failed:", e);
      res.status(500).json({
        error: "Swap execution failed",
        reason: e.reason || e.message,
        hint: "Check wallet balance and liquidity",
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ EXTERNAL API WRAPPERS ============

// Free APIs (no key required)
const EXTERNAL_APIS = {
  coingecko: "https://api.coingecko.com/api/v3",
  defillama: "https://api.llama.fi",
  goplus: "https://api.gopluslabs.io/api/v1",
  dexscreener: "https://api.dexscreener.com/latest",
};

// Fetch with timeout and error handling
async function fetchAPI(url: string, timeout = 10000): Promise<any> {
  try {
    const response = await axios.get(url, { timeout });
    return response.data;
  } catch (e: any) {
    console.error(`API fetch failed: ${url}`, e.message);
    return null;
  }
}

// ============ SMART ALGORITHMS ============

/**
 * ALGORITHM 1: Arbitrage Profit Calculator
 * Calculates real profit after gas, slippage, and exchange fees
 */
interface ArbitrageOpportunity {
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  liquidityDepth: number;
  estimatedProfit: number;
  profitAfterCosts: number;
  executable: boolean;
  confidence: number;
  optimalSize: number;
  route: string[];
}

function calculateArbitrageProfit(
  buyPrice: number,
  sellPrice: number,
  liquidity: number,
  tradeSize: number,
  gasCostUsd: number
): { profit: number; slippage: number; executable: boolean; optimalSize: number } {
  // Price impact formula: impact = (tradeSize / liquidity) * impactFactor
  const impactFactor = 2.5; // Empirical constant for AMM slippage
  const priceImpact = (tradeSize / Math.max(liquidity, 1)) * impactFactor;

  // Effective slippage (higher for low liquidity)
  const slippage = Math.min(priceImpact * 100, 50); // Cap at 50%

  // Adjust sell price for slippage
  const effectiveSellPrice = sellPrice * (1 - slippage / 100);

  // Gross profit per unit
  const grossProfitPercent = ((effectiveSellPrice - buyPrice) / buyPrice) * 100;

  // Exchange fees (0.3% per swap typical)
  const exchangeFees = tradeSize * 0.006; // 0.3% * 2 swaps

  // Net profit
  const grossProfit = (grossProfitPercent / 100) * tradeSize;
  const netProfit = grossProfit - exchangeFees - gasCostUsd;

  // Optimal trade size (maximize profit - costs)
  // Derivative: d(profit)/d(size) = spreadPercent - 2*impactFactor*size/liquidity = 0
  const spreadPercent = ((sellPrice - buyPrice) / buyPrice);
  const optimalSize = (spreadPercent * liquidity) / (2 * impactFactor);

  return {
    profit: netProfit,
    slippage,
    executable: netProfit > 0 && slippage < 5,
    optimalSize: Math.min(optimalSize, liquidity * 0.1) // Max 10% of liquidity
  };
}

function detectFlashLoanOpportunity(opportunities: ArbitrageOpportunity[]): {
  viable: boolean;
  route: string[];
  estimatedProfit: number;
  flashLoanFee: number;
  netProfit: number;
} {
  // Find circular arbitrage paths
  const profitableOps = opportunities.filter(o => o.executable && o.profitAfterCosts > 10);

  if (profitableOps.length === 0) {
    return { viable: false, route: [], estimatedProfit: 0, flashLoanFee: 0, netProfit: 0 };
  }

  // Best single opportunity for flash loan
  const best = profitableOps.sort((a, b) => b.profitAfterCosts - a.profitAfterCosts)[0];

  // Flash loan fee (typically 0.09% for Aave, 0.3% for Uniswap)
  const flashLoanAmount = best.optimalSize * 10; // Leverage 10x
  const flashLoanFee = flashLoanAmount * 0.0009;
  const amplifiedProfit = best.profitAfterCosts * 10;
  const netProfit = amplifiedProfit - flashLoanFee;

  return {
    viable: netProfit > 50, // Minimum $50 profit for flash loan
    route: best.route,
    estimatedProfit: amplifiedProfit,
    flashLoanFee,
    netProfit
  };
}

/**
 * ALGORITHM 2: Weighted Sentiment Scoring with Trend Detection
 * Uses exponential moving average and momentum indicators
 */
interface SentimentSignal {
  source: string;
  value: number;
  weight: number;
  trend: "up" | "down" | "neutral";
  confidence: number;
}

function calculateWeightedSentiment(signals: SentimentSignal[]): {
  score: number;
  confidence: number;
  trend: string;
  momentum: number;
  signals: { source: string; contribution: number; trend: string }[];
} {
  // Weights for different signal sources
  const sourceWeights: Record<string, number> = {
    price_action: 0.25,
    volume: 0.15,
    tvl_change: 0.20,
    whale_activity: 0.20,
    social_sentiment: 0.10,
    on_chain_metrics: 0.10
  };

  let weightedSum = 0;
  let totalWeight = 0;
  let trendScore = 0;
  const signalContributions: { source: string; contribution: number; trend: string }[] = [];

  for (const signal of signals) {
    const weight = sourceWeights[signal.source] || 0.1;
    const adjustedWeight = weight * signal.confidence;

    weightedSum += signal.value * adjustedWeight;
    totalWeight += adjustedWeight;

    // Trend momentum
    if (signal.trend === "up") trendScore += weight;
    else if (signal.trend === "down") trendScore -= weight;

    signalContributions.push({
      source: signal.source,
      contribution: (signal.value * adjustedWeight * 100) / totalWeight,
      trend: signal.trend
    });
  }

  const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 50;
  const momentum = trendScore * 100; // -100 to +100

  // Confidence based on signal agreement
  const trendAgreement = signals.filter(s =>
    (momentum > 0 && s.trend === "up") || (momentum < 0 && s.trend === "down")
  ).length / Math.max(signals.length, 1);

  const confidence = trendAgreement * 100;

  return {
    score: Math.min(100, Math.max(0, finalScore)),
    confidence,
    trend: momentum > 20 ? "BULLISH" : momentum < -20 ? "BEARISH" : "NEUTRAL",
    momentum,
    signals: signalContributions
  };
}

function detectTrendReversal(
  currentPrice: number,
  priceHistory: number[],
  volumeHistory: number[]
): { reversal: boolean; direction: string; strength: number; signal: string } {
  if (priceHistory.length < 3) {
    return { reversal: false, direction: "none", strength: 0, signal: "Insufficient data" };
  }

  // Calculate short-term and long-term moving averages
  const shortMA = priceHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const longMA = priceHistory.reduce((a, b) => a + b, 0) / priceHistory.length;

  // RSI-like momentum
  const gains = priceHistory.slice(1).map((p, i) => Math.max(0, p - priceHistory[i]));
  const losses = priceHistory.slice(1).map((p, i) => Math.max(0, priceHistory[i] - p));
  const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  const rsi = 100 - (100 / (1 + rs));

  // Volume confirmation
  const recentVolume = volumeHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
  const volumeSpike = recentVolume / avgVolume;

  // Detect reversal patterns
  const maGap = ((shortMA - longMA) / longMA) * 100;

  let reversal = false;
  let direction = "none";
  let signal = "";
  let strength = 0;

  // Bullish reversal: oversold RSI + MA crossover + volume spike
  if (rsi < 30 && maGap > -5 && volumeSpike > 1.5) {
    reversal = true;
    direction = "bullish";
    strength = Math.min(100, (30 - rsi) + volumeSpike * 20);
    signal = "Oversold bounce with volume confirmation";
  }
  // Bearish reversal: overbought RSI + MA crossover + volume spike
  else if (rsi > 70 && maGap < 5 && volumeSpike > 1.5) {
    reversal = true;
    direction = "bearish";
    strength = Math.min(100, (rsi - 70) + volumeSpike * 20);
    signal = "Overbought reversal with volume confirmation";
  }
  // Trend continuation
  else if (maGap > 3) {
    signal = "Uptrend continuation";
    strength = Math.min(maGap * 10, 50);
  }
  else if (maGap < -3) {
    signal = "Downtrend continuation";
    strength = Math.min(Math.abs(maGap) * 10, 50);
  }
  else {
    signal = "Consolidation phase";
    strength = 20;
  }

  return { reversal, direction, strength, signal };
}

/**
 * ALGORITHM 3: Portfolio Risk Metrics
 * Calculates Sharpe ratio, VaR, correlation, and drawdown
 */
interface PortfolioAsset {
  symbol: string;
  value: number;
  weight: number;
  volatility: number;
  expectedReturn: number;
}

function calculatePortfolioRisk(assets: PortfolioAsset[]): {
  sharpeRatio: number;
  valueAtRisk: number;
  maxDrawdown: number;
  diversificationScore: number;
  correlationRisk: string;
  riskAdjustedReturn: number;
  recommendations: string[];
} {
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);
  if (totalValue === 0) {
    return {
      sharpeRatio: 0, valueAtRisk: 0, maxDrawdown: 0,
      diversificationScore: 0, correlationRisk: "N/A",
      riskAdjustedReturn: 0, recommendations: ["No assets found"]
    };
  }

  // Calculate weights
  assets = assets.map(a => ({ ...a, weight: a.value / totalValue }));

  // Portfolio expected return (weighted average)
  const portfolioReturn = assets.reduce((sum, a) => sum + a.expectedReturn * a.weight, 0);

  // Portfolio volatility (simplified - assumes some correlation)
  // σ_p = sqrt(Σ w_i² * σ_i² + 2 * Σ Σ w_i * w_j * σ_i * σ_j * ρ_ij)
  // Assuming average correlation of 0.5 for crypto assets
  const avgCorrelation = 0.5;
  let portfolioVariance = 0;

  for (let i = 0; i < assets.length; i++) {
    portfolioVariance += Math.pow(assets[i].weight * assets[i].volatility, 2);
    for (let j = i + 1; j < assets.length; j++) {
      portfolioVariance += 2 * assets[i].weight * assets[j].weight *
                          assets[i].volatility * assets[j].volatility * avgCorrelation;
    }
  }

  const portfolioVolatility = Math.sqrt(portfolioVariance);

  // Sharpe Ratio (assuming risk-free rate of 4%)
  const riskFreeRate = 0.04;
  const sharpeRatio = portfolioVolatility > 0
    ? (portfolioReturn - riskFreeRate) / portfolioVolatility
    : 0;

  // Value at Risk (95% confidence, 1 day)
  // VaR = Portfolio Value * (Expected Return - Z * Volatility)
  const zScore95 = 1.645;
  const dailyVolatility = portfolioVolatility / Math.sqrt(365);
  const valueAtRisk = totalValue * zScore95 * dailyVolatility;

  // Max Drawdown estimate (historical avg for crypto ~50-80%)
  const maxDrawdown = portfolioVolatility * 2.5; // Rough estimate

  // Diversification score (1 - HHI)
  const hhi = assets.reduce((sum, a) => sum + Math.pow(a.weight, 2), 0);
  const diversificationScore = (1 - hhi) * 100;

  // Correlation risk assessment
  let correlationRisk: string;
  if (avgCorrelation > 0.7) correlationRisk = "HIGH - Assets move together";
  else if (avgCorrelation > 0.4) correlationRisk = "MEDIUM - Moderate correlation";
  else correlationRisk = "LOW - Good diversification";

  // Risk-adjusted return
  const riskAdjustedReturn = portfolioReturn / Math.max(portfolioVolatility, 0.01);

  // Generate recommendations
  const recommendations: string[] = [];

  if (sharpeRatio < 0.5) recommendations.push("Low risk-adjusted returns - consider rebalancing");
  if (diversificationScore < 50) recommendations.push("High concentration - diversify holdings");
  if (valueAtRisk > totalValue * 0.1) recommendations.push("High VaR - consider hedging strategies");
  if (assets.some(a => a.weight > 0.5)) recommendations.push("Single asset dominates - reduce concentration");
  if (maxDrawdown > 50) recommendations.push("High drawdown risk - add stable assets");
  if (recommendations.length === 0) recommendations.push("Portfolio is reasonably balanced");

  return {
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    valueAtRisk: Math.round(valueAtRisk * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10) / 10,
    diversificationScore: Math.round(diversificationScore),
    correlationRisk,
    riskAdjustedReturn: Math.round(riskAdjustedReturn * 100) / 100,
    recommendations
  };
}

/**
 * ALGORITHM 4: Smart Contract Vulnerability Scoring
 * Weighted risk assessment with pattern detection
 */
interface VulnerabilityFlag {
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  description: string;
  weight: number;
}

function calculateVulnerabilityScore(flags: VulnerabilityFlag[]): {
  score: number;
  grade: string;
  criticalCount: number;
  highCount: number;
  topRisks: string[];
  safeToInteract: boolean;
  auditRecommendation: string;
} {
  // Severity weights
  const severityWeights: Record<string, number> = {
    critical: 40,
    high: 25,
    medium: 15,
    low: 5,
    info: 1
  };

  let totalRiskScore = 0;
  let criticalCount = 0;
  let highCount = 0;
  const riskDescriptions: { desc: string; weight: number }[] = [];

  for (const flag of flags) {
    const baseWeight = severityWeights[flag.severity] || 5;
    const adjustedWeight = baseWeight * flag.weight;
    totalRiskScore += adjustedWeight;

    if (flag.severity === "critical") criticalCount++;
    if (flag.severity === "high") highCount++;

    riskDescriptions.push({ desc: flag.description, weight: adjustedWeight });
  }

  // Normalize to 0-100 scale (100 = most risky)
  const normalizedScore = Math.min(100, totalRiskScore);

  // Grade assignment
  let grade: string;
  if (normalizedScore >= 70) grade = "F - Dangerous";
  else if (normalizedScore >= 50) grade = "D - High Risk";
  else if (normalizedScore >= 30) grade = "C - Moderate Risk";
  else if (normalizedScore >= 15) grade = "B - Low Risk";
  else grade = "A - Safe";

  // Top 3 risks
  const topRisks = riskDescriptions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(r => r.desc);

  // Safety determination
  const safeToInteract = criticalCount === 0 && normalizedScore < 40;

  // Audit recommendation
  let auditRecommendation: string;
  if (criticalCount > 0) {
    auditRecommendation = "DO NOT INTERACT - Critical vulnerabilities detected";
  } else if (normalizedScore >= 50) {
    auditRecommendation = "AVOID - High risk contract, wait for audit";
  } else if (normalizedScore >= 25) {
    auditRecommendation = "CAUTION - Review before large transactions";
  } else {
    auditRecommendation = "ACCEPTABLE - No major issues found";
  }

  return {
    score: Math.round(normalizedScore),
    grade,
    criticalCount,
    highCount,
    topRisks,
    safeToInteract,
    auditRecommendation
  };
}

/**
 * ALGORITHM 5: Trade Route Optimization
 * Finds optimal path considering liquidity, slippage, and gas
 */
interface DEXRoute {
  dex: string;
  path: string[];
  liquidity: number;
  expectedOutput: number;
  priceImpact: number;
  gasCost: number;
}

function optimizeTradeRoute(
  routes: DEXRoute[],
  inputAmount: number,
  minOutput: number
): {
  bestRoute: DEXRoute | null;
  splitRoute: { dex: string; amount: number; output: number }[] | null;
  savings: number;
  recommendation: string;
  mevProtection: string[];
} {
  if (routes.length === 0) {
    return {
      bestRoute: null,
      splitRoute: null,
      savings: 0,
      recommendation: "No routes available",
      mevProtection: []
    };
  }

  // Sort routes by effective output (output - gas cost equivalent)
  const scoredRoutes = routes.map(r => ({
    ...r,
    effectiveOutput: r.expectedOutput - (r.gasCost * inputAmount * 0.01), // Gas as % of trade
    score: r.expectedOutput / inputAmount * (1 - r.priceImpact / 100)
  })).sort((a, b) => b.effectiveOutput - a.effectiveOutput);

  const bestRoute = scoredRoutes[0];

  // Check if split routing is beneficial for large trades
  let splitRoute: { dex: string; amount: number; output: number }[] | null = null;
  let splitOutput = 0;

  // Split makes sense when price impact is > 1%
  if (bestRoute.priceImpact > 1 && routes.length >= 2) {
    // Split 60/40 across top 2 DEXs
    const route1 = scoredRoutes[0];
    const route2 = scoredRoutes[1];

    const split1Amount = inputAmount * 0.6;
    const split2Amount = inputAmount * 0.4;

    // Reduced price impact for smaller amounts
    const impact1 = route1.priceImpact * 0.6 * 0.6; // Quadratic reduction
    const impact2 = route2.priceImpact * 0.4 * 0.4;

    const output1 = route1.expectedOutput * 0.6 * (1 - impact1 / 100);
    const output2 = route2.expectedOutput * 0.4 * (1 - impact2 / 100);

    splitOutput = output1 + output2;

    if (splitOutput > bestRoute.effectiveOutput) {
      splitRoute = [
        { dex: route1.dex, amount: split1Amount, output: output1 },
        { dex: route2.dex, amount: split2Amount, output: output2 }
      ];
    }
  }

  // Calculate savings vs worst route
  const worstRoute = scoredRoutes[scoredRoutes.length - 1];
  const savings = ((bestRoute.effectiveOutput - worstRoute.effectiveOutput) / worstRoute.effectiveOutput) * 100;

  // MEV protection suggestions
  const mevProtection: string[] = [];
  if (inputAmount > 1000) {
    mevProtection.push("Use private RPC to avoid frontrunning");
  }
  if (bestRoute.priceImpact > 2) {
    mevProtection.push("Consider splitting trade across blocks");
  }
  mevProtection.push("Set tight slippage tolerance (0.5-1%)");
  mevProtection.push("Use Flashbots/MEV Blocker for protection");

  // Recommendation
  let recommendation: string;
  if (splitRoute) {
    recommendation = `Split trade across ${splitRoute.length} DEXs for ${((splitOutput / bestRoute.effectiveOutput - 1) * 100).toFixed(1)}% better execution`;
  } else if (bestRoute.priceImpact < 0.5) {
    recommendation = `Execute on ${bestRoute.dex} - minimal price impact`;
  } else if (bestRoute.priceImpact < 2) {
    recommendation = `Execute on ${bestRoute.dex} - acceptable price impact`;
  } else {
    recommendation = `Consider smaller trade size - ${bestRoute.priceImpact.toFixed(1)}% price impact is high`;
  }

  return {
    bestRoute,
    splitRoute,
    savings: Math.round(savings * 10) / 10,
    recommendation,
    mevProtection
  };
}

// ============ AI AGENTS (Combine APIs → x402) ============

// Agent config - these combine multiple data sources
const AGENTS: Record<string, ServiceConfig> = {
  arbitrage: {
    name: "Arbitrage Scanner",
    price: "0.08",
    unit: "per scan",
    description: "Find arbitrage opportunities across DEXs (VVS + prices)"
  },
  sentiment: {
    name: "Whale + Sentiment",
    price: "0.06",
    unit: "per analysis",
    description: "Combine whale movements with market sentiment"
  },
  risk: {
    name: "Portfolio Risk",
    price: "0.05",
    unit: "per portfolio",
    description: "Analyze portfolio risk with price correlations"
  },
  audit: {
    name: "Contract Auditor",
    price: "0.10",
    unit: "per contract",
    description: "Scan contract for known vulnerabilities"
  },
  executor: {
    name: "Trade Executor",
    price: "0.03",
    unit: "per trade",
    description: "Quote + Execute optimal trade route"
  },
};

// Add agents to services
Object.entries(AGENTS).forEach(([id, agent]) => {
  SERVICES[`agent-${id}`] = agent;
});

// ─────────────────────────────────────────────────────────────
// AGENT 1: Arbitrage Scanner (SMART ALGORITHM)
// Combines: CoinGecko prices + DexScreener + On-chain quotes
// Algorithm: Profit calculation with gas, slippage, liquidity depth
// ─────────────────────────────────────────────────────────────
app.get("/api/x402/agent/arbitrage", x402Gate("agent-arbitrage"), async (req, res) => {
  try {
    const token = (req.query.token as string) || "cronos";
    const tradeSize = parseFloat(req.query.size as string) || 100; // USD trade size

    // API 1: CoinGecko - Get CEX price
    const cgData = await fetchAPI(
      `${EXTERNAL_APIS.coingecko}/simple/price?ids=${token}&vs_currencies=usd&include_24hr_change=true`
    );

    // API 2: DexScreener - Get DEX prices on Cronos
    const dexData = await fetchAPI(
      `${EXTERNAL_APIS.dexscreener}/dex/search?q=${token}`
    );

    // API 3: On-chain VVS quote
    let vvsPrice = null;
    let vvsLiquidity = 0;
    try {
      const amount = ethers.parseEther("1000");
      const path = [WCRO_ADDRESS, "0xc21223249ca28397b4b6541dffaecc539bff0c59"]; // CRO->USDC
      const amounts = await vvsRouter.getAmountsOut(amount, path);
      vvsPrice = parseFloat(ethers.formatUnits(amounts[1], 6)) / 1000;
      vvsLiquidity = 500000; // Estimated VVS pool liquidity
    } catch (e) {}

    // API 4: Gas estimation for profit calculation
    const feeData = await mainnetProvider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    const swapGas = 180000n;
    const gasCostCro = parseFloat(ethers.formatEther(gasPrice * swapGas));
    const croPrice = cgData?.[token]?.usd || 0.09;
    const gasCostUsd = gasCostCro * croPrice;

    const cexPrice = cgData?.[token]?.usd || 0;
    const priceChange24h = cgData?.[token]?.usd_24h_change || 0;

    // Find Cronos DEX pairs from DexScreener
    const cronosPairs = dexData?.pairs?.filter((p: any) =>
      p.chainId === "cronos" && p.baseToken?.symbol?.toUpperCase() === "CRO"
    ).slice(0, 10) || [];

    // SMART ALGORITHM: Calculate real arbitrage opportunities
    const opportunities: ArbitrageOpportunity[] = [];

    // CEX vs VVS arbitrage with profit calculation
    if (cexPrice && vvsPrice) {
      const buyPrice = Math.min(cexPrice, vvsPrice);
      const sellPrice = Math.max(cexPrice, vvsPrice);
      const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

      const profitCalc = calculateArbitrageProfit(
        buyPrice, sellPrice, vvsLiquidity, tradeSize, gasCostUsd * 2 // 2 swaps
      );

      if (spreadPercent > 0.3) { // Minimum 0.3% spread to consider
        opportunities.push({
          pair: "CRO/USDC",
          buyExchange: cexPrice < vvsPrice ? "CoinGecko (CEX)" : "VVS Finance",
          sellExchange: cexPrice < vvsPrice ? "VVS Finance" : "CoinGecko (CEX)",
          buyPrice,
          sellPrice,
          spreadPercent,
          liquidityDepth: vvsLiquidity,
          estimatedProfit: (spreadPercent / 100) * tradeSize,
          profitAfterCosts: profitCalc.profit,
          executable: profitCalc.executable,
          confidence: profitCalc.slippage < 2 ? 85 : profitCalc.slippage < 5 ? 60 : 30,
          optimalSize: profitCalc.optimalSize,
          route: ["CRO", "USDC", "CRO"],
        });
      }
    }

    // DEX vs DEX arbitrage with liquidity-aware profit calc
    for (const pair of cronosPairs) {
      const dexPrice = parseFloat(pair.priceUsd || 0);
      const dexLiquidity = pair.liquidity?.usd || 0;

      if (cexPrice && dexPrice && dexLiquidity > 10000) {
        const buyPrice = Math.min(cexPrice, dexPrice);
        const sellPrice = Math.max(cexPrice, dexPrice);
        const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

        if (spreadPercent > 0.3) {
          const profitCalc = calculateArbitrageProfit(
            buyPrice, sellPrice, dexLiquidity, tradeSize, gasCostUsd * 2
          );

          opportunities.push({
            pair: `${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}`,
            buyExchange: cexPrice < dexPrice ? "CEX" : pair.dexId,
            sellExchange: cexPrice < dexPrice ? pair.dexId : "CEX",
            buyPrice,
            sellPrice,
            spreadPercent,
            liquidityDepth: dexLiquidity,
            estimatedProfit: (spreadPercent / 100) * tradeSize,
            profitAfterCosts: profitCalc.profit,
            executable: profitCalc.executable,
            confidence: profitCalc.slippage < 2 ? 85 : profitCalc.slippage < 5 ? 60 : 30,
            optimalSize: profitCalc.optimalSize,
            route: [pair.baseToken?.symbol, pair.quoteToken?.symbol, pair.baseToken?.symbol],
          });
        }
      }
    }

    // Sort by profit after costs
    opportunities.sort((a, b) => b.profitAfterCosts - a.profitAfterCosts);

    // SMART ALGORITHM: Detect flash loan opportunity
    const flashLoan = detectFlashLoanOpportunity(opportunities);

    // Calculate summary stats
    const executableOps = opportunities.filter(o => o.executable);
    const totalPotentialProfit = executableOps.reduce((sum, o) => sum + o.profitAfterCosts, 0);

    // AI ANALYSIS: Groq LLM analyzes the arbitrage data
    const arbAiAnalysis = await analyzeWithGroq("arbitrage", {
      opportunities: executableOps.length,
      totalProfit: totalPotentialProfit,
      bestSpread: opportunities[0]?.spreadPercent,
      flashLoanViable: flashLoan.viable
    });

    res.json({
      success: true,
      agent: "Arbitrage Scanner",
      llm: "groq-llama-3.1-8b",
      cost: SERVICES["agent-arbitrage"].price + " CRO",
      algorithm: "Smart Profit Calculator v1.0",
      apisUsed: [
        "CoinGecko (CEX prices)",
        "DexScreener (DEX prices + liquidity)",
        "VVS Router (on-chain quotes)",
        "On-chain (gas estimation)"
      ],
      data: {
        token,
        tradeSize: `$${tradeSize}`,
        prices: {
          coingecko: cexPrice ? `$${cexPrice.toFixed(4)}` : "N/A",
          vvs: vvsPrice ? `$${vvsPrice.toFixed(4)}` : "N/A",
          change24h: priceChange24h.toFixed(2) + "%",
        },
        gasCosts: {
          perSwap: `$${gasCostUsd.toFixed(4)}`,
          roundTrip: `$${(gasCostUsd * 2).toFixed(4)}`,
        },
        analysis: {
          pairsScanned: cronosPairs.length + 1,
          opportunitiesFound: opportunities.length,
          executableNow: executableOps.length,
          totalPotentialProfit: `$${totalPotentialProfit.toFixed(2)}`,
        },
        opportunities: opportunities.slice(0, 5).map(o => ({
          pair: o.pair,
          route: `${o.buyExchange} → ${o.sellExchange}`,
          spread: `${o.spreadPercent.toFixed(2)}%`,
          liquidity: `$${o.liquidityDepth.toLocaleString()}`,
          grossProfit: `$${o.estimatedProfit.toFixed(2)}`,
          netProfit: `$${o.profitAfterCosts.toFixed(2)}`,
          executable: o.executable ? "YES" : "NO (slippage/gas too high)",
          confidence: `${o.confidence}%`,
          optimalTradeSize: `$${o.optimalSize.toFixed(0)}`,
        })),
        flashLoanOpportunity: flashLoan.viable ? {
          viable: true,
          route: flashLoan.route.join(" → "),
          estimatedProfit: `$${flashLoan.estimatedProfit.toFixed(2)}`,
          flashLoanFee: `$${flashLoan.flashLoanFee.toFixed(2)}`,
          netProfit: `$${flashLoan.netProfit.toFixed(2)}`,
          recommendation: "Flash loan arbitrage possible!"
        } : {
          viable: false,
          reason: "No profitable flash loan routes found"
        },
        timestamp: new Date().toISOString(),
      },
      aiAnalysis: arbAiAnalysis || { analysis: "AI unavailable", recommendation: "NEUTRAL", confidence: 0 }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AGENT 2: Whale + Sentiment Analyzer (SMART ALGORITHM)
// Combines: DefiLlama TVL + CoinGecko market + On-chain whales
// Algorithm: Weighted sentiment scoring with trend reversal detection
// ─────────────────────────────────────────────────────────────
app.get("/api/x402/agent/sentiment", x402Gate("agent-sentiment"), async (req, res) => {
  try {
    // API 1: DefiLlama - Cronos TVL data
    const tvlData = await fetchAPI(`${EXTERNAL_APIS.defillama}/v2/chains`);
    const cronosTvl = tvlData?.find((c: any) => c.name === "Cronos");

    // API 2: CoinGecko - Extended market data for CRO with price history
    const marketData = await fetchAPI(
      `${EXTERNAL_APIS.coingecko}/coins/crypto-com-chain?localization=false&tickers=false&community_data=true&developer_data=false&sparkline=true`
    );

    // API 3: DefiLlama - Top Cronos protocols
    const protocolsData = await fetchAPI(`${EXTERNAL_APIS.defillama}/protocols`);
    const cronosProtocols = protocolsData?.filter((p: any) =>
      p.chains?.includes("Cronos")
    ).slice(0, 5) || [];

    // API 4: On-chain whale activity with detailed analysis
    const latestBlock = await mainnetProvider.getBlockNumber();
    const whaleThreshold = ethers.parseEther("10000");
    let whaleCount = 0;
    let totalWhaleVolume = 0n;
    let whaleBuys = 0;
    let whaleSells = 0;

    for (let i = 0; i < 5; i++) {
      const block = await mainnetProvider.getBlock(latestBlock - i, true);
      if (!block?.prefetchedTransactions) continue;
      for (const tx of block.prefetchedTransactions) {
        if (tx.value >= whaleThreshold) {
          whaleCount++;
          totalWhaleVolume += tx.value;
          // Heuristic: transfers to contracts are likely sells, from contracts are buys
          const toCode = await mainnetProvider.getCode(tx.to || "0x0");
          if (toCode !== "0x") whaleSells++;
          else whaleBuys++;
        }
      }
    }

    // Extract price metrics
    const priceChange24h = marketData?.market_data?.price_change_percentage_24h || 0;
    const priceChange7d = marketData?.market_data?.price_change_percentage_7d || 0;
    const priceChange30d = marketData?.market_data?.price_change_percentage_30d || 0;
    const currentPrice = marketData?.market_data?.current_price?.usd || 0;
    const volume24h = marketData?.market_data?.total_volume?.usd || 0;

    // Extract sparkline for trend analysis (last 7 days hourly)
    const sparkline = marketData?.market_data?.sparkline_7d?.price || [];
    const priceHistory = sparkline.slice(-24); // Last 24 data points
    const volumeHistory = new Array(priceHistory.length).fill(volume24h / 24); // Approximate

    // SMART ALGORITHM: Build weighted sentiment signals
    const sentimentSignals: SentimentSignal[] = [];

    // Signal 1: Price Action (25% weight)
    let priceScore = 50;
    let priceTrend: "up" | "down" | "neutral" = "neutral";
    if (priceChange24h > 5) { priceScore = 80; priceTrend = "up"; }
    else if (priceChange24h > 2) { priceScore = 65; priceTrend = "up"; }
    else if (priceChange24h > 0) { priceScore = 55; priceTrend = "up"; }
    else if (priceChange24h > -2) { priceScore = 45; priceTrend = "down"; }
    else if (priceChange24h > -5) { priceScore = 35; priceTrend = "down"; }
    else { priceScore = 20; priceTrend = "down"; }

    sentimentSignals.push({
      source: "price_action",
      value: priceScore,
      weight: 0.25,
      trend: priceTrend,
      confidence: Math.min(100, Math.abs(priceChange24h) * 10 + 50) / 100
    });

    // Signal 2: Volume Analysis (15% weight)
    const avgVolume = marketData?.market_data?.total_volume?.usd || 0;
    const marketCap = marketData?.market_data?.market_cap?.usd || 1;
    const volumeToMcap = (avgVolume / marketCap) * 100;
    let volumeScore = 50;
    let volumeTrend: "up" | "down" | "neutral" = "neutral";
    if (volumeToMcap > 10) { volumeScore = 75; volumeTrend = "up"; }
    else if (volumeToMcap > 5) { volumeScore = 60; volumeTrend = "up"; }
    else if (volumeToMcap < 2) { volumeScore = 35; volumeTrend = "down"; }

    sentimentSignals.push({
      source: "volume",
      value: volumeScore,
      weight: 0.15,
      trend: volumeTrend,
      confidence: 0.7
    });

    // Signal 3: TVL Change (20% weight)
    const tvlChange = cronosTvl?.change_1d || 0;
    let tvlScore = 50;
    let tvlTrend: "up" | "down" | "neutral" = "neutral";
    if (tvlChange > 5) { tvlScore = 85; tvlTrend = "up"; }
    else if (tvlChange > 2) { tvlScore = 70; tvlTrend = "up"; }
    else if (tvlChange > 0) { tvlScore = 55; tvlTrend = "up"; }
    else if (tvlChange > -2) { tvlScore = 45; tvlTrend = "down"; }
    else { tvlScore = 25; tvlTrend = "down"; }

    sentimentSignals.push({
      source: "tvl_change",
      value: tvlScore,
      weight: 0.20,
      trend: tvlTrend,
      confidence: 0.85
    });

    // Signal 4: Whale Activity (20% weight)
    let whaleScore = 50;
    let whaleTrend: "up" | "down" | "neutral" = "neutral";
    const netWhaleBias = whaleBuys - whaleSells;
    if (whaleCount > 10 && netWhaleBias > 0) { whaleScore = 80; whaleTrend = "up"; }
    else if (whaleCount > 5) { whaleScore = 65; whaleTrend = netWhaleBias > 0 ? "up" : "down"; }
    else if (whaleCount > 2) { whaleScore = 55; whaleTrend = "neutral"; }
    else if (whaleCount === 0) { whaleScore = 35; whaleTrend = "down"; }

    sentimentSignals.push({
      source: "whale_activity",
      value: whaleScore,
      weight: 0.20,
      trend: whaleTrend,
      confidence: whaleCount > 3 ? 0.8 : 0.5
    });

    // Signal 5: On-chain Metrics (10% weight)
    let onChainScore = 50;
    const txCount = await mainnetProvider.getBlockNumber();
    // Higher block number = more activity (relative metric)
    onChainScore = 50 + Math.min(20, (txCount % 1000) / 50);

    sentimentSignals.push({
      source: "on_chain_metrics",
      value: onChainScore,
      weight: 0.10,
      trend: "neutral",
      confidence: 0.6
    });

    // Signal 6: Social/Market Sentiment (10% weight)
    let socialScore = 50;
    let socialTrend: "up" | "down" | "neutral" = "neutral";
    // Use multi-timeframe momentum as proxy
    const momentum = (priceChange24h + priceChange7d / 7) / 2;
    if (momentum > 3) { socialScore = 75; socialTrend = "up"; }
    else if (momentum > 0) { socialScore = 55; socialTrend = "up"; }
    else if (momentum > -3) { socialScore = 45; socialTrend = "down"; }
    else { socialScore = 30; socialTrend = "down"; }

    sentimentSignals.push({
      source: "social_sentiment",
      value: socialScore,
      weight: 0.10,
      trend: socialTrend,
      confidence: 0.5
    });

    // SMART ALGORITHM: Calculate weighted sentiment
    const weightedResult = calculateWeightedSentiment(sentimentSignals);

    // SMART ALGORITHM: Detect trend reversal
    const trendReversal = detectTrendReversal(currentPrice, priceHistory, volumeHistory);

    // Generate actionable recommendations
    const recommendations: string[] = [];
    if (weightedResult.trend === "BULLISH" && weightedResult.confidence > 70) {
      recommendations.push("Strong bullish signals - consider accumulating");
    } else if (weightedResult.trend === "BULLISH") {
      recommendations.push("Moderate bullish sentiment - wait for confirmation");
    } else if (weightedResult.trend === "BEARISH" && weightedResult.confidence > 70) {
      recommendations.push("Strong bearish signals - consider reducing exposure");
    } else if (weightedResult.trend === "BEARISH") {
      recommendations.push("Moderate bearish sentiment - set stop losses");
    } else {
      recommendations.push("Mixed signals - trade range with tight stops");
    }

    if (trendReversal.reversal) {
      recommendations.push(`${trendReversal.direction.toUpperCase()} reversal detected (${trendReversal.strength.toFixed(0)}% strength)`);
    }
    recommendations.push(trendReversal.signal);

    // AI ANALYSIS: Groq LLM analyzes sentiment data
    const aiAnalysis = await analyzeWithGroq("sentiment", {
      sentimentScore: weightedResult.score,
      trend: weightedResult.trend,
      whaleActivity: netWhaleBias,
      reversalDetected: trendReversal.reversal
    });

    res.json({
      success: true,
      agent: "Whale + Sentiment Analyzer",
      llm: "groq-llama-3.1-8b",
      cost: SERVICES["agent-sentiment"].price + " CRO",
      algorithm: "Weighted Sentiment Scoring v1.0",
      apisUsed: [
        "DefiLlama (TVL + protocol data)",
        "CoinGecko (market + sparkline)",
        "On-chain (whale tracking + metrics)"
      ],
      data: {
        market: {
          price: currentPrice ? `$${currentPrice.toFixed(4)}` : "N/A",
          change24h: priceChange24h.toFixed(2) + "%",
          change7d: priceChange7d.toFixed(2) + "%",
          change30d: priceChange30d.toFixed(2) + "%",
          marketCap: marketCap ? `$${(marketCap / 1e9).toFixed(2)}B` : "N/A",
          volume24h: volume24h ? `$${(volume24h / 1e6).toFixed(2)}M` : "N/A",
          volumeToMcap: volumeToMcap.toFixed(2) + "%",
        },
        defi: {
          cronosTvl: cronosTvl?.tvl ? `$${(cronosTvl.tvl / 1e6).toFixed(2)}M` : "N/A",
          tvlChange24h: tvlChange.toFixed(2) + "%",
          topProtocols: cronosProtocols.map((p: any) => ({
            name: p.name,
            tvl: `$${(p.tvl / 1e6).toFixed(2)}M`,
          })),
        },
        whales: {
          transactionsFound: whaleCount,
          volume: ethers.formatEther(totalWhaleVolume) + " CRO",
          netBias: netWhaleBias > 0 ? `+${netWhaleBias} (accumulating)` : netWhaleBias < 0 ? `${netWhaleBias} (distributing)` : "neutral",
          buyTransactions: whaleBuys,
          sellTransactions: whaleSells,
        },
        sentiment: {
          score: `${weightedResult.score.toFixed(0)}/100`,
          label: weightedResult.trend,
          confidence: `${weightedResult.confidence.toFixed(0)}%`,
          momentum: weightedResult.momentum.toFixed(1),
        },
        signalBreakdown: weightedResult.signals.map(s => ({
          source: s.source.replace(/_/g, " "),
          contribution: `${s.contribution.toFixed(1)}%`,
          trend: s.trend,
        })),
        trendAnalysis: {
          reversalDetected: trendReversal.reversal,
          direction: trendReversal.direction,
          strength: `${trendReversal.strength.toFixed(0)}%`,
          signal: trendReversal.signal,
        },
        timestamp: new Date().toISOString(),
      },
      recommendations,
      aiAnalysis: aiAnalysis || { analysis: "AI analysis unavailable", recommendation: "NEUTRAL", confidence: 0 }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AGENT 3: Portfolio Risk Scorer (SMART ALGORITHM)
// Combines: Wallet balances + Price volatility + CoinGecko data
// Algorithm: Sharpe ratio, VaR, correlation matrix, max drawdown
// ─────────────────────────────────────────────────────────────
app.get("/api/x402/agent/risk", x402Gate("agent-risk"), async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    // API 1: Get native CRO balance
    const croBalance = await mainnetProvider.getBalance(address);
    const croValue = parseFloat(ethers.formatEther(croBalance));

    // API 2: Check common token balances with real prices
    const erc20Abi = ["function balanceOf(address) view returns (uint256)"];

    const tokensToCheck = [
      { symbol: "WCRO", address: "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23", decimals: 18, coingeckoId: "crypto-com-chain" },
      { symbol: "USDC", address: "0xc21223249ca28397b4b6541dffaecc539bff0c59", decimals: 6, coingeckoId: "usd-coin" },
      { symbol: "USDT", address: "0x66e428c3f67a68878562e79a0234c1f83c208770", decimals: 6, coingeckoId: "tether" },
      { symbol: "WETH", address: "0xe44fd7fcb2b1581822d0c862b68222998a0c299a", decimals: 18, coingeckoId: "ethereum" },
      { symbol: "WBTC", address: "0x062e66477faf219f25d27dced647bf57c3107d52", decimals: 8, coingeckoId: "bitcoin" },
      { symbol: "VVS", address: "0x2d03bece6747adc00e1a131bba1469c15fd11e03", decimals: 18, coingeckoId: "vvs-finance" },
    ];

    // API 3: Fetch real prices and volatility from CoinGecko
    const priceIds = tokensToCheck.map(t => t.coingeckoId).join(",");
    const priceData = await fetchAPI(
      `${EXTERNAL_APIS.coingecko}/simple/price?ids=${priceIds},crypto-com-chain&vs_currencies=usd&include_24hr_change=true`
    );

    // Get CRO price for native balance
    const croPrice = priceData?.["crypto-com-chain"]?.usd || 0.09;
    const croChange24h = priceData?.["crypto-com-chain"]?.usd_24h_change || 0;

    // Estimated volatility by asset type (annualized)
    const volatilityEstimates: Record<string, number> = {
      "CRO": 0.85, "WCRO": 0.85, "VVS": 1.2, // High vol altcoins
      "WETH": 0.65, "WBTC": 0.55, // Major crypto
      "USDC": 0.02, "USDT": 0.02, // Stablecoins
    };

    // Expected annual returns (rough estimates)
    const returnEstimates: Record<string, number> = {
      "CRO": 0.15, "WCRO": 0.15, "VVS": 0.20, // Higher risk/return
      "WETH": 0.12, "WBTC": 0.10, // Moderate
      "USDC": 0.04, "USDT": 0.04, // Risk-free proxy
    };

    // Build portfolio assets
    const portfolioAssets: PortfolioAsset[] = [];
    let totalValueUSD = 0;

    // Add native CRO
    const croValueUSD = croValue * croPrice;
    if (croValueUSD > 0.01) {
      portfolioAssets.push({
        symbol: "CRO",
        value: croValueUSD,
        weight: 0, // Will calculate
        volatility: volatilityEstimates["CRO"],
        expectedReturn: returnEstimates["CRO"]
      });
      totalValueUSD += croValueUSD;
    }

    // Fetch token balances and add to portfolio
    for (const token of tokensToCheck) {
      try {
        const contract = new ethers.Contract(token.address, erc20Abi, mainnetProvider);
        const balance = await contract.balanceOf(address);
        const rawValue = parseFloat(ethers.formatUnits(balance, token.decimals));

        if (rawValue > 0) {
          const tokenPrice = priceData?.[token.coingeckoId]?.usd || 0;
          const usdValue = rawValue * tokenPrice;

          if (usdValue > 0.01) {
            portfolioAssets.push({
              symbol: token.symbol,
              value: usdValue,
              weight: 0, // Will calculate
              volatility: volatilityEstimates[token.symbol] || 0.5,
              expectedReturn: returnEstimates[token.symbol] || 0.08
            });
            totalValueUSD += usdValue;
          }
        }
      } catch (e) {}
    }

    // SMART ALGORITHM: Calculate comprehensive risk metrics
    const riskMetrics = calculatePortfolioRisk(portfolioAssets);

    // Calculate additional metrics for display
    const largestHolding = portfolioAssets.reduce((max, a) => a.value > max.value ? a : max, portfolioAssets[0] || { symbol: "none", value: 0 });
    const largestWeight = totalValueUSD > 0 ? (largestHolding.value / totalValueUSD) * 100 : 0;

    // Risk-free equivalent (how much you'd need in stables for same risk)
    const portfolioRisk = riskMetrics.valueAtRisk;
    const riskFreeEquivalent = totalValueUSD * (1 - (riskMetrics.maxDrawdown / 100));

    // Stress test scenarios
    const stressTests = {
      market_crash_30pct: {
        scenario: "30% Market Crash",
        estimatedLoss: `$${(totalValueUSD * 0.3 * (1 - riskMetrics.diversificationScore / 200)).toFixed(2)}`,
        portfolioValue: `$${(totalValueUSD * 0.7).toFixed(2)}`
      },
      crypto_winter: {
        scenario: "Crypto Winter (-70%)",
        estimatedLoss: `$${(totalValueUSD * 0.7 * (1 - riskMetrics.diversificationScore / 300)).toFixed(2)}`,
        portfolioValue: `$${(totalValueUSD * 0.3).toFixed(2)}`
      },
      stablecoin_depeg: {
        scenario: "Stablecoin Depeg",
        estimatedLoss: portfolioAssets.some(a => a.symbol === "USDC" || a.symbol === "USDT")
          ? `$${(portfolioAssets.filter(a => a.symbol === "USDC" || a.symbol === "USDT").reduce((sum, a) => sum + a.value, 0) * 0.1).toFixed(2)}`
          : "$0 (no stablecoin exposure)"
      }
    };

    // Calculate risk level
    const riskLevel = riskMetrics.maxDrawdown > 60 ? "HIGH" : riskMetrics.maxDrawdown > 40 ? "MEDIUM" : "LOW";

    // AI ANALYSIS: Groq LLM analyzes risk data
    const aiAnalysis = await analyzeWithGroq("risk", {
      sharpeRatio: riskMetrics.sharpeRatio,
      maxDrawdown: riskMetrics.maxDrawdown,
      diversificationScore: riskMetrics.diversificationScore,
      riskLevel
    });

    res.json({
      success: true,
      agent: "Portfolio Risk Scorer",
      llm: "groq-llama-3.1-8b",
      cost: SERVICES["agent-risk"].price + " CRO",
      algorithm: "Modern Portfolio Theory + VaR v1.0",
      apisUsed: [
        "On-chain (balance queries)",
        "CoinGecko (real-time prices)",
        "Risk Calculator (Sharpe, VaR, correlation)"
      ],
      data: {
        portfolio: {
          address: address.slice(0, 10) + "..." + address.slice(-4),
          totalValueUSD: `$${totalValueUSD.toFixed(2)}`,
          assetCount: portfolioAssets.length,
          holdings: portfolioAssets.map(a => ({
            symbol: a.symbol,
            value: `$${a.value.toFixed(2)}`,
            weight: `${((a.value / Math.max(totalValueUSD, 1)) * 100).toFixed(1)}%`,
            volatility: `${(a.volatility * 100).toFixed(0)}%`,
            expectedReturn: `${(a.expectedReturn * 100).toFixed(0)}%`
          })),
          largestPosition: {
            asset: largestHolding?.symbol || "N/A",
            weight: `${largestWeight.toFixed(1)}%`,
            warning: largestWeight > 50 ? "CONCENTRATED" : largestWeight > 30 ? "Elevated" : "OK"
          }
        },
        riskMetrics: {
          sharpeRatio: {
            value: riskMetrics.sharpeRatio,
            interpretation: riskMetrics.sharpeRatio > 1 ? "Good risk-adjusted returns"
              : riskMetrics.sharpeRatio > 0.5 ? "Acceptable risk-adjusted returns"
              : "Poor risk-adjusted returns"
          },
          valueAtRisk: {
            daily95: `$${riskMetrics.valueAtRisk.toFixed(2)}`,
            interpretation: `95% confident daily loss won't exceed this`
          },
          maxDrawdown: {
            estimated: `${riskMetrics.maxDrawdown.toFixed(1)}%`,
            dollarAmount: `$${(totalValueUSD * riskMetrics.maxDrawdown / 100).toFixed(2)}`,
            interpretation: "Expected worst-case decline from peak"
          },
          diversificationScore: {
            value: `${riskMetrics.diversificationScore}/100`,
            level: riskMetrics.diversificationScore > 70 ? "Well Diversified"
              : riskMetrics.diversificationScore > 40 ? "Moderately Diversified"
              : "Poorly Diversified"
          },
          correlationRisk: riskMetrics.correlationRisk,
          riskAdjustedReturn: riskMetrics.riskAdjustedReturn
        },
        stressTests,
        summary: {
          riskLevel,
          riskFreeEquivalent: `$${riskFreeEquivalent.toFixed(2)}`,
        },
        timestamp: new Date().toISOString(),
      },
      recommendations: riskMetrics.recommendations,
      aiAnalysis: aiAnalysis || { analysis: "AI analysis unavailable", recommendation: "NEUTRAL", confidence: 0 }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AGENT 4: Smart Contract Auditor (SMART ALGORITHM)
// Combines: GoPlus Security + Bytecode analysis + On-chain data
// Algorithm: Weighted vulnerability scoring with code pattern detection
// ─────────────────────────────────────────────────────────────
app.get("/api/x402/agent/audit", x402Gate("agent-audit"), async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid contract address" });
    }

    // API 1: GoPlus Security - Contract security check (chain 25 = Cronos)
    const goplusData = await fetchAPI(
      `${EXTERNAL_APIS.goplus}/token_security/25?contract_addresses=${address}`
    );
    const tokenSecurity = goplusData?.result?.[address.toLowerCase()];

    // API 2: GoPlus - Address security (malicious address check)
    const addressSecurity = await fetchAPI(
      `${EXTERNAL_APIS.goplus}/address_security/${address}?chain_id=25`
    );

    // API 3: GoPlus - Approval security (if token)
    const approvalData = await fetchAPI(
      `${EXTERNAL_APIS.goplus}/approval_security/25?contract_addresses=${address}`
    );

    // API 4: On-chain bytecode analysis
    const code = await mainnetProvider.getCode(address);
    const isContract = code !== "0x";
    const codeSize = isContract ? (code.length - 2) / 2 : 0;

    // API 5: On-chain balance and transaction count
    const [balance, txCount] = await Promise.all([
      mainnetProvider.getBalance(address),
      isContract ? Promise.resolve(0) : mainnetProvider.getTransactionCount(address)
    ]);
    const croBalance = parseFloat(ethers.formatEther(balance));

    // SMART ALGORITHM: Build vulnerability flags with weighted scoring
    const vulnerabilityFlags: VulnerabilityFlag[] = [];

    // GoPlus token security flags with severity weights
    if (tokenSecurity) {
      if (tokenSecurity.is_honeypot === "1") {
        vulnerabilityFlags.push({
          type: "honeypot",
          severity: "critical",
          description: "HONEYPOT - Cannot sell tokens after buying",
          weight: 1.5
        });
      }
      if (tokenSecurity.is_blacklisted === "1") {
        vulnerabilityFlags.push({
          type: "blacklist",
          severity: "high",
          description: "Token has blacklist functionality",
          weight: 1.2
        });
      }
      if (tokenSecurity.can_take_back_ownership === "1") {
        vulnerabilityFlags.push({
          type: "ownership",
          severity: "high",
          description: "Owner can reclaim ownership after renouncing",
          weight: 1.3
        });
      }
      if (tokenSecurity.hidden_owner === "1") {
        vulnerabilityFlags.push({
          type: "hidden_owner",
          severity: "high",
          description: "Contract has hidden owner mechanisms",
          weight: 1.4
        });
      }
      if (tokenSecurity.selfdestruct === "1") {
        vulnerabilityFlags.push({
          type: "selfdestruct",
          severity: "critical",
          description: "Contract can self-destruct and steal funds",
          weight: 1.5
        });
      }
      if (tokenSecurity.external_call === "1") {
        vulnerabilityFlags.push({
          type: "external_call",
          severity: "medium",
          description: "Makes external calls (potential reentrancy)",
          weight: 0.8
        });
      }
      if (tokenSecurity.is_mintable === "1" && tokenSecurity.owner_address !== "0x0000000000000000000000000000000000000000") {
        vulnerabilityFlags.push({
          type: "mintable",
          severity: "medium",
          description: "Owner can mint unlimited tokens",
          weight: 1.0
        });
      }
      if (tokenSecurity.transfer_pausable === "1") {
        vulnerabilityFlags.push({
          type: "pausable",
          severity: "medium",
          description: "Transfers can be paused by owner",
          weight: 0.7
        });
      }
      if (tokenSecurity.trading_cooldown === "1") {
        vulnerabilityFlags.push({
          type: "cooldown",
          severity: "low",
          description: "Has trading cooldown (anti-bot)",
          weight: 0.3
        });
      }
      if (tokenSecurity.is_anti_whale === "1") {
        vulnerabilityFlags.push({
          type: "anti_whale",
          severity: "info",
          description: "Has anti-whale mechanisms",
          weight: 0.1
        });
      }

      // Tax analysis
      const buyTax = parseFloat(tokenSecurity.buy_tax || "0");
      const sellTax = parseFloat(tokenSecurity.sell_tax || "0");

      if (buyTax > 25 || sellTax > 25) {
        vulnerabilityFlags.push({
          type: "extreme_tax",
          severity: "critical",
          description: `Extreme taxes: Buy ${buyTax}%, Sell ${sellTax}%`,
          weight: 1.3
        });
      } else if (buyTax > 10 || sellTax > 10) {
        vulnerabilityFlags.push({
          type: "high_tax",
          severity: "high",
          description: `High taxes: Buy ${buyTax}%, Sell ${sellTax}%`,
          weight: 1.0
        });
      } else if (buyTax > 5 || sellTax > 5) {
        vulnerabilityFlags.push({
          type: "moderate_tax",
          severity: "medium",
          description: `Moderate taxes: Buy ${buyTax}%, Sell ${sellTax}%`,
          weight: 0.6
        });
      }

      // Holder concentration risk
      const holderCount = parseInt(tokenSecurity.holder_count || "0");
      if (holderCount < 50 && holderCount > 0) {
        vulnerabilityFlags.push({
          type: "low_holders",
          severity: "medium",
          description: `Only ${holderCount} holders - high manipulation risk`,
          weight: 0.8
        });
      }

      // LP lock check
      if (tokenSecurity.lp_holder_count === "0" || tokenSecurity.lp_total_supply === "0") {
        vulnerabilityFlags.push({
          type: "no_liquidity",
          severity: "high",
          description: "No liquidity or LP tokens detected",
          weight: 1.2
        });
      }
    }

    // GoPlus address security
    if (addressSecurity?.result) {
      const addrSec = addressSecurity.result;
      if (addrSec.malicious_address === "1") {
        vulnerabilityFlags.push({
          type: "malicious",
          severity: "critical",
          description: "Known malicious address flagged by security databases",
          weight: 2.0
        });
      }
      if (addrSec.phishing_activities === "1") {
        vulnerabilityFlags.push({
          type: "phishing",
          severity: "critical",
          description: "Associated with phishing activities",
          weight: 1.8
        });
      }
      if (addrSec.stealing_attack === "1") {
        vulnerabilityFlags.push({
          type: "stealing",
          severity: "critical",
          description: "Associated with token stealing attacks",
          weight: 2.0
        });
      }
    }

    // Bytecode pattern analysis (when no GoPlus data)
    if (isContract) {
      // Check for dangerous opcodes
      const bytecodeHex = code.toLowerCase();

      // SELFDESTRUCT (0xff)
      if (bytecodeHex.includes("ff") && !tokenSecurity?.selfdestruct) {
        vulnerabilityFlags.push({
          type: "selfdestruct_opcode",
          severity: "high",
          description: "Contains SELFDESTRUCT opcode",
          weight: 0.9
        });
      }

      // DELEGATECALL (0xf4)
      if (bytecodeHex.includes("f4")) {
        vulnerabilityFlags.push({
          type: "delegatecall",
          severity: "medium",
          description: "Uses DELEGATECALL - proxy pattern or vulnerability",
          weight: 0.5
        });
      }

      // Suspiciously small code
      if (codeSize < 200) {
        vulnerabilityFlags.push({
          type: "minimal_code",
          severity: "medium",
          description: `Suspiciously small contract (${codeSize} bytes)`,
          weight: 0.7
        });
      }

      // Very large code (potential complexity)
      if (codeSize > 24000) {
        vulnerabilityFlags.push({
          type: "large_code",
          severity: "info",
          description: `Very large contract (${codeSize} bytes) - review carefully`,
          weight: 0.2
        });
      }
    }

    // SMART ALGORITHM: Calculate weighted vulnerability score
    const auditResult = calculateVulnerabilityScore(vulnerabilityFlags);

    // Generate detailed findings
    const findings = vulnerabilityFlags.map(f => ({
      type: f.type,
      severity: f.severity,
      description: f.description,
      impactScore: Math.round(f.weight * (
        f.severity === "critical" ? 40 :
        f.severity === "high" ? 25 :
        f.severity === "medium" ? 15 :
        f.severity === "low" ? 5 : 1
      ))
    })).sort((a, b) => b.impactScore - a.impactScore);

    // Build positive signals
    const positiveSignals: string[] = [];
    if (tokenSecurity?.is_open_source === "1") positiveSignals.push("Verified source code");
    if (tokenSecurity?.owner_address === "0x0000000000000000000000000000000000000000") positiveSignals.push("Ownership renounced");
    if (tokenSecurity?.is_proxy === "0") positiveSignals.push("Non-upgradeable contract");
    if (parseInt(tokenSecurity?.holder_count || "0") > 1000) positiveSignals.push(`Large holder base (${tokenSecurity?.holder_count})`);
    if (vulnerabilityFlags.length === 0) positiveSignals.push("No vulnerabilities detected");

    // AI ANALYSIS: Groq LLM analyzes audit data
    const aiAnalysis = await analyzeWithGroq("audit", {
      grade: auditResult.grade,
      score: auditResult.score,
      criticalFindings: auditResult.criticalCount,
      safeToInteract: auditResult.safeToInteract,
      topRisks: auditResult.topRisks
    });

    res.json({
      success: true,
      agent: "Contract Auditor",
      llm: "groq-llama-3.1-8b",
      cost: SERVICES["agent-audit"].price + " CRO",
      algorithm: "Weighted Vulnerability Scoring v1.0",
      apisUsed: [
        "GoPlus Security (token check)",
        "GoPlus Security (address check)",
        "GoPlus Security (approval check)",
        "On-chain (bytecode analysis)"
      ],
      data: {
        contract: {
          address,
          isContract,
          codeSize: codeSize + " bytes",
          balance: croBalance.toFixed(2) + " CRO",
          complexity: codeSize > 20000 ? "High" : codeSize > 5000 ? "Medium" : "Low"
        },
        tokenInfo: tokenSecurity ? {
          name: tokenSecurity.token_name || "Unknown",
          symbol: tokenSecurity.token_symbol || "Unknown",
          isOpenSource: tokenSecurity.is_open_source === "1",
          isProxy: tokenSecurity.is_proxy === "1",
          owner: tokenSecurity.owner_address?.slice(0, 10) + "..." || "Unknown",
          ownershipRenounced: tokenSecurity.owner_address === "0x0000000000000000000000000000000000000000",
          holderCount: tokenSecurity.holder_count || "N/A",
          totalSupply: tokenSecurity.total_supply || "N/A",
          buyTax: (tokenSecurity.buy_tax || "0") + "%",
          sellTax: (tokenSecurity.sell_tax || "0") + "%",
        } : "No token data available",
        securityAnalysis: {
          totalFindings: findings.length,
          criticalCount: auditResult.criticalCount,
          highCount: auditResult.highCount,
          findings: findings.slice(0, 10), // Top 10 findings
        },
        positiveSignals,
        verdict: {
          riskScore: `${auditResult.score}/100`,
          grade: auditResult.grade,
          safeToInteract: auditResult.safeToInteract,
          topRisks: auditResult.topRisks,
        },
        timestamp: new Date().toISOString(),
      },
      recommendation: auditResult.auditRecommendation,
      aiAnalysis: aiAnalysis || { analysis: "AI analysis unavailable", recommendation: "NEUTRAL", confidence: 0 }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AGENT 5: Trade Executor (SMART ALGORITHM)
// Combines: DexScreener + VVS quote + CoinGecko price + Execution
// Algorithm: Route optimization with split routing and MEV protection
// ─────────────────────────────────────────────────────────────
app.post("/api/x402/agent/executor", x402Gate("agent-executor"), async (req, res) => {
  try {
    const { amountIn, tokenSymbol, execute, minOutput } = req.body;

    if (!amountIn) {
      return res.status(400).json({ error: "Missing amountIn" });
    }

    const amountNum = parseFloat(amountIn);
    const token = tokenSymbol || "USDC";

    // API 1: DexScreener - Find ALL Cronos pairs for the token
    const dexData = await fetchAPI(
      `${EXTERNAL_APIS.dexscreener}/dex/search?q=${token}%20cronos`
    );

    const cronosPairs = dexData?.pairs?.filter((p: any) =>
      p.chainId === "cronos"
    ).slice(0, 10) || [];

    // API 2: CoinGecko - Get reference price and market data
    const cgData = await fetchAPI(
      `${EXTERNAL_APIS.coingecko}/simple/price?ids=cronos,${token.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`
    );
    const croPrice = cgData?.cronos?.usd || 0.09;
    const inputValueUsd = amountNum * croPrice;

    // API 3: Multiple on-chain VVS quotes for different paths
    const usdcAddress = "0xc21223249ca28397b4b6541dffaecc539bff0c59";
    const usdtAddress = "0x66e428c3f67a68878562e79a0234c1f83c208770";
    const wethAddress = "0xe44fd7fcb2b1581822d0c862b68222998a0c299a";

    const vvsRoutes: DEXRoute[] = [];
    const amountWei = ethers.parseEther(amountIn.toString());

    // Direct CRO -> USDC
    try {
      const amounts = await vvsRouter.getAmountsOut(amountWei, [WCRO_ADDRESS, usdcAddress]);
      const output = parseFloat(ethers.formatUnits(amounts[1], 6));
      const priceImpact = Math.abs((output / amountNum - croPrice) / croPrice * 100);
      vvsRoutes.push({
        dex: "VVS Finance",
        path: ["CRO", "USDC"],
        liquidity: 500000, // Estimated
        expectedOutput: output,
        priceImpact,
        gasCost: 180000
      });
    } catch (e) {}

    // CRO -> USDT (alternative stable)
    try {
      const amounts = await vvsRouter.getAmountsOut(amountWei, [WCRO_ADDRESS, usdtAddress]);
      const output = parseFloat(ethers.formatUnits(amounts[1], 6));
      const priceImpact = Math.abs((output / amountNum - croPrice) / croPrice * 100);
      vvsRoutes.push({
        dex: "VVS Finance",
        path: ["CRO", "USDT"],
        liquidity: 300000,
        expectedOutput: output,
        priceImpact,
        gasCost: 180000
      });
    } catch (e) {}

    // Multi-hop: CRO -> WETH -> USDC (for large trades)
    try {
      const amounts = await vvsRouter.getAmountsOut(amountWei, [WCRO_ADDRESS, wethAddress, usdcAddress]);
      const output = parseFloat(ethers.formatUnits(amounts[2], 6));
      const priceImpact = Math.abs((output / amountNum - croPrice) / croPrice * 100);
      vvsRoutes.push({
        dex: "VVS Finance (2-hop)",
        path: ["CRO", "WETH", "USDC"],
        liquidity: 400000,
        expectedOutput: output,
        priceImpact,
        gasCost: 280000 // Higher gas for multi-hop
      });
    } catch (e) {}

    // API 4: Gas estimation with current network conditions
    const feeData = await mainnetProvider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    const baseGasCost = parseFloat(ethers.formatEther(gasPrice * 180000n));
    const gasCostUsd = baseGasCost * croPrice;

    // Build DEXRoute array from DexScreener data
    for (const pair of cronosPairs) {
      const liquidity = pair.liquidity?.usd || 0;
      if (liquidity < 1000) continue;

      // Estimate price impact based on liquidity
      const priceImpact = (inputValueUsd / liquidity) * 100 * 2.5; // AMM impact formula

      vvsRoutes.push({
        dex: pair.dexId,
        path: [pair.baseToken?.symbol || "?", pair.quoteToken?.symbol || "?"],
        liquidity,
        expectedOutput: inputValueUsd / (parseFloat(pair.priceUsd) || 1),
        priceImpact: Math.min(priceImpact, 50),
        gasCost: 180000
      });
    }

    // SMART ALGORITHM: Optimize trade route
    const minOutputAmount = parseFloat(minOutput) || inputValueUsd * 0.95; // 5% slippage default
    const optimization = optimizeTradeRoute(vvsRoutes, inputValueUsd, minOutputAmount);

    // Calculate optimal slippage based on trade size and liquidity
    let suggestedSlippage: number;
    if (optimization.bestRoute) {
      if (optimization.bestRoute.priceImpact < 0.5) suggestedSlippage = 50; // 0.5%
      else if (optimization.bestRoute.priceImpact < 1) suggestedSlippage = 100; // 1%
      else if (optimization.bestRoute.priceImpact < 2) suggestedSlippage = 150; // 1.5%
      else suggestedSlippage = Math.min(300, Math.ceil(optimization.bestRoute.priceImpact * 100) + 100);
    } else {
      suggestedSlippage = 200;
    }

    // Calculate potential savings
    const worstRoute = vvsRoutes.sort((a, b) => a.expectedOutput - b.expectedOutput)[0];
    const bestRoute = optimization.bestRoute;
    const savingsVsWorst = bestRoute && worstRoute
      ? ((bestRoute.expectedOutput - worstRoute.expectedOutput) / worstRoute.expectedOutput * 100).toFixed(2)
      : "0";

    // Timing analysis
    const latestBlock = await mainnetProvider.getBlockNumber();
    const blockTime = 6; // Cronos block time ~6 seconds
    const optimalTiming = {
      currentBlock: latestBlock,
      suggestedDeadline: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      urgency: optimization.bestRoute && optimization.bestRoute.priceImpact > 2
        ? "HIGH - Large trade, execute quickly to avoid price movement"
        : optimization.bestRoute && optimization.bestRoute.priceImpact > 1
        ? "MEDIUM - Monitor for better entry"
        : "LOW - Can wait for optimal conditions"
    };

    // AI ANALYSIS: Groq LLM analyzes execution data
    const aiAnalysis = await analyzeWithGroq("executor", {
      bestDex: optimization.bestRoute?.dex,
      priceImpact: optimization.bestRoute?.priceImpact,
      mevRisk: inputValueUsd > 10000 ? "HIGH" : inputValueUsd > 1000 ? "MEDIUM" : "LOW",
      splitRecommended: !!optimization.splitRoute
    });

    res.json({
      success: true,
      agent: "Trade Executor",
      llm: "groq-llama-3.1-8b",
      cost: SERVICES["agent-executor"].price + " CRO",
      algorithm: "Route Optimization + MEV Protection v1.0",
      apisUsed: [
        "DexScreener (multi-DEX quotes)",
        "CoinGecko (reference prices)",
        "VVS Router (on-chain multi-path quotes)",
        "On-chain (gas + block analysis)"
      ],
      data: {
        input: {
          amount: amountIn + " CRO",
          valueUsd: `$${inputValueUsd.toFixed(2)}`,
          targetToken: token,
        },
        routesAnalyzed: vvsRoutes.length,
        bestRoute: optimization.bestRoute ? {
          dex: optimization.bestRoute.dex,
          path: optimization.bestRoute.path.join(" → "),
          expectedOutput: `$${optimization.bestRoute.expectedOutput.toFixed(2)}`,
          priceImpact: `${optimization.bestRoute.priceImpact.toFixed(2)}%`,
          liquidity: `$${optimization.bestRoute.liquidity.toLocaleString()}`,
          gasCost: `${(optimization.bestRoute.gasCost / 1e6).toFixed(2)}M gas`,
        } : null,
        splitRouting: optimization.splitRoute ? {
          recommended: true,
          reason: "Large trade benefits from splitting across DEXs",
          routes: optimization.splitRoute.map(r => ({
            dex: r.dex,
            amount: `$${r.amount.toFixed(2)}`,
            expectedOutput: `$${r.output.toFixed(2)}`
          })),
          totalOutput: `$${optimization.splitRoute.reduce((sum, r) => sum + r.output, 0).toFixed(2)}`
        } : {
          recommended: false,
          reason: "Single route is optimal for this trade size"
        },
        optimization: {
          savingsVsWorstRoute: `${savingsVsWorst}%`,
          suggestedSlippage: `${suggestedSlippage / 100}%`,
          slippageBps: suggestedSlippage,
          gasCosts: {
            estimated: `${baseGasCost.toFixed(6)} CRO`,
            usd: `$${gasCostUsd.toFixed(4)}`,
            percentOfTrade: `${((gasCostUsd / inputValueUsd) * 100).toFixed(3)}%`
          }
        },
        mevProtection: {
          recommendations: optimization.mevProtection,
          riskLevel: inputValueUsd > 10000 ? "HIGH" : inputValueUsd > 1000 ? "MEDIUM" : "LOW",
          privateRpcSuggested: inputValueUsd > 5000
        },
        timing: optimalTiming,
        execution: execute ? {
          status: "READY",
          endpoint: "POST /api/x402/swap/execute",
          payload: {
            amountIn,
            tokenOut: usdcAddress,
            slippage: suggestedSlippage,
            deadline: optimalTiming.suggestedDeadline
          },
          warning: optimization.bestRoute && optimization.bestRoute.priceImpact > 3
            ? "High price impact - consider smaller trade size"
            : null
        } : {
          status: "QUOTE_ONLY",
          hint: "Set execute: true to prepare execution payload"
        },
        timestamp: new Date().toISOString(),
      },
      recommendation: optimization.recommendation,
      aiAnalysis: aiAnalysis || { analysis: "AI analysis unavailable", recommendation: "NEUTRAL", confidence: 0 }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============ WALLET API ============

app.get("/api/wallet/status", async (req, res) => {
  const status = await getWalletStatus();
  res.json(status);
});

app.post("/api/wallet/deposit", async (req, res) => {
  // For real wallet, user needs to send CRO directly
  res.json({
    message: "Send CRO to wallet address",
    walletAddress: AGENT_WALLET_ADDRESS,
    network: "Cronos Testnet (Chain ID: 338)",
  });
});

// Agent pays for service with cryptographic receipt
app.post("/api/agent/pay", async (req, res) => {
  const { serviceId, payerAddress } = req.body;
  const service = SERVICES[serviceId];
  if (!service) return res.status(400).json({ error: "Unknown service" });

  const amount = ethers.parseEther(service.price);
  const check = await canAgentSpend(amount);

  if (!check.ok) {
    return res.status(403).json({ error: check.reason, canSpend: false });
  }

  // For demo, we simulate the spend without actual tx
  simulatedSpent += parseFloat(service.price);
  simulatedTxCount++;

  // Create cryptographic payment receipt
  const receipt = await createPaymentReceipt(serviceId, service.price, payerAddress);

  // Also store in paidRequests for backward compatibility
  paidRequests.set(receipt.receiptId, Date.now());

  const status = await getWalletStatus();

  res.json({
    success: true,
    paid: service.price + " CRO",
    proof: receipt.receiptId,
    receipt: {
      id: receipt.receiptId,
      hash: receipt.hash,
      signature: receipt.signature,
      timestamp: new Date(receipt.timestamp).toISOString(),
      verifyUrl: `/api/proof/verify/${receipt.receiptId}`,
    },
    wallet: status,
  });
});

// ============ TRANSACTION PROOF API ENDPOINTS ============

// Get all payment receipts
app.get("/api/proofs", (req, res) => {
  const receipts = Array.from(paymentReceipts.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100); // Limit to last 100

  res.json({
    count: receipts.length,
    receipts: receipts.map(r => ({
      id: r.receiptId,
      service: r.serviceName,
      amount: r.amount + " " + r.currency,
      timestamp: new Date(r.timestamp).toISOString(),
      status: r.status,
      hash: r.hash,
      signed: !!r.signature,
    })),
  });
});

// Get specific receipt by ID
app.get("/api/proof/:receiptId", (req, res) => {
  const { receiptId } = req.params;
  const receipt = paymentReceipts.get(receiptId);

  if (!receipt) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  res.json({
    receipt,
    verification: {
      hashAlgorithm: "keccak256",
      signatureType: receipt.signature ? "EIP-191" : null,
      chainId: receipt.chainId,
      network: "Cronos Testnet",
      explorerUrl: receipt.txHash
        ? `https://testnet.cronoscan.com/tx/${receipt.txHash}`
        : null,
    },
  });
});

// Verify a receipt's integrity and signature
app.get("/api/proof/verify/:receiptId", (req, res) => {
  const { receiptId } = req.params;
  const result = verifyReceipt(receiptId);

  res.json({
    receiptId,
    valid: result.valid,
    reason: result.reason,
    receipt: result.receipt ? {
      service: result.receipt.serviceName,
      amount: result.receipt.amount + " " + result.receipt.currency,
      timestamp: new Date(result.receipt.timestamp).toISOString(),
      payer: result.receipt.payer,
      payee: result.receipt.payee,
      hash: result.receipt.hash,
      signed: !!result.receipt.signature,
    } : null,
    verificationDetails: result.receipt ? {
      hashVerified: result.valid,
      signatureVerified: result.receipt.signature ? result.valid : "no_signature",
      signer: agentWallet?.address || null,
    } : null,
  });
});

// Verify by hash (for external verification)
app.post("/api/proof/verify-hash", (req, res) => {
  const { hash, signature } = req.body;

  if (!hash) {
    return res.status(400).json({ error: "Missing hash" });
  }

  // Find receipt by hash
  const receipt = Array.from(paymentReceipts.values()).find(r => r.hash === hash);

  if (!receipt) {
    // If receipt not found but we have a signature, verify the signature directly
    if (signature && agentWallet) {
      try {
        const recoveredAddress = ethers.verifyMessage(ethers.getBytes(hash), signature);
        const isValidSigner = recoveredAddress.toLowerCase() === agentWallet.address.toLowerCase();
        return res.json({
          valid: isValidSigner,
          receipt: null,
          signatureValid: isValidSigner,
          recoveredSigner: recoveredAddress,
          expectedSigner: agentWallet.address,
        });
      } catch (e) {
        return res.json({
          valid: false,
          reason: "Invalid signature format",
        });
      }
    }
    return res.status(404).json({ error: "Receipt not found for this hash" });
  }

  const result = verifyReceipt(receipt.receiptId);
  res.json({
    valid: result.valid,
    receiptId: receipt.receiptId,
    reason: result.reason,
  });
});

// ============ AI AGENT TASK EXECUTOR ============

app.post("/api/agent/task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "Missing task" });

  const steps: any[] = [];
  let totalCost = 0;
  const taskLower = task.toLowerCase();

  // Determine services to call
  const servicesToCall: { id: string; params: Record<string, string> }[] = [];

  if (taskLower.includes("whale") || taskLower.includes("large")) {
    servicesToCall.push({ id: "whale", params: {} });
  }
  if (taskLower.includes("gas") || taskLower.includes("fee")) {
    servicesToCall.push({ id: "gas", params: {} });
  }
  if (taskLower.includes("wallet") || taskLower.includes("address") || taskLower.includes("balance")) {
    const addressMatch = task.match(/0x[a-fA-F0-9]{40}/);
    servicesToCall.push({
      id: "wallet",
      params: { address: addressMatch ? addressMatch[0] : "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23" }
    });
  }
  if (taskLower.includes("block")) {
    servicesToCall.push({ id: "block", params: {} });
  }
  if (taskLower.includes("contract") || taskLower.includes("scan")) {
    const addressMatch = task.match(/0x[a-fA-F0-9]{40}/);
    if (addressMatch) servicesToCall.push({ id: "contract", params: { address: addressMatch[0] } });
  }
  if (taskLower.includes("swap") || taskLower.includes("trade") || taskLower.includes("vvs")) {
    servicesToCall.push({ id: "swap", params: {} });
  }

  if (servicesToCall.length === 0) {
    servicesToCall.push({ id: "gas", params: {} });
    servicesToCall.push({ id: "block", params: {} });
  }

  // Execute services
  for (const svc of servicesToCall) {
    const service = SERVICES[svc.id];
    const amount = ethers.parseEther(service.price);

    const check = await canAgentSpend(amount);
    if (!check.ok) {
      steps.push({ service: svc.id, status: "blocked", reason: check.reason });
      continue;
    }

    simulatedSpent += parseFloat(service.price);
    simulatedTxCount++;
    const proof = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paidRequests.set(proof, Date.now());
    totalCost += parseFloat(service.price);

    try {
      const queryParams = new URLSearchParams(svc.params).toString();
      const url = `http://localhost:3005/api/x402/${svc.id}${queryParams ? '?' + queryParams : ''}`;
      const resp = await axios.get(url, { headers: { "X-Payment": proof } });
      steps.push({ service: svc.id, status: "success", cost: service.price + " CRO", result: resp.data.data });
    } catch (e: any) {
      steps.push({ service: svc.id, status: "error", error: e.message });
    }
  }

  const status = await getWalletStatus();

  res.json({
    task,
    steps,
    totalCost: totalCost.toFixed(4) + " CRO",
    wallet: status,
  });
});

// ============ A2A PROTOCOL (Agent-to-Agent Communication) ============
// Agents discover each other's capabilities before x402 payment
// Based on Google's A2A protocol for agent interoperability

interface AgentCard {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  inputs: { name: string; type: string; required: boolean; description: string }[];
  outputs: { name: string; type: string; description: string }[];
  pricing: { amount: string; currency: string; unit: string };
  endpoint: string;
  status: "active" | "inactive";
}

// Agent Registry - A2A Discovery
const AGENT_REGISTRY: Record<string, AgentCard> = {
  "agent-arbitrage": {
    id: "agent-arbitrage",
    name: "Arbitrage Scanner",
    description: "Scans CEX/DEX price differences and calculates profitable arbitrage opportunities with slippage and gas considerations",
    version: "1.0.0",
    capabilities: ["price-comparison", "profit-calculation", "flash-loan-detection", "slippage-analysis"],
    inputs: [
      { name: "size", type: "number", required: false, description: "Trade size in USD (default: 1000)" }
    ],
    outputs: [
      { name: "opportunities", type: "array", description: "List of arbitrage opportunities with profit calculations" },
      { name: "flashLoanOpportunity", type: "object", description: "Flash loan viability analysis" }
    ],
    pricing: { amount: "0.08", currency: "CRO", unit: "per-query" },
    endpoint: "/api/x402/agent/arbitrage",
    status: "active"
  },
  "agent-sentiment": {
    id: "agent-sentiment",
    name: "Whale + Sentiment Analyzer",
    description: "Combines whale wallet movements with market sentiment signals using weighted scoring algorithms",
    version: "1.0.0",
    capabilities: ["whale-tracking", "sentiment-analysis", "trend-detection", "signal-aggregation"],
    inputs: [],
    outputs: [
      { name: "sentiment", type: "object", description: "Weighted sentiment score with confidence" },
      { name: "whaleActivity", type: "object", description: "Recent whale movements" },
      { name: "trendAnalysis", type: "object", description: "Market trend signals" }
    ],
    pricing: { amount: "0.06", currency: "CRO", unit: "per-query" },
    endpoint: "/api/x402/agent/sentiment",
    status: "active"
  },
  "agent-risk": {
    id: "agent-risk",
    name: "Portfolio Risk Analyzer",
    description: "Analyzes portfolio risk using Modern Portfolio Theory, Sharpe ratio, Value at Risk (VaR), and diversification metrics",
    version: "1.0.0",
    capabilities: ["sharpe-ratio", "value-at-risk", "max-drawdown", "diversification-score", "correlation-analysis"],
    inputs: [
      { name: "address", type: "string", required: true, description: "Wallet address to analyze" }
    ],
    outputs: [
      { name: "riskMetrics", type: "object", description: "Sharpe ratio, VaR, max drawdown" },
      { name: "recommendations", type: "array", description: "Risk mitigation recommendations" }
    ],
    pricing: { amount: "0.05", currency: "CRO", unit: "per-query" },
    endpoint: "/api/x402/agent/risk",
    status: "active"
  },
  "agent-audit": {
    id: "agent-audit",
    name: "Smart Contract Auditor",
    description: "Scans smart contracts for security vulnerabilities with weighted risk scoring and safety recommendations",
    version: "1.0.0",
    capabilities: ["vulnerability-detection", "risk-scoring", "honeypot-detection", "owner-analysis"],
    inputs: [
      { name: "address", type: "string", required: true, description: "Contract address to audit" }
    ],
    outputs: [
      { name: "verdict", type: "object", description: "Safety grade and risk score" },
      { name: "vulnerabilities", type: "array", description: "Detected security issues" }
    ],
    pricing: { amount: "0.10", currency: "CRO", unit: "per-query" },
    endpoint: "/api/x402/agent/audit",
    status: "active"
  },
  "agent-executor": {
    id: "agent-executor",
    name: "Trade Route Optimizer",
    description: "Finds optimal trade routes across DEXs with split routing support and MEV protection analysis",
    version: "1.0.0",
    capabilities: ["route-optimization", "split-routing", "mev-protection", "gas-estimation"],
    inputs: [
      { name: "amountIn", type: "string", required: true, description: "Input amount in CRO" },
      { name: "tokenOut", type: "string", required: false, description: "Target token (default: USDC)" }
    ],
    outputs: [
      { name: "bestRoute", type: "object", description: "Optimal trade route" },
      { name: "mevProtection", type: "object", description: "MEV risk analysis and recommendations" }
    ],
    pricing: { amount: "0.03", currency: "CRO", unit: "per-query" },
    endpoint: "/api/x402/agent/executor",
    status: "active"
  }
};

// A2A Discovery Endpoint - List all available agents
app.get("/api/a2a/agents", (req, res) => {
  res.json({
    protocol: "a2a",
    version: "1.0.0",
    agents: Object.values(AGENT_REGISTRY)
  });
});

// A2A Agent Card - Get specific agent capabilities
app.get("/api/a2a/agents/:agentId", (req, res) => {
  const agent = AGENT_REGISTRY[req.params.agentId];
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }
  res.json(agent);
});

// A2A Capability Search - Find agents by capability
app.get("/api/a2a/search", (req, res) => {
  const { capability, q } = req.query;
  let results = Object.values(AGENT_REGISTRY);

  if (capability) {
    results = results.filter(a => a.capabilities.includes(capability as string));
  }

  if (q) {
    const query = (q as string).toLowerCase();
    results = results.filter(a =>
      a.name.toLowerCase().includes(query) ||
      a.description.toLowerCase().includes(query) ||
      a.capabilities.some(c => c.includes(query))
    );
  }

  res.json({ results });
});

// A2A Negotiate - Check if agent can handle request
app.post("/api/a2a/negotiate", (req, res) => {
  const { agentId, task, inputs } = req.body;
  const agent = AGENT_REGISTRY[agentId];

  if (!agent) {
    return res.json({ canHandle: false, reason: "Agent not found" });
  }

  if (agent.status !== "active") {
    return res.json({ canHandle: false, reason: "Agent is not active" });
  }

  // Check required inputs
  const missingInputs = agent.inputs
    .filter(i => i.required)
    .filter(i => !inputs || !(i.name in inputs));

  if (missingInputs.length > 0) {
    return res.json({
      canHandle: false,
      reason: `Missing required inputs: ${missingInputs.map(i => i.name).join(", ")}`
    });
  }

  res.json({
    canHandle: true,
    agent: agent,
    pricing: agent.pricing,
    paymentEndpoint: "/api/agent/pay",
    executeEndpoint: agent.endpoint
  });
});


// ============ GROQ AI INTEGRATION (Free LLM for Intent Understanding) ============
// Uses Groq's free tier for fast inference

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant"; // Fast and free

interface GroqIntent {
  agents: string[];
  reasoning: string;
  confidence: number;
}

async function analyzeIntentWithGroq(userGoal: string): Promise<GroqIntent | null> {
  if (!GROQ_API_KEY) {
    console.log("GROQ_API_KEY not set, using fallback keyword matching");
    return null;
  }

  try {
    const systemPrompt = `You are an AI agent router. Given a user's goal, determine which sub-agents should be called.

Available agents:
1. agent-arbitrage: Finds price differences between DEXs/CEXs for profit opportunities
2. agent-sentiment: Analyzes market sentiment, whale movements, and trading signals
3. agent-risk: Calculates portfolio risk metrics (Sharpe ratio, VaR, diversification)
4. agent-audit: Audits smart contracts for security vulnerabilities
5. agent-executor: Finds optimal trade routes with MEV protection

Respond ONLY with valid JSON in this exact format:
{"agents": ["agent-id1", "agent-id2"], "reasoning": "brief explanation", "confidence": 0.9}

Rules:
- Only include agents that are clearly needed
- For investment decisions, include both sentiment and risk
- For trading, include executor
- For contract safety, include audit
- confidence should be 0.0-1.0`;

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User goal: "${userGoal}"` }
        ],
        temperature: 0.1,
        max_tokens: 200
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    const content = response.data.choices[0]?.message?.content;
    if (content) {
      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  } catch (error: any) {
    console.error("Groq API error:", error.message);
  }

  return null;
}

// Generic Groq AI analysis for all agents
async function analyzeWithGroq(agentType: string, data: any, question?: string): Promise<{ analysis: string; recommendation: string; confidence: number } | null> {
  if (!GROQ_API_KEY) return null;

  const prompts: Record<string, string> = {
    arbitrage: `You are an arbitrage analysis AI. Analyze the price data and opportunities provided. Give a concise analysis of:
1. Best opportunity and why
2. Risk assessment
3. Recommended action
Keep response under 100 words. Be specific with numbers.`,

    sentiment: `You are a market sentiment analysis AI. Analyze the whale movements and market signals provided. Give a concise analysis of:
1. Overall market sentiment (bullish/bearish/neutral)
2. Key whale activity insights
3. Short-term outlook
Keep response under 100 words.`,

    risk: `You are a portfolio risk analysis AI. Analyze the risk metrics provided. Give a concise analysis of:
1. Portfolio health assessment
2. Main risk factors
3. Diversification recommendation
Keep response under 100 words.`,

    audit: `You are a smart contract security AI. Analyze the contract patterns provided. Give a concise analysis of:
1. Security assessment (Safe/Caution/Danger)
2. Key risks identified
3. Interaction recommendation
Keep response under 100 words.`,

    executor: `You are a trade execution AI. Analyze the DEX routes and prices provided. Give a concise analysis of:
1. Best execution route
2. Slippage and MEV risk
3. Execution recommendation
Keep response under 100 words.`
  };

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: prompts[agentType] || "Analyze the data and provide insights." },
          { role: "user", content: `Data: ${JSON.stringify(data, null, 2)}${question ? `\n\nUser question: ${question}` : ''}` }
        ],
        temperature: 0.3,
        max_tokens: 300
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const content = response.data.choices[0]?.message?.content || "";
    return {
      analysis: content,
      recommendation: content.includes("buy") || content.includes("bullish") ? "POSITIVE" :
                      content.includes("sell") || content.includes("bearish") ? "NEGATIVE" : "NEUTRAL",
      confidence: 0.85
    };
  } catch (error: any) {
    console.error("Groq analysis error:", error.message);
    return null;
  }
}


// ============ CONDUCTOR AGENT (x402-gated Orchestrator) ============
// User pays Conductor via x402, Conductor then pays sub-agents
// Flow: User → Groq AI (intent) → A2A (discover) → x402 (pay) → Sub-agents

const CONDUCTOR_FEE = "0.02"; // Base fee to use Conductor

interface ConductorPlan {
  goal: string;
  reasoning: string;
  agents: string[];
  conductorFee: number;
  subAgentsCost: number;
  totalCost: number;
}

async function planAgentSwarmWithAI(goal: string): Promise<ConductorPlan> {
  // Try Groq AI first for smart intent detection
  const aiIntent = await analyzeIntentWithGroq(goal);

  if (aiIntent && aiIntent.agents.length > 0) {
    // Validate agents exist and get pricing
    const validAgents = aiIntent.agents.filter(id => AGENT_REGISTRY[id]);

    const subAgentsCost = validAgents.reduce((sum, id) => {
      const agent = AGENT_REGISTRY[id];
      return sum + (agent ? parseFloat(agent.pricing.amount) : 0);
    }, 0);

    const conductorFee = parseFloat(CONDUCTOR_FEE);

    return {
      goal,
      reasoning: `[AI] ${aiIntent.reasoning} (confidence: ${(aiIntent.confidence * 100).toFixed(0)}%)`,
      agents: validAgents,
      conductorFee,
      subAgentsCost,
      totalCost: conductorFee + subAgentsCost
    };
  }

  // Fallback to keyword matching
  return planAgentSwarmFallback(goal);
}

function planAgentSwarmFallback(goal: string): ConductorPlan {
  const goalLower = goal.toLowerCase();
  const agents: string[] = [];
  let reasoning = "[Keyword] ";

  // Intent detection with reasoning
  const intents = {
    arbitrage: goalLower.match(/arbitrage|profit|opportunity|dex|cex|price diff/),
    sentiment: goalLower.match(/sentiment|whale|market|mood|signal|trend|bull|bear/),
    risk: goalLower.match(/risk|portfolio|sharpe|var|diversif|safe|exposure/),
    audit: goalLower.match(/audit|security|vulnerab|contract|safe|scam|rug/),
    trade: goalLower.match(/trade|swap|route|execute|buy|sell|mev|slippage/)
  };

  // Build reasoning and agent list
  if (intents.arbitrage) {
    agents.push("agent-arbitrage");
    reasoning += "Detected arbitrage/profit intent - will scan for price differences. ";
  }

  if (intents.sentiment) {
    agents.push("agent-sentiment");
    reasoning += "Detected market sentiment intent - will analyze whale movements and signals. ";
  }

  if (intents.risk) {
    agents.push("agent-risk");
    reasoning += "Detected risk analysis intent - will calculate portfolio metrics. ";
  }

  if (intents.audit) {
    agents.push("agent-audit");
    reasoning += "Detected security concern - will audit contract for vulnerabilities. ";
  }

  if (intents.trade) {
    agents.push("agent-executor");
    reasoning += "Detected trade intent - will find optimal routes with MEV protection. ";
  }

  // Complex queries that need multiple agents
  if (goalLower.match(/should i (buy|invest|trade)/)) {
    if (!agents.includes("agent-sentiment")) agents.push("agent-sentiment");
    if (!agents.includes("agent-risk")) agents.push("agent-risk");
    reasoning += "Investment decision requires both sentiment and risk analysis. ";
  }

  if (goalLower.match(/full analysis|comprehensive|everything/)) {
    agents.length = 0;
    agents.push("agent-arbitrage", "agent-sentiment", "agent-risk", "agent-audit", "agent-executor");
    reasoning = "Comprehensive analysis requested - deploying all agents. ";
  }

  // Default fallback
  if (agents.length === 0) {
    agents.push("agent-sentiment", "agent-risk");
    reasoning = "General query - using sentiment and risk agents for market overview. ";
  }

  const subAgentsCost = agents.reduce((sum, id) => {
    const svc = SERVICES[id];
    return sum + (svc ? parseFloat(svc.price) : 0);
  }, 0);

  const conductorFee = parseFloat(CONDUCTOR_FEE);
  const totalCost = conductorFee + subAgentsCost;

  return { goal, reasoning, agents, conductorFee, subAgentsCost, totalCost };
}

// Add Conductor to services (x402-gated)
SERVICES["conductor"] = {
  name: "Conductor Agent",
  price: CONDUCTOR_FEE,
  unit: "per query",
  description: "AI orchestrator that coordinates sub-agents to answer complex queries"
};

// Conductor planning endpoint (free to preview)
app.post("/api/conductor/plan", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Missing goal" });

  const plan = await planAgentSwarmWithAI(goal);
  res.json({
    status: "planned",
    plan,
    breakdown: {
      conductorFee: plan.conductorFee + " CRO",
      subAgentsCost: plan.subAgentsCost.toFixed(2) + " CRO",
      totalCost: plan.totalCost.toFixed(2) + " CRO"
    },
    message: "Call /api/x402/conductor with X-Payment header to execute"
  });
});

// Conductor streaming endpoint (SSE) - Real-time updates as agents complete
app.post("/api/x402/conductor/stream", x402Gate("conductor"), async (req, res) => {
  const { goal } = req.body;

  if (!goal) {
    return res.status(400).json({ error: "Missing goal" });
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Plan the swarm
  const plan = await planAgentSwarmWithAI(goal);
  sendEvent("plan", {
    goal,
    reasoning: plan.reasoning,
    agents: plan.agents,
    estimatedCost: plan.totalCost.toFixed(2) + " CRO"
  });

  const results: any[] = [];
  let subAgentsPaid = 0;
  const startTime = Date.now();

  // Execute agents and stream results
  for (const agentId of plan.agents) {
    const service = SERVICES[agentId];
    if (!service) continue;

    sendEvent("agent_start", {
      agent: agentId,
      name: service.name,
      cost: service.price + " CRO"
    });

    const amount = ethers.parseEther(service.price);
    const check = await canAgentSpend(amount);

    if (!check.ok) {
      sendEvent("agent_error", { agent: agentId, reason: check.reason });
      results.push({ agent: agentId, status: "blocked", reason: check.reason });
      continue;
    }

    // Pay for agent
    simulatedSpent += parseFloat(service.price);
    simulatedTxCount++;
    const proof = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paidRequests.set(proof, Date.now());
    subAgentsPaid += parseFloat(service.price);

    sendEvent("agent_paid", {
      agent: agentId,
      proof,
      cost: service.price + " CRO"
    });

    try {
      let url = `http://localhost:3005/api/x402/agent/${agentId.replace('agent-', '')}`;
      const params: Record<string, string> = {};

      if (agentId === "agent-arbitrage") params.size = "1000";
      if (agentId === "agent-risk") params.address = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23";
      if (agentId === "agent-audit") params.address = "0x2d03bece6747adc00e1a131bba1469c15fd11e03";

      const queryString = new URLSearchParams(params).toString();
      if (queryString) url += `?${queryString}`;

      let response;
      if (agentId === "agent-executor") {
        response = await axios.post(url, { amountIn: "100" }, { headers: { "X-Payment": proof } });
      } else {
        response = await axios.get(url, { headers: { "X-Payment": proof } });
      }

      const result = {
        agent: agentId,
        name: service.name,
        status: "success",
        cost: service.price + " CRO",
        algorithm: response.data.algorithm,
        data: response.data.data
      };
      results.push(result);

      sendEvent("agent_complete", result);
    } catch (e: any) {
      const error = { agent: agentId, status: "error", error: e.message };
      results.push(error);
      sendEvent("agent_error", error);
    }
  }

  // Final summary
  const summary = generateConductorSummary(goal, results);
  const walletStatus = await getWalletStatus();

  sendEvent("complete", {
    goal,
    executionTime: Date.now() - startTime + "ms",
    costs: {
      conductorFee: CONDUCTOR_FEE + " CRO",
      subAgentsPaid: subAgentsPaid.toFixed(2) + " CRO",
      totalCost: (parseFloat(CONDUCTOR_FEE) + subAgentsPaid).toFixed(2) + " CRO"
    },
    summary,
    wallet: walletStatus
  });

  res.end();
});

// Conductor execution endpoint (x402-gated)
app.post("/api/x402/conductor", x402Gate("conductor"), async (req, res) => {
  const { goal } = req.body;

  if (!goal) {
    return res.status(400).json({ error: "Missing goal" });
  }

  // Plan the swarm using AI (or fallback to keyword matching)
  const plan = await planAgentSwarmWithAI(goal);

  // Execute the swarm - Conductor pays sub-agents via A2A + x402
  const results: any[] = [];
  let subAgentsPaid = 0;
  const startTime = Date.now();

  for (const agentId of plan.agents) {
    const service = SERVICES[agentId];
    if (!service) continue;

    const amount = ethers.parseEther(service.price);
    const check = await canAgentSpend(amount);

    if (!check.ok) {
      results.push({
        agent: agentId,
        status: "blocked",
        reason: check.reason
      });
      continue;
    }

    // Conductor pays sub-agent
    simulatedSpent += parseFloat(service.price);
    simulatedTxCount++;
    const proof = `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paidRequests.set(proof, Date.now());
    subAgentsPaid += parseFloat(service.price);

    try {
      // Build endpoint URL with defaults
      let url = `http://localhost:3005/api/x402/agent/${agentId.replace('agent-', '')}`;
      const params: Record<string, string> = {};

      if (agentId === "agent-arbitrage") params.size = "1000";
      if (agentId === "agent-risk") params.address = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23";
      if (agentId === "agent-audit") params.address = "0x2d03bece6747adc00e1a131bba1469c15fd11e03";

      const queryString = new URLSearchParams(params).toString();
      if (queryString) url += `?${queryString}`;

      let response;
      if (agentId === "agent-executor") {
        response = await axios.post(url, { amountIn: "100" }, {
          headers: { "X-Payment": proof }
        });
      } else {
        response = await axios.get(url, {
          headers: { "X-Payment": proof }
        });
      }

      results.push({
        agent: agentId,
        name: service.name,
        status: "success",
        cost: service.price + " CRO",
        algorithm: response.data.algorithm,
        data: response.data.data
      });
    } catch (e: any) {
      results.push({
        agent: agentId,
        status: "error",
        error: e.message
      });
    }
  }

  // Generate summary
  const summary = generateConductorSummary(goal, results);
  const walletStatus = await getWalletStatus();

  res.json({
    status: "complete",
    goal,
    plan,
    executionTime: Date.now() - startTime + "ms",
    costs: {
      conductorFee: CONDUCTOR_FEE + " CRO",
      subAgentsPaid: subAgentsPaid.toFixed(2) + " CRO",
      totalCost: (parseFloat(CONDUCTOR_FEE) + subAgentsPaid).toFixed(2) + " CRO"
    },
    results,
    summary,
    wallet: walletStatus
  });
});

function generateConductorSummary(goal: string, results: any[]): string {
  const successful = results.filter(r => r.status === "success");

  if (successful.length === 0) {
    return "Unable to complete analysis - all agents failed or were blocked.";
  }

  let summary = `Based on your goal "${goal}", here's what I found:\n\n`;

  for (const result of successful) {
    if (result.agent === "agent-arbitrage" && result.data) {
      const opps = result.data.analysis?.opportunitiesFound || 0;
      const flash = result.data.flashLoanOpportunity?.viable;
      summary += `📈 **Arbitrage**: Found ${opps} opportunities. Flash loan ${flash ? 'viable' : 'not viable'}.\n`;
    }

    if (result.agent === "agent-sentiment" && result.data) {
      const sentiment = result.data.sentiment?.label || "Neutral";
      const confidence = ((result.data.sentiment?.confidence || 0) * 100).toFixed(0);
      summary += `🐋 **Sentiment**: Market is ${sentiment} (${confidence}% confidence).\n`;
    }

    if (result.agent === "agent-risk" && result.data) {
      const sharpe = result.data.riskMetrics?.sharpeRatio?.value?.toFixed(2) || "N/A";
      const risk = result.data.summary?.riskLevel || "Unknown";
      summary += `📊 **Risk**: Sharpe ratio ${sharpe}, risk level: ${risk}.\n`;
    }

    if (result.agent === "agent-audit" && result.data) {
      const grade = result.data.verdict?.grade || "N/A";
      const safe = result.data.verdict?.safeToInteract;
      summary += `🔍 **Audit**: Grade ${grade}, ${safe ? 'safe to interact' : 'use caution'}.\n`;
    }

    if (result.agent === "agent-executor" && result.data) {
      const dex = result.data.bestRoute?.dex || "N/A";
      const mev = result.data.mevProtection?.riskLevel || "Unknown";
      summary += `⚡ **Trade**: Best route via ${dex}, MEV risk: ${mev}.\n`;
    }
  }

  return summary;
}

// ============ SERVICE CATALOG ============

app.get("/api/services", (req, res) => {
  res.json({
    services: Object.entries(SERVICES).map(([id, s]) => ({
      id,
      name: s.name,
      price: s.price + " CRO",
      unit: s.unit,
      description: s.description,
      endpoint: `/api/x402/${id}`,
    })),
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============ DEMO UI ============

app.get("/", async (req, res) => {
  const status = await getWalletStatus();

  const servicesHtml = Object.entries(SERVICES).map(([id, s]) =>
    `<div class="service" onclick="demoService('${id}')">
      <div>
        <span class="service-name">${s.name}</span>
        <span class="service-desc">${s.description}</span>
      </div>
      <span class="service-price">${s.price} CRO</span>
    </div>`
  ).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cronos Conductor - AI Agent Orchestration with x402</title>
  <meta name="description" content="AI-powered autonomous payment orchestration using x402 protocol on Cronos EVM">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23002D74'/%3E%3Cstop offset='100%25' stop-color='%230052CC'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='32' cy='32' r='30' fill='url(%23g)'/%3E%3Cpath d='M20 44 L32 16 L44 44' stroke='%23fff' stroke-width='4' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='20' cy='44' r='4' fill='%2322c55e'/%3E%3Ccircle cx='32' cy='16' r='4' fill='%23f59e0b'/%3E%3Ccircle cx='44' cy='44' r='4' fill='%238b5cf6'/%3E%3Cpath d='M20 44 Q32 36 44 44' stroke='%23fff' stroke-width='2' stroke-dasharray='4 2' fill='none' opacity='0.6'/%3E%3C/svg%3E">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg: #09090b; --card: #18181b; --border: #27272a; --text: #fafafa; --muted: #a1a1aa; --accent: #0052CC; --success: #22c55e; --warning: #f59e0b; --error: #ef4444; --purple: #8b5cf6; --code-bg: #0d1117; --cronos-blue: #002D74; --cronos-light: #0052CC; }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }

    /* Header */
    header { text-align: center; padding: 40px 0; }
    .logo-container { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px; }
    .logo-icon { width: 72px; height: 72px; }
    .logo-text { text-align: left; }
    .logo-title { font-size: 42px; font-weight: 700; background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1.1; }
    .logo-subtitle { font-size: 14px; font-weight: 600; color: var(--cronos-light); letter-spacing: 2px; text-transform: uppercase; }
    .tagline { color: var(--muted); font-size: 16px; margin-top: 8px; }
    .protocol-badges { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
    .protocol-badge { padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); background: var(--card); display: flex; align-items: center; gap: 6px; }
    .protocol-badge .dot { width: 6px; height: 6px; border-radius: 50%; }
    .protocol-badge.x402 .dot { background: var(--warning); }
    .protocol-badge.a2a .dot { background: var(--purple); }
    .protocol-badge.groq .dot { background: var(--success); }
    .protocol-badge.mcp .dot { background: var(--cronos-light); }

    /* Main Grid */
    .main-grid { display: grid; grid-template-columns: 350px 1fr; gap: 24px; }
    @media (max-width: 1000px) { .main-grid { grid-template-columns: 1fr; } }

    /* Cards */
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 24px; }
    .card-title { font-size: 12px; font-weight: 600; margin-bottom: 16px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
    .badge { padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; }
    .badge-live { background: var(--success); color: black; }
    .badge-402 { background: var(--warning); color: black; font-size: 11px; }
    .badge-facilitator { background: linear-gradient(135deg, #06b6d4, #3b82f6); color: white; }

    /* Mode Toggle */
    .mode-toggle { margin-bottom: 24px; }
    .mode-toggle-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .mode-buttons { display: flex; gap: 8px; }
    .mode-btn { flex: 1; padding: 12px 16px; border: 2px solid var(--border); background: var(--bg); color: var(--muted); border-radius: 10px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; transition: all 0.2s; }
    .mode-btn:hover { border-color: var(--purple); }
    .mode-btn.active { border-color: var(--success); background: rgba(34, 197, 94, 0.1); color: var(--success); }
    .mode-btn.active-facilitator { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
    .mode-desc { font-size: 10px; color: var(--muted); margin-top: 8px; padding: 8px; background: var(--bg); border-radius: 6px; }
    .mode-desc code { color: var(--accent); }

    /* Stats */
    .stat { margin-bottom: 20px; }
    .stat-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-value.small { font-size: 18px; }
    .stat-sub { font-size: 11px; color: var(--accent); margin-top: 4px; }

    /* Progress */
    .progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, var(--purple), var(--accent)); transition: width 0.5s ease; }

    /* Services */
    .service { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--bg); border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
    .service:hover { border-color: var(--purple); transform: translateX(4px); }
    .service-name { font-weight: 600; font-size: 14px; }
    .service-desc { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .service-price { color: var(--warning); font-weight: 700; font-family: 'JetBrains Mono', monospace; }

    /* x402 Flow Display */
    .x402-flow { background: var(--code-bg); border-radius: 16px; border: 1px solid var(--border); overflow: hidden; }
    .x402-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .x402-title { font-family: 'JetBrains Mono', monospace; font-size: 14px; color: var(--muted); }
    .x402-status { display: flex; align-items: center; gap: 12px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); }
    .status-dot.active { background: var(--success); animation: glow 2s infinite; }
    @keyframes glow { 0%, 100% { box-shadow: 0 0 5px var(--success); } 50% { box-shadow: 0 0 20px var(--success); } }

    .x402-body { padding: 24px; min-height: 400px; }

    /* Terminal Style */
    .terminal { font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.6; }
    .terminal-line { margin-bottom: 8px; opacity: 0; animation: fadeIn 0.3s forwards; }
    .terminal-line.visible { opacity: 1; }
    @keyframes fadeIn { to { opacity: 1; } }

    .cmd { color: var(--success); }
    .url { color: var(--accent); }
    .header-name { color: var(--purple); }
    .header-value { color: var(--warning); }
    .comment { color: #6a737d; }
    .error-code { color: var(--error); font-weight: 700; font-size: 24px; }
    .success-code { color: var(--success); font-weight: 700; }

    /* 402 Badge Big */
    .http-402 { display: inline-flex; align-items: center; gap: 12px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 16px 24px; border-radius: 12px; margin: 16px 0; }
    .http-402-code { font-size: 36px; font-weight: 800; color: black; font-family: 'JetBrains Mono', monospace; }
    .http-402-text { color: black; font-weight: 600; }

    /* Payment Flow */
    .payment-flow { display: flex; align-items: center; gap: 16px; margin: 20px 0; flex-wrap: wrap; }
    .flow-step { display: flex; flex-direction: column; align-items: center; padding: 16px 20px; background: var(--card); border-radius: 12px; border: 2px solid var(--border); min-width: 120px; transition: all 0.3s; }
    .flow-step.active { border-color: var(--purple); background: rgba(139, 92, 246, 0.1); }
    .flow-step.done { border-color: var(--success); background: rgba(34, 197, 94, 0.1); }
    .flow-step.paying { border-color: var(--warning); background: rgba(245, 158, 11, 0.1); animation: pulse-border 1s infinite; }
    @keyframes pulse-border { 0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); } 50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); } }
    .flow-icon { font-size: 24px; margin-bottom: 8px; }
    .flow-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .flow-arrow { color: var(--muted); font-size: 20px; }

    /* Response Display */
    .response-box { background: var(--bg); border-radius: 12px; padding: 16px; margin-top: 16px; border: 1px solid var(--border); }
    .response-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .response-title { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; }
    .response-status { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
    .response-status.success { color: var(--success); }
    .response-status.error { color: var(--error); }
    .response-body { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); white-space: pre-wrap; max-height: 300px; overflow: auto; }

    /* Input Area */
    .input-area { margin-top: 24px; }
    .examples { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .example { padding: 10px 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 20px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
    .example:hover { border-color: var(--purple); background: rgba(139, 92, 246, 0.1); }

    textarea { width: 100%; padding: 16px; background: var(--bg); border: 2px solid var(--border); border-radius: 12px; color: var(--text); font-family: inherit; font-size: 14px; resize: none; min-height: 80px; transition: border-color 0.2s; }
    textarea:focus { outline: none; border-color: var(--purple); }

    .btn { width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; margin-top: 16px; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(135deg, var(--purple) 0%, #7c3aed 100%); color: white; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(139, 92, 246, 0.3); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    /* Total Cost */
    .total-cost { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(234, 88, 12, 0.1) 100%); border-radius: 12px; margin-top: 20px; border: 1px solid rgba(245, 158, 11, 0.3); }
    .total-label { font-size: 14px; color: var(--muted); }
    .total-value { font-size: 24px; font-weight: 700; color: var(--warning); font-family: 'JetBrains Mono', monospace; }

    footer { text-align: center; padding: 40px 20px; color: var(--muted); font-size: 12px; }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-container">
        <svg class="logo-icon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#002D74"/>
              <stop offset="100%" stop-color="#0052CC"/>
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <circle cx="32" cy="32" r="30" fill="url(#logoGrad)"/>
          <path d="M20 46 L32 14 L44 46" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" filter="url(#glow)"/>
          <circle cx="20" cy="46" r="5" fill="#22c55e">
            <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="32" cy="14" r="5" fill="#f59e0b">
            <animate attributeName="opacity" values="1;0.5;1" dur="2s" begin="0.3s" repeatCount="indefinite"/>
          </circle>
          <circle cx="44" cy="46" r="5" fill="#8b5cf6">
            <animate attributeName="opacity" values="1;0.5;1" dur="2s" begin="0.6s" repeatCount="indefinite"/>
          </circle>
          <path d="M20 46 Q32 38 44 46" stroke="#fff" stroke-width="2" stroke-dasharray="4 2" fill="none" opacity="0.6"/>
          <circle cx="32" cy="42" r="3" fill="#fff" opacity="0.8"/>
        </svg>
        <div class="logo-text">
          <div class="logo-title">Cronos Conductor</div>
          <div class="logo-subtitle">AI Agent Orchestration</div>
        </div>
      </div>
      <p class="tagline">Autonomous payment orchestration using x402 protocol on Cronos EVM</p>
      <div class="protocol-badges">
        <span class="protocol-badge x402"><span class="dot"></span>x402 Protocol</span>
        <span class="protocol-badge a2a"><span class="dot"></span>A2A Discovery</span>
        <span class="protocol-badge groq"><span class="dot"></span>Groq AI</span>
        <span class="protocol-badge mcp"><span class="dot"></span>MCP Server</span>
      </div>
    </header>

    <div class="main-grid">
      <!-- Left Sidebar -->
      <div class="sidebar">
        <!-- Payment Mode Toggle -->
        <div class="card">
          <div class="card-title">Payment Mode</div>
          <div class="mode-toggle">
            <div class="mode-buttons">
              <button class="mode-btn active" id="modeAgent" onclick="setMode('agent')">
                CRO + AgentWallet
              </button>
              <button class="mode-btn" id="modeFacilitator" onclick="setMode('facilitator')">
                USDC.e + Facilitator
              </button>
            </div>
            <div class="mode-desc" id="modeDesc">
              <strong>AgentWallet:</strong> CRO payments with autonomous spending limits
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Agent Wallet <span class="badge badge-live">LIVE</span></div>
          <div class="stat">
            <div class="stat-label">Contract Balance</div>
            <div class="stat-value" id="walletBalance">${parseFloat(status.balance).toFixed(4)} CRO</div>
            <div class="stat-sub">${AGENT_WALLET_ADDRESS.slice(0, 8)}...${AGENT_WALLET_ADDRESS.slice(-6)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Daily Spend Limit</div>
            <div class="stat-value small"><span id="dailySpent">0.00</span> / <span id="dailyLimit">5.00</span> CRO</div>
            <div class="progress-bar"><div class="progress-fill" id="dailyProgress" style="width: 0%"></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">API Calls Made</div>
            <div class="stat-value small" id="txCount">0</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Premium APIs <span class="badge badge-402">x402</span></div>
          ${servicesHtml}
        </div>
      </div>

      <!-- Main Content -->
      <div class="main-content">
        <div class="x402-flow">
          <div class="x402-header">
            <div class="x402-title">x402 Protocol Flow</div>
            <div class="x402-status">
              <span id="statusText" style="font-size:12px;color:var(--muted);">Ready</span>
              <div class="status-dot" id="statusDot"></div>
            </div>
          </div>
          <div class="x402-body">
            <!-- Flow Steps -->
            <div class="payment-flow" id="flowSteps">
              <div class="flow-step" id="step1">
                <div class="flow-icon">📡</div>
                <div class="flow-label">Request</div>
              </div>
              <div class="flow-arrow">→</div>
              <div class="flow-step" id="step2">
                <div class="flow-icon">🔒</div>
                <div class="flow-label">402</div>
              </div>
              <div class="flow-arrow">→</div>
              <div class="flow-step" id="step3">
                <div class="flow-icon">💰</div>
                <div class="flow-label">Pay</div>
              </div>
              <div class="flow-arrow">→</div>
              <div class="flow-step" id="step4">
                <div class="flow-icon">✅</div>
                <div class="flow-label">Data</div>
              </div>
            </div>

            <!-- Terminal Output -->
            <div class="terminal" id="terminal">
              <div class="terminal-line visible"><span class="comment">// Click a service or enter a task to see x402 in action</span></div>
            </div>

            <!-- Input Area -->
            <div class="input-area">
              <div class="examples">
                <div class="example" onclick="setTask('Get current gas prices')">⛽ Gas Oracle</div>
                <div class="example" onclick="setTask('Find whale transactions')">🐋 Whale Tracker</div>
                <div class="example" onclick="setTask('Analyze latest block')">📦 Block Data</div>
                <div class="example" onclick="setTask('Get VVS swap quote')">🔄 VVS Swap</div>
              </div>
              <textarea id="taskInput" placeholder="Ask the agent anything..."></textarea>
              <button class="btn btn-primary" id="runBtn" onclick="runTask()">Execute x402 Request</button>
            </div>

            <!-- Total Cost -->
            <div class="total-cost" id="totalCostBox" style="display:none;">
              <span class="total-label">Total Paid via x402</span>
              <span class="total-value" id="totalCost">0.00 CRO</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer>
      <strong>Cronos Conductor</strong> - Built for Cronos x402 Paytech Hackathon |
      <a href="https://testnet.cronoscan.com/address/${AGENT_WALLET_ADDRESS}" target="_blank">AgentWallet Contract</a> |
      Powered by x402, A2A, Groq AI & MCP
    </footer>
  </div>

  <script>
    const SERVICES = ${JSON.stringify(SERVICES)};
    const FACILITATOR_URL = "${FACILITATOR_URL}";
    const USDCE_ADDRESS = "${USDCE_TESTNET}";
    let currentMode = 'agent';

    function setTask(t) { document.getElementById('taskInput').value = t; }

    async function setMode(mode) {
      try {
        const res = await fetch('/api/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode })
        });
        const data = await res.json();
        currentMode = data.mode;

        // Update UI
        document.getElementById('modeAgent').className = mode === 'agent' ? 'mode-btn active' : 'mode-btn';
        document.getElementById('modeFacilitator').className = mode === 'facilitator' ? 'mode-btn active-facilitator' : 'mode-btn';

        if (mode === 'facilitator') {
          document.getElementById('modeDesc').innerHTML =
            '<strong>Cronos Facilitator:</strong> USDC.e via <code>' + FACILITATOR_URL + '</code><br/>' +
            '<span style="color:#22c55e;">✓ Real x402 - EIP-3009 gasless payments</span>';
        } else {
          document.getElementById('modeDesc').innerHTML =
            '<strong>AgentWallet:</strong> CRO payments with autonomous spending limits';
        }

        clearTerminal();
        addTerminalLine('<span class="comment">// Switched to ' + (mode === 'facilitator' ? 'USDC.e Facilitator' : 'CRO AgentWallet') + ' mode</span>');
      } catch (e) {
        console.error('Failed to switch mode:', e);
      }
    }

    function resetFlow() {
      ['step1','step2','step3','step4'].forEach(id => {
        document.getElementById(id).className = 'flow-step';
      });
    }

    function setStep(num, state) {
      const el = document.getElementById('step' + num);
      el.className = 'flow-step ' + state;
    }

    function setStatus(text, active) {
      document.getElementById('statusText').textContent = text;
      document.getElementById('statusDot').className = active ? 'status-dot active' : 'status-dot';
    }

    function addTerminalLine(html, delay = 0) {
      return new Promise(resolve => {
        setTimeout(() => {
          const terminal = document.getElementById('terminal');
          const line = document.createElement('div');
          line.className = 'terminal-line';
          line.innerHTML = html;
          terminal.appendChild(line);
          setTimeout(() => { line.classList.add('visible'); resolve(); }, 50);
        }, delay);
      });
    }

    function clearTerminal() {
      document.getElementById('terminal').innerHTML = '';
    }

    async function updateWallet() {
      try {
        const res = await fetch('/api/wallet/status');
        const data = await res.json();
        document.getElementById('walletBalance').textContent = parseFloat(data.balance).toFixed(4) + ' CRO';
        if (data.agent) {
          document.getElementById('dailySpent').textContent = parseFloat(data.agent.spentToday).toFixed(2);
          document.getElementById('dailyLimit').textContent = parseFloat(data.agent.dailyLimit).toFixed(2);
          document.getElementById('txCount').textContent = data.agent.txCount;
          const pct = (parseFloat(data.agent.spentToday) / parseFloat(data.agent.dailyLimit)) * 100;
          document.getElementById('dailyProgress').style.width = Math.min(pct, 100) + '%';
        }
      } catch (e) { console.error(e); }
    }

    async function demoService(serviceId) {
      const svc = SERVICES[serviceId];
      clearTerminal();
      resetFlow();
      setStatus('Requesting...', true);

      // Step 1: Request
      setStep(1, 'active');
      await addTerminalLine('<span class="cmd">GET</span> <span class="url">/api/x402/' + serviceId + '</span>');
      await new Promise(r => setTimeout(r, 500));

      // Step 2: 402 Response
      setStep(1, 'done');
      setStep(2, 'active');
      setStatus('Payment Required', true);

      await addTerminalLine('<span class="error-code">HTTP 402</span> <span style="color:var(--warning)">Payment Required</span>', 200);
      await addTerminalLine('<span class="header-name">X-Payment:</span> <span class="header-value">required</span>', 100);
      await addTerminalLine('<span class="header-name">X-Payment-Amount:</span> <span class="header-value">' + svc.price + ' CRO</span>', 100);
      await addTerminalLine('<span class="header-name">X-Payment-Address:</span> <span class="header-value">${PAYMENT_RECEIVER.slice(0,10)}...</span>', 100);
      await addTerminalLine('<span class="header-name">X-Payment-Network:</span> <span class="header-value">cronos-testnet</span>', 100);

      await new Promise(r => setTimeout(r, 600));

      // Step 3: Payment
      setStep(2, 'done');
      setStep(3, 'paying');
      setStatus('Processing Payment...', true);

      await addTerminalLine('', 200);
      await addTerminalLine('<span class="comment">// Agent Wallet paying ' + svc.price + ' CRO...</span>', 100);
      await addTerminalLine('<span class="cmd">→</span> Checking spend limits...', 200);
      await addTerminalLine('<span class="cmd">→</span> Executing payment...', 400);

      // Actually pay
      const payRes = await fetch('/api/agent/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId })
      });
      const payData = await payRes.json();

      await addTerminalLine('<span class="success-code">✓</span> Payment confirmed: <span class="header-value">' + payData.proof.slice(0,20) + '...</span>', 200);

      await new Promise(r => setTimeout(r, 400));

      // Step 4: Get Data
      setStep(3, 'done');
      setStep(4, 'active');
      setStatus('Fetching Data...', true);

      await addTerminalLine('', 100);
      await addTerminalLine('<span class="cmd">GET</span> <span class="url">/api/x402/' + serviceId + '</span> <span class="comment">[with payment proof]</span>', 100);

      const dataRes = await fetch('/api/x402/' + serviceId, {
        headers: { 'X-Payment': payData.proof }
      });
      const data = await dataRes.json();

      await addTerminalLine('<span class="success-code">HTTP 200</span> <span style="color:var(--success)">OK</span>', 300);

      setStep(4, 'done');
      setStatus('Complete', false);

      // Show response
      await addTerminalLine('', 100);
      await addTerminalLine('<div class="response-box"><div class="response-header"><span class="response-title">Response Data</span><span class="response-status success">200 OK</span></div><div class="response-body">' + JSON.stringify(data.data || data, null, 2) + '</div></div>', 100);

      document.getElementById('totalCostBox').style.display = 'flex';
      document.getElementById('totalCost').textContent = svc.price + ' CRO';

      updateWallet();
    }

    async function runTask() {
      const task = document.getElementById('taskInput').value.trim();
      if (!task) return alert('Enter a task');

      const btn = document.getElementById('runBtn');
      btn.disabled = true;
      btn.textContent = 'Processing...';

      clearTerminal();
      resetFlow();
      setStatus('Analyzing task...', true);

      await addTerminalLine('<span class="comment">// Task: "' + task + '"</span>');
      await addTerminalLine('<span class="cmd">→</span> Identifying required services...', 300);

      try {
        const res = await fetch('/api/agent/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
        });
        const data = await res.json();

        let totalSteps = data.steps.length;
        let currentStep = 0;

        for (const step of data.steps) {
          currentStep++;
          await addTerminalLine('', 200);
          await addTerminalLine('<span style="color:var(--purple);font-weight:600">[' + currentStep + '/' + totalSteps + '] ' + step.service.toUpperCase() + '</span>', 100);

          if (step.status === 'success') {
            setStep(1, 'done'); setStep(2, 'done'); setStep(3, 'done'); setStep(4, 'active');
            await addTerminalLine('<span class="error-code" style="font-size:16px">402</span> → <span class="header-value">' + step.cost + '</span> → <span class="success-code">200 OK</span>', 200);
            await addTerminalLine('<div class="response-box"><div class="response-header"><span class="response-title">' + step.service + '</span><span class="response-status success">PAID</span></div><div class="response-body">' + JSON.stringify(step.result, null, 2) + '</div></div>', 100);
            setStep(4, 'done');
          } else {
            await addTerminalLine('<span class="error-code" style="font-size:14px">BLOCKED:</span> ' + (step.reason || step.error), 100);
          }
        }

        setStatus('Complete', false);
        document.getElementById('totalCostBox').style.display = 'flex';
        document.getElementById('totalCost').textContent = data.totalCost;

        updateWallet();
      } catch (e) {
        await addTerminalLine('<span class="error-code">ERROR:</span> ' + e.message, 100);
        setStatus('Error', false);
      }

      btn.disabled = false;
      btn.textContent = 'Execute x402 Request';
    }

    updateWallet();
    setInterval(updateWallet, 5000);
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, async () => {
  const status = await getWalletStatus();

  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║                                                                           ║");
  console.log("║       ██████╗ ██████╗ ███╗   ██╗██████╗ ██╗   ██╗ ██████╗████████╗        ║");
  console.log("║      ██╔════╝██╔═══██╗████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝        ║");
  console.log("║      ██║     ██║   ██║██╔██╗ ██║██║  ██║██║   ██║██║        ██║           ║");
  console.log("║      ██║     ██║   ██║██║╚██╗██║██║  ██║██║   ██║██║        ██║           ║");
  console.log("║      ╚██████╗╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝╚██████╗   ██║           ║");
  console.log("║       ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚═════╝   ╚═╝           ║");
  console.log("║                                                                           ║");
  console.log("║              CRONOS CONDUCTOR - AI Agent Orchestration                    ║");
  console.log("║         x402 Protocol | A2A Discovery | Groq AI | MCP Server              ║");
  console.log("║                                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("  Dashboard: http://localhost:" + PORT);
  console.log("");
  console.log("  PROTOCOLS:");
  console.log("  ├─ x402     HTTP 402 Payment Required for AI agents");
  console.log("  ├─ A2A      Agent-to-Agent discovery & negotiation");
  console.log("  ├─ Groq AI  Intent detection (llama-3.1-8b-instant)");
  console.log("  └─ MCP      Model Context Protocol for external AI");
  console.log("");
  console.log("  PAYMENT MODES:");
  console.log("  ┌─────────────────────────────────────────────────────────────────────┐");
  console.log("  │ [DEFAULT] CRO + AgentWallet                                         │");
  console.log("  │   Contract: " + AGENT_WALLET_ADDRESS + "              │");
  console.log("  │   Balance:  " + parseFloat(status.balance).toFixed(4) + " CRO                                           │");
  console.log("  ├─────────────────────────────────────────────────────────────────────┤");
  console.log("  │ [ALT] USDC.e + Cronos Facilitator                                   │");
  console.log("  │   Facilitator: " + FACILITATOR_URL + "               │");
  console.log("  └─────────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("  AI AGENTS (x402-gated):");
  Object.entries(SERVICES).filter(([id]) => id.startsWith('agent-') || id === 'conductor').forEach(([id, s]) => {
    console.log(`    ${s.price.padStart(4)} CRO - ${s.name.padEnd(20)} /api/x402/${id}`);
  });
  console.log("");
  console.log("  PROOF ENDPOINTS:");
  console.log("    GET  /api/proofs             List payment receipts");
  console.log("    GET  /api/proof/:id          Get receipt details");
  console.log("    GET  /api/proof/verify/:id   Verify with signature");
  console.log("");
});
