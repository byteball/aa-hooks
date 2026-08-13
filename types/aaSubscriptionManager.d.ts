export = AaSubscriptionManager;
/**
 * Coordinates the two light-client delivery strategies for a set of AAs:
 * direct live notifications and persisted history synchronization.
 */
declare class AaSubscriptionManager {
    constructor(addresses: any, { logEvent }?: {
        logEvent?: () => void;
    });
    start(): void;
    add(address: any): Promise<void>;
    #private;
}
