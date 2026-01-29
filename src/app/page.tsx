'use client'

import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport, isTextUIPart } from 'ai'
import { useEffect, useRef, useState } from 'react'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const { messages, sendMessage, status } = useChat({
    transport: new TextStreamChatTransport({ api: '/api/chat' }),
  })
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && status !== 'streaming') {
      sendMessage({ text: input })
      setInput('')
    }
  }

  const getMessageText = (message: typeof messages[0]) => {
    return message.parts
      .filter(isTextUIPart)
      .map(part => part.text)
      .join('')
  }

  return (
    <main className="flex flex-col h-screen max-h-screen bg-slate-50 overflow-hidden">
      {/* YLÄPALKKI */}
      <header className="bg-klvl-blue text-white p-4 shadow-lg shrink-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-klvl-yellow rounded-full flex items-center justify-center text-klvl-blue font-bold text-xl shadow-inner">
            Ä
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Äly-Nappi Arkisto</h1>
            <p className="text-[10px] uppercase tracking-widest opacity-80">KLVL ry:n tekoälyavustaja</p>
          </div>
        </div>
      </header>

      {/* VIESTIALUE */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="max-w-2xl mx-auto w-full">
          {messages.length === 0 && (
            <div className="text-center py-16 px-6 bg-white rounded-3xl shadow-sm border border-slate-100 mt-10">
              <h2 className="text-klvl-blue text-2xl font-bold mb-4">Hei! Mitä haluaisit tietää Nappi-lehdistä?</h2>
              <p className="text-slate-600 italic">Etsin vastaukset suoraan arkistosta ja kerron lähteet.</p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
              <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm leading-relaxed ${
                m.role === 'user' 
                  ? 'bg-klvl-blue text-white rounded-tr-none' 
                  : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
              }`}>
                <div className="whitespace-pre-wrap">{getMessageText(m)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SYÖTTÖKENTTÄ */}
      <div className="p-4 bg-white border-t border-slate-200 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex gap-2">
          <input
            className="flex-1 p-4 bg-slate-100 rounded-2xl focus:ring-2 focus:ring-klvl-blue outline-none text-slate-800 transition-all shadow-inner"
            value={input}
            placeholder="Kysy jotain Napista..."
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'streaming'}
          />
          <button 
            type="submit" 
            disabled={status === 'streaming' || !input.trim()}
            className="px-6 bg-klvl-yellow hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-klvl-blue font-bold rounded-2xl transition-all shadow-md active:scale-95"
          >
            {status === 'streaming' ? '...' : 'Kysy'}
          </button>
        </form>
      </div>
    </main>
  )
}