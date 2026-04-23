export interface IngestJob {
  siteId: string;
  knowledgeUrl: string;
}

export interface ExtractedPage {
  url: string;
  title: string | null;
  text: string;
}
