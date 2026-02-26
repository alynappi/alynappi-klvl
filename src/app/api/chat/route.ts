import { createClient } from '@supabase/supabase-js'

// PAKOTETAAN EDGE RUNTIME
export const runtime = 'edge';

async function getEmbedding(text: string, mistralApiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

  try {
    const response = await fetch('https://api.mistral.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mistralApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ model: 'mistral-embed', input: [text.replace(/\n/g, ' ')] })
    });

    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Embedding failed');
    const data = await response.json();
    return data.data[0].embedding;
  } catch (e: any) {
    clearTimeout(timeoutId);
    throw new Error('Mistral embedding hidas tai virheellinen: ' + e.message);
  }
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

    if (!supabaseUrl || !supabaseServiceKey || !MISTRAL_API_KEY) {
      throw new Error('Ympäristömuuttujat puuttuvat Vercelistä.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { messages: rawMessages } = await req.json();

    const messages = rawMessages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : (m.parts?.find((p: any) => p.type === 'text')?.text || "")
    }));

    const userQuestion = messages[messages.length - 1]?.content;

    // 1. Haetaan embedding (n. 0.2s)
    const queryEmbedding = await getEmbedding(userQuestion, MISTRAL_API_KEY);

    // 2. Supabase RPC (n. 1s)
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.15,
      match_count: 4
    });
    if (matchError) throw new Error(`Supabase RPC epäonnistui: ${matchError.message}`);

    const contextText = matchedSections?.map((s: any) => {
      const category = s.category || '[Kategoria puuttuu]';
      const title = s.metadata?.title || s.title || '';
      const pageNumber = s.page_number ? `, s. ${s.page_number}` : '';
      return `[Lähde: ${category} ${title}${pageNumber}]\n${s.content}`;
    }).join('\n\n---\n\n');

    // 3. System prompt
    const systemPrompt = `
Rooli: Olet Äly-Nappi, avulias ja empaattinen arkistoavustaja. Vastauksesi perustuvat annettuihin Nappi-lehden tekstiotteisiin.

Yleiset säännöt:
Lähdemateriaali: Käytä vain annettua arkistomateriaalia. Jos tietoa ei löydy, sano: "Etsin arkistosta ahkerasti, mutta tästä aiheesta ei valitettavasti löytynyt mainintoja. 🔍 Voinko auttaa jossain muussa?"
Sävy: Ole ystävällinen ja eläväinen. Käytä emojeita (📅, 📍, ❄️) elävöittämään tekstiä.
Lähdeviitteet: [Kategoria] Nimi, s. X.
Älä koskaan käännä julkaisujen nimiä.

LÖYDETTY ARKISTOMATERIAALI:
${contextText || 'Ei suoria osumia arkistosta.'}
`;

    // 4. Mistral chat
    const mistralController = new AbortController();
    const mistralTimeout = setTimeout(() => mistralController.abort(), 20000); // 20s timeout

    let response;
    try {
      response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: mistralController.signal,
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 1000,
          temperature: 0.7,
          stream: true
        })
      });
      clearTimeout(mistralTimeout);
    } catch (e: any) {
      clearTimeout(mistralTimeout);
      if (e.name === 'AbortError') throw new Error('Mistral API timeout 20s.');
      throw e;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Mistral API Error: ${err}`);
    }

    // 5. Palautetaan striimi suoraan
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (error: any) {
    console.error('Chat API Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}