# Demo Mode Is Explicit and Deployment-Agnostic

TraceForge must remain easy to demonstrate without making demo behavior an accidental production fallback. Demo behavior is controlled only by an explicit `DEMO_MODE` switch and is independent of `NODE_ENV`, so a formally deployed instance may still intentionally operate as a demo.

When enabled, Demo Mode may prefill the documented demonstration login, use data created by the demo seed, and must display a persistent demo indicator. When disabled, the Console must not prefill credentials, generate demo values, or silently replace missing or failed database reads with fabricated metrics. Dashboard features remain complete in both modes and always read their displayed values from persisted or aggregated data.

The Console is an administrative surface and remains `noindex, nofollow` in both modes. Enabling Demo Mode accepts the reduced credential secrecy as an explicit deployment choice rather than inferring it from whether the build is development or production.
