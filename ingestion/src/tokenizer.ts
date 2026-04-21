import { encodingForModel, getEncoding } from "js-tiktoken";

// text-embedding-3-small uses the cl100k_base tokenizer.
// Some versions of js-tiktoken don't recognise "text-embedding-3-small" by
// name; in that case we fall back to the underlying encoding directly.
function buildEncoder() {
  try {
    return encodingForModel("text-embedding-3-small");
  } catch {
    return getEncoding("cl100k_base");
  }
}

const encoder = buildEncoder();

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return encoder.encode(text).length;
}
