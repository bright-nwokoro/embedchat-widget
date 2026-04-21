import { readFileSync } from "node:fs";
import type { Chunk } from "../types.js";

/**
 * Doubles the input value.
 * Exported utility.
 */
export function double(x: number): number {
  return x * 2;
}

// Simple comment on this one.
export const MAX_RETRIES = 3;

export interface SampleConfig {
  id: string;
  retries: number;
}

export class SampleClass {
  constructor(public readonly id: string) {}
  describe(): string {
    return `Sample(${this.id})`;
  }
}
