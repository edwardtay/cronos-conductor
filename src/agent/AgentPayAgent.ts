import { ethers, Wallet } from "ethers";
import Anthropic from "@anthropic-ai/sdk";
import { ContractService, ContractAddresses } from "../services/ContractService";
import { CryptoComService } from "../integrations/CryptoComService";
import { VVSFinanceService } from "../integrations/VVSFinanceService";

/**
 * AgentPay AI Agent
 * Autonomous payment orchestration agent using Claude for decision making
 * Integrates with x402 payment protocol, Crypto.com market data, and VVS Finance
 */

export interface AgentConfig {
  privateKey: string;
  rpcUrl: string;
  contractAddresses: ContractAddresses;
  anthropicApiKey: string;
  isMainnet?: boolean;
}

export interface AgentTask {
  type:
    | "payment"
    | "batch_payment"
    | "recurring"
    | "escrow"
    | "swap"
    | "portfolio_rebalance"
    | "market_analysis"
    | "custom";
  params: Record<string, any>;
  priority?: "low" | "medium" | "high" | "critical";
}

export interface AgentDecision {
  action: string;
  reasoning: string;
  confidence: number;
  params: Record<string, any>;
  risks: string[];
}

export interface PortfolioState {
  balances: Map<string, bigint>;
  positions: Array<{ token: string; amount: bigint; valueUsd: number }>;
  totalValueUsd: number;
  lastUpdated: Date;
}

export class AgentPayAgent {
  private wallet: Wallet;
  private provider: ethers.JsonRpcProvider;
  private contractService: ContractService;
  private cryptoComService: CryptoComService;
  private vvsService: VVSFinanceService;
  private anthropic: Anthropic;
  private taskQueue: AgentTask[] = [];
  private isRunning: boolean = false;
  private portfolio: PortfolioState | null = null;

  constructor(config: AgentConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.contractService = new ContractService(this.provider, config.contractAddresses).connect(this.wallet);
    this.cryptoComService = new CryptoComService();
    this.vvsService = new VVSFinanceService(this.provider, config.isMainnet).connect(this.wallet);
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  // ============ Core Agent Loop ============

  async start(): Promise<void> {
    console.log(`[AgentPay] Starting agent with address: ${this.wallet.address}`);
    this.isRunning = true;

    while (this.isRunning) {
      try {
        // Process task queue
        if (this.taskQueue.length > 0) {
          const task = this.taskQueue.shift()!;
          await this.processTask(task);
        }

        // Check price alerts
        await this.cryptoComService.checkPriceAlerts();

        // Update portfolio state periodically
        await this.updatePortfolioState();

        await this.sleep(5000); // 5 second loop
      } catch (error) {
        console.error("[AgentPay] Error in main loop:", error);
        await this.sleep(10000);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log("[AgentPay] Agent stopped");
  }

  // ============ Task Processing ============

  async processTask(task: AgentTask): Promise<any> {
    console.log(`[AgentPay] Processing task: ${task.type}`);

    switch (task.type) {
      case "payment":
        return this.executePayment(task.params as any);
      case "batch_payment":
        return this.executeBatchPayment(task.params as any);
      case "recurring":
        return this.setupRecurringPayment(task.params as any);
      case "escrow":
        return this.createEscrow(task.params as any);
      case "swap":
        return this.executeSwap(task.params as any);
      case "portfolio_rebalance":
        return this.rebalancePortfolio(task.params as any);
      case "market_analysis":
        return this.analyzeMarket(task.params as any);
      case "custom":
        return this.executeCustomTask(task.params as any);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  addTask(task: AgentTask): void {
    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const taskPriority = priorityOrder[task.priority || "medium"];

    const insertIndex = this.taskQueue.findIndex((t) => {
      const tPriority = priorityOrder[t.priority || "medium"];
      return tPriority > taskPriority;
    });

    if (insertIndex === -1) {
      this.taskQueue.push(task);
    } else {
      this.taskQueue.splice(insertIndex, 0, task);
    }
  }

  // ============ Payment Operations ============

  async executePayment(params: {
    to: string;
    token: string;
    amount: string;
    deadline?: number;
    condition?: string;
  }): Promise<{ paymentId: string; txHash: string }> {
    const amount = ethers.parseUnits(params.amount, 18);
    const deadline = params.deadline || 3600;
    const conditionHash = params.condition ? ethers.keccak256(ethers.toUtf8Bytes(params.condition)) : ethers.ZeroHash;

    const result = await this.contractService.createPayment(params.to, params.token, amount, deadline, conditionHash);

    // Auto-execute if no condition
    if (!params.condition) {
      await this.contractService.executePayment(result.paymentId);
    }

    console.log(`[AgentPay] Payment created: ${result.paymentId}`);
    return result;
  }

  async executeBatchPayment(params: {
    payments: Array<{ to: string; token: string; amount: string }>;
  }): Promise<{ batchId: string; txHash: string }> {
    // Create individual payments first
    const paymentIds: string[] = [];
    for (const payment of params.payments) {
      const amount = ethers.parseUnits(payment.amount, 18);
      const result = await this.contractService.createPayment(payment.to, payment.token, amount, 3600, ethers.ZeroHash);
      paymentIds.push(result.paymentId);
    }

    // Create and execute batch
    const batchResult = await this.contractService.createBatch(paymentIds);
    await this.contractService.executeBatch(batchResult.batchId);

    console.log(`[AgentPay] Batch payment executed: ${batchResult.batchId}`);
    return batchResult;
  }

  async setupRecurringPayment(params: {
    to: string;
    token: string;
    amount: string;
    intervalDays: number;
    count?: number;
  }): Promise<{ scheduleId: string; txHash: string }> {
    const amount = ethers.parseUnits(params.amount, 18);
    const intervalSeconds = params.intervalDays * 24 * 60 * 60;

    const result = await this.contractService.createRecurringPayment(
      params.to,
      params.token,
      amount,
      intervalSeconds,
      params.count || 0
    );

    console.log(`[AgentPay] Recurring payment scheduled: ${result.scheduleId}`);
    return result;
  }

  // ============ Escrow Operations ============

  async createEscrow(params: {
    beneficiary: string;
    arbiter?: string;
    token: string;
    amount: string;
    releaseTimeDays?: number;
    condition?: string;
    milestones?: Array<{ description: string; amount: string }>;
  }): Promise<{ escrowId: string; txHash: string }> {
    if (params.milestones) {
      // Create milestone escrow
      const milestones = params.milestones.map((m) => ({
        description: m.description,
        amount: ethers.parseUnits(m.amount, 18),
      }));

      return this.contractService.createMilestoneEscrow(
        params.beneficiary,
        params.arbiter || this.wallet.address,
        params.token,
        milestones
      );
    }

    const amount = ethers.parseUnits(params.amount, 18);
    const releaseTimeSeconds = (params.releaseTimeDays || 7) * 24 * 60 * 60;
    const conditionHash = params.condition ? ethers.keccak256(ethers.toUtf8Bytes(params.condition)) : ethers.ZeroHash;

    return this.contractService.createEscrow(
      params.beneficiary,
      params.arbiter || ethers.ZeroAddress,
      params.token,
      amount,
      releaseTimeSeconds,
      conditionHash
    );
  }

  // ============ DeFi Operations ============

  async executeSwap(params: {
    tokenIn: string;
    tokenOut: string;
    amount: string;
    maxSlippage?: number;
    optimize?: boolean;
  }): Promise<{ txHash: string; amountOut: string }> {
    const amount = ethers.parseUnits(params.amount, 18);
    const slippage = params.maxSlippage || 50; // 0.5% default

    if (params.optimize) {
      const result = await this.vvsService.executeOptimizedSwap(params.tokenIn, params.tokenOut, amount, 1.0);
      return {
        txHash: result.txHashes[0],
        amountOut: ethers.formatUnits(result.totalAmountOut, 18),
      };
    }

    const result = await this.vvsService.executeSwap(params.tokenIn, params.tokenOut, amount, slippage);
    return {
      txHash: result.txHash,
      amountOut: ethers.formatUnits(result.amountOut, 18),
    };
  }

  async rebalancePortfolio(params: {
    targetAllocations: Record<string, number>; // token -> percentage
    maxSlippage?: number;
  }): Promise<{ trades: Array<{ token: string; action: string; amount: string }> }> {
    await this.updatePortfolioState();
    if (!this.portfolio) throw new Error("Could not fetch portfolio state");

    const decision = await this.getAIDecision(
      `Analyze current portfolio and recommend rebalancing trades:
      Current portfolio: ${JSON.stringify(Array.from(this.portfolio.positions))}
      Target allocations: ${JSON.stringify(params.targetAllocations)}

      Return a JSON object with recommended trades to achieve target allocations.
      Consider gas costs and slippage. Minimize number of trades.`
    );

    console.log(`[AgentPay] AI Rebalance Decision: ${decision.reasoning}`);

    // Execute recommended trades
    const trades: Array<{ token: string; action: string; amount: string }> = [];

    // Parse AI decision and execute trades
    // This is a simplified implementation
    for (const param of Object.entries(decision.params)) {
      const [token, allocation] = param;
      trades.push({ token, action: "rebalance", amount: String(allocation) });
    }

    return { trades };
  }

  // ============ Market Analysis ============

  async analyzeMarket(params: { symbols: string[] }): Promise<{
    analysis: Record<
      string,
      {
        price: number;
        sentiment: string;
        recommendation: string;
      }
    >;
  }> {
    const analysis: Record<string, any> = {};

    for (const symbol of params.symbols) {
      const [price, sentiment] = await Promise.all([
        this.cryptoComService.getPrice(symbol),
        this.cryptoComService.getMarketSentiment(symbol),
      ]);

      analysis[symbol] = {
        price,
        sentiment: sentiment.sentiment,
        confidence: sentiment.confidence,
        indicators: sentiment.indicators,
      };
    }

    // Get AI recommendation
    const decision = await this.getAIDecision(
      `Analyze these market conditions and provide trading recommendations:
      ${JSON.stringify(analysis)}

      Consider volatility, sentiment, and technical indicators.
      Return recommendations for each symbol.`
    );

    // Add AI recommendations to analysis
    for (const symbol of params.symbols) {
      analysis[symbol].recommendation = decision.params[symbol] || "hold";
    }

    return { analysis };
  }

  // ============ AI Decision Making ============

  async getAIDecision(prompt: string): Promise<AgentDecision> {
    const systemPrompt = `You are an AI financial agent managing payments and DeFi operations on Cronos blockchain.
    You make decisions about:
    - Payment execution and timing
    - Portfolio rebalancing
    - Risk management
    - Market analysis

    Always respond with valid JSON in this format:
    {
      "action": "string describing the action to take",
      "reasoning": "explanation of why this action is recommended",
      "confidence": 0.0 to 1.0,
      "params": { /* action-specific parameters */ },
      "risks": ["list", "of", "potential", "risks"]
    }

    Be conservative with financial decisions. Prioritize capital preservation.`;

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    try {
      return JSON.parse(content.text);
    } catch {
      return {
        action: "none",
        reasoning: content.text,
        confidence: 0.5,
        params: {},
        risks: ["Could not parse AI response"],
      };
    }
  }

  // ============ Custom Task Execution ============

  async executeCustomTask(params: { instruction: string }): Promise<any> {
    const decision = await this.getAIDecision(
      `You are given this instruction to execute: "${params.instruction}"

      Available actions:
      - createPayment(to, token, amount, deadline)
      - executeSwap(tokenIn, tokenOut, amount)
      - createEscrow(beneficiary, token, amount)
      - analyzeMarket(symbols)

      Determine what action(s) to take and return the parameters.`
    );

    console.log(`[AgentPay] Custom task decision: ${decision.action}`);
    console.log(`[AgentPay] Reasoning: ${decision.reasoning}`);

    // Execute based on AI decision
    if (decision.confidence < 0.7) {
      console.log("[AgentPay] Low confidence, skipping execution");
      return { status: "skipped", reason: "Low confidence", decision };
    }

    // Map AI action to actual execution
    // This would be expanded based on the AI's response
    return { status: "executed", decision };
  }

  // ============ Portfolio Management ============

  private async updatePortfolioState(): Promise<void> {
    const address = this.wallet.address;

    // Get native CRO balance
    const croBalance = await this.provider.getBalance(address);

    // Get common token balances
    const tokens = [this.vvsService.getAddresses().WCRO, this.vvsService.getAddresses().USDC];

    const balances = new Map<string, bigint>();
    balances.set("CRO", croBalance);

    for (const token of tokens) {
      const balance = await this.vvsService.getTokenBalance(token, address);
      const info = await this.vvsService.getTokenInfo(token);
      balances.set(info.symbol, balance);
    }

    // Get CRO price for USD valuation
    const croPrice = await this.cryptoComService.getPrice("CRO_USD");

    const positions = [];
    let totalValueUsd = 0;

    for (const [symbol, balance] of balances) {
      const valueUsd = Number(ethers.formatUnits(balance, 18)) * croPrice;
      positions.push({ token: symbol, amount: balance, valueUsd });
      totalValueUsd += valueUsd;
    }

    this.portfolio = {
      balances,
      positions,
      totalValueUsd,
      lastUpdated: new Date(),
    };
  }

  getPortfolio(): PortfolioState | null {
    return this.portfolio;
  }

  // ============ Price Alert Setup ============

  async setupPriceAlert(
    symbol: string,
    targetPrice: number,
    condition: "above" | "below",
    action: AgentTask
  ): Promise<void> {
    this.cryptoComService.addPriceAlert({
      symbol,
      targetPrice,
      condition,
      callback: async (price) => {
        console.log(`[AgentPay] Price alert triggered: ${symbol} is ${condition} ${targetPrice} (current: ${price})`);
        this.addTask(action);
      },
    });
  }

  // ============ Utilities ============

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getAddress(): string {
    return this.wallet.address;
  }
}
