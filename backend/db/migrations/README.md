# AXERLY database migrations

Add forward-only migrations as `NNNN_description.sql`. The startup runner
applies `backend/schema.sql` as version `0001`, then these files in lexical
order. Each file is applied once in its own transaction and its SHA-256 is
recorded; changing an applied migration fails startup.
