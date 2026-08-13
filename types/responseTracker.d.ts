/**
 * Tracks the delivery lifecycle of AA responses.
 *
 * The same response can arrive through the direct light channel and through
 * history synchronization. This registry keeps transport concerns out of the
 * Hooks coordinator and makes retries idempotent per hook.
 */
export class ResponseTracker {
    constructor(limits?: {});
    queuePending(res: any, source: any): boolean;
    hasPending(): boolean;
    takePending(): any[];
    begin(res: any, source: any): {
        state: "duplicate";
        key: string;
    } | {
        state: "deferred";
        key: string;
    } | {
        state: "started";
        key: string;
    };
    hasCompletedHook(responseKey: any, hookId: any): boolean;
    markHookCompleted(responseKey: any, hookId: any): void;
    finish(responseKey: any, completed: any): any;
    #private;
}
export const RESPONSE_STATE: Readonly<{
    STARTED: "started";
    DUPLICATE: "duplicate";
    DEFERRED: "deferred";
}>;
