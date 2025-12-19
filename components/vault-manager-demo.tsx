"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAddress, parseUnits, formatUnits } from "viem"
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi"
import { RefreshCw } from "lucide-react"
import { DotLottieReact } from "@lottiefiles/dotlottie-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { erc20Abi } from "@/lib/contracts/erc20"
import { getVaultManagerAddress, type Address } from "@/lib/contracts/addresses"
import { vaultManagerAbi } from "@/lib/contracts/vault-manager"

type Hex = `0x${string}`

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "未知错误"
}

function shortenAddress(address: string) {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatUnitsTruncated(value: bigint, decimals: number, maxFractionDigits = 6) {
  const full = formatUnits(value, decimals)
  if (!full.includes(".")) return full
  const [integerPart, fractionalPartRaw] = full.split(".")
  const fractionalPart = fractionalPartRaw.slice(0, maxFractionDigits).replace(/0+$/, "")
  return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart
}

function parseVaultTuple(vault: unknown) {
  return {
    owner: ((vault as any).owner ?? (vault as any)[0]) as Address,
    unlockTimestamp: ((vault as any).unlockTimestamp ?? (vault as any)[1]) as bigint,
    broken: ((vault as any).broken ?? (vault as any)[2]) as boolean,
  }
}

type TokenMeta = {
  symbol: string | null
  decimals: number | null
}

type VaultTokenPosition = {
  token: Address
  symbol: string | null
  decimals: number | null
  balance: bigint
}

type VaultDetails = {
  id: bigint
  owner: Address
  unlockTimestamp: bigint
  broken: boolean
  tokens: VaultTokenPosition[]
}

export function VaultManagerDemo() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const vaultManagerAddress = useMemo(() => getVaultManagerAddress(chainId), [chainId])

  const [unlockMinutes, setUnlockMinutes] = useState("10")
  const [tokenAddress, setTokenAddress] = useState("")
  const [amount, setAmount] = useState("")

  const [txHash, setTxHash] = useState<Hex | null>(null)
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null)
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null)
  const [tokenWhitelisted, setTokenWhitelisted] = useState<boolean | null>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)

  const [myVaultIds, setMyVaultIds] = useState<bigint[]>([])
  const [lastCreatedVaultId, setLastCreatedVaultId] = useState<bigint | null>(null)
  const [myVaults, setMyVaults] = useState<VaultDetails[]>([])
  const [vaultListLoading, setVaultListLoading] = useState(false)

  const tokenMetaCacheRef = useRef<Map<Address, TokenMeta>>(new Map())
  const vaultListRequestIdRef = useRef(0)

  const [breakVaultId, setBreakVaultId] = useState("")
  const [breakVaultPreview, setBreakVaultPreview] = useState<{
    owner: Address
    unlockTimestamp: bigint
    broken: boolean
  } | null>(null)

  const normalizedTokenAddress = tokenAddress.trim()
  const tokenAddressValid = isAddress(normalizedTokenAddress)
  const tokenAddressTyped = (tokenAddressValid ? (normalizedTokenAddress as Address) : undefined) satisfies Address | undefined

  const unlockTimestamp = useMemo(() => {
    const minutes = Number(unlockMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return null
    const secondsFromNow = Math.floor(minutes * 60)
    return BigInt(Math.floor(Date.now() / 1000) + secondsFromNow)
  }, [unlockMinutes])

  const parsedAmount = useMemo(() => {
    if (!amount || tokenDecimals == null) return null
    try {
      return parseUnits(amount, tokenDecimals)
    } catch {
      return null
    }
  }, [amount, tokenDecimals])

  const refreshVaultIds = useCallback(async () => {
    if (!publicClient || !vaultManagerAddress || !address) {
      setMyVaultIds([])
      return []
    }
    const ids = await publicClient.readContract({
      address: vaultManagerAddress,
      abi: vaultManagerAbi,
      functionName: "getVaultIdsByOwner",
      args: [address],
    })
    const idsArray = Array.from(ids)
    setMyVaultIds(idsArray)
    return idsArray
  }, [address, publicClient, vaultManagerAddress])

  const refreshMyVaults = useCallback(async () => {
    if (!publicClient || !vaultManagerAddress || !address) {
      setMyVaultIds([])
      setMyVaults([])
      return []
    }

    const requestId = ++vaultListRequestIdRef.current
    setVaultListLoading(true)

    try {
      const ids = await refreshVaultIds()
      if (requestId !== vaultListRequestIdRef.current) return ids

      if (!ids.length) {
        setMyVaults([])
        return ids
      }

      const vaultBaseList = await Promise.all(
        ids.map(async (vaultId) => {
          const [vault, tokenAddresses] = await Promise.all([
            publicClient.readContract({
              address: vaultManagerAddress,
              abi: vaultManagerAbi,
              functionName: "getVault",
              args: [vaultId],
            }),
            publicClient.readContract({
              address: vaultManagerAddress,
              abi: vaultManagerAbi,
              functionName: "getVaultTokens",
              args: [vaultId],
            }),
          ])
          const { owner, unlockTimestamp, broken } = parseVaultTuple(vault)
          return { vaultId, owner, unlockTimestamp, broken, tokenAddresses }
        }),
      )

      const uniqueTokenMap = new Map<string, Address>()
      for (const vault of vaultBaseList) {
        for (const token of vault.tokenAddresses as Address[]) uniqueTokenMap.set(token.toLowerCase(), token)
      }
      const uniqueTokens = Array.from(uniqueTokenMap.values())
      const tokensToFetchMeta = uniqueTokens.filter((token) => !tokenMetaCacheRef.current.has(token))

      if (tokensToFetchMeta.length) {
        try {
          const metaCalls = tokensToFetchMeta.flatMap(
            (token) =>
              [
                { address: token, abi: erc20Abi, functionName: "symbol" as const },
                { address: token, abi: erc20Abi, functionName: "decimals" as const },
              ] as const,
          )
          const results = await (publicClient as any).multicall({
            contracts: metaCalls,
            allowFailure: true,
          })

          for (let i = 0; i < tokensToFetchMeta.length; i++) {
            const symbolResult = results[i * 2]
            const decimalsResult = results[i * 2 + 1]

            const symbol = symbolResult?.status === "success" ? (symbolResult.result as string) : null
            const decimalsRaw = decimalsResult?.status === "success" ? (decimalsResult.result as unknown) : null
            const decimals =
              decimalsRaw == null ? null : typeof decimalsRaw === "bigint" ? Number(decimalsRaw) : (decimalsRaw as number)

            tokenMetaCacheRef.current.set(tokensToFetchMeta[i], { symbol, decimals })
          }
        } catch {
          await Promise.all(
            tokensToFetchMeta.map(async (token) => {
              const [symbolResult, decimalsResult] = await Promise.allSettled([
                publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
                publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
              ])

              const symbol = symbolResult.status === "fulfilled" ? (symbolResult.value as string) : null
              const decimalsRaw = decimalsResult.status === "fulfilled" ? (decimalsResult.value as unknown) : null
              const decimals =
                decimalsRaw == null
                  ? null
                  : typeof decimalsRaw === "bigint"
                    ? Number(decimalsRaw)
                    : (decimalsRaw as number)

              tokenMetaCacheRef.current.set(token, { symbol, decimals })
            }),
          )
        }
      }

      const balanceCalls: { vaultId: bigint; token: Address }[] = []
      for (const vault of vaultBaseList) {
        for (const token of vault.tokenAddresses as Address[]) {
          balanceCalls.push({ vaultId: vault.vaultId, token })
        }
      }

      const balanceMap = new Map<string, bigint>()
      if (balanceCalls.length) {
        try {
          const results = await (publicClient as any).multicall({
            contracts: balanceCalls.map((p) => ({
              address: vaultManagerAddress,
              abi: vaultManagerAbi,
              functionName: "vaultTokenBalance" as const,
              args: [p.vaultId, p.token] as const,
            })),
            allowFailure: true,
          })
          for (let i = 0; i < balanceCalls.length; i++) {
            const { vaultId, token } = balanceCalls[i]
            const result = results[i]
            const balance = result?.status === "success" ? (result.result as bigint) : 0n
            balanceMap.set(`${vaultId.toString()}:${token.toLowerCase()}`, balance)
          }
        } catch {
          await Promise.all(
            balanceCalls.map(async ({ vaultId, token }) => {
              const balance = await publicClient.readContract({
                address: vaultManagerAddress,
                abi: vaultManagerAbi,
                functionName: "vaultTokenBalance",
                args: [vaultId, token],
              })
              balanceMap.set(`${vaultId.toString()}:${token.toLowerCase()}`, balance)
            }),
          )
        }
      }

      const vaultDetails = vaultBaseList.map(({ vaultId, owner, unlockTimestamp, broken, tokenAddresses }) => {
        const tokens = (tokenAddresses as Address[]).map((token) => {
          const meta = tokenMetaCacheRef.current.get(token) ?? { symbol: null, decimals: null }
          const balance = balanceMap.get(`${vaultId.toString()}:${token.toLowerCase()}`) ?? 0n
          return { token, symbol: meta.symbol, decimals: meta.decimals, balance }
        })

        return { id: vaultId, owner, unlockTimestamp, broken, tokens } satisfies VaultDetails
      })

      if (requestId !== vaultListRequestIdRef.current) return ids
      setMyVaults(vaultDetails)
      return ids
    } catch (err) {
      if (requestId === vaultListRequestIdRef.current) setError(toErrorMessage(err))
      return []
    } finally {
      if (requestId === vaultListRequestIdRef.current) setVaultListLoading(false)
    }
  }, [address, publicClient, refreshVaultIds, vaultManagerAddress])

  const refreshTokenInfo = useCallback(async () => {
    setTokenSymbol(null)
    setTokenDecimals(null)
    setTokenWhitelisted(null)
    setAllowance(null)

    if (!publicClient || !vaultManagerAddress || !tokenAddressTyped) return

    const [decimalsRaw, symbol, whitelisted] = await Promise.all([
      publicClient.readContract({
        address: tokenAddressTyped,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: tokenAddressTyped,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: vaultManagerAddress,
        abi: vaultManagerAbi,
        functionName: "isTokenWhitelisted",
        args: [tokenAddressTyped],
      }),
    ])

    const decimals = typeof decimalsRaw === "bigint" ? Number(decimalsRaw) : decimalsRaw
    setTokenDecimals(decimals)
    setTokenSymbol(symbol)
    setTokenWhitelisted(whitelisted)

    if (!address) return
    const currentAllowance = await publicClient.readContract({
      address: tokenAddressTyped,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, vaultManagerAddress],
    })
    setAllowance(currentAllowance)
  }, [address, publicClient, tokenAddressTyped, vaultManagerAddress])

  useEffect(() => {
    setError(null)
    if (!tokenAddressValid) {
      setTokenSymbol(null)
      setTokenDecimals(null)
      setTokenWhitelisted(null)
      setAllowance(null)
      return
    }
    refreshTokenInfo().catch((err) => setError(toErrorMessage(err)))
  }, [refreshTokenInfo, tokenAddressValid])

  useEffect(() => {
    if (!isConnected) {
      setMyVaultIds([])
      setMyVaults([])
      setLastCreatedVaultId(null)
      return
    }
    refreshMyVaults().catch(() => undefined)
  }, [isConnected, refreshMyVaults])

  useEffect(() => {
    tokenMetaCacheRef.current.clear()
    setMyVaultIds([])
    setMyVaults([])
    setLastCreatedVaultId(null)
  }, [chainId])

  const approve = useCallback(async () => {
    setError(null)
    setStatus("")

    if (!isConnected || !address) return setError("请先连接钱包")
    if (!walletClient || !publicClient) return setError("钱包客户端未就绪")
    if (!vaultManagerAddress) return setError("当前网络未配置 VaultManager 地址")
    if (!tokenAddressTyped) return setError("Token 地址不合法")
    if (!parsedAmount || parsedAmount <= 0n) return setError("金额不合法")

    try {
      setBusy(true)
      setStatus("授权中（Approve）…")

      const hash = await (walletClient as any).writeContract({
        address: tokenAddressTyped,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultManagerAddress, parsedAmount],
        account: address,
      })

      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setStatus("授权已确认")

      await refreshTokenInfo()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [
    address,
    isConnected,
    parsedAmount,
    publicClient,
    refreshTokenInfo,
    tokenAddressTyped,
    vaultManagerAddress,
    walletClient,
  ])

  const createVaultAndDeposit = useCallback(async () => {
    setError(null)
    setStatus("")

    if (!isConnected || !address) return setError("请先连接钱包")
    if (!walletClient || !publicClient) return setError("钱包客户端未就绪")
    if (!vaultManagerAddress) return setError("当前网络未配置 VaultManager 地址")
    if (!tokenAddressTyped) return setError("Token 地址不合法")
    if (!unlockTimestamp) return setError("解锁时间不合法")
    if (!parsedAmount || parsedAmount <= 0n) return setError("金额不合法")
    if (tokenWhitelisted === false) return setError("该 Token 未被 VaultManager 加入白名单")
    if (allowance != null && allowance < parsedAmount) return setError("授权额度不足，请先 Approve")

    try {
      setBusy(true)
      setStatus("创建 Vault 并存入中…")

      const hash = await (walletClient as any).writeContract({
        address: vaultManagerAddress,
        abi: vaultManagerAbi,
        functionName: "createVaultAndDeposit",
        args: [unlockTimestamp, tokenAddressTyped, parsedAmount],
        account: address,
      })

      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setStatus("交易已确认")

      const ids = await refreshMyVaults()
      const last = ids.at(-1) ?? null
      setLastCreatedVaultId(last)
      await refreshTokenInfo()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [
    address,
    allowance,
    isConnected,
    parsedAmount,
    publicClient,
    refreshTokenInfo,
    refreshMyVaults,
    tokenAddressTyped,
    tokenWhitelisted,
    unlockTimestamp,
    vaultManagerAddress,
    walletClient,
  ])

  const previewBreakVault = useCallback(async () => {
    setBreakVaultPreview(null)
    if (!publicClient || !vaultManagerAddress) return

    try {
      const vaultId = BigInt(breakVaultId.trim())
      const vault = await publicClient.readContract({
        address: vaultManagerAddress,
        abi: vaultManagerAbi,
        functionName: "getVault",
        args: [vaultId],
      })

      setBreakVaultPreview({
        owner: ((vault as any).owner ?? (vault as any)[0]) as Address,
        unlockTimestamp: ((vault as any).unlockTimestamp ?? (vault as any)[1]) as bigint,
        broken: ((vault as any).broken ?? (vault as any)[2]) as boolean,
      })
    } catch {
      setBreakVaultPreview(null)
    }
  }, [breakVaultId, publicClient, vaultManagerAddress])

  useEffect(() => {
    if (!breakVaultId.trim()) {
      setBreakVaultPreview(null)
      return
    }
    previewBreakVault().catch(() => undefined)
  }, [breakVaultId, previewBreakVault])

  const breakVault = useCallback(async () => {
    setError(null)
    setStatus("")

    if (!isConnected || !address) return setError("请先连接钱包")
    if (!walletClient || !publicClient) return setError("钱包客户端未就绪")
    if (!vaultManagerAddress) return setError("当前网络未配置 VaultManager 地址")

    let vaultId: bigint
    try {
      vaultId = BigInt(breakVaultId.trim())
    } catch {
      return setError("Vault ID 不合法")
    }

    try {
      setBusy(true)
      setStatus("Break 中…")

      const hash = await (walletClient as any).writeContract({
        address: vaultManagerAddress,
        abi: vaultManagerAbi,
        functionName: "breakVault",
        args: [vaultId],
        account: address,
      })

      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setStatus("已 Break")
      await refreshMyVaults()
      await previewBreakVault()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [
    address,
    breakVaultId,
    isConnected,
    previewBreakVault,
    publicClient,
    refreshMyVaults,
    vaultManagerAddress,
    walletClient,
  ])

  const allowanceHuman = useMemo(() => {
    if (allowance == null || tokenDecimals == null) return null
    return formatUnits(allowance, tokenDecimals)
  }, [allowance, tokenDecimals])

  const nowSeconds = Math.floor(Date.now() / 1000)
  const unlockHuman = useMemo(() => {
    if (!unlockTimestamp) return null
    return new Date(Number(unlockTimestamp) * 1000).toLocaleString()
  }, [unlockTimestamp])

  const redeemVault = useCallback(
    async (vaultId: bigint) => {
      setError(null)
      setStatus("")

      if (!isConnected || !address) return setError("请先连接钱包")
      if (!walletClient || !publicClient) return setError("钱包客户端未就绪")
      if (!vaultManagerAddress) return setError("当前网络未配置 VaultManager 地址")

      try {
        setBusy(true)
        setStatus(`赎回 Vault #${vaultId.toString()} 中…`)

        const hash = await (walletClient as any).writeContract({
          address: vaultManagerAddress,
          abi: vaultManagerAbi,
          functionName: "breakVault",
          args: [vaultId],
          account: address,
        })

        setTxHash(hash)
        await publicClient.waitForTransactionReceipt({ hash })
        setStatus(`Vault #${vaultId.toString()} 已赎回`)
        await refreshMyVaults()
      } catch (err) {
        setError(toErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [address, isConnected, publicClient, refreshMyVaults, vaultManagerAddress, walletClient],
  )

  return (
    <Card className="w-full max-w-2xl border-2 border-[#28a0f0]/20 bg-gradient-to-br from-background to-[#28a0f0]/5">
      <CardHeader>
        <div className="flex justify-center mb-4">
          <DotLottieReact
            src="/lotties/piggy-deposit.json"
            loop
            autoplay
            style={{ width: 120, height: 120 }}
          />
        </div>
        <CardTitle className="text-xl">VaultManager 演示</CardTitle>
        <CardDescription>
          创建时间锁 Vault，存入 ERC20，到期后 Break 全额取回；提前 Break 则返还 95%，5% 作为项目收益留在合约里。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl bg-muted/40 p-4 text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">ChainId：</span> <span className="font-mono">{chainId}</span>
          </div>
          <div className="break-all">
            <span className="text-muted-foreground">VaultManager：</span>{" "}
            <span className="font-mono">{vaultManagerAddress ?? "(not configured)"}</span>
          </div>
          {!vaultManagerAddress && (
            <div className="text-muted-foreground">
              请设置 <span className="font-mono">NEXT_PUBLIC_VAULT_MANAGER_ADDRESS_ARBITRUM</span> /{" "}
              <span className="font-mono">NEXT_PUBLIC_VAULT_MANAGER_ADDRESS_MAINNET</span>（或{" "}
              <span className="font-mono">NEXT_PUBLIC_VAULT_MANAGER_ADDRESS</span>）。
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold">创建 Vault 并存入（单笔交易）</div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">多少分钟后解锁</label>
              <Input value={unlockMinutes} onChange={(e) => setUnlockMinutes(e.target.value)} inputMode="numeric" />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">ERC20 Token 地址（需在白名单）</label>
              <Input
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                placeholder="0x…"
                className={tokenAddress && !tokenAddressValid ? "border-destructive" : ""}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">数量</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" inputMode="decimal" />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">信息</label>
              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div>
                  Token：{" "}
                  {tokenAddressValid ? (
                    <span className="font-mono">{tokenAddressTyped}</span>
                  ) : (
                    <span>(不合法)</span>
                  )}{" "}
                  {tokenSymbol ? <span>({tokenSymbol})</span> : null}
                </div>
                <div>Decimals：{tokenDecimals ?? "-"}</div>
                <div>白名单：{tokenWhitelisted == null ? "-" : tokenWhitelisted ? "是" : "否"}</div>
                <div>Allowance：{allowanceHuman ?? "-"}</div>
                <div>
                  解锁时间戳：{" "}
                  {unlockTimestamp ? (
                    <>
                      <span className="font-mono">{unlockTimestamp.toString()}</span> ({unlockHuman}){" "}
                      {unlockTimestamp <= BigInt(nowSeconds) ? <span className="text-destructive">(不合法)</span> : null}
                    </>
                  ) : (
                    "-"
                  )}
                </div>
                <div className="text-[11px]">
                  说明：任何人都可以给 Vault 存入，但 Break 时会把资产退回给 Vault 创建者（owner）。
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={approve} disabled={busy || !isConnected}>
              授权（Approve）
            </Button>
            <Button onClick={createVaultAndDeposit} disabled={busy || !isConnected}>
              创建并存入
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold">Break Vault（取回）</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Vault ID</label>
              <Input value={breakVaultId} onChange={(e) => setBreakVaultId(e.target.value)} inputMode="numeric" />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">预览</label>
              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1">
                {breakVaultPreview ? (
                  <>
                    <div className="break-all">
                      Owner：<span className="font-mono">{breakVaultPreview.owner}</span>
                    </div>
                    <div>Unlock：{breakVaultPreview.unlockTimestamp.toString()}</div>
                    <div>Broken：{breakVaultPreview.broken ? "是" : "否"}</div>
                  </>
                ) : (
                  <div>-</div>
                )}
              </div>
            </div>
          </div>
          <Button onClick={breakVault} disabled={busy || !isConnected}>
            Break
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">我的 Vault 列表</div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refreshMyVaults().catch((err) => setError(toErrorMessage(err)))}
              disabled={!isConnected || busy || vaultListLoading}
            >
              <RefreshCw className={`h-4 w-4 ${vaultListLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="space-y-3">
            {!isConnected ? (
              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">请先连接钱包</div>
            ) : vaultListLoading && !myVaults.length ? (
              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">加载中…</div>
            ) : myVaultIds.length ? (
              myVaults.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {myVaults.map((vault) => {
                    const matured = vault.unlockTimestamp <= BigInt(nowSeconds)
                    const unlockDate = new Date(Number(vault.unlockTimestamp) * 1000).toLocaleString()
                    const canRedeem = !vault.broken && !busy && isConnected && !!vaultManagerAddress && !!walletClient && !!publicClient

                    return (
                      <Card key={vault.id.toString()} className="border border-border/60 bg-background/60">
                        <CardHeader className="space-y-2 pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <CardTitle className="text-base">Vault #{vault.id.toString()}</CardTitle>
                              <CardDescription className="break-all text-xs">
                                Owner：<span className="font-mono">{vault.owner}</span>
                              </CardDescription>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {vault.broken ? (
                                <Badge variant="secondary">已赎回</Badge>
                              ) : matured ? (
                                <Badge className="bg-emerald-600 hover:bg-emerald-600/90">已到期</Badge>
                              ) : (
                                <Badge variant="outline">未到期</Badge>
                              )}
                              <span className="text-[11px] text-muted-foreground">{vault.tokens.length} Tokens</span>
                            </div>
                          </div>

                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                            <div>
                              到期时间：<span className="font-mono">{unlockDate}</span>
                            </div>
                            <div>
                              时间戳：<span className="font-mono">{vault.unlockTimestamp.toString()}</span>
                            </div>
                          </div>
                        </CardHeader>

                        <CardContent className="space-y-3">
                          <div className="space-y-2">
                            {vault.tokens.length ? (
                              vault.tokens.map((token) => {
                                const amount =
                                  token.decimals == null
                                    ? token.balance.toString()
                                    : formatUnitsTruncated(token.balance, token.decimals)
                                const symbol = token.symbol ?? shortenAddress(token.token)
                                return (
                                  <div
                                    key={`${vault.id.toString()}:${token.token}`}
                                    className="rounded-md border bg-background px-3 py-2 text-xs space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-medium">{symbol}</div>
                                      <div className="text-muted-foreground">Decimals：{token.decimals ?? "-"}</div>
                                    </div>
                                    <div className="break-all text-muted-foreground font-mono">{token.token}</div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-muted-foreground">Vault Balance</span>
                                      <span className="font-mono">{amount}</span>
                                    </div>
                                  </div>
                                )
                              })
                            ) : (
                              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">暂无 Token</div>
                            )}
                          </div>

                          <Button
                            onClick={() => redeemVault(vault.id)}
                            disabled={!canRedeem}
                            variant={matured ? "default" : "outline"}
                            className="w-full"
                          >
                            {vault.broken ? "已赎回" : matured ? "赎回" : "提前赎回（-5%）"}
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                  未能加载 Vault 详情，请点击右上角刷新重试
                </div>
              )
            ) : (
              <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                {vaultListLoading ? "加载中…" : "暂无 Vault"}
              </div>
            )}

            {lastCreatedVaultId != null && (
              <div className="text-xs text-muted-foreground">
                最近创建：<span className="font-mono">{lastCreatedVaultId.toString()}</span>
              </div>
            )}
          </div>
        </div>

        {(status || error || txHash) && (
          <div className="rounded-xl border bg-background p-4 text-sm space-y-1">
            {status ? (
              <div>
                <span className="text-muted-foreground">状态：</span> {status}
              </div>
            ) : null}
            {txHash ? (
              <div className="break-all">
                <span className="text-muted-foreground">Tx：</span> <span className="font-mono">{txHash}</span>
              </div>
            ) : null}
            {error ? (
              <div className="text-destructive">
                <span className="text-muted-foreground">错误：</span> {error}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
