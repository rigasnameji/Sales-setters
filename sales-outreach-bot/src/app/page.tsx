'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Copy, Loader2, Settings, MessageSquare, Check } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const [conversation, setConversation] = useState('')
  const [variations, setVariations] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const handleGenerate = async () => {
    if (!conversation.trim()) return

    setIsLoading(true)
    setVariations([])

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation })
      })

      if (!response.ok) {
        throw new Error('Failed to generate responses')
      }

      const data = await response.json()
      setVariations(data)
    } catch (error) {
      console.error(error)
      alert('Failed to generate responses. Please check your OpenAI API key in the .env file and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 min-h-screen flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-primary flex items-center gap-3">
            <MessageSquare className="w-8 h-8" />
            OutreachBot
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">Paste a conversation, get 3 distinct response variations instantly.</p>
        </div>
        <Link href="/admin">
          <Button variant="outline" className="gap-2 shadow-sm">
            <Settings className="w-4 h-4" />
            Training & Settings
          </Button>
        </Link>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        <Card className="flex flex-col shadow-lg border-primary/10">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle>Current Conversation</CardTitle>
            <CardDescription>Paste the email chain, LinkedIn messages, or notes here.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0">
            <Textarea 
              placeholder="E.g., Prospect: 'I like the idea, but we don't have budget until Q4.'..."
              className="flex-1 min-h-[350px] border-0 rounded-none resize-none text-base p-6 leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
              value={conversation}
              onChange={(e) => setConversation(e.target.value)}
            />
          </CardContent>
          <CardFooter className="bg-muted/30 pt-6 border-t">
            <Button 
              size="lg" 
              className="w-full text-lg h-14 font-semibold shadow-md transition-all hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleGenerate}
              disabled={isLoading || !conversation.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                  Generating Variations...
                </>
              ) : (
                'Generate Variations'
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-6">
          {variations.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl p-8 text-center bg-muted/5">
              <MessageSquare className="w-16 h-16 mb-6 opacity-20" />
              <h3 className="text-2xl font-semibold mb-2">No Variations Yet</h3>
              <p className="text-lg">Paste a conversation and click Generate to see options here.</p>
            </div>
          ) : null}

          {variations.map((text, i) => (
            <Card key={i} className="shadow-md hover:shadow-xl transition-all border-l-4 border-l-primary" style={{ animationDelay: `${i * 100}ms` }}>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 bg-muted/20 border-b border-muted">
                <CardTitle className="text-sm font-bold tracking-wide uppercase text-primary/80">Variation {i + 1}</CardTitle>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => handleCopy(text, i)}
                  className="h-8 px-3 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  {copiedIndex === i ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copiedIndex === i ? <span className="text-green-500 font-medium">Copied!</span> : 'Copy'}
                </Button>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{text}</p>
              </CardContent>
            </Card>
          ))}

          {isLoading && (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="shadow-sm opacity-50 animate-pulse border-l-4 border-l-primary/30">
                  <CardContent className="p-6">
                    <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
                    <div className="h-4 bg-muted rounded w-1/2 mb-4"></div>
                    <div className="h-4 bg-muted rounded w-5/6"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
