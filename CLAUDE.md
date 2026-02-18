

# IMPORTANT

- dont tour core convos extension
- always use pnpm
- always PR to staging not main
- PRIVATE_WALLET_KEY does othing to do witgh Convos!

# Workarounds

- `@convos/cli` is not published to npm — it's installed from `github:xmtplabs/convos-cli` as a dependency of the convos extension. Extension deps must be installed with `NODE_ENV=development` so that devDependencies (typescript, oclif) are available for the prepack build step. See `cli/scripts/install-deps.sh`.