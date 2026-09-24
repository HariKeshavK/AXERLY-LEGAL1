// AXERLY modified 2026-09-23.
import { createDatabase, type Db } from "../lib/database";
import { logError } from "../lib/log";
import { sweepStaleProcessingDocuments } from "../modules/documents/documents.service";
import { sweepStaleGeneratingCells } from "../modules/tabular/tabular.service";

/** Run both sweeps; errors are contained per sweep. */
export async function runStaleWorkSweep(
    db: Db = createDatabase(),
): Promise<{ documents: number; cells: number }> {
    const documents = await sweepStaleProcessingDocuments(db).catch((err) => {
        logError("stale-sweep", err, { sweep: "documents" });
        return 0;
    });
    const cells = await sweepStaleGeneratingCells(db).catch((err) => {
        logError("stale-sweep", err, { sweep: "cells" });
        return 0;
    });
    return { documents, cells };
}
