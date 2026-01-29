'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      })

      if (!response.ok) throw new Error('Haku epäonnistui')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') break
              try {
                const json = JSON.parse(data)
                const content = json.choices[0]?.delta?.content || ''
                assistantContent += content
                setMessages(prev => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1].content = assistantContent
                  return newMessages
                })
              } catch (e) {
                // Ohitetaan epätäydelliset JSON-pätkät
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Virhe:', error)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Haku epäonnistui. Tarkista yhteys.' }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-white dark:bg-zinc-900 px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">Äly-Nappi Arkisto</h1>
        <div className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Mistral AI v1.0</div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 rounded-full bg-zinc-200 dark:bg-zinc-800 p-4">🤖</div>
              <h2 className="text-lg font-semibold">Tervetuloa arkistoon</h2>
              <p className="text-sm text-zinc-500 max-w-xs">Voit kysyä mitä tahansa vuoden 2025 lehdistä. Etsin vastaukset suoraan tekstistä.</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`rounded-2xl px-6 py-4 shadow-sm max-w-[90%] ${
                m.role === 'user' 
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900' 
                  : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800'
              }`}>
                {/* TÄSSÄ ON MUUTETTU KOHTA: ReactMarkdown hoitaa muotoilun */}
                <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
                  <ReactMarkdown
                    components={{
                      // Tehdään linkeistä klikattavia ja sinisiä
                      a: ({ node, ...props }) => (
                        <a {...props} className="text-blue-600 font-bold underline hover:text-blue-800" target="_blank" rel="noopener noreferrer" />
                      )
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Form */}
      <footer className="border-t bg-white dark:bg-zinc-900 p-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl flex gap-3">
          <input
            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
            value={input}
            placeholder="Mitä Nappi-lehdessä 1/2025 sanottiin..."
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-50 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isLoading ? 'Etsitään...' : 'Kysy'}
          </button>
        </form>
      </footer>
    </div>
  )
}