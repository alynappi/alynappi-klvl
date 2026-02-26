
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Käytetään Edge-runtimea, koska se herää sekunteja nopeammin kuin Node.js
export const runtime = 'edge';

async function getEmbedding(text: string, mistralApiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); 

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
  } catch (e) {
    clearTimeout(timeoutId);
    throw new Error('Mistral API (embeddings) on liian hidas juuri nyt.');
  }
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

    if (!supabaseUrl || !supabaseServiceKey || !MISTRAL_API_KEY) {
      throw new Error('Ympäristömuuttujat puuttuvat Vercelin asetuksista.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { messages: rawMessages } = await req.json();
    
    const messages = rawMessages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.parts?.find((p: any) => p.type === 'text')?.text || "")
    }));

    const userQuestion = messages[messages.length - 1]?.content;
    
    // 1. Haetaan embedding
    const queryEmbedding = await getEmbedding(userQuestion, MISTRAL_API_KEY);

    // 2. Tietokantahaku Supabasesta
    const { data: matchedSections, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.15,
      match_count: 7 
    });
    
    if (matchError) throw new Error(`Tietokantahaku epäonnistui: ${matchError.message}`);

    const contextText = matchedSections?.map((s: any) => {
      const category = s.category || '[Kategoria puuttuu]';
      const title = s.metadata?.title || s.title || '';
      const pageNumber = s.page_number ? `, s. ${s.page_number}` : '';
      return `[Lähde: ${category} ${title}${pageNumber}]\n${s.content}`;
    }).join('\n\n---\n\n');

    // 3. TÄYSI ROOLIKUVAUS (System Prompt)
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
ÄLÄ KÄYTÄ TAULUKOITA OLLENKAAN. Markdown-taulukot ovat kiellettyjä niiden huonon luettavuuden vuoksi.

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

    // 4. Kutsu Mistraliin
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1500,
        temperature: 0.7,
        stream: true, // Tämä on tärkeää, jotta vastaus alkaa valua heti
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Mistral API Error: ${err}`);
    }

    // Edge-runtimessa voimme palauttaa Mistralin response.body:n suoraan selaimelle
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Chat API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}