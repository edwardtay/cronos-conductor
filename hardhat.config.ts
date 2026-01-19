import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    cronosTestnet: {
      url: "https://evm-t3.cronos.org",
      chainId: 338,
      accounts: [PRIVATE_KEY],
      gasPrice: 5000000000000 // 5000 Gwei
    },
    cronosMainnet: {
      url: "https://evm.cronos.org",
      chainId: 25,
      accounts: [PRIVATE_KEY],
      gasPrice: 5000000000000
    }
  },
  etherscan: {
    apiKey: {
      cronosTestnet: process.env.CRONOSCAN_API_KEY || "",
      cronosMainnet: process.env.CRONOSCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "cronosTestnet",
        chainId: 338,
        urls: {
          apiURL: "https://explorer-api.cronos.org/testnet/api",
          browserURL: "https://explorer.cronos.org/testnet"
        }
      },
      {
        network: "cronosMainnet",
        chainId: 25,
        urls: {
          apiURL: "https://explorer-api.cronos.org/mainnet/api",
          browserURL: "https://explorer.cronos.org"
        }
      }
    ]
  }
};

export default config;
