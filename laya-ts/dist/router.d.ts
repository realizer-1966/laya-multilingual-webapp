import { type AnalyseResult } from "./lang.js";
import type { PredictOptions, QuestionDef, SystemOneResult } from "./agent.js";
import { type DecideOptions, type DecisionResult } from "./structured.js";
import { HookRegistry, type HookArg, type PredictHook } from "./hooks.js";
export declare const BUNDLE_REPO = "convaiinnovations/laya";
export interface ModelSpec {
    repo: string;
    subfolder: string | null;
}
export declare const DEFAULT_MODELS: Record<string, ModelSpec>;
export declare const STANDALONE_MODELS: Record<string, string>;
export type ModelName = "english" | "multilingual" | "typed-decisions";
export declare function normaliseName(name: string): ModelName;
export declare function matchTypedDecisionsWorkflow(questions: Record<string, unknown> | null | undefined): string | null;
export declare function englishFromCode(value: unknown): boolean | null;
/** Parity alias for the Python `_english_from_code` name. */
export declare const _englishFromCode: typeof englishFromCode;
export interface RouteDecision {
    model: ModelName;
    repo: string;
    reason: string;
    detection: AnalyseResult | null;
    workflow: string | null;
}
export type RoutedResult = SystemOneResult & {
    routing: RouteDecision;
};
export type LangGuess = string | null | undefined | ((state: unknown) => unknown);
export type AgentLoader = (name: ModelName, spec: ModelSpec) => unknown | Promise<unknown>;
export interface RouterOptions {
    models?: Record<string, string | ModelSpec | [string, string | null]>;
    device?: string | null;
    token?: string | null;
    maxLoaded?: number;
    max_loaded?: number;
    default?: string;
    autoTaskDetection?: boolean;
    auto_task_detection?: boolean;
    standaloneRepos?: boolean;
    standalone_repos?: boolean;
    preload?: boolean | string[];
    langGuess?: LangGuess;
    lang_guess?: LangGuess;
    loader?: AgentLoader;
    /** Optional hub revision (commit SHA/branch/tag) applied to every checkpoint load. */
    revision?: string | null;
    /** Per-model revision overrides, keyed by model name or alias. */
    revisions?: Record<string, string | null>;
    hooks?: HookArg;
    onPredictStart?: PredictHook;
    onPredictEnd?: PredictHook;
    hooksRaise?: boolean;
}
export interface RouteOptions {
    model?: string | null;
    task?: string | null;
    lang?: string | null;
    langGuess?: LangGuess;
    lang_guess?: LangGuess;
    hooks?: HookArg;
    hooksRaise?: boolean;
}
export declare class Router extends HookRegistry {
    hooksRaise: boolean;
    models: Record<string, ModelSpec>;
    device: string | null;
    token: string | null | undefined;
    revision: string | null;
    revisions: Partial<Record<ModelName, string | null>>;
    maxLoaded: number;
    default: ModelName;
    autoTaskDetection: boolean;
    langGuess: LangGuess;
    loader: AgentLoader | null;
    _agents: Map<string, unknown>;
    _order: string[];
    private readonly _loading;
    constructor(opts?: RouterOptions);
    load(name: string): Promise<unknown>;
    _touch(key: string): void;
    /** Drop least-recently-used agents until `maxLoaded` holds. Returns evicted names. */
    _evict(): string[];
    attach(name: string, agent: unknown): unknown;
    preload(names?: string[]): Promise<this>;
    unload(name?: string | null): void;
    get loaded(): string[];
    _resolveHint(hint: LangGuess, state: unknown): boolean | null;
    /**
     * Decide which checkpoint to use, then let `onRoute` hooks observe or replace the decision.
     *
     * `ctx.decision` is the RouteDecision; a hook may replace it (for example to pin a
     * checkpoint) and the replacement is what gets returned and used. `opts.hooks` are
     * per-call hooks, appended after any installed on the Router.
     */
    route(state: unknown, questions?: Record<string, unknown> | null, opts?: RouteOptions): RouteDecision;
    /** Decide which checkpoint to use, without loading, running, or hooking anything. */
    _route(state: unknown, questions?: Record<string, unknown> | null, opts?: RouteOptions): RouteDecision;
    /**
     * Route, then answer every question in one forward pass on the chosen checkpoint.
     *
     * The result is the usual systemOne payload plus a `routing` key recording the decision.
     * Router-level `onPredictStart` / `onPredictEnd` hooks wrap the whole route+infer call and
     * see `ctx.decision`; see hooks.ts.
     */
    predict(state: unknown, questions: Record<string, QuestionDef>, opts?: RouteOptions & PredictOptions): Promise<RoutedResult>;
    /**
     * Answer `state` against a JSON schema (or explicit `opts.questions`) and return typed
     * values — see `structured.ts`. Routing options (`model`, `task`, ...) are forwarded to
     * `predict`.
     */
    decide(state: unknown, schema: unknown, opts: DecideOptions & RouteOptions & PredictOptions & {
        returnDetails: true;
    }): Promise<DecisionResult>;
    decide(state: unknown, schema?: unknown, opts?: DecideOptions & RouteOptions & PredictOptions): Promise<Record<string, unknown>>;
    systemOne(state: unknown, questions: Record<string, QuestionDef>, opts?: RouteOptions & PredictOptions): Promise<RoutedResult>;
}
