# GitHub Pages Deployment

## Target

- Repository: `LLL-Laboratory/shared-city-cloud`
- Repository visibility: public
- Pages source: `main` branch, repository root
- Site:
  [https://lll-laboratory.github.io/shared-city-cloud/](https://lll-laboratory.github.io/shared-city-cloud/)

## Artifact

The repository root is a dependency-free static artifact. `index.html` uses
relative `./` asset references so it remains safe beneath the
`/shared-city-cloud/` GitHub Pages project path. `.nojekyll` keeps the artifact
literal and bypasses Jekyll processing.

`PAGES_MANIFEST_SHA256.csv` records the byte count and SHA-256 digest of every
published artifact file except the manifest itself.

## Validation contract

The build fails if protected research state drifts, if browser runtime files
contain external service requests, or if project-subpath-safe asset references
are missing. The public artifact also excludes machine-local paths and replaces
them with stable provenance descriptions.

This static preview does not unlock hosted records, team access, identity,
database, MCP/API, external AI, analytics, automatic capture, or external data
collection.
