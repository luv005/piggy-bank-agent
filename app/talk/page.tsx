"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Menu, PhoneOff } from "lucide-react"

const MENTOR_QUOTES = [
  "Don't forget to deposit!",
  "Save a little, grow a lot!",
  "Your future self will thank you!",
  "Every satoshi counts!",
  "Stay consistent, stay wealthy!",
  "HODL strong, save long!",
]

export default function TalkPage() {
  const router = useRouter()
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [currentQuote, setCurrentQuote] = useState(MENTOR_QUOTES[0])

  // Timer for call duration
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Rotate quotes every 5 seconds
  useEffect(() => {
    const quoteTimer = setInterval(() => {
      setCurrentQuote((prev) => {
        const currentIndex = MENTOR_QUOTES.indexOf(prev)
        const nextIndex = (currentIndex + 1) % MENTOR_QUOTES.length
        return MENTOR_QUOTES[nextIndex]
      })
    }, 5000)
    return () => clearInterval(quoteTimer)
  }, [])

  // Format elapsed time as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }, [])

  // End call handler
  const handleEndCall = () => {
    router.push("/vault")
  }

  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-pink-50 to-pink-100">
      {/* Header */}
      <header className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500">
            <span className="text-sm font-bold text-white">🐷</span>
          </div>
          <span className="text-xl font-bold text-slate-900">BitPiggy</span>
        </div>
        <button className="p-2">
          <Menu className="h-6 w-6 text-slate-600" />
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center px-6 py-8">
        {/* Avatar */}
        <div className="mb-6">
          <div className="flex h-48 w-48 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-500 shadow-lg">
            <span className="text-8xl">🐷</span>
          </div>
        </div>

        {/* Name */}
        <h1 className="mb-2 text-3xl font-bold text-slate-900">Piggy Mentor</h1>

        {/* Call Duration */}
        <div className="mb-8 flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <span className="font-mono text-lg text-green-600">{formatTime(elapsedSeconds)}</span>
        </div>

        {/* Quote */}
        <div className="mb-auto flex min-h-[80px] items-center justify-center px-4">
          <p className="text-center text-2xl font-semibold italic text-slate-700">
            &ldquo;{currentQuote}&rdquo;
          </p>
        </div>

        {/* End Call Button Area */}
        <div className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-8 pt-6 shadow-lg">
          <div className="flex justify-center">
            <button
              onClick={handleEndCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              <PhoneOff className="h-7 w-7 text-white" />
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
