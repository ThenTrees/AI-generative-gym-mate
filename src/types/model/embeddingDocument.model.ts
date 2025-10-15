export interface EmbeddingDocument {
  id: string;
  exerciseId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  similarity?: number;
}
