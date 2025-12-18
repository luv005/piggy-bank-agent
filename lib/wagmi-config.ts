import { http, createConfig } from "wagmi"
import { arbitrum, mainnet } from "wagmi/chains"
import { injected } from "wagmi/connectors"

export const config = createConfig({
  chains: [arbitrum, mainnet],
  connectors: [injected()],
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
