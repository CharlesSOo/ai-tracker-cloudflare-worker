# Collector design

The goal is a tiny forwarder you rarely need to change—not a collector that anticipates everything.

Customers install the collector once; assume they will not redeploy it for routine updates. Keep classification, verification, and reporting logic on the tracker backend. Preserve the request metadata that backend needs, without adding speculative features, retry frameworks, queues, or automatic updaters. Protect customer traffic first.
