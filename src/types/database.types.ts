export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      documents: {
        Row: {
          id: string
          title: string
          source_type: string
          year: number | null
          issue: number | null
          url: string | null
          published_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'created_at'>
      }
      sections: {
        Row: {
          id: string
          document_id: string
          content: string
          category: string | null
          page_number: number | null
          embedding: string // Vector is returned as string by some drivers, or number[]
          created_at: string
        }
        Insert: {
          document_id: string
          content: string
          category?: string | null
          page_number?: number | null
          embedding: number[] // We insert numbers
        }
      }
    }
  }
}
