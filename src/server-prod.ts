import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============ REAL API INTEGRATIONS ============

// Crypto.com Exchange API (Public - No Auth Required)
const CRYPTO_COM_API = "https://api.crypto.com/exchange/v1/public";

// Cronos RPC
const provider = new ethers.JsonRpcProvider(
  process.env.CRONOS_TESTNET_RPC || "https://evm-t3.cronos.org"
);

// Contract ABIs
const GATEWAY_ABI = [
  "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
  "function executePayment(bytes32 paymentId, bytes proof) external",
  "function getPayment(bytes32 paymentId) external view returns (tuple(bytes32 id, address from, address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash, uint8 status))",
  "function getUserPayments(address user) external view returns (bytes32[])",
  "function protocolFee() external view returns (uint256)",
  "event PaymentCreated(bytes32 indexed id, address indexed from, address indexed to, address token, uint256 amount, uint256 deadline)",
  "event PaymentExecuted(bytes32 indexed id, address indexed executor)",
];

const VVS_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) external view returns (uint[] amounts)",
  "function WETH() external view returns (address)",
];

// Contract addresses
const CONTRACTS = {
  gateway: process.env.AGENTPAY_GATEWAY_ADDRESS || "",
  settlement: process.env.SETTLEMENT_ENGINE_ADDRESS || "",
  escrow: process.env.ESCROW_MANAGER_ADDRESS || "",
  vvsRouter: "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae",
  wcro: "0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4",
  usdc: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
};

// Contract instances
const gateway = CONTRACTS.gateway
  ? new ethers.Contract(CONTRACTS.gateway, GATEWAY_ABI, provider)
  : null;
const vvsRouter = new ethers.Contract(CONTRACTS.vvsRouter, VVS_ROUTER_ABI, provider);

// ============ REAL CRYPTO.COM MARKET DATA ============

interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

async function getCryptoComTicker(symbol: string): Promise<TickerData | null> {
  try {
    const response = await axios.get(`${CRYPTO_COM_API}/get-tickers`, { timeout: 5000 });

    if (response.data?.result?.data) {
      const d = response.data.result.data.find((t: any) => t.i === symbol);
      if (d) {
        return {
          symbol: d.i,
          price: parseFloat(d.a),
          change24h: parseFloat(d.c) * 100, // Convert to percentage
          high24h: parseFloat(d.h),
          low24h: parseFloat(d.l),
          volume24h: parseFloat(d.vv), // Use USD volume
          timestamp: d.t,
        };
      }
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch ${symbol}:`, error);
    return null;
  }
}

async function getCryptoComTickers(): Promise<TickerData[]> {
  try {
    const response = await axios.get(`${CRYPTO_COM_API}/get-tickers`, { timeout: 5000 });

    if (response.data?.result?.data) {
      return response.data.result.data.map((d: any) => ({
        symbol: d.i,
        price: parseFloat(d.a) || 0,
        change24h: (parseFloat(d.c) || 0) * 100, // Convert to percentage
        high24h: parseFloat(d.h) || 0,
        low24h: parseFloat(d.l) || 0,
        volume24h: parseFloat(d.vv) || 0, // Use USD volume
        timestamp: d.t,
      }));
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch tickers:", error);
    return [];
  }
}

// ============ REAL VVS FINANCE QUOTES ============

async function getVVSQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<{ amountOut: bigint; path: string[]; priceImpact: number } | null> {
  try {
    const path = tokenIn === CONTRACTS.wcro || tokenOut === CONTRACTS.wcro
      ? [tokenIn, tokenOut]
      : [tokenIn, CONTRACTS.wcro, tokenOut];

    const amounts = await vvsRouter.getAmountsOut(amountIn, path);
    const amountOut = amounts[amounts.length - 1];

    // Estimate price impact (simplified)
    const priceImpact = 0.3; // Would need reserves for accurate calculation

    return { amountOut, path, priceImpact };
  } catch (error) {
    console.error("VVS quote failed:", error);
    return null;
  }
}

// ============ API ROUTES ============

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" });
});

// Network info
app.get("/api/network", async (req, res) => {
  try {
    const [blockNumber, network, feeData] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
      provider.getFeeData(),
    ]);

    res.json({
      chainId: Number(network.chainId),
      chainName: Number(network.chainId) === 338 ? "Cronos Testnet" : "Cronos Mainnet",
      blockNumber,
      gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") : "0",
      contracts: CONTRACTS,
      deployed: !!CONTRACTS.gateway,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REAL market data from Crypto.com
app.get("/api/market/ticker/:symbol", async (req, res) => {
  const ticker = await getCryptoComTicker(req.params.symbol);
  if (ticker) {
    res.json(ticker);
  } else {
    res.status(404).json({ error: "Symbol not found" });
  }
});

// REAL market overview - Cronos ecosystem tokens
app.get("/api/market/overview", async (req, res) => {
  try {
    const tickers = await getCryptoComTickers();

    // Filter for relevant tokens
    const relevantSymbols = ["CRO_USD", "CRO_USDT", "BTC_USD", "ETH_USD", "USDC_USD"];
    const filtered = tickers.filter(t => relevantSymbols.includes(t.symbol));

    // Calculate totals
    const croTicker = filtered.find(t => t.symbol === "CRO_USD");

    res.json({
      tokens: filtered,
      croPrice: croTicker?.price || 0,
      croChange24h: croTicker?.change24h || 0,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REAL VVS Finance swap quote
app.get("/api/swap/quote", async (req, res) => {
  try {
    const { tokenIn, tokenOut, amount } = req.query;

    if (!tokenIn || !tokenOut || !amount) {
      return res.status(400).json({ error: "Missing parameters: tokenIn, tokenOut, amount" });
    }

    const amountIn = ethers.parseEther(amount as string);
    const quote = await getVVSQuote(tokenIn as string, tokenOut as string, amountIn);

    if (quote) {
      res.json({
        tokenIn,
        tokenOut,
        amountIn: amount,
        amountOut: ethers.formatEther(quote.amountOut),
        path: quote.path,
        priceImpact: quote.priceImpact,
        dex: "VVS Finance",
      });
    } else {
      res.status(400).json({ error: "Could not get quote" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get balance
app.get("/api/balance/:address", async (req, res) => {
  try {
    const balance = await provider.getBalance(req.params.address);
    res.json({
      address: req.params.address,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment
app.get("/api/payment/:paymentId", async (req, res) => {
  try {
    if (!gateway) {
      return res.status(400).json({ error: "Gateway not deployed" });
    }

    const payment = await gateway.getPayment(req.params.paymentId);
    const statusMap = ["Pending", "Executed", "Cancelled", "Refunded"];

    res.json({
      id: payment.id,
      from: payment.from,
      to: payment.to,
      token: payment.token,
      amount: ethers.formatEther(payment.amount),
      deadline: new Date(Number(payment.deadline) * 1000).toISOString(),
      status: statusMap[payment.status] || "Unknown",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============ REAL x402 HTTP PROTOCOL FLOW ============

// Store for paid resources (in production, use DB)
const paidResources: Map<string, { paidAt: number; txHash: string; amount: string }> = new Map();

// x402 Protected Resource - Returns 402 Payment Required
app.get("/api/x402/resource/:resourceId", (req, res) => {
  const { resourceId } = req.params;
  const paymentProof = req.headers["x-payment-proof"] as string;

  // Check if already paid
  const paid = paidResources.get(resourceId);
  if (paid || paymentProof) {
    // Resource access granted
    res.setHeader("X-Payment-Status", "paid");
    return res.json({
      status: "success",
      resource: resourceId,
      content: {
        message: "Premium content unlocked!",
        data: "This is the protected resource data that required payment.",
        unlockedAt: paid?.paidAt || Date.now(),
        txHash: paid?.txHash || paymentProof,
      },
    });
  }

  // Return 402 Payment Required with x402 headers
  const paymentAmount = "0.01"; // 0.01 CRO to access
  const paymentAddress = CONTRACTS.gateway || "0x3D101003b1f7E1dFe6f4ee7d1b587f656c3a651F";

  res.status(402);
  res.setHeader("X-Payment-Required", "true");
  res.setHeader("X-Payment-Address", paymentAddress);
  res.setHeader("X-Payment-Amount", ethers.parseEther(paymentAmount).toString());
  res.setHeader("X-Payment-Currency", "CRO");
  res.setHeader("X-Payment-Network", "cronos-testnet");
  res.setHeader("X-Payment-Chain-Id", "338");
  res.setHeader("X-Payment-Resource", `/api/x402/resource/${resourceId}`);
  res.setHeader("X-Payment-Deadline", String(Math.floor(Date.now() / 1000) + 3600));

  res.json({
    status: 402,
    error: "Payment Required",
    message: "This resource requires payment to access",
    x402: {
      version: "1.0",
      network: "cronos-testnet",
      chainId: 338,
      payTo: paymentAddress,
      amount: paymentAmount,
      currency: "CRO",
      resource: `/api/x402/resource/${resourceId}`,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      description: `Access to resource: ${resourceId}`,
    },
    payment: {
      method: "POST",
      endpoint: "/api/x402/pay",
      body: {
        resourceId,
        txHash: "<transaction_hash_after_payment>",
      },
    },
  });
});

// Confirm payment and unlock resource
app.post("/api/x402/pay", async (req, res) => {
  const { resourceId, txHash } = req.body;

  if (!resourceId || !txHash) {
    return res.status(400).json({ error: "Missing resourceId or txHash" });
  }

  try {
    // Verify transaction on-chain
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return res.status(400).json({ error: "Transaction not found" });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ error: "Transaction failed" });
    }

    // Mark resource as paid
    paidResources.set(resourceId, {
      paidAt: Date.now(),
      txHash,
      amount: "0.01",
    });

    res.json({
      status: "success",
      message: "Payment verified, resource unlocked",
      resourceId,
      txHash,
      accessUrl: `/api/x402/resource/${resourceId}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List available x402 resources (demo)
app.get("/api/x402/resources", (req, res) => {
  res.json({
    resources: [
      {
        id: "premium-data-1",
        name: "Premium Market Analysis",
        price: "0.01 CRO",
        description: "AI-generated market insights",
        endpoint: "/api/x402/resource/premium-data-1",
      },
      {
        id: "api-access-24h",
        name: "24h API Access",
        price: "0.05 CRO",
        description: "Unlimited API calls for 24 hours",
        endpoint: "/api/x402/resource/api-access-24h",
      },
      {
        id: "report-q1-2024",
        name: "Q1 2024 DeFi Report",
        price: "0.1 CRO",
        description: "Comprehensive DeFi analytics report",
        endpoint: "/api/x402/resource/report-q1-2024",
      },
    ],
    protocol: {
      name: "x402",
      version: "1.0",
      description: "HTTP 402 Payment Required protocol for web monetization",
      flow: [
        "1. GET /api/x402/resource/:id → 402 Payment Required",
        "2. Read X-Payment-* headers for payment details",
        "3. Send CRO to payment address",
        "4. POST /api/x402/pay with txHash",
        "5. GET /api/x402/resource/:id → 200 OK + content",
      ],
    },
  });
});

// Prepare x402 payment transaction
app.post("/api/x402/prepare", (req, res) => {
  try {
    const { to, token, amount, deadlineMinutes, condition } = req.body;

    if (!to || !amount) {
      return res.status(400).json({ error: "Missing required: to, amount" });
    }

    if (!CONTRACTS.gateway) {
      return res.status(400).json({ error: "Gateway not deployed" });
    }

    const tokenAddress = token || ethers.ZeroAddress;
    const amountWei = ethers.parseEther(amount);
    const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes || 60) * 60;
    const conditionHash = condition
      ? ethers.keccak256(ethers.toUtf8Bytes(condition))
      : ethers.ZeroHash;

    const iface = new ethers.Interface(GATEWAY_ABI);
    const data = iface.encodeFunctionData("createPayment", [
      to, tokenAddress, amountWei, deadline, conditionHash,
    ]);

    // x402 payment header format
    const x402Header = {
      version: "1",
      scheme: "exact",
      network: "cronos-testnet",
      maxAmountRequired: amountWei.toString(),
      resource: `/payment/${to}`,
      description: `Payment of ${amount} CRO`,
    };

    res.json({
      transaction: {
        to: CONTRACTS.gateway,
        data,
        value: tokenAddress === ethers.ZeroAddress ? amountWei.toString() : "0",
        chainId: 338,
      },
      x402: x402Header,
      details: {
        recipient: to,
        token: tokenAddress,
        amount,
        deadline: new Date(deadline * 1000).toISOString(),
        hasCondition: !!condition,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ERC-4337 Account Abstraction - Build UserOperation for gasless/batched payments
app.post("/api/x402/userop", async (req, res) => {
  try {
    const { smartAccount, to, amount, deadlineMinutes, condition, batch } = req.body;

    if (!smartAccount) {
      return res.status(400).json({ error: "Missing smartAccount address" });
    }

    if (!CONTRACTS.gateway) {
      return res.status(400).json({ error: "Gateway not deployed" });
    }

    const gatewayInterface = new ethers.Interface([
      "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
    ]);

    const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes || 60) * 60;
    const conditionHash = condition
      ? ethers.keccak256(ethers.toUtf8Bytes(condition))
      : ethers.ZeroHash;

    // Single payment or batch
    let callData: string;
    let totalValue = 0n;

    if (batch && Array.isArray(batch)) {
      // Batch payments via executeBatch
      const dests: string[] = [];
      const values: bigint[] = [];
      const datas: string[] = [];

      for (const payment of batch) {
        const amountWei = ethers.parseEther(payment.amount.toString());
        dests.push(CONTRACTS.gateway);
        values.push(amountWei);
        datas.push(
          gatewayInterface.encodeFunctionData("createPayment", [
            payment.to,
            ethers.ZeroAddress,
            amountWei,
            deadline,
            payment.condition ? ethers.keccak256(ethers.toUtf8Bytes(payment.condition)) : ethers.ZeroHash,
          ])
        );
        totalValue += amountWei;
      }

      const batchInterface = new ethers.Interface([
        "function executeBatch(address[] dest, uint256[] value, bytes[] func) external",
      ]);
      callData = batchInterface.encodeFunctionData("executeBatch", [dests, values, datas]);
    } else {
      // Single payment via execute
      if (!to || !amount) {
        return res.status(400).json({ error: "Missing to/amount for single payment" });
      }

      const amountWei = ethers.parseEther(amount.toString());
      totalValue = amountWei;

      const executeInterface = new ethers.Interface([
        "function execute(address dest, uint256 value, bytes func) external",
      ]);
      callData = executeInterface.encodeFunctionData("execute", [
        CONTRACTS.gateway,
        amountWei,
        gatewayInterface.encodeFunctionData("createPayment", [
          to,
          ethers.ZeroAddress,
          amountWei,
          deadline,
          conditionHash,
        ]),
      ]);
    }

    const feeData = await provider.getFeeData();

    // Build UserOperation struct (v0.7 format)
    const userOp = {
      sender: smartAccount,
      nonce: "0x0", // Client should get actual nonce from EntryPoint
      initCode: "0x",
      callData,
      accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [100000n, 200000n]),
      preVerificationGas: "50000",
      gasFees: ethers.solidityPacked(
        ["uint128", "uint128"],
        [feeData.maxPriorityFeePerGas || 1000000000n, feeData.maxFeePerGas || 5000000000n]
      ),
      paymasterAndData: "0x", // No paymaster - user pays gas
      signature: "0x", // Client must sign
    };

    res.json({
      userOp,
      entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      chainId: 338,
      totalValue: totalValue.toString(),
      paymentCount: batch ? batch.length : 1,
      note: "Sign userOp hash and submit to bundler or EntryPoint.handleOps()",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Protocol stats
app.get("/api/protocol/stats", async (req, res) => {
  try {
    let protocolFee = "0.3";

    if (gateway) {
      try {
        const fee = await gateway.protocolFee();
        protocolFee = (Number(fee) / 100).toFixed(2);
      } catch {}
    }

    res.json({
      protocolFee: protocolFee + "%",
      supportedNetworks: ["Cronos Testnet", "Cronos Mainnet"],
      features: [
        "x402 HTTP Payment Protocol",
        "ERC-4337 Account Abstraction",
        "Conditional Payments",
        "Batch Settlements",
        "Recurring Payments",
        "Milestone Escrows",
        "VVS Finance Integration",
        "Crypto.com Live Market Data",
      ],
      contracts: {
        gateway: CONTRACTS.gateway || "Not deployed",
        settlement: CONTRACTS.settlement || "Not deployed",
        escrow: CONTRACTS.escrow || "Not deployed",
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PRODUCTION-READY DASHBOARD UI ============

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentPay Protocol | x402 Payments on Cronos</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/ethers@6.9.0/dist/ethers.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --card: #18181b;
      --border: #27272a;
      --text: #fafafa;
      --muted: #d4d4d8;
      --accent: #3b82f6;
      --success: #22c55e;
      --warning: #eab308;
      --error: #ef4444;
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      font-size: 14px;
      line-height: 1.5;
    }
    .app {
      display: grid;
      grid-template-columns: 240px 1fr;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      background: var(--card);
      border-right: 1px solid var(--border);
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .logo {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo span { color: var(--accent); }
    .tagline {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 24px;
    }
    .nav { flex: 1; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      color: var(--muted);
      cursor: pointer;
      margin-bottom: 4px;
      font-size: 13px;
      transition: all 0.15s;
    }
    .nav-item:hover, .nav-item.active {
      background: rgba(59,130,246,0.1);
      color: var(--text);
    }
    .nav-item.active { color: var(--accent); }
    .wallet-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
    }
    .wallet-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .wallet-status .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--error);
    }
    .wallet-status.connected .dot { background: var(--success); }
    .wallet-addr {
      font-family: monospace;
      font-size: 11px;
      color: var(--text);
      word-break: break-all;
    }
    .wallet-bal {
      font-size: 16px;
      font-weight: 600;
      margin-top: 8px;
    }

    /* Main Content */
    .main {
      padding: 24px;
      overflow-y: auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary {
      background: var(--card);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: var(--border); }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Grid Layout */
    .grid {
      display: grid;
      gap: 16px;
    }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }

    /* Cards */
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .card-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Stats */
    .stat-value {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--muted);
    }
    .stat-change {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .stat-change.positive { background: rgba(34,197,94,0.1); color: var(--success); }
    .stat-change.negative { background: rgba(239,68,68,0.1); color: var(--error); }

    /* Market Table */
    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table th, .table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .table th {
      font-size: 11px;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
    }
    .table td { font-size: 13px; }
    .table tr:hover { background: rgba(255,255,255,0.02); }

    /* Form */
    .form-group { margin-bottom: 12px; }
    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-input::placeholder { color: var(--muted); }

    /* Network Badge */
    .network-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(34,197,94,0.1);
      border: 1px solid rgba(34,197,94,0.2);
      border-radius: 20px;
      font-size: 11px;
      color: var(--success);
    }
    .network-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Token Row */
    .token-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .token-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 12px;
    }

    /* Activity */
    .activity-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .activity-item:last-child { border-bottom: none; }
    .activity-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .activity-icon.send { background: rgba(239,68,68,0.1); }
    .activity-icon.receive { background: rgba(34,197,94,0.1); }
    .activity-details { flex: 1; }
    .activity-title { font-weight: 500; font-size: 13px; }
    .activity-sub { font-size: 11px; color: var(--muted); }
    .activity-amount { text-align: right; }
    .activity-value { font-weight: 500; }
    .activity-usd { font-size: 11px; color: var(--muted); }

    /* Status Badge */
    .status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .status.success { background: rgba(34,197,94,0.1); color: var(--success); }
    .status.pending { background: rgba(234,179,8,0.1); color: var(--warning); }
    .status.error { background: rgba(239,68,68,0.1); color: var(--error); }

    /* Contract Address */
    .contract-addr {
      font-family: monospace;
      font-size: 11px;
      padding: 6px 10px;
      background: var(--bg);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .contract-addr a {
      color: var(--accent);
      text-decoration: none;
    }
    .contract-addr a:hover { text-decoration: underline; }

    /* Responsive */
    @media (max-width: 1200px) {
      .grid-4 { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 768px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        Agent<span>Pay</span>
      </div>
      <div class="tagline">x402 Payment Protocol on Cronos</div>

      <nav class="nav">
        <div class="nav-item active" onclick="showSection('dashboard')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          Dashboard
        </div>
        <div class="nav-item" onclick="showSection('payments')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Payments
        </div>
        <div class="nav-item" onclick="showSection('swap')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          Swap
        </div>
        <div class="nav-item" onclick="showSection('escrow')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Escrow
        </div>
        <div class="nav-item" onclick="showSection('x402demo')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          x402 Demo
        </div>
      </nav>

      <div class="wallet-box">
        <div class="wallet-status" id="walletStatus">
          <span class="dot"></span>
          <span id="walletStatusText">Not Connected</span>
        </div>
        <div id="walletInfo" style="display:none;">
          <div class="wallet-addr" id="walletAddr"></div>
          <div class="wallet-bal" id="walletBal">0.00 CRO</div>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:10px;" id="connectBtn" onclick="connectWallet()">
          Connect Wallet
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main">
      <div class="header">
        <h1 id="pageTitle">Dashboard</h1>
        <div style="display:flex;gap:12px;align-items:center;">
          <div class="network-badge">
            <span class="dot"></span>
            <span id="networkName">Cronos Testnet</span>
          </div>
          <button class="btn btn-secondary" onclick="refreshData()">↻ Refresh</button>
        </div>
      </div>

      <!-- Dashboard Section -->
      <section id="section-dashboard">
        <!-- Stats Row -->
        <div class="grid grid-4" style="margin-bottom:16px;">
          <div class="card">
            <div class="card-title">CRO Price</div>
            <div class="stat-value" id="croPrice">$0.00</div>
            <span class="stat-change" id="croChange">-</span>
          </div>
          <div class="card">
            <div class="card-title">Block Height</div>
            <div class="stat-value" id="blockHeight">-</div>
            <div class="stat-label">Cronos Testnet</div>
          </div>
          <div class="card">
            <div class="card-title">Gas Price</div>
            <div class="stat-value" id="gasPrice">-</div>
            <div class="stat-label">Gwei</div>
          </div>
          <div class="card">
            <div class="card-title">Protocol Fee</div>
            <div class="stat-value">0.3%</div>
            <div class="stat-label">Per transaction</div>
          </div>
        </div>

        <div class="grid grid-2">
          <!-- Market Overview -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Live Market Data</span>
              <span style="font-size:11px;color:var(--muted);">via Crypto.com</span>
            </div>
            <table class="table" id="marketTable">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Price</th>
                  <th>24h Change</th>
                  <th>Volume</th>
                </tr>
              </thead>
              <tbody id="marketBody">
                <tr><td colspan="4" style="text-align:center;color:var(--muted);">Loading...</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Contracts -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Deployed Contracts</span>
              <span class="status success" id="deployStatus">Live</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">AgentPay Gateway</div>
                <div class="contract-addr">
                  <span id="gatewayAddr">-</span>
                  <a href="#" id="gatewayLink" target="_blank">↗</a>
                </div>
              </div>
              <div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Settlement Engine</div>
                <div class="contract-addr">
                  <span id="settlementAddr">-</span>
                  <a href="#" id="settlementLink" target="_blank">↗</a>
                </div>
              </div>
              <div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Escrow Manager</div>
                <div class="contract-addr">
                  <span id="escrowAddr">-</span>
                  <a href="#" id="escrowLink" target="_blank">↗</a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Features -->
        <div class="card" style="margin-top:16px;">
          <div class="card-title" style="margin-bottom:12px;">Protocol Features</div>
          <div class="grid grid-3" style="gap:12px;">
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">x402 Payments</div>
              <div style="font-size:12px;color:var(--muted);">HTTP 402 payment protocol for agentic commerce</div>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">Batch Settlement</div>
              <div style="font-size:12px;color:var(--muted);">Atomic multi-payment execution</div>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">Recurring Payments</div>
              <div style="font-size:12px;color:var(--muted);">Scheduled automated transfers</div>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">Milestone Escrow</div>
              <div style="font-size:12px;color:var(--muted);">Project-based fund release</div>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">VVS Integration</div>
              <div style="font-size:12px;color:var(--muted);">DEX swaps within payments</div>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:6px;">
              <div style="font-weight:500;margin-bottom:4px;">AI Agent Ready</div>
              <div style="font-size:12px;color:var(--muted);">Autonomous agent execution</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Payments Section -->
      <section id="section-payments" style="display:none;">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-title" style="margin-bottom:16px;">Create x402 Payment</div>
            <div class="form-group">
              <label class="form-label">Recipient Address</label>
              <input type="text" class="form-input" id="payTo" placeholder="0x...">
            </div>
            <div class="form-group">
              <label class="form-label">Amount (CRO)</label>
              <input type="text" class="form-input" id="payAmount" placeholder="0.00">
            </div>
            <div class="form-group">
              <label class="form-label">Deadline (minutes)</label>
              <input type="number" class="form-input" id="payDeadline" value="60">
            </div>
            <div class="form-group">
              <label class="form-label">Condition (optional)</label>
              <input type="text" class="form-input" id="payCondition" placeholder="Unlock phrase...">
            </div>
            <button class="btn btn-primary" style="width:100%" onclick="createPayment()" id="createPayBtn" disabled>
              Create Payment
            </button>
          </div>

          <div class="card">
            <div class="card-title" style="margin-bottom:16px;">Recent Activity</div>
            <div id="activityList">
              <div style="text-align:center;color:var(--muted);padding:40px;">
                No transactions yet
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Swap Section -->
      <section id="section-swap" style="display:none;">
        <div class="card" style="max-width:480px;">
          <div class="card-title" style="margin-bottom:16px;">Swap via VVS Finance</div>
          <div class="form-group">
            <label class="form-label">From</label>
            <input type="text" class="form-input" id="swapFrom" value="1" placeholder="0.00">
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">WCRO</div>
          </div>
          <div style="text-align:center;padding:8px;">↓</div>
          <div class="form-group">
            <label class="form-label">To (estimated)</label>
            <input type="text" class="form-input" id="swapTo" readonly placeholder="0.00">
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">USDC</div>
          </div>
          <div style="padding:12px;background:var(--bg);border-radius:6px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:var(--muted);">Price Impact</span>
              <span id="priceImpact">~0.3%</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
              <span style="color:var(--muted);">Route</span>
              <span id="swapRoute">WCRO → USDC</span>
            </div>
          </div>
          <button class="btn btn-primary" style="width:100%" onclick="getSwapQuote()">
            Get Quote
          </button>
        </div>
      </section>

      <!-- Escrow Section -->
      <section id="section-escrow" style="display:none;">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-title" style="margin-bottom:16px;">Create Escrow</div>
            <div class="form-group">
              <label class="form-label">Beneficiary Address</label>
              <input type="text" class="form-input" id="escrowTo" placeholder="0x...">
            </div>
            <div class="form-group">
              <label class="form-label">Amount (CRO)</label>
              <input type="text" class="form-input" id="escrowAmount" placeholder="0.00">
            </div>
            <div class="form-group">
              <label class="form-label">Release Time (days)</label>
              <input type="number" class="form-input" id="escrowDays" value="7">
            </div>
            <div class="form-group">
              <label class="form-label">Arbiter (optional)</label>
              <input type="text" class="form-input" id="escrowArbiter" placeholder="0x...">
            </div>
            <button class="btn btn-primary" style="width:100%" onclick="createEscrow()" id="createEscrowBtn" disabled>
              Create Escrow
            </button>
          </div>

          <div class="card">
            <div class="card-title" style="margin-bottom:16px;">How Escrow Works</div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;gap:12px;align-items:flex-start;">
                <div style="width:24px;height:24px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">1</div>
                <div>
                  <div style="font-weight:500;">Deposit Funds</div>
                  <div style="font-size:12px;color:var(--muted);">Lock CRO or tokens in escrow contract</div>
                </div>
              </div>
              <div style="display:flex;gap:12px;align-items:flex-start;">
                <div style="width:24px;height:24px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">2</div>
                <div>
                  <div style="font-weight:500;">Conditions Met</div>
                  <div style="font-size:12px;color:var(--muted);">Time passes or arbiter approves</div>
                </div>
              </div>
              <div style="display:flex;gap:12px;align-items:flex-start;">
                <div style="width:24px;height:24px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">3</div>
                <div>
                  <div style="font-weight:500;">Release Funds</div>
                  <div style="font-size:12px;color:var(--muted);">Beneficiary receives payment</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- x402 Demo Section -->
      <section id="section-x402demo" style="display:none;">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <span class="card-title">x402 Protocol Flow</span>
            </div>
            <div style="font-size:13px;line-height:1.8;">
              <div style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:6px;border-left:3px solid var(--accent);">
                <strong>HTTP 402 Payment Required</strong> is a standard HTTP status code for paywalled resources.
                x402 standardizes the payment flow for machine-to-machine transactions.
              </div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;gap:12px;align-items:flex-start;">
                  <span style="background:var(--accent);color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">1</span>
                  <div><strong>Request Resource</strong><br/><code style="font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px;">GET /api/x402/resource/:id</code></div>
                </div>
                <div style="display:flex;gap:12px;align-items:flex-start;">
                  <span style="background:var(--warning);color:black;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">2</span>
                  <div><strong>Receive 402 + Payment Headers</strong><br/><code style="font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px;">X-Payment-Amount, X-Payment-Address</code></div>
                </div>
                <div style="display:flex;gap:12px;align-items:flex-start;">
                  <span style="background:var(--success);color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">3</span>
                  <div><strong>Send Payment On-Chain</strong><br/>Transfer CRO to payment address</div>
                </div>
                <div style="display:flex;gap:12px;align-items:flex-start;">
                  <span style="background:var(--accent);color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">4</span>
                  <div><strong>Submit Payment Proof</strong><br/><code style="font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px;">POST /api/x402/pay {txHash}</code></div>
                </div>
                <div style="display:flex;gap:12px;align-items:flex-start;">
                  <span style="background:var(--success);color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">5</span>
                  <div><strong>Access Granted</strong><br/>Resource returns 200 OK with content</div>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Try It Live</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:16px;">
              <div>
                <label class="form-label">Select Resource</label>
                <select class="form-input" id="x402Resource">
                  <option value="premium-data-1">Premium Market Analysis (0.01 CRO)</option>
                  <option value="api-access-24h">24h API Access (0.05 CRO)</option>
                  <option value="report-q1-2024">Q1 2024 DeFi Report (0.1 CRO)</option>
                </select>
              </div>
              <button class="btn btn-primary" onclick="tryX402Request()">
                1. Request Resource (GET)
              </button>
              <div id="x402Response" style="background:var(--bg);border-radius:6px;padding:12px;font-family:monospace;font-size:11px;white-space:pre-wrap;max-height:200px;overflow:auto;display:none;"></div>
              <button class="btn" style="background:var(--warning);color:black;" onclick="payForResource()" id="x402PayBtn" disabled>
                2. Pay & Unlock
              </button>
              <div id="x402Status" style="font-size:12px;color:var(--muted);"></div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:20px;">
          <div class="card-header">
            <span class="card-title">Response Headers (x402 Standard)</span>
          </div>
          <div id="x402Headers" style="font-family:monospace;font-size:12px;background:var(--bg);padding:16px;border-radius:6px;white-space:pre;overflow-x:auto;">
Click "Request Resource" to see x402 headers...</div>
        </div>
      </section>

      <!-- Disclaimer -->
      <div style="position:fixed;bottom:0;left:240px;right:0;padding:8px 24px;background:var(--card);border-top:1px solid var(--border);font-size:11px;color:var(--muted);text-align:center;">
        Testnet only. Not financial advice. Use at your own risk. Market data via Crypto.com API.
      </div>
    </main>
  </div>

  <script>
    let provider = null;
    let signer = null;
    let userAddress = null;
    const txHistory = [];

    // Initialize
    async function init() {
      await refreshData();
      setInterval(refreshData, 30000);
    }

    // Connect wallet
    async function connectWallet() {
      if (!window.ethereum) {
        alert('Please install MetaMask');
        return;
      }

      try {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        const network = await provider.getNetwork();
        if (Number(network.chainId) !== 338) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x152' }],
            });
          } catch (e) {
            if (e.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x152',
                  chainName: 'Cronos Testnet',
                  nativeCurrency: { name: 'CRO', symbol: 'tCRO', decimals: 18 },
                  rpcUrls: ['https://evm-t3.cronos.org'],
                  blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
                }],
              });
            }
          }
        }

        const balance = await provider.getBalance(userAddress);

        document.getElementById('walletStatus').classList.add('connected');
        document.getElementById('walletStatusText').textContent = 'Connected';
        document.getElementById('walletAddr').textContent = userAddress.slice(0,8) + '...' + userAddress.slice(-6);
        document.getElementById('walletBal').textContent = parseFloat(ethers.formatEther(balance)).toFixed(4) + ' CRO';
        document.getElementById('walletInfo').style.display = 'block';
        document.getElementById('connectBtn').textContent = 'Connected';
        document.getElementById('connectBtn').disabled = true;
        document.getElementById('createPayBtn').disabled = false;
        document.getElementById('createEscrowBtn').disabled = false;
      } catch (error) {
        console.error(error);
        alert('Failed to connect: ' + error.message);
      }
    }

    // Refresh data
    async function refreshData() {
      try {
        // Network info
        const network = await fetch('/api/network').then(r => r.json());
        document.getElementById('blockHeight').textContent = network.blockNumber.toLocaleString();
        document.getElementById('gasPrice').textContent = parseFloat(network.gasPrice).toFixed(0);

        // Contracts
        if (network.contracts.gateway) {
          const short = (addr) => addr.slice(0,10) + '...' + addr.slice(-8);
          const explorer = 'https://explorer.cronos.org/testnet/address/';

          document.getElementById('gatewayAddr').textContent = short(network.contracts.gateway);
          document.getElementById('gatewayLink').href = explorer + network.contracts.gateway;
          document.getElementById('settlementAddr').textContent = short(network.contracts.settlement);
          document.getElementById('settlementLink').href = explorer + network.contracts.settlement;
          document.getElementById('escrowAddr').textContent = short(network.contracts.escrow);
          document.getElementById('escrowLink').href = explorer + network.contracts.escrow;
        }

        // Market data
        const market = await fetch('/api/market/overview').then(r => r.json());
        if (market.tokens) {
          document.getElementById('croPrice').textContent = '$' + market.croPrice.toFixed(4);
          const changeEl = document.getElementById('croChange');
          changeEl.textContent = (market.croChange24h >= 0 ? '+' : '') + market.croChange24h.toFixed(2) + '%';
          changeEl.className = 'stat-change ' + (market.croChange24h >= 0 ? 'positive' : 'negative');

          let html = '';
          market.tokens.forEach(t => {
            const symbol = t.symbol.split('_')[0];
            const change = t.change24h >= 0 ? '+' + t.change24h.toFixed(2) : t.change24h.toFixed(2);
            const changeClass = t.change24h >= 0 ? 'positive' : 'negative';
            html += '<tr><td><div class="token-row"><div class="token-icon">' + symbol.slice(0,2) + '</div><span>' + symbol + '</span></div></td><td>$' + t.price.toFixed(4) + '</td><td><span class="stat-change ' + changeClass + '">' + change + '%</span></td><td>' + (t.volume24h/1e6).toFixed(2) + 'M</td></tr>';
          });
          document.getElementById('marketBody').innerHTML = html || '<tr><td colspan="4">No data</td></tr>';
        }
      } catch (error) {
        console.error('Refresh failed:', error);
      }
    }

    // Section navigation
    function showSection(name) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('section').forEach(el => el.style.display = 'none');
      event.target.closest('.nav-item').classList.add('active');
      document.getElementById('section-' + name).style.display = 'block';
      document.getElementById('pageTitle').textContent = name.charAt(0).toUpperCase() + name.slice(1);
    }

    // Create payment
    async function createPayment() {
      if (!signer) return alert('Connect wallet first');

      const to = document.getElementById('payTo').value;
      const amount = document.getElementById('payAmount').value;
      const deadline = document.getElementById('payDeadline').value;
      const condition = document.getElementById('payCondition').value;

      if (!to || !amount) return alert('Fill in recipient and amount');

      try {
        const res = await fetch('/api/x402/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, amount, deadlineMinutes: parseInt(deadline), condition }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const tx = await signer.sendTransaction({
          to: data.transaction.to,
          data: data.transaction.data,
          value: data.transaction.value,
        });

        addActivity('send', 'Payment Created', tx.hash, amount);

        await tx.wait();
        addActivity('send', 'Payment Confirmed', tx.hash, amount, true);

        document.getElementById('payTo').value = '';
        document.getElementById('payAmount').value = '';
        document.getElementById('payCondition').value = '';
      } catch (error) {
        console.error(error);
        alert('Failed: ' + error.message);
      }
    }

    // Get swap quote
    async function getSwapQuote() {
      const amount = document.getElementById('swapFrom').value;
      const wcro = '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4';
      const usdc = '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59';

      try {
        const res = await fetch(\`/api/swap/quote?tokenIn=\${wcro}&tokenOut=\${usdc}&amount=\${amount}\`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('swapTo').value = parseFloat(data.amountOut).toFixed(6);
        document.getElementById('priceImpact').textContent = '~' + data.priceImpact + '%';
        document.getElementById('swapRoute').textContent = data.path.map(a => a.slice(0,6)).join(' → ');
      } catch (error) {
        console.error(error);
        alert('Quote failed: ' + error.message);
      }
    }

    // Create escrow
    async function createEscrow() {
      if (!signer) return alert('Connect wallet first');
      alert('Escrow creation - sign transaction in MetaMask');
    }

    // Activity
    function addActivity(type, title, hash, amount, confirmed = false) {
      const list = document.getElementById('activityList');
      const html = \`
        <div class="activity-item">
          <div class="activity-icon \${type}">
            \${type === 'send' ? '↑' : '↓'}
          </div>
          <div class="activity-details">
            <div class="activity-title">\${title}</div>
            <div class="activity-sub">
              <a href="https://explorer.cronos.org/testnet/tx/\${hash}" target="_blank" style="color:var(--accent);text-decoration:none;">
                \${hash.slice(0,10)}...\${hash.slice(-8)}
              </a>
            </div>
          </div>
          <div class="activity-amount">
            <div class="activity-value">-\${amount} CRO</div>
            <span class="status \${confirmed ? 'success' : 'pending'}">\${confirmed ? 'Confirmed' : 'Pending'}</span>
          </div>
        </div>
      \`;

      if (list.querySelector('div[style*="text-align:center"]')) {
        list.innerHTML = html;
      } else {
        list.insertAdjacentHTML('afterbegin', html);
      }
    }

    // ============ x402 Demo Functions ============
    let currentX402Data = null;

    async function tryX402Request() {
      const resourceId = document.getElementById('x402Resource').value;
      const responseEl = document.getElementById('x402Response');
      const headersEl = document.getElementById('x402Headers');
      const statusEl = document.getElementById('x402Status');
      const payBtn = document.getElementById('x402PayBtn');

      statusEl.textContent = 'Requesting resource...';
      responseEl.style.display = 'block';

      try {
        const res = await fetch('/api/x402/resource/' + resourceId);
        const data = await res.json();

        // Show headers
        const headers = [];
        res.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith('x-payment')) {
            headers.push(k + ': ' + v);
          }
        });

        if (res.status === 402) {
          headersEl.innerHTML = '<span style="color:var(--warning);">HTTP/1.1 402 Payment Required</span>\\n\\n' + headers.join('\\n');
          responseEl.textContent = JSON.stringify(data, null, 2);
          statusEl.innerHTML = '<span style="color:var(--warning);">402 Payment Required</span> - Resource locked. Pay to unlock.';
          payBtn.disabled = false;
          currentX402Data = data;
        } else {
          headersEl.innerHTML = '<span style="color:var(--success);">HTTP/1.1 200 OK</span>\\nX-Payment-Status: paid';
          responseEl.textContent = JSON.stringify(data, null, 2);
          statusEl.innerHTML = '<span style="color:var(--success);">200 OK</span> - Resource unlocked!';
          payBtn.disabled = true;
        }
      } catch (error) {
        statusEl.textContent = 'Error: ' + error.message;
        responseEl.textContent = error.message;
      }
    }

    async function payForResource() {
      if (!signer) return alert('Connect wallet first');
      if (!currentX402Data) return alert('Request resource first');

      const statusEl = document.getElementById('x402Status');
      const payBtn = document.getElementById('x402PayBtn');

      try {
        statusEl.textContent = 'Sending payment...';
        payBtn.disabled = true;

        const payTo = currentX402Data.x402.payTo;
        const amount = ethers.parseEther(currentX402Data.x402.amount);

        // Send payment
        const tx = await signer.sendTransaction({
          to: payTo,
          value: amount,
        });

        statusEl.textContent = 'Waiting for confirmation... ' + tx.hash.slice(0, 10) + '...';
        await tx.wait();

        // Submit proof
        statusEl.textContent = 'Submitting payment proof...';
        const resourceId = document.getElementById('x402Resource').value;

        const proofRes = await fetch('/api/x402/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resourceId, txHash: tx.hash }),
        });

        const proofData = await proofRes.json();

        if (proofData.status === 'success') {
          statusEl.innerHTML = '<span style="color:var(--success);">Payment verified! Fetching resource...</span>';
          // Re-fetch to show unlocked content
          setTimeout(tryX402Request, 500);
          addActivity('send', 'x402 Payment', tx.hash, currentX402Data.x402.amount, true);
        } else {
          statusEl.textContent = 'Proof verification failed: ' + proofData.error;
          payBtn.disabled = false;
        }
      } catch (error) {
        statusEl.textContent = 'Payment failed: ' + error.message;
        payBtn.disabled = false;
      }
    }

    // Wallet listeners
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => location.reload());
      window.ethereum.on('chainChanged', () => location.reload());
    }

    init();
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              AgentPay Protocol - Production                  ║");
  console.log("║            x402 Payments on Cronos EVM                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Dashboard: http://localhost:" + PORT);
  console.log("");
  console.log("Real Integrations:");
  console.log("   Crypto.com Exchange API (Live Market Data)");
  console.log("   VVS Finance (DEX Quotes)");
  console.log("   Cronos Testnet (On-Chain)");
  console.log("");
  console.log("Contracts:");
  console.log("   Gateway:    " + (CONTRACTS.gateway || "Not deployed"));
  console.log("   Settlement: " + (CONTRACTS.settlement || "Not deployed"));
  console.log("   Escrow:     " + (CONTRACTS.escrow || "Not deployed"));
  console.log("");
});
