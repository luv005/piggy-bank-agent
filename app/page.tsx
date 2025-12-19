import { ConnectWallet } from "@/components/connect-wallet"
import { VaultManagerDemo } from "@/components/vault-manager-demo"

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-[#28a0f0]/5">
      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#28a0f0]">
              <span className="text-sm font-bold text-white">🐷</span>
            </div>
            <span className="text-xl font-bold">小猪存钱罐</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Powered by</span>
            <span className="font-semibold text-[#28a0f0]">Arbitrum</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-16">
        {/* Wallet Card */}
        <div className="flex justify-center">
          <ConnectWallet />
        </div>

        {/* Contract Demo */}
        <div className="mt-10 flex justify-center">
          <VaultManagerDemo />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Built by 年年有余队 • imHackathon
        </div>
      </footer>
    </main>
  )
}
