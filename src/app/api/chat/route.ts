import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Allow streaming responses up to 60 seconds (increased from 30s to handle slow Mistral API connections)
export const maxDuration = 60;
export const runtime = 'nodejs';

// Environment variables will be validated in the request handler

async function getEmbedding(text: string, mistralApiKey: string) {
  if (!text) throw new Error('Input missing');
  
  const startTime = Date.now();
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${mistralApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'mistral-embed', input: [text.replace(/\n/g, ' ')] })
  })
  
  const fetchTime = Date.now() - startTime;
  if (fetchTime > 2000) {
    console.warn(`⚠️  Slow embedding fetch: ${fetchTime}ms`);
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error('Invalid embedding response format');
  }
  
  return data.data[0].embedding;
}

export async function POST(req: Request) {
  const startTime = Date.now();
  console.log('📥 Chat API request received');
  try {
    // Initialize Supabase client with environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

    // Validate environment variables
    if (!supabaseUrl || !supabaseServiceKey || !MISTRAL_API_KEY) {
      const envCheck = {
        hasSupabaseUrl: !!supabaseUrl,
        hasSupabaseKey: !!supabaseServiceKey,
        hasMistralKey: !!MISTRAL_API_KEY,
        supabaseUrlLength: supabaseUrl?.length || 0,
        supabaseKeyLength: supabaseServiceKey?.length || 0,
        mistralKeyLength: MISTRAL_API_KEY?.length || 0,
        allEnvKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE') || k.includes('MISTRAL'))
      }
      console.error('❌ Missing environment variables:', envCheck)
      throw new Error(`Missing required environment variables. Check Vercel settings. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, MISTRAL_API_KEY. Found keys: ${envCheck.allEnvKeys.join(', ')}`)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let body;
    try {
      body = await req.json();
      console.log('📥 Request body parsed, messages count:', body.messages?.length || body.length || 0);
    } catch (parseError: any) {
      console.error('❌ Failed to parse request body:', parseError?.message);
      throw new Error(`Invalid JSON in request body: ${parseError?.message}`);
    }
    
    // Handle different request formats from TextStreamChatTransport
    const rawMessages = body.messages || body;
    
    if (!rawMessages || !Array.isArray(rawMessages)) {
      console.error('❌ Invalid request format:', { body, rawMessages });
      throw new Error('Invalid request: messages array is required');
    }

    const messages = rawMessages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : 
               (Array.isArray(m.parts) ? m.parts.find((p: any) => p.type === 'text')?.text || "" : "")
    }));

    const userQuestion = messages[messages.length - 1]?.content;
    console.log('💬 User question:', userQuestion?.substring(0, 100) || 'empty');
    
    if (!userQuestion || !userQuestion.trim()) {
      console.error('❌ User question is empty');
      throw new Error('User question is empty');
    }
    
    const embeddingStart = Date.now();
    const queryEmbedding = await getEmbedding(userQuestion, MISTRAL_API_KEY);
    console.log(`⏱️  Embedding took: ${Date.now() - embeddingStart}ms`);

    // 2. HAKU (match_threshold ja match_count säädettävissä tässä)
    const rpcStart = Date.now();
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.15,
      match_count: 8
    });
    console.log(`⏱️  Supabase RPC took: ${Date.now() - rpcStart}ms`);
    
    if (matchError) {
      console.error('Supabase RPC error:', matchError.message);
      throw new Error(`Database search failed: ${matchError.message}`);
    }

    // Format context with category and page number metadata
    const contextText = matchedSections?.map((s: any) => {
      const category = s.category || null;
      const pageNumber = s.page_number || null;
      // Extract title from metadata object (new RPC structure) or fallback to direct title field
      const title = s.metadata?.title || s.title || '';
      
      // Format: [Category] Title, s. X - Category is REQUIRED
      // If category is missing, use a fallback but log it
      const categoryLabel = category ? `[${category}]` : '[Kategoria puuttuu]';
      let sourceLabel = `${categoryLabel} ${title}`;
      if (pageNumber) {
        sourceLabel += `, s. ${pageNumber}`;
      }
      
      return `[Lähde: ${sourceLabel}]\n${s.content}`;
    }).join('\n\n---\n\n');

    // 3. SYSTEM PROMPT - Äly-Napin aivot ja säännöt palautettu
    const systemPrompt = `

Rooli: Olet Äly-Nappi, avulias ja empaattinen arkistoavustaja. Vastauksesi perustuvat annettuihin Nappi-lehden tekstiotteisiin.

Yleiset säännöt:
Lähdemateriaali: Käytä vain annettua arkistomateriaalia. Jos tietoa ei löydy, sano: "Etsin arkistosta ahkerasti, mutta tästä aiheesta ei valitettavasti löytynyt mainintoja. 🔍 Voinko auttaa jossain muussa?"
Sävy: Ole ystävällinen, eläväinen ja asiantunteva opas. Käytä emojeita (📅, 📍, ❄️) elävöittämään tekstiä (mutta ei taulukoiden sisällä).
Lähdeviitteet (KRIITTINEN): Jokaisen tiedon perässä on oltava lähde muodossa: [Kategoria] Nimi, s. X. Kategoria on pakollinen.
Esim: [Lehti] Nappi_1_2025, s. 12 tai [Tutkimus] Pelkkikangas, s. 3.
SÄÄNTÖ LÄHTEIDEN NIMILLE:
ÄLÄ KOSKAAN käännä julkaisujen, esitteiden, oppaiden tai Nappi-lehtien nimiä muille kielille.
Nimien on pysyttävä aina alkuperäisessä muodossaan (yleensä suomeksi), vaikka vastaus olisi muulla kielellä.
Esimerkki:
VÄÄRIN: [Брошюра] Памятка для родителей
OIKEIN: [Брошюра] Vinkkivihko vanhemmille
Voit kääntää sivunumeron (esm. "s." -> "с.") ja lähdetyypin (esim. "[Lehti]" -> "[Журнал]"), mutta itse teoksen nimi on pyhä.

Rakenne ja muotoilu:
ÄLÄ KÄYTÄ TAULUKOITA. Markdown-taulukot ovat kiellettyjä niiden huonon luettavuuden vuoksi.

KÄYTÄ LISTOJA: Esitä kaikki vertailut ja apuvälineet selkeinä, otsikoituina listoina.
MUOTOILU: Käytä lihavointia avainsanoille ja jätä tyhjä rivi eri kohtien välille.

ESIMERKKI: 
1. Kuulokoje
- Käyttötarkoitus: Vahvistaa ääniä...
- Hankintatapa: Hoitava sairaala...
- Lähde: [Tutkimus] Pelkkikangas, s. 15.

Kun käytät tietolähteenä verkkosivua (web-sivusto), noudata näitä sääntöjä:
ÄLÄ kirjoita [web-sivusto].
KÄYTÄ AINA Markdown-muotoilua: [Sivun otsikko tai lyhyt kuvaus](URL-osoite).
ESIMERKKI: "Lue lisää täältä: Edunvalvonta"

LÄHDELUETTELO: 
Lisää jokaisen vastauksen loppuun otsikko LÄHTEET:
Listaa jokainen lähde omalle rivilleen kuten alla esimerkissä.
    LÄHTEET:
    [Opas] Vinkkivihko vanhemmille 
    [Tutkimus] Elina Pelkkikangas: Kuulovammainen lapsi päivähoidossa 
    [Tutkimus] Ensiaskeleet lapsen kuulomatkalle
    [Lehti] Nappi_1_2025, s. 12


Lopetus:
Päätä vastaus lyhyeen, innostavaan jatkokysymykseen.
Ehdotä 2-3 aiheeseen liittyvää kysymystä muodossa: [[Kysymys?]]. Pidä ne lyhyinä (max 60 merkkiä).

LÖYDETTY ARKISTOMATERIAALI:
${contextText || 'Ei suoria osumia arkistosta.'}
`;

    // 4. MISTRAL KUTSU - Optimized for fast connections
    const mistralStart = Date.now();
    
    // Optimize fetch with proper timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 10000); // 10 second timeout - should be plenty for a normal connection
    
    let response;
    try {
      response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'mistral-large-latest',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 1000,
          temperature: 0.7,
          frequency_penalty: 0.2,
          presence_penalty: 0.1,
          top_p: 1,
          stream: true,
        })
      });
      clearTimeout(timeoutId);
      
      const connectionTime = Date.now() - mistralStart;
      console.log(`⏱️  Mistral API connection took: ${connectionTime}ms`);
      
      if (connectionTime > 2000) {
        console.warn(`⚠️  SLOW CONNECTION DETECTED: ${connectionTime}ms (should be <2000ms)`);
        console.warn(`   Possible causes: Vercel cold start, network latency, Mistral API region mismatch`);
        console.warn(`   Check Vercel function logs for cold start indicators`);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        const elapsed = Date.now() - mistralStart;
        throw new Error(`Mistral API connection timeout after ${elapsed}ms - network issue detected. Check Vercel region and Mistral API status.`);
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
    }
    
    console.log(`⏱️  Total time before streaming: ${Date.now() - startTime}ms`);

    const encoder = new TextEncoder();
    let streamStartTime = Date.now();
    let chunkCount = 0;
    let totalBytes = 0;
    
    // Add streaming timeout - stop streaming if it takes too long (55 seconds total from start)
    const streamTimeoutId = setTimeout(() => {
      console.error('⏱️  Streaming timeout - stopping stream to prevent Vercel timeout');
    }, 55000);
    
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) {
          clearTimeout(streamTimeoutId);
          controller.close();
          return;
        }

        try {
          let buffer = '';
          let done = false;
          
          while (!done) {
            // Check if we're approaching the 60s limit (stop at 58s to be safe)
            const elapsed = Date.now() - startTime;
            if (elapsed > 58000) {
              console.warn(`⏱️  Approaching timeout (${elapsed}ms), closing stream early`);
              clearTimeout(streamTimeoutId);
              const timeoutMessage = '\n\n⚠️ Vastaus katkesi aikakatkaisun vuoksi. Yritä uudelleen.';
              controller.enqueue(encoder.encode(timeoutMessage));
              done = true;
              break;
            }
            
            const result = await reader.read();
            done = result.done;
            
            if (result.value) {
              totalBytes += result.value.length;
              // Decode with stream:true to handle partial UTF-8 sequences
              buffer += decoder.decode(result.value, { stream: !done });
            }
            
            // Process complete lines
            const lines = buffer.split('\n');
            // Keep incomplete line in buffer
            buffer = done ? '' : (lines.pop() || '');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  done = true;
                  clearTimeout(streamTimeoutId);
                  const streamDuration = Date.now() - streamStartTime;
                  console.log(`✅ Stream complete: ${chunkCount} chunks, ${totalBytes} bytes, ${streamDuration}ms`);
                  break;
                }
                if (data) {
                  try {
                    const json = JSON.parse(data);
                    const text = json.choices?.[0]?.delta?.content;
                    if (text) {
                      chunkCount++;
                      controller.enqueue(encoder.encode(text));
                    }
                  } catch (e) {
                    // Skip invalid JSON lines
                    console.error('Failed to parse JSON:', data, e);
                  }
                }
              }
            }
          }
          
          // Flush any remaining buffer
          if (buffer && buffer.trim()) {
            if (buffer.startsWith('data: ')) {
              const data = buffer.slice(6).trim();
              if (data && data !== '[DONE]') {
                try {
                  const json = JSON.parse(data);
                  const text = json.choices?.[0]?.delta?.content;
                  if (text) {
                    chunkCount++;
                    controller.enqueue(encoder.encode(text));
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
          
          // Stream complete
          clearTimeout(streamTimeoutId);
          const totalTime = Date.now() - startTime;
          console.log(`⏱️  Total request time: ${totalTime}ms`);
        } catch (e) {
          clearTimeout(streamTimeoutId);
          console.error('Stream error:', e);
          const errorTime = Date.now() - startTime;
          console.error(`❌ Stream failed after ${errorTime}ms, ${chunkCount} chunks sent`);
          
          // If stream was cut off due to timeout, send a message to user
          if (errorTime >= 58000) {
            const timeoutMessage = '\n\n⚠️ Vastaus katkesi aikakatkaisun vuoksi. Yritä uudelleen, seuraava pyyntö on nopeampi.';
            controller.enqueue(encoder.encode(timeoutMessage));
          }
          
          controller.error(e);
        } finally {
          clearTimeout(streamTimeoutId);
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    // Enhanced error logging
    const errorDetails = {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      name: error?.name,
      cause: error?.cause,
      timestamp: new Date().toISOString(),
    };
    console.error('❌ Chat API Error:', JSON.stringify(errorDetails, null, 2));
    console.error('❌ Error stack:', error?.stack);
    
    // Return error as a stream-compatible response so frontend can handle it
    const errorMessage = error?.message || 'Unknown error occurred';
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream({
      start(controller) {
        // Send error as text that can be displayed to user
        const errorText = `\n\n❌ Virhe: ${errorMessage}\n\nJos ongelma jatkuu, tarkista Vercel-ympäristömuuttujat ja tarkista Vercel-lokit.`;
        controller.enqueue(encoder.encode(errorText));
        controller.close();
      }
    });
    
    return new Response(errorStream, {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
}