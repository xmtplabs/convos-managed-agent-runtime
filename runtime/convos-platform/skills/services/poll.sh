#!/bin/sh
# Services poll hook — no-op.
# Email and SMS are delivered via webhooks (pool pushes to /convos/notify).
# On-demand inbox checks are still available via `email poll` and `sms poll`.
