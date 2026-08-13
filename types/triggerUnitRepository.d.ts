export = TriggerUnitRepository;
/**
 * Read-through repository for immutable DAG trigger units.
 *
 * Successful reads are cached. Missing units are intentionally not cached so
 * a duplicate live/history delivery can retry after synchronization catches up.
 */
declare class TriggerUnitRepository {
    constructor(maxSize?: number);
    prime(unit: any): void;
    isUnavailable(unitHash: any): boolean;
    read(unitHash: any): any;
    #private;
}
