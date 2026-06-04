'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export async function getSettings() {
  let settings = await prisma.botSettings.findFirst()
  if (!settings) {
    settings = await prisma.botSettings.create({
      data: {}
    })
  }
  return settings
}

export async function updateSettings(formData: FormData) {
  const settings = await getSettings()
  
  const systemPrompt = formData.get('systemPrompt') as string
  const guidelines = formData.get('guidelines') as string

  await prisma.botSettings.update({
    where: { id: settings.id },
    data: {
      systemPrompt: systemPrompt || "",
      guidelines: guidelines || "",
    }
  })
  
  revalidatePath('/admin')
  revalidatePath('/')
}
