// Load environment variables FIRST, before any other imports
import * as dotenv from 'dotenv'
import path from 'path'

// Configure dotenv to load .env.local from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Now import other modules (Supabase will be dynamically imported later)
import { promises as fs } from 'fs'
import type { Database } from '../../src/types/database.types'

type DocumentInsert = Database['public']['Tables']['documents']['Insert']
type SectionInsert = Database['public']['Tables']['sections']['Insert']

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

// Folder-to-category mapping
const FOLDER_CATEGORIES = {
  'lehti-pdf': 'Lehti',
  'oppaat-pdf': 'Opas',
  'tutkimukset-pdf': 'Tutkimus',
} as const

type CategoryFolder = keyof typeof FOLDER_CATEGORIES
type Category = typeof FOLDER_CATEGORIES[CategoryFolder]

// Base directory for all PDF folders
const BASE_DIR = path.join(process.cwd(), 'tietolahteet')

if (!MISTRAL_API_KEY) {
  throw new Error('MISTRAL_API_KEY environment variable is required')
}

// --- HELPER FUNCTIONS ---

/**
 * Parse year and issue from filename
 * Examples: "Nappi_1_2025.pdf" -> { issue: 1, year: 2025 }
 */
function parseFilename(filename: string): { issue: number | null; year: number | null } {
  const match = filename.match(/Nappi[_\s-]?(\d+)[_\s-]?(\d{4})/i)
  if (match) {
    return {
      issue: parseInt(match[1], 10),
      year: parseInt(match[2], 10),
    }
  }
  return { issue: null, year: null }
}

/**
 * Split text into chunks with overlap to preserve context at boundaries.
 * Tries to break at natural points (punctuation, newlines, spaces) to avoid splitting words.
 * Returns chunks with their associated page numbers.
 */
function chunkText(
  text: string, 
  chunkSize: number = 1000, 
  overlap: number = 200,
  pageBoundaries: Array<{ pageNumber: number; startIndex: number; endIndex: number }> = []
): Array<{ content: string; pageNumber: number | null }> {
  const chunks: Array<{ content: string; pageNumber: number | null }> = []
  let startIndex = 0

  // Helper function to find page number for a given text index
  const getPageNumber = (index: number): number | null => {
    for (const page of pageBoundaries) {
      if (index >= page.startIndex && index < page.endIndex) {
        return page.pageNumber
      }
    }
    // If no page boundaries provided, return null
    return pageBoundaries.length > 0 ? null : null
  }

  // Ensure overlap is reasonable
  const safeOverlap = Math.min(overlap, Math.floor(chunkSize * 0.3))

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize

    // If we're at the end, take the remaining text
    if (endIndex >= text.length) {
      const remaining = text.slice(startIndex).trim()
      if (remaining.length > 0) {
        const pageNum = getPageNumber(startIndex)
        chunks.push({ content: remaining, pageNumber: pageNum })
      }
      break
    }

    // Try to find a good break point (look back up to 30% of chunk size)
    const lookBackLimit = Math.floor(chunkSize * 0.3)
    const searchStart = Math.max(startIndex + Math.floor(chunkSize * 0.7), endIndex - lookBackLimit)

    let breakPoint = -1
    const paragraphMatch = text.lastIndexOf('\n\n', endIndex)
    if (paragraphMatch >= searchStart) {
      breakPoint = paragraphMatch + 2
    } else {
      const sentenceMatch = Math.max(
        text.lastIndexOf('. ', endIndex),
        text.lastIndexOf('! ', endIndex),
        text.lastIndexOf('? ', endIndex)
      )
      if (sentenceMatch >= searchStart) {
        breakPoint = sentenceMatch + 2
      } else {
        const spaceMatch = text.lastIndexOf(' ', endIndex)
        if (spaceMatch >= searchStart) {
          breakPoint = spaceMatch + 1
        }
      }
    }

    if (breakPoint !== -1 && breakPoint > startIndex) {
      endIndex = breakPoint
    }

    const chunk = text.slice(startIndex, endIndex).trim()
    if (chunk.length > 0) {
      const pageNum = getPageNumber(startIndex)
      chunks.push({ content: chunk, pageNumber: pageNum })
    }

    // Move start index forward with overlap
    const nextStartIndex = endIndex - safeOverlap

    // Safety check: ensure we're making progress
    if (nextStartIndex <= startIndex) {
      startIndex = endIndex
    } else {
      startIndex = nextStartIndex
    }

    // Additional safety: if we've processed all text, break
    if (startIndex >= text.length) {
      break
    }
  }

  return chunks.filter(chunk => chunk.content.trim().length > 0)
}

// --- MISTRAL API FUNCTIONS (Native Node.js FormData Edition) ---

/**
 * Upload file to Mistral API using native FormData and Blob
 */
async function uploadFile(filePath: string, filename: string): Promise<string> {
  const stats = await fs.stat(filePath)
  const fileSizeInMB = stats.size / (1024 * 1024)
  console.log(`  📦 File size: ${fileSizeInMB.toFixed(2)} MB (reading into memory...)`)

  // Read file into buffer
  const fileBuffer = await fs.readFile(filePath)

  // Create Blob from buffer (Node.js 18+ has native Blob support)
  const blob = new Blob([fileBuffer], { type: 'application/pdf' })

  // Use native FormData (Node.js 18+ has native FormData support)
  const formData = new FormData()
  formData.append('file', blob, filename)
  formData.append('purpose', 'ocr')

  console.log(`  🚀 Uploading to Mistral...`)

  // Fetch with native FormData - don't set Content-Type header manually!
  // Fetch will automatically set it with the correct boundary
  const response = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      // DO NOT set Content-Type - let fetch handle it automatically
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Upload failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as any
  if (!data.id) {
    throw new Error('Upload succeeded but no file ID returned')
  }

  return data.id
}

/**
 * Perform OCR on uploaded file using file ID
 * Returns both markdown text and page metadata
 */
async function performOCR(fileId: string): Promise<{ markdown: string; pages: Array<{ pageNumber: number; text: string; startIndex: number; endIndex: number }> }> {
  console.log(`  👀 Performing OCR analysis...`)

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: {
        type: 'file',
        file_id: fileId,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OCR failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as any

  // Extract markdown from OCR response with page tracking
  let fullMarkdown = ''
  const pages: Array<{ pageNumber: number; text: string; startIndex: number; endIndex: number }> = []
  
  if (data.pages && Array.isArray(data.pages)) {
    data.pages.forEach((page: any, index: number) => {
      const pageNumber = page.page_number || page.number || (index + 1)
      const pageText = page.markdown || page.text || ''
      
      if (pageText) {
        const startIndex = fullMarkdown.length
        fullMarkdown += pageText + '\n\n'
        const endIndex = fullMarkdown.length
        
        pages.push({
          pageNumber,
          text: pageText,
          startIndex,
          endIndex,
        })
        
        console.log(`    📄 Processing page ${pageNumber}...`)
      }
    })
  } else if (data.markdown) {
    fullMarkdown = data.markdown
    pages.push({
      pageNumber: 1,
      text: data.markdown,
      startIndex: 0,
      endIndex: data.markdown.length,
    })
  } else if (data.text) {
    fullMarkdown = data.text
    pages.push({
      pageNumber: 1,
      text: data.text,
      startIndex: 0,
      endIndex: data.text.length,
    })
  } else if (data.content) {
    fullMarkdown = data.content
    pages.push({
      pageNumber: 1,
      text: data.content,
      startIndex: 0,
      endIndex: data.content.length,
    })
  }

  return {
    markdown: fullMarkdown.trim(),
    pages,
  }
}

/**
 * Get embeddings for text chunks from Mistral
 */
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: texts,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Embeddings failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as any
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid embeddings response format')
  }

  return data.data.map((item: any) => item.embedding)
}

// --- MAIN PROCESSING ---

/**
 * Process a single PDF file
 */
async function processPDF(filePath: string, filename: string, category: Category): Promise<void> {
  // Dynamically import Supabase after env vars are loaded
  const { supabase } = await import('../../src/lib/supabase')
  
  console.log(`\n📄 Processing: ${filename} [Category: ${category}]`)

  const title = path.basename(filename, path.extname(filename))

  // Check if document already exists
  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('title', title)
    .single()

  if (existing) {
    console.log(`  ⏭️  Already exists in database, skipping.`)
    return
  }

  // 1. Upload file
  const startUpload = Date.now()
  const fileId = await uploadFile(filePath, filename)
  console.log(`  ✅ Upload complete (ID: ${fileId}) - took ${((Date.now() - startUpload) / 1000).toFixed(1)}s`)

  // 2. Perform OCR
  const startOCR = Date.now()
  const { markdown, pages } = await performOCR(fileId)
  console.log(`  ✅ OCR complete - extracted ${markdown.length} characters from ${pages.length} page(s) - took ${((Date.now() - startOCR) / 1000).toFixed(1)}s`)

  if (!markdown || markdown.length === 0) {
    throw new Error('OCR returned empty content')
  }

  // 3. Insert document metadata
  const { issue, year } = parseFilename(filename)
  const documentData: DocumentInsert = {
    title,
    source_type: 'print', // Use 'print' as per original requirements
    year,
    issue,
    url: null,
    published_at: null,
  }

  const { data: doc, error: docError } = await supabase
    .from('documents')
    // @ts-ignore
    .insert(documentData)
    .select()
    .single()

  if (docError || !doc) {
    throw new Error(`Failed to insert document: ${docError?.message || 'Unknown error'}`)
  }

  // 4. Chunk text with page boundaries
  console.log(`  ✂️  Chunking text with page tracking...`)
  const pageBoundaries = pages.map(p => ({
    pageNumber: p.pageNumber,
    startIndex: p.startIndex,
    endIndex: p.endIndex,
  }))
  const chunks = chunkText(markdown, 1000, 200, pageBoundaries)
  console.log(`  📊 Created ${chunks.length} chunks`)

  // 5. Get embeddings in batches
  console.log(`  🧠 Generating embeddings (${chunks.length} chunks)...`)
  const BATCH_SIZE = 10 // Process embeddings in batches to avoid rate limits
  const allEmbeddings: number[][] = []

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE)

    // Extract just the content for embeddings
    const batchContent = batch.map(chunk => chunk.content)
    console.log(`    Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`)
    const embeddings = await getEmbeddings(batchContent)
    allEmbeddings.push(...embeddings)
    console.log(`    ✓ Batch ${batchNum} complete`)
  }

  if (chunks.length !== allEmbeddings.length) {
    throw new Error(`Mismatch: ${chunks.length} chunks but ${allEmbeddings.length} embeddings`)
  }

  // 6. Insert sections with embeddings and page numbers
  console.log(`  💾 Inserting ${chunks.length} sections into database...`)
  const sections: SectionInsert[] = chunks.map((chunk, index) => ({
    document_id: doc.id,
    content: chunk.content,
    embedding: allEmbeddings[index],
    category: category, // Set category based on source folder
    page_number: chunk.pageNumber, // Extract page number from chunk metadata
  }))

  const { error: sectionsError } = await supabase.from('sections').insert(sections)

  if (sectionsError) {
    throw new Error(`Failed to insert sections: ${sectionsError.message}`)
  }

  console.log(`  ✨ Complete! Inserted ${sections.length} sections`)
}

/**
 * Main ingestion function
 */
async function main() {
  try {
    // Process each category folder
    for (const [folder, category] of Object.entries(FOLDER_CATEGORIES)) {
      const pdfDir = path.join(BASE_DIR, folder)
      
      console.log(`\n📁 Processing folder: ${folder} -> Category: ${category}`)
      console.log(`   Path: ${pdfDir}`)

      // Check if PDF directory exists
      try {
        await fs.access(pdfDir)
      } catch {
        console.log(`   ⚠️  Directory not found, skipping: ${pdfDir}`)
        continue
      }

      // Read all files in PDF directory
      const files = await fs.readdir(pdfDir)
      const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'))

      if (pdfFiles.length === 0) {
        console.log(`   ℹ️  No PDF files found in ${pdfDir}`)
        continue
      }

      console.log(`   Found ${pdfFiles.length} PDF file(s) to process`)

      // Process each PDF file
      for (const filename of pdfFiles) {
        const filePath = path.join(pdfDir, filename)
        try {
          await processPDF(filePath, filename, category as Category)
        } catch (error) {
          console.error(`  ❌ Error processing ${filename}:`, error instanceof Error ? error.message : error)
          // Continue with next file
        }
      }
    }

    console.log('\n✅ All processing complete!')
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

// Run the ingestion
main()
