PROJECT BRIEF: ÄLYNAPPI - CHATBOT
1. OBJECTIVE

The goal is to transform 25 years of static knowledge (PDF magazines and web articles) into an interactive, living support system for the Federation of Hard of Hearing Children's Parents (KLVL).

The Core Problem: New parents need immediate information about hearing aids, rehabilitation, and peer support. The printed magazine (Nappi-lehti) cannot repeat basic information in every issue. The archives are static PDFs that are hard to search.

The Solution: ÄlyNappi is a RAG-based (Retrieval-Augmented Generation) chatbot that allows members to converse with the organization's entire history.

- Target Audience: Parents of children with hearing impairments.

- Key Value: Solves the "First Issue Problem" by providing instant access to foundational knowledge and historical peer support stories.

- Core Principles: Zero hallucinations, strict citation of sources, and high data privacy (GDPR compliant). No use of google, or any other seach engines.

2. TECHNOLOGY STACK

We are building a modern, lightweight, and European-centric stack.
- Frontend: Next.js (App Router), TypeScript, Tailwind CSS.
- Hosting: Vercel.
- AI & NLP:
  Provider: Mistral AI (European, GDPR friendly).
  OCR: Mistral OCR (for digesting PDF magazines).
  LLM: Mistral Large/Small (for generating answers).
  Embeddings: Mistral Embed (for vectorizing text chunks).
  Integration: Vercel AI SDK (for streaming chat responses).

- Backend & Database:
  Supabase: PostgreSQL database.
  Vector Search: pgvector extension.
  Auth: Supabase Auth (Passwordless Magic Link). Most likely whitelisted, members only. Members are in separate csv, or if have direct API to    membook
  Storage: Supabase Storage (for hosting source PDFs if needed).

3. UI/UX

The interface must be accessible, calm, and trustworthy.

- Design Language: Clean, high contrast, legible fonts. Adheres to KLVL brand colors (Blue/Yellow/White).
- Accessibility: WCAG compliant (critical for the target audience).

Key Screens:
- Login: Simple email input for Magic Link (Whitelist check). 
- Chat Interface: Similar to standard chat UIs but with emphasized citation pills.
- Citation Display: When the AI answers, it must clearly display the source (e.g., "Source: Nappi 2/2025, p. 14").

Branding
- lets use same brandcolor, font etc as in their mainpage https://www.klvl.fi/

4. DATABASE ARCHITECTURE

The database is singular (Single Tenant) but handles multiple source types.

Core Tables:
    documents: Stores metadata for a whole unit (PDF issue or Webpage).
       id, title, source_type ('print', 'web'), year, issue, url.

    sections: Stores the actual chunks of text and vectors.
       id, document_id, content (text), embedding (vector), page_number, category (e.g., 'Expert Article', 'Peer Support').

    profiles: User management.
       id, email (Primary verification method against whitelist).

5. ADDITIONAL INFORMATION

    Strict RAG Rule: The AI must never answer based on general training data. It must only answer using the retrieved context from Supabase. If the answer is not in the context, it must state: "Information not found in the archive, please contact KLVL directly."

    Citation Format: Every claim must be backed by a reference in the output: (Year/Issue, Page X).

    Pilot Data: We are starting with 4 issues from the year 2025 (PDF format). Once pipeline is working we are adding more issues.

6. RAG & DATA PIPELINE LOGIC

This is the technical flow for the AI to implement:

    Ingestion (Script):
        Read PDF file -> Send to Mistral OCR API.
        Receive structured Markdown
        Split Markdown into chunks (approx 500-1000 tokens). Use overlaying if benefial, as the dataset is not going to that big
        Extract metadata (Page number, Article Category).
        Generate Embeddings -> Insert into sections table in Supabase.

    Retrieval (App):
        User asks a question -> Convert to Vector.
        Perform cosine similarity search in Supabase (match_sections function).
        Retrieve top 5-10 chunks.

    Generation (Chat):
        Feed chunks + User Question to Mistral LLM as "System Context".
        Stream the answer to the UI.