import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Alustetaan Supabase-asiakas service_role-avaimella, jotta pääsemme käsiksi vektoreihin
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY!

// --- APUFUNKTIOT ---

/**
 * Muuttaa tekstin vektoriksi (Embedding)
 */
async function getEmbedding(text: string) {
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: [text.replace(/\n/g, ' ')]
    })
  })
  
  if (!response.ok) throw new Error('Embedding creation failed')
  const data = await response.json()
  return data.data[0].embedding
}

// --- API REITTI ---

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()
    const userQuestion = messages[messages.length - 1].content

    // 1. Luodaan kysymyksestä vektori
    const queryEmbedding = await getEmbedding(userQuestion)

    // 2. Etsitään Supabasesta matemaattisesti lähimmät tekstinpätkät
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.2, // Säädä tätä (0.1 = hyvin löysä, 0.8 = tiukka)
      match_count: 10        // Kuinka monta pätkää annetaan tekoälylle
    })

    if (matchError) throw matchError

    // 3. Koostetaan löydetty teksti kontekstiksi
    const contextText = matchedSections
      ?.map((s: any) => `[Lähde: ${s.title}]\n${s.content}`)
      .join('\n\n---\n\n')

    // 4. Valmistellaan ohjeet Mistralille
    const systemPrompt = `
Olet Äly-Nappi, avulias ja empaattinenarkistoavustaja. Tehtäväsi on vastata käyttäjän kysymyksiin annettujen Nappi-lehden tekstiotteiden perusteella.

SÄÄNNÖT:
  - Käytä vain annettua kontekstia.
  - Vastaa aina kysymyksiin sillä kielellä millä ne on kirjoitettu. Mainitse kuintekin jos olet kääntänyt vastauksen kysytylle kiele 
  - Pidä vastaukset tiiviinä ja ytimekkäinä 
  - Käytä tarvittaessa selkeitä listoja ja lihavointeja (**tärkeä termi**).
  - Jos vastaus löytyy arkistosta, mainitse vastauksessa vuosi ja lehden numero.
  - Jos et löydä tietoa, sano se suoraan äläkä keksi omia, sano esimerkiksi : "Pahoittelut, tästä aiheesta ei löytynyt mainintoja."

LÖYDETTY ARKISTOMATERIAALI:
${contextText || 'Ei suoria osumia arkistosta.'}
`

    // 5. Kutsutaan Mistral Chat API:a striimauksella
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 500,
        stream: true, // Tämä mahdollistaa tekstin "valumisen" ruudulle
      })
    })

    // 6. Palautetaan vastaus suoraan striiminä frontendille
    return new Response(response.body, {
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      }
    })

  } catch (error: any) {
    console.error('Chat API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}