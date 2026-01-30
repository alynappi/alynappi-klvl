// Load environment variables FIRST
import * as dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { Database } from '../../src/types/database.types'

type DocumentInsert = Database['public']['Tables']['documents']['Insert']
type SectionInsert = Database['public']['Tables']['sections']['Insert']

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY
if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY missing')

// --- KULTAINEN WHITELIST (Vain nämä polut hyväksytään) ---

const ALLOWED_PATHS = [
  // Kuuloavain.fi KULTA
  'kuuloavain.fi/support',
  'kuuloavain.fi/info',
  'kuuloavain.fi/vertaistukea',
  'kuuloavain.fi/tietoa',
  
  // KLVL.fi KULTA
  'klvl.fi/uusille-perheille',
  'klvl.fi/vertaistoiminta',
  'klvl.fi/edunvalvonta',
  'klvl.fi/jasenille',
  'klvl.fi/vaikuta-kanssamme'
]

const SITEMAPS = [
  { url: 'https://klvl.fi/page-sitemap.xml', category: 'web-sivusto' },
  { url: 'https://kuuloavain.fi/page-sitemap.xml', category: 'web-sivusto' }
]

// --- APUFUNKTIOT ---

async function getUrlsFromSitemap(sitemapUrl: string): Promise<string[]> {
  console.log(`🔍 Tutkitaan sitemap: ${sitemapUrl}...`)
  try {
    const response = await fetch(sitemapUrl)
    if (!response.ok) return []
    const xml = await response.text()
    const regex = /<loc>(.*?)<\/loc>/g
    const urls: string[] = []
    let match
    
    while ((match = regex.exec(xml)) !== null) {
      const url = match[1]
      
      // WHITELIST-TARKISTUS: Hyväksytään vain jos URL sisältää jonkin kultaisista poluista
      const isWhitelisted = ALLOWED_PATHS.some(path => url.toLowerCase().includes(path.toLowerCase()))
      const isTrash = url.includes('/sv/') || url.includes('/en/') || url.endsWith('.pdf') || url.endsWith('.xml')

      if (isWhitelisted && !isTrash) {
        urls.push(url)
      }
    }
    return urls
  } catch (e) { 
    console.error(`  ❌ Virhe sitemappia luettaessa: ${sitemapUrl}`)
    return [] 
  }
}

function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = []
  let startIndex = 0
  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize
    const chunk = text.slice(startIndex, endIndex).trim()
    chunks.push(chunk)
    startIndex = endIndex - overlap
    if (startIndex >= text.length || chunk.length === 0) break
  }
  return chunks.filter(c => c.length > 150) // Pidetään vain järkevän mittaiset pätkät
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mistral-embed', input: texts }),
  })
  const data = await response.json() as any
  if (!data.data) throw new Error('Mistral embeddings error')
  return data.data.map((item: any) => item.embedding)
}

async function fetchWebContent(url: string): Promise<{ title: string; content: string }> {
  // Käytetään Jina Readeria siistin markdown-tekstin saamiseksi
  const response = await fetch(`https://r.jina.ai/${url}`)
  const text = await response.text()
  const titleMatch = text.match(/^# (.*)/)
  const title = titleMatch ? titleMatch[1].trim() : url
  return { title, content: text }
}

// --- PÄÄPROSESSI ---

async function processWebPage(url: string, category: string) {
  const { supabase } = await import('../../src/lib/supabase')
  
  // Estetään duplikaatit
  const { data: existing } = await supabase.from('documents').select('id').eq('url', url).single()
  if (existing) {
    console.log(`  ⏭️ Ohitetaan (jo tallennettu): ${url}`)
    return
  }

  try {
    const { title, content } = await fetchWebContent(url)
    
    // Varmistetaan että sivulla on oikeasti sisältöä
    if (content.length < 300) {
      console.log(`  ⚠️ Ohitetaan (liian lyhyt sisältö): ${url}`)
      return 
    }

    const { data: doc } = await supabase.from('documents').insert({
      title, 
      source_type: 'web', 
      url, 
      year: 2026 // Merkitään tiedot tuoreiksi
    }).select().single()

    if (!doc) return

    const chunks = chunkText(content)
    const embeddings = await getEmbeddings(chunks)

    const sections: SectionInsert[] = chunks.map((chunk, i) => ({
      document_id: doc.id,
      content: chunk,
      embedding: embeddings[i],
      category: category,
    }))

    await supabase.from('sections').insert(sections)
    console.log(`  ✅ Tallennettu laatusivu: ${title}`)
  } catch (e) { 
    console.error(`  ❌ Virhe prosessoinnissa: ${url}`, e) 
  }
}

async function main() {
  console.log('🚀 Aloitetaan kultaisten polkujen haku (Strict Whitelist)...')
  
  for (const sitemap of SITEMAPS) {
    const urls = await getUrlsFromSitemap(sitemap.url)
    console.log(`📍 Löydetty ${urls.length} whitelistattua sivua kohteesta ${sitemap.url}`)
    
    for (const pageUrl of urls) {
      await processWebPage(pageUrl, sitemap.category)
    }
  }
  
  console.log('\n✨ Valmis! Tietokanta on nyt kuratoitu ja sisältää vain parhaan tiedon.')
}

main()