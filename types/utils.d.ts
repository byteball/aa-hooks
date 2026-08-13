/**
 * Create an opt-in diagnostic logger that is not affected when headless-obyte
 * replaces console.log with a file writer after wallet initialization.
 * @param {boolean} enabled
 * @param {(message: string) => void} [output]
 * @returns {(message: string) => void}
 */
export function createEventLogger(enabled: boolean, output?: (message: string) => void): (message: string) => void;
/**
 * @param {any} res
 * @returns {string}
 */
export function formatResponseContext(res: any): string;
/**
 * Identity of a response, matching the `UNIQUE (trigger_unit, aa_address)`
 * constraint on ocore's `aa_responses` table.
 * @param {any} res
 * @returns {string | undefined} undefined when the response cannot be identified
 */
export function getResponseKey(res: any): string | undefined;
/**
 * @param {any} error
 * @returns {Error}
 */
export function toError(error: any): Error;
/**
 * Evict the oldest entries of an insertion-ordered Map or Set.
 * @param {Map<any, any> | Set<any>} collection
 * @param {number} maxSize
 */
export function trimOldest(collection: Map<any, any> | Set<any>, maxSize: number): void;
/**
 * Reject if `promise` has not settled within `timeoutMs`.
 *
 * ocore and aabot report some failures by throwing from an asynchronous
 * callback rather than by rejecting. The throw escapes as an uncaughtException
 * and leaves the promise pending forever, which would otherwise stall a filter
 * while it holds the response mutex and silently kill the instance.
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<any>}
 */
export function withTimeout(promise: Promise<any>, timeoutMs: number, message: string): Promise<any>;
