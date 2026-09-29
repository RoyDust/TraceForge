# Console Stores UTC and Presents Asia/Shanghai Time

TraceForge persists timestamps and exposes API or export timestamps in UTC, while Console date filters and human-readable timestamps use `Asia/Shanghai`. This fixed presentation timezone keeps dashboard ranges and displayed events consistent across developer machines, Docker, and production hosts whose operating-system timezone may differ.
