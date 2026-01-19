import axios, { AxiosInstance } from "axios";

/**
 * Crypto.com Market Data Service
 * Integrates with Crypto.com's Market Data MCP Server
 * https://mcp.crypto.com/docs
 */

export interface MarketTicker {
  symbol: string;
  price: string;
  volume24h: string;
  change24h: string;
  high24h: string;
  low24h: string;
  timestamp: number;
}

export interface OrderBook {
  symbol: string;
  bids: Array<{ price: string; quantity: string }>;
  asks: Array<{ price: string; quantity: string }>;
  timestamp: number;
}

export interface Trade {
  id: string;
  symbol: string;
  price: string;
  quantity: string;
  side: "buy" | "sell";
  timestamp: number;
}

export interface PriceAlert {
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  callback: (price: number) => void;
}

export class CryptoComService {
  private apiClient: AxiosInstance;
  private wsConnection: WebSocket | null = null;
  private priceAlerts: Map<string, PriceAlert[]> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor() {
    this.apiClient = axios.create({
      baseURL: "https://api.crypto.com/exchange/v1",
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // ============ Market Data ============

  async getTicker(symbol: string): Promise<MarketTicker> {
    const response = await this.apiClient.get(`/public/get-ticker`, {
      params: { instrument_name: symbol },
    });
    const data = response.data.result.data[0];
    return {
      symbol: data.i,
      price: data.a,
      volume24h: data.v,
      change24h: data.c,
      high24h: data.h,
      low24h: data.l,
      timestamp: data.t,
    };
  }

  async getAllTickers(): Promise<MarketTicker[]> {
    const response = await this.apiClient.get(`/public/get-ticker`);
    return response.data.result.data.map((data: any) => ({
      symbol: data.i,
      price: data.a,
      volume24h: data.v,
      change24h: data.c,
      high24h: data.h,
      low24h: data.l,
      timestamp: data.t,
    }));
  }

  async getOrderBook(symbol: string, depth: number = 10): Promise<OrderBook> {
    const response = await this.apiClient.get(`/public/get-book`, {
      params: { instrument_name: symbol, depth },
    });
    const data = response.data.result.data[0];
    return {
      symbol: data.instrument_name,
      bids: data.bids.map((b: any) => ({ price: b[0], quantity: b[1] })),
      asks: data.asks.map((a: any) => ({ price: a[0], quantity: a[1] })),
      timestamp: data.t,
    };
  }

  async getRecentTrades(symbol: string, count: number = 50): Promise<Trade[]> {
    const response = await this.apiClient.get(`/public/get-trades`, {
      params: { instrument_name: symbol, count },
    });
    return response.data.result.data.map((t: any) => ({
      id: t.d,
      symbol: t.i,
      price: t.p,
      quantity: t.q,
      side: t.s,
      timestamp: t.t,
    }));
  }

  // ============ Price Monitoring ============

  async getPrice(symbol: string): Promise<number> {
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    const ticker = await this.getTicker(symbol);
    const price = parseFloat(ticker.price);
    this.priceCache.set(symbol, { price, timestamp: Date.now() });
    return price;
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const promises = symbols.map(async (symbol) => {
      const price = await this.getPrice(symbol);
      prices.set(symbol, price);
    });
    await Promise.all(promises);
    return prices;
  }

  addPriceAlert(alert: PriceAlert): void {
    const alerts = this.priceAlerts.get(alert.symbol) || [];
    alerts.push(alert);
    this.priceAlerts.set(alert.symbol, alerts);
  }

  removePriceAlert(symbol: string, targetPrice: number): void {
    const alerts = this.priceAlerts.get(symbol) || [];
    const filtered = alerts.filter((a) => a.targetPrice !== targetPrice);
    this.priceAlerts.set(symbol, filtered);
  }

  async checkPriceAlerts(): Promise<void> {
    for (const [symbol, alerts] of this.priceAlerts) {
      const price = await this.getPrice(symbol);
      for (const alert of alerts) {
        if (alert.condition === "above" && price > alert.targetPrice) {
          alert.callback(price);
          this.removePriceAlert(symbol, alert.targetPrice);
        } else if (alert.condition === "below" && price < alert.targetPrice) {
          alert.callback(price);
          this.removePriceAlert(symbol, alert.targetPrice);
        }
      }
    }
  }

  // ============ Analytics ============

  async getMarketSentiment(symbol: string): Promise<{
    sentiment: "bullish" | "bearish" | "neutral";
    confidence: number;
    indicators: Record<string, string>;
  }> {
    const [ticker, orderBook, trades] = await Promise.all([
      this.getTicker(symbol),
      this.getOrderBook(symbol, 20),
      this.getRecentTrades(symbol, 100),
    ]);

    // Analyze buy/sell ratio
    const buyTrades = trades.filter((t) => t.side === "buy");
    const sellTrades = trades.filter((t) => t.side === "sell");
    const buySellRatio = buyTrades.length / (sellTrades.length || 1);

    // Analyze order book imbalance
    const totalBids = orderBook.bids.reduce((sum, b) => sum + parseFloat(b.quantity), 0);
    const totalAsks = orderBook.asks.reduce((sum, a) => sum + parseFloat(a.quantity), 0);
    const orderBookRatio = totalBids / (totalAsks || 1);

    // Determine sentiment
    const combinedScore = (buySellRatio + orderBookRatio) / 2;
    let sentiment: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;

    if (combinedScore > 1.2) {
      sentiment = "bullish";
      confidence = Math.min(combinedScore / 2, 0.9);
    } else if (combinedScore < 0.8) {
      sentiment = "bearish";
      confidence = Math.min((2 - combinedScore) / 2, 0.9);
    }

    return {
      sentiment,
      confidence,
      indicators: {
        buySellRatio: buySellRatio.toFixed(2),
        orderBookRatio: orderBookRatio.toFixed(2),
        change24h: ticker.change24h,
        volume24h: ticker.volume24h,
      },
    };
  }

  async getVolatility(symbol: string, periodHours: number = 24): Promise<number> {
    const trades = await this.getRecentTrades(symbol, 1000);

    if (trades.length < 10) return 0;

    const prices = trades.map((t) => parseFloat(t.price));
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    return (stdDev / mean) * 100; // Return as percentage
  }

  // ============ Trading Pairs Info ============

  async getCronosPairs(): Promise<string[]> {
    // Return common Cronos trading pairs
    return [
      "CRO_USD",
      "CRO_USDT",
      "CRO_BTC",
      "CRO_ETH",
      "WCRO_USD",
      "VVS_USD",
      "TONIC_USD",
      "FER_USD",
    ];
  }

  async getTokenPrice(tokenSymbol: string, quoteSymbol: string = "USD"): Promise<number> {
    const pair = `${tokenSymbol}_${quoteSymbol}`;
    return this.getPrice(pair);
  }
}

// Singleton instance
export const cryptoComService = new CryptoComService();
