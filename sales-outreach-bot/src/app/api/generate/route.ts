import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { conversation } = await req.json()

    if (!conversation) {
      return new Response('Conversation is required', { status: 400 })
    }

    // Get the latest settings
    let settings = await prisma.botSettings.findFirst()
    if (!settings) {
      settings = await prisma.botSettings.create({ data: {} })
    }

    const google = createGoogleGenerativeAI({
      apiKey: settings.apiKey || process.env.GEMINI_API_KEY || '',
    })

    const { object } = await generateObject({
      model: google('gemini-1.5-pro-latest'),
      schema: z.object({
        variations: z.array(z.string()).length(3).describe('Exactly 3 distinct response variations'),
      }),
      system: `${settings.systemPrompt}\n\nGuidelines:\n${settings.guidelines}`,
      prompt: `Please generate 3 distinct response variations for the following prospect conversation:\n\n${conversation}`,
    })

    return new Response(JSON.stringify(object.variations), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error: any) {
    console.error('Error generating response:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
