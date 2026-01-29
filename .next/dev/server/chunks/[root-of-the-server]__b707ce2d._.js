module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/src/app/api/chat/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@supabase/supabase-js/dist/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
;
;
const supabaseUrl = ("TURBOPACK compile-time value", "https://opfaolaonmnqyvbuzjvj.supabase.co");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["createClient"])(supabaseUrl, supabaseServiceKey);
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
async function getEmbedding(text) {
    if (!text) throw new Error('Input missing');
    const response = await fetch('https://api.mistral.ai/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${MISTRAL_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'mistral-embed',
            input: [
                text.replace(/\n/g, ' ')
            ]
        })
    });
    const data = await response.json();
    return data.data[0].embedding;
}
async function POST(req) {
    try {
        const { messages: rawMessages } = await req.json();
        const messages = rawMessages.map((m)=>({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : Array.isArray(m.parts) ? m.parts.find((p)=>p.type === 'text')?.text || "" : ""
            }));
        const userQuestion = messages[messages.length - 1]?.content;
        const queryEmbedding = await getEmbedding(userQuestion);
        // 2. HAKU (match_threshold ja match_count säädettävissä tässä)
        const { data: matchedSections } = await supabase.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_threshold: 0.15,
            match_count: 8 //
        });
        const contextText = matchedSections?.map((s)=>`[Lähde: ${s.title}]\n${s.content}`).join('\n\n---\n\n');
        // 3. SYSTEM PROMPT - Äly-Napin aivot ja säännöt palautettu
        const systemPrompt = `
Olet Äly-Nappi, avulias ja empaattinen arkistoavustaja. Tehtäväsi on vastata käyttäjän kysymyksiin annettujen Nappi-lehden tekstiotteiden perusteella.

SÄÄNNÖT:
  - Käytä vain annettua arkistomateriaalia vastauksen pohjana.
  - Vastaa perusteellisesti ja kattavasti.
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
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'mistral-small-latest',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    ...messages
                ],
                max_tokens: 500,
                temperature: 0.7,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                stop: null,
                stream: true
            })
        });
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start (controller) {
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                if (!reader) return controller.close();
                try {
                    let buffer = '';
                    while(true){
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, {
                            stream: true
                        });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines){
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') break;
                                try {
                                    const json = JSON.parse(data);
                                    const text = json.choices?.[0]?.delta?.content;
                                    if (text) controller.enqueue(encoder.encode(text));
                                } catch (e) {}
                            }
                        }
                    }
                    if (buffer && buffer.startsWith('data: ')) {
                        try {
                            const data = buffer.slice(6).trim();
                            if (data !== '[DONE]') {
                                const json = JSON.parse(data);
                                const text = json.choices?.[0]?.delta?.content;
                                if (text) controller.enqueue(encoder.encode(text));
                            }
                        } catch (e) {}
                    }
                } catch (e) {
                    controller.error(e);
                } finally{
                    controller.close();
                }
            }
        });
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        });
    } catch (error) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: error.message
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__b707ce2d._.js.map