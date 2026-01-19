/**
 * MCP Server - Model Context Protocol for AgentPay
 *
 * Allows external AI agents (Claude, GPT, etc.) to use our x402-gated agents
 * via the standardized MCP protocol.
 *
 * Usage: npx ts-node src/mcp-server.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const AGENTPAY_URL = process.env.AGENTPAY_URL || "http://localhost:3005";

// Create MCP Server
const server = new Server(
  {
    name: "agentpay-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools (maps to our x402 agents)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "conductor",
        description: "AI orchestrator that coordinates multiple sub-agents to answer complex crypto/DeFi questions. Uses Groq AI for intent detection and A2A protocol for agent discovery. Costs 0.02 CRO base + sub-agent fees.",
        inputSchema: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description: "Natural language goal or question (e.g., 'Should I buy CRO?', 'Is this contract safe?', 'Find arbitrage opportunities')"
            }
          },
          required: ["goal"]
        }
      },
      {
        name: "arbitrage_scanner",
        description: "Scans CEX/DEX price differences and calculates profitable arbitrage opportunities with slippage and gas considerations. Costs 0.08 CRO.",
        inputSchema: {
          type: "object",
          properties: {
            trade_size: {
              type: "number",
              description: "Trade size in USD (default: 1000)"
            }
          }
        }
      },
      {
        name: "sentiment_analyzer",
        description: "Analyzes market sentiment by combining whale wallet movements with trading signals using weighted scoring algorithms. Costs 0.06 CRO.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "portfolio_risk",
        description: "Calculates portfolio risk metrics using Modern Portfolio Theory - Sharpe ratio, Value at Risk (VaR), max drawdown, diversification score. Costs 0.05 CRO.",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Wallet address to analyze"
            }
          },
          required: ["address"]
        }
      },
      {
        name: "contract_auditor",
        description: "Audits smart contracts for security vulnerabilities with weighted risk scoring. Detects honeypots, owner privileges, and other risks. Costs 0.10 CRO.",
        inputSchema: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Contract address to audit"
            }
          },
          required: ["address"]
        }
      },
      {
        name: "trade_executor",
        description: "Finds optimal trade routes across DEXs with split routing support and MEV protection analysis. Costs 0.03 CRO.",
        inputSchema: {
          type: "object",
          properties: {
            amount_in: {
              type: "string",
              description: "Input amount in CRO"
            },
            token_out: {
              type: "string",
              description: "Target token (default: USDC)"
            }
          },
          required: ["amount_in"]
        }
      },
      {
        name: "a2a_discover",
        description: "Discover available agents and their capabilities via A2A protocol. Free to use.",
        inputSchema: {
          type: "object",
          properties: {
            capability: {
              type: "string",
              description: "Filter by capability (optional)"
            }
          }
        }
      },
      {
        name: "wallet_status",
        description: "Check AgentWallet balance and spending limits. Free to use.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "conductor": {
        // Pay for conductor
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "conductor"
        });
        const proof = payRes.data.proof;

        // Execute conductor
        const result = await axios.post(
          `${AGENTPAY_URL}/api/x402/conductor`,
          { goal: args?.goal },
          { headers: { "X-Payment": proof } }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                goal: args?.goal,
                reasoning: result.data.plan?.reasoning,
                agents_used: result.data.plan?.agents,
                costs: result.data.costs,
                summary: result.data.summary,
                results: result.data.results?.map((r: any) => ({
                  agent: r.name,
                  status: r.status,
                  key_metrics: r.data ? extractKeyMetrics(r) : null
                }))
              }, null, 2)
            }
          ]
        };
      }

      case "arbitrage_scanner": {
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "agent-arbitrage"
        });
        const result = await axios.get(
          `${AGENTPAY_URL}/api/x402/agent/arbitrage?size=${args?.trade_size || 1000}`,
          { headers: { "X-Payment": payRes.data.proof } }
        );
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "sentiment_analyzer": {
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "agent-sentiment"
        });
        const result = await axios.get(
          `${AGENTPAY_URL}/api/x402/agent/sentiment`,
          { headers: { "X-Payment": payRes.data.proof } }
        );
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "portfolio_risk": {
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "agent-risk"
        });
        const result = await axios.get(
          `${AGENTPAY_URL}/api/x402/agent/risk?address=${args?.address}`,
          { headers: { "X-Payment": payRes.data.proof } }
        );
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "contract_auditor": {
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "agent-audit"
        });
        const result = await axios.get(
          `${AGENTPAY_URL}/api/x402/agent/audit?address=${args?.address}`,
          { headers: { "X-Payment": payRes.data.proof } }
        );
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "trade_executor": {
        const payRes = await axios.post(`${AGENTPAY_URL}/api/agent/pay`, {
          serviceId: "agent-executor"
        });
        const result = await axios.post(
          `${AGENTPAY_URL}/api/x402/agent/executor`,
          { amountIn: args?.amount_in, tokenOut: args?.token_out },
          { headers: { "X-Payment": payRes.data.proof } }
        );
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "a2a_discover": {
        const url = args?.capability
          ? `${AGENTPAY_URL}/api/a2a/search?capability=${args.capability}`
          : `${AGENTPAY_URL}/api/a2a/agents`;
        const result = await axios.get(url);
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "wallet_status": {
        const result = await axios.get(`${AGENTPAY_URL}/api/wallet/status`);
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

function extractKeyMetrics(result: any): any {
  const d = result.data;
  if (!d) return null;

  if (result.agent === "agent-arbitrage") {
    return {
      opportunities: d.analysis?.opportunitiesFound,
      flash_loan_viable: d.flashLoanOpportunity?.viable
    };
  }
  if (result.agent === "agent-sentiment") {
    return {
      sentiment: d.sentiment?.label,
      confidence: d.sentiment?.confidence,
      trend: d.trendAnalysis?.signal
    };
  }
  if (result.agent === "agent-risk") {
    return {
      sharpe_ratio: d.riskMetrics?.sharpeRatio?.value,
      risk_level: d.summary?.riskLevel
    };
  }
  if (result.agent === "agent-audit") {
    return {
      grade: d.verdict?.grade,
      safe_to_interact: d.verdict?.safeToInteract
    };
  }
  if (result.agent === "agent-executor") {
    return {
      best_dex: d.bestRoute?.dex,
      mev_risk: d.mevProtection?.riskLevel
    };
  }
  return null;
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AgentPay MCP Server running on stdio");
}

main().catch(console.error);
