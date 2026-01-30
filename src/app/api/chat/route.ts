import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;
export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY!

async function getEmbedding(text: string) {
  if (!text) throw new Error('Input missing');
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'mistral-embed', input: [text.replace(/\n/g, ' ')] })
  })
  
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
  try {
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
    
    const queryEmbedding = await getEmbedding(userQuestion);

    // 2. HAKU (match_threshold ja match_count säädettävissä tässä)
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.15,
      match_count: 8
    });
    
    if (matchError) {
      console.error('Supabase RPC error:', matchError);
      throw new Error(`Database search failed: ${matchError.message}`);
    }

    const contextText = matchedSections?.map((s: any) => `[Lähde: ${s.title}]\n${s.content}`).join('\n\n---\n\n');

    // 3. SYSTEM PROMPT - Äly-Napin aivot ja säännöt palautettu
    const systemPrompt = `
Olet Äly-Nappi, avulias ja empaattinen arkistoavustaja. Tehtäväsi on vastata käyttäjän kysymyksiin annettujen Nappi-lehden tekstiotteiden perusteella.

SÄÄNNÖT:
  - Käytä vain annettua arkistomateriaalia vastauksen pohjana.
  - Vastaa perusteellisesti, asiantuntevastikattavasti.
  - Käytä selkeitä listoja ja lihavointeja (**tärkeä termi**).
  - Mainitse vastauksessa aina lähteenä käytetyn lehden numero ja vuosi.
  - Jos et löydä tietoa, sano: "Pahoittelut, tästä aiheesta ei löytynyt mainintoja arkistosta."

LÖYDETTY ARKISTOMATERIAALI:
${contextText || 'Ei suoria osumia arkistosta.'}
`;

    // 4. MISTRAL KUTSU - Asetukset palautettu (temperature, max_tokens)
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-small-latest', // vaihda malli mistral-large-latest
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 500,    //nosta tätä tuotannossa 1000
        temperature: 0.7,
        top_p: 1,
        stream: true,
      })
    });

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
        } catch (e) {
          console.error('Stream error:', e);
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
    const errorMessage = error?.message || 'Unknown error occurred';
    return NextResponse.json({ 
      error: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }, { status: 500 });
  }
}