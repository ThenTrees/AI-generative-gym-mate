export class EmbeddingService {
  private model: use.UniversalSentenceEncoder | null = null;

  async initialize(): Promise<void> {
    console.log("Loading Universal Sentence Encoder model...");
    this.model = await use.load();
    console.log("Model loaded successfully");
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.model) {
      throw new Error("Embedding model not initialized");
    }

    // Preprocess text
    const cleanText = this.preprocessText(text);

    // Generate embedding
    const embeddings = await this.model.embed([cleanText]);
    const embeddingArray = await embeddings.data();
    embeddings.dispose();

    return Array.from(embeddingArray);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.model) {
      throw new Error("Embedding model not initialized");
    }

    const cleanTexts = texts.map((text) => this.preprocessText(text));
    const embeddings = await this.model.embed(cleanTexts);
    const embeddingData = await embeddings.data();
    embeddings.dispose();

    // Convert to 2D array
    const embeddingDim = 512; // Universal Sentence Encoder dimension
    const result: number[][] = [];

    for (let i = 0; i < texts.length; i++) {
      const start = i * embeddingDim;
      const end = start + embeddingDim;
      result.push(Array.from(embeddingData.slice(start, end)));
    }

    return result;
  }

  private preprocessText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // Remove special characters
      .replace(/\s+/g, " ") // Multiple spaces to single space
      .trim();
  }
}

// Singleton instance
export const embeddingService = new EmbeddingService();
