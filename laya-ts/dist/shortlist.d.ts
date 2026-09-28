import type { QuestionDef, SystemOneResult } from "./agent.js";
export declare const DEFAULT_SHORTLIST_K = 20;
export type EmbedFn = (texts: string[]) => Promise<number[][]> | number[][];
export interface ShortlistMeta {
    labels: string[];
    scores: number[] | null;
    k: number;
    n: number;
    passthrough: boolean;
}
/** Return the top-k choice labels for state. Skips embed_fn when k >= n. */
export declare function shortlistChoice(state: unknown, criteria: unknown, embedFn: EmbedFn, k?: number, instructions?: unknown): Promise<string[]>;
/** Shortlist each choice question, then call predict/systemOne once. */
export declare function predictShortlist(agent: unknown, state: unknown, questions: Record<string, QuestionDef>, embedFn: EmbedFn, k?: number, predictKwargs?: Record<string, unknown>): Promise<SystemOneResult & {
    shortlist: Record<string, ShortlistMeta>;
}>;
/** Mean-pool the agent's provider encoder. Throws honestly without encoder access. */
export declare function embedFnFromAgent(agent: unknown, maxLength?: number, batchSize?: number): EmbedFn;
