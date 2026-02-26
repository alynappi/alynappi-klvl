import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Allow streaming responses up to 60 seconds (increased due to slow Mistral API connections ~17s)
export const maxDuration = 60;
export const runtime = 'nodejs';

// Environment variables will be validated in the request handler

async function getEmbedding(text: string, mistralApiKey: string) {
  if (!text) throw new Error('Input missing');
  
  // Add timeout to prevent hanging on slow connections
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout - embeddings are usually fast but allow buffer
  
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
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Invalid embedding response format');
    }
    
    return data.data[0].embedding;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('❌ Embedding API timeout after 15 seconds');
      throw new Error('Embedding API connection timeout after 15 seconds');
    }
    console.error('❌ Embedding API error:', error.message);
    throw error;
  }
}

export async function POST(req: Request) {
  // CRITICAL: Log immediately to verify function is being called
  console.log('🚨 POST /api/chat called at', new Date().toISOString());
  console.log('🚨 Environment check:', {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SECRET_KEY,
    hasMistralKey: !!process.env.MISTRAL_API_KEY,
    vercelRegion: process.env.VERCEL_REGION || 'unknown'
  });
  
  const startTime = Date.now();
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

    // Log first few characters to verify keys are loaded (without exposing full key)
    console.log('Environment check:', {
      supabaseUrl: supabaseUrl.substring(0, 20) + '...',
      supabaseKeyPrefix: supabaseServiceKey.substring(0, 10) + '...',
      mistralKeyPrefix: MISTRAL_API_KEY.substring(0, 10) + '...',
      keyLength: supabaseServiceKey.length
    })

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json();
    const { messages: rawMessages } = body;
    
    if (!rawMessages || !Array.isArray(rawMessages)) {
      throw new Error('Invalid request: messages array is required');
    }

    const messages = rawMessages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : 
               (Array.isArray(m.parts) ? m.parts.find((p: any) => p.type === 'text')?.text || "" : "")
    }));

    const userQuestion = messages[messages.length - 1]?.content;
    
    if (!userQuestion || !userQuestion.trim()) {
      throw new Error('User question is empty');
    }
    
    const queryEmbedding = await getEmbedding(userQuestion, MISTRAL_API_KEY);

    // 2. HAKU (match_threshold ja match_count säädettävissä tässä)
    console.log('Calling Supabase RPC with embedding length:', queryEmbedding.length);
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.15,
      match_count: 8
    });
    
    if (matchError) {
      console.error('Supabase RPC error details:', {
        message: matchError.message,
        details: matchError.details,
        hint: matchError.hint,
        code: matchError.code,
        hasSupabaseUrl: !!supabaseUrl,
        hasSupabaseKey: !!supabaseServiceKey && supabaseServiceKey.length > 0
      });
      throw new Error(`Database search failed: ${matchError.message}`);
    }

    // Log first section to verify category is being returned
    if (matchedSections && matchedSections.length > 0) {
      const firstSection = matchedSections[0];
      console.log('📋 First matched section sample:', {
        id: firstSection.id,
        title: firstSection.metadata?.title || firstSection.title,
        category: firstSection.category,
        page_number: firstSection.page_number,
        similarity: firstSection.similarity,
        hasContent: !!firstSection.content,
        metadata: firstSection.metadata
      });
    }

    // Format context with category and page number metadata
    const contextText = matchedSections?.map((s: any) => {
      const category = s.category || null;
      const pageNumber = s.page_number || null;
      // Extract title from metadata object (new RPC structure) or fallback to direct title field
      const title = s.metadata?.title || s.title || '';
      
      // Log for debugging
      if (!category) {
        console.warn(`⚠️  Missing category for section: ${title} (section ID: ${s.id || 'unknown'})`);
      }
      
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

    // 4. MISTRAL KUTSU - Diagnostic version to find root cause of latency
    const mistralStart = Date.now();
    console.log('🚀 Starting Mistral API connection...', {
      timestamp: new Date().toISOString(),
      vercelRegion: process.env.VERCEL_REGION || 'unknown',
      nodeVersion: process.version
    });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 25000); // 25 second timeout - allows for slow connections but fails fast
    
    let response;
    try {
      const fetchStart = Date.now();
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
          max_tokens: 1500, // Reduced from 2000 for faster generation
          temperature: 0.7,
          stream: true,
        })
      });
      clearTimeout(timeoutId);
      
      const fetchTime = Date.now() - fetchStart;
      const totalTime = Date.now() - mistralStart;
      
      // Detailed diagnostics
      console.log('🔍 Mistral API Connection Diagnostics:', {
        fetchTime: `${fetchTime}ms`,
        totalTime: `${totalTime}ms`,
        status: response.status,
        statusText: response.statusText,
        vercelRegion: process.env.VERCEL_REGION || 'unknown',
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
      });
      
      if (totalTime > 2000) {
        console.warn(`⚠️  SLOW CONNECTION DETECTED: ${totalTime}ms (should be <2000ms)`);
        console.warn(`   Fetch time: ${fetchTime}ms`);
        console.warn(`   Vercel region: ${process.env.VERCEL_REGION || 'unknown'}`);
        console.warn(`   This indicates network latency between Vercel and Mistral API`);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - mistralStart;
      console.error('❌ Mistral API connection failed:', {
        error: error.message,
        elapsed: `${elapsed}ms`,
        name: error.name,
        code: error.code,
        vercelRegion: process.env.VERCEL_REGION || 'unknown',
        timestamp: new Date().toISOString()
      });
      if (error.name === 'AbortError') {
        throw new Error(`Mistral API connection timeout after ${elapsed}ms. Vercel region: ${process.env.VERCEL_REGION || 'unknown'}. This indicates a network/infrastructure issue between Vercel and Mistral API.`);
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          let buffer = '';
          let done = false;
          
          while (!done) {
            // Check if we're approaching timeout (28 seconds = warning threshold)
            const elapsed = Date.now() - startTime;
            if (elapsed >= 28000) {
              // We're about to hit timeout, send warning and close gracefully
              const warning = '\n\n⚠️ Vastaus katkesi aikakatkaisun vuoksi. Yritä uudelleen.';
              controller.enqueue(encoder.encode(warning));
              console.error(`⏱️ Stream timeout warning at ${elapsed}ms`);
              break;
            }
            
            const result = await reader.read();
            done = result.done;
            
            if (result.value) {
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
                  break;
                }
                if (data) {
                  try {
                    const json = JSON.parse(data);
                    const text = json.choices?.[0]?.delta?.content;
                    if (text) {
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
                    controller.enqueue(encoder.encode(text));
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
          
          // Stream complete
          const totalTime = Date.now() - startTime;
          console.log(`✅ Stream complete: ${totalTime}ms`);
        } catch (e) {
          console.error('Stream error:', e);
          const errorTime = Date.now() - startTime;
          console.error(`❌ Stream failed after ${errorTime}ms`);
          
          // If timeout, send user-friendly message
          if (errorTime >= 28000) {
            const timeoutMessage = '\n\n⚠️ Vastaus katkesi aikakatkaisun vuoksi. Yritä uudelleen.';
            controller.enqueue(encoder.encode(timeoutMessage));
          }
          
          controller.error(e);
        } finally {
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
    console.error('Chat API Error:', error);
    console.error('Error details:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
    const errorMessage = error?.message || 'Unknown error occurred';
    return NextResponse.json({ 
      error: errorMessage,
      details: error?.details || error?.hint || undefined,
      // Include more details in production for debugging
      type: error?.name || 'Error'
    }, { status: 500 });
  }
}