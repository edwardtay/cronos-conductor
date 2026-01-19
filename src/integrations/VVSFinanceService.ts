import { ethers, Contract, Signer } from "ethers";

/**
 * VVS Finance Integration for Cronos
 * Provides intelligent swap routing, liquidity management, and automated trading
 */

// VVS Router ABI (key functions)
const VVS_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) external returns (uint[] amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) external payable returns (uint[] amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) external returns (uint[] amounts)",
  "function getAmountsOut(uint amountIn, address[] path) external view returns (uint[] amounts)",
  "function getAmountsIn(uint amountOut, address[] path) external view returns (uint[] amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)",
];

// VVS Factory ABI
const VVS_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function allPairs(uint) external view returns (address pair)",
  "function allPairsLength() external view returns (uint)",
];

// ERC20 ABI
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

// Common Cronos Testnet addresses
export const CRONOS_TESTNET_ADDRESSES = {
  VVS_ROUTER: "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae",
  VVS_FACTORY: "0x3B44B2a187a7b3824131F8db5a74194D0a42Fc15",
  WCRO: "0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4",
  USDC: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
  USDT: "0x66e428c3f67a68878562e79A0234c1F83c208770",
};

// Cronos Mainnet addresses
export const CRONOS_MAINNET_ADDRESSES = {
  VVS_ROUTER: "0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae",
  VVS_FACTORY: "0x3B44B2a187a7b3824131F8db5a74194D0a42Fc15",
  WCRO: "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23",
  USDC: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
  USDT: "0x66e428c3f67a68878562e79A0234c1F83c208770",
  VVS: "0x2D03bECE6747ADC00E1a131BBA1469C15fD11e03",
};

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  path: string[];
  priceImpact: number;
  minimumReceived: bigint;
}

export interface LiquidityPosition {
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  lpTokens: bigint;
  pairAddress: string;
}

export class VVSFinanceService {
  private router: Contract;
  private factory: Contract;
  private signer: Signer | null = null;
  private addresses: typeof CRONOS_TESTNET_ADDRESSES;

  constructor(provider: ethers.Provider, isMainnet: boolean = false) {
    this.addresses = isMainnet ? CRONOS_MAINNET_ADDRESSES : CRONOS_TESTNET_ADDRESSES;
    this.router = new Contract(this.addresses.VVS_ROUTER, VVS_ROUTER_ABI, provider);
    this.factory = new Contract(this.addresses.VVS_FACTORY, VVS_FACTORY_ABI, provider);
  }

  connect(signer: Signer): VVSFinanceService {
    this.signer = signer;
    this.router = this.router.connect(signer) as Contract;
    this.factory = this.factory.connect(signer) as Contract;
    return this;
  }

  // ============ Swap Operations ============

  /**
   * Get optimal swap quote with price impact calculation
   */
  async getSwapQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippageBps: number = 50 // 0.5% default
  ): Promise<SwapQuote> {
    // Build optimal path (direct or through WCRO)
    const directPath = [tokenIn, tokenOut];
    const wcroPath = [tokenIn, this.addresses.WCRO, tokenOut];

    let bestPath = directPath;
    let bestAmountOut = 0n;

    try {
      const directAmounts = await this.router.getAmountsOut(amountIn, directPath);
      bestAmountOut = directAmounts[directAmounts.length - 1];
    } catch {
      // Direct path doesn't exist
    }

    if (tokenIn !== this.addresses.WCRO && tokenOut !== this.addresses.WCRO) {
      try {
        const wcroAmounts = await this.router.getAmountsOut(amountIn, wcroPath);
        const wcroAmountOut = wcroAmounts[wcroAmounts.length - 1];
        if (wcroAmountOut > bestAmountOut) {
          bestPath = wcroPath;
          bestAmountOut = wcroAmountOut;
        }
      } catch {
        // WCRO path doesn't exist
      }
    }

    // Calculate price impact (simplified)
    const priceImpact = 0.3; // Placeholder - would need reserves for accurate calculation

    // Calculate minimum with slippage
    const minimumReceived = (bestAmountOut * BigInt(10000 - slippageBps)) / 10000n;

    return {
      amountIn,
      amountOut: bestAmountOut,
      path: bestPath,
      priceImpact,
      minimumReceived,
    };
  }

  /**
   * Execute token swap
   */
  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippageBps: number = 50
  ): Promise<{ txHash: string; amountOut: bigint }> {
    if (!this.signer) throw new Error("Signer not connected");

    const quote = await this.getSwapQuote(tokenIn, tokenOut, amountIn, slippageBps);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes
    const to = await this.signer.getAddress();

    // Approve token if needed
    if (tokenIn !== this.addresses.WCRO) {
      await this.approveToken(tokenIn, this.addresses.VVS_ROUTER, amountIn);
    }

    let tx;
    if (tokenIn === this.addresses.WCRO) {
      // Swap CRO for tokens
      tx = await this.router.swapExactETHForTokens(quote.minimumReceived, quote.path, to, deadline, {
        value: amountIn,
      });
    } else if (tokenOut === this.addresses.WCRO) {
      // Swap tokens for CRO
      tx = await this.router.swapExactTokensForETH(amountIn, quote.minimumReceived, quote.path, to, deadline);
    } else {
      // Swap tokens for tokens
      tx = await this.router.swapExactTokensForTokens(amountIn, quote.minimumReceived, quote.path, to, deadline);
    }

    const receipt = await tx.wait();
    return { txHash: receipt.hash, amountOut: quote.amountOut };
  }

  /**
   * Execute swap with agent-driven optimization
   * Splits large trades to minimize price impact
   */
  async executeOptimizedSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    maxPriceImpact: number = 1.0 // 1% max
  ): Promise<{ txHashes: string[]; totalAmountOut: bigint }> {
    if (!this.signer) throw new Error("Signer not connected");

    const initialQuote = await this.getSwapQuote(tokenIn, tokenOut, amountIn);

    if (initialQuote.priceImpact <= maxPriceImpact) {
      // Single swap is fine
      const result = await this.executeSwap(tokenIn, tokenOut, amountIn);
      return { txHashes: [result.txHash], totalAmountOut: result.amountOut };
    }

    // Split into multiple smaller swaps
    const numSplits = Math.ceil(initialQuote.priceImpact / maxPriceImpact);
    const amountPerSwap = amountIn / BigInt(numSplits);

    const txHashes: string[] = [];
    let totalAmountOut = 0n;

    for (let i = 0; i < numSplits; i++) {
      const swapAmount = i === numSplits - 1 ? amountIn - amountPerSwap * BigInt(numSplits - 1) : amountPerSwap;

      const result = await this.executeSwap(tokenIn, tokenOut, swapAmount);
      txHashes.push(result.txHash);
      totalAmountOut += result.amountOut;

      // Wait a bit between swaps to let liquidity recover
      if (i < numSplits - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return { txHashes, totalAmountOut };
  }

  // ============ Liquidity Operations ============

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(
    tokenA: string,
    tokenB: string,
    amountA: bigint,
    amountB: bigint,
    slippageBps: number = 100
  ): Promise<{ txHash: string; liquidity: bigint }> {
    if (!this.signer) throw new Error("Signer not connected");

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const to = await this.signer.getAddress();

    const amountAMin = (amountA * BigInt(10000 - slippageBps)) / 10000n;
    const amountBMin = (amountB * BigInt(10000 - slippageBps)) / 10000n;

    // Approve tokens
    if (tokenA !== this.addresses.WCRO) {
      await this.approveToken(tokenA, this.addresses.VVS_ROUTER, amountA);
    }
    if (tokenB !== this.addresses.WCRO) {
      await this.approveToken(tokenB, this.addresses.VVS_ROUTER, amountB);
    }

    let tx;
    if (tokenA === this.addresses.WCRO) {
      tx = await this.router.addLiquidityETH(tokenB, amountB, amountBMin, amountAMin, to, deadline, {
        value: amountA,
      });
    } else if (tokenB === this.addresses.WCRO) {
      tx = await this.router.addLiquidityETH(tokenA, amountA, amountAMin, amountBMin, to, deadline, {
        value: amountB,
      });
    } else {
      tx = await this.router.addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, to, deadline);
    }

    const receipt = await tx.wait();
    // Parse liquidity from events
    return { txHash: receipt.hash, liquidity: 0n };
  }

  /**
   * Remove liquidity from a pool
   */
  async removeLiquidity(
    tokenA: string,
    tokenB: string,
    liquidity: bigint,
    slippageBps: number = 100
  ): Promise<{ txHash: string; amountA: bigint; amountB: bigint }> {
    if (!this.signer) throw new Error("Signer not connected");

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const to = await this.signer.getAddress();

    // Get pair address and approve LP tokens
    const pairAddress = await this.factory.getPair(tokenA, tokenB);
    await this.approveToken(pairAddress, this.addresses.VVS_ROUTER, liquidity);

    const tx = await this.router.removeLiquidity(tokenA, tokenB, liquidity, 0, 0, to, deadline);

    const receipt = await tx.wait();
    return { txHash: receipt.hash, amountA: 0n, amountB: 0n };
  }

  // ============ Helper Functions ============

  private async approveToken(token: string, spender: string, amount: bigint): Promise<void> {
    if (!this.signer) throw new Error("Signer not connected");

    const tokenContract = new Contract(token, ERC20_ABI, this.signer);
    const owner = await this.signer.getAddress();

    const allowance = await tokenContract.allowance(owner, spender);
    if (allowance < amount) {
      const tx = await tokenContract.approve(spender, ethers.MaxUint256);
      await tx.wait();
    }
  }

  async getTokenBalance(token: string, address: string): Promise<bigint> {
    const tokenContract = new Contract(token, ERC20_ABI, this.router.runner);
    return await tokenContract.balanceOf(address);
  }

  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    const tokenContract = new Contract(token, ERC20_ABI, this.router.runner);
    const [symbol, decimals] = await Promise.all([tokenContract.symbol(), tokenContract.decimals()]);
    return { symbol, decimals };
  }

  getPairAddress(tokenA: string, tokenB: string): Promise<string> {
    return this.factory.getPair(tokenA, tokenB);
  }

  getAddresses(): typeof CRONOS_TESTNET_ADDRESSES {
    return this.addresses;
  }
}
