import { http, createConfig } from "wagmi"
import { arbitrum, mainnet } from "wagmi/chains"
import { injected, metaMask, coinbaseWallet } from "wagmi/connectors"

const projectId = "YOUR_WALLETCONNECT_PROJECT_ID" // 可选：用于WalletConnect

export const config = createConfig({
  chains: [arbitrum, mainnet],
  connectors: [injected(), metaMask(), coinbaseWallet({ appName: "Web3 DApp" })],
  transports: {
    [arbitrum.id]: http(),
    [mainnet.id]: http(),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof config
  }
}
