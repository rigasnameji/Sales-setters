import { getSettings, updateSettings } from '@/app/actions'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function AdminPage() {
  const settings = await getSettings()

  return (
    <div className="max-w-4xl mx-auto p-8 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bot Training Interface</h1>
          <p className="text-muted-foreground mt-2">Update the bot's system prompt and response guidelines.</p>
        </div>
        <Link href="/">
          <Button variant="outline">Back to Bot</Button>
        </Link>
      </div>

      <form action={updateSettings}>
        <Card className="shadow-lg border-primary/10">
          <CardHeader className="bg-muted/30">
            <CardTitle>Training Data</CardTitle>
            <CardDescription>This information will be sent to the AI every time a new conversation is pasted.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3">
              <Label htmlFor="apiKey" className="text-base font-semibold">Google Gemini API Key (Optional)</Label>
              <input 
                id="apiKey"
                name="apiKey"
                type="password"
                placeholder="AIzaSy..."
                defaultValue={settings.apiKey || ""}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-sm text-muted-foreground">Get a free key from <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-blue-500 underline">Google AI Studio</a>. If provided, this key will be used instead of the local server environment variable.</p>
            </div>

            <div className="space-y-3">
              <Label htmlFor="systemPrompt" className="text-base font-semibold">System Prompt</Label>
              <Textarea 
                id="systemPrompt"
                name="systemPrompt"
                defaultValue={settings.systemPrompt}
                rows={4}
                className="resize-none font-mono text-sm"
              />
            </div>
            
            <div className="space-y-3">
              <Label htmlFor="guidelines" className="text-base font-semibold">Response Guidelines & Examples</Label>
              <Textarea 
                id="guidelines"
                name="guidelines"
                defaultValue={settings.guidelines}
                rows={12}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end bg-muted/30 pt-6">
            <Button type="submit" size="lg" className="w-full sm:w-auto">Save Training Data</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  )
}
