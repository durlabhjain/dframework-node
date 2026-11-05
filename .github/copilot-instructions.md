<!-- Generated from AGENTS.md; edit the source and run yarn instructions:sync. -->

# dframework-node contributor instructions

`AGENTS.md` is the canonical repository-wide guidance for coding agents and
contributors. Edit that source; `CLAUDE.md` imports it and Copilot's copies are
generated. Scoped guidance lives in `lib/AGENTS.md` and `tests/AGENTS.md`.

## Scope and working process

- This is `@durlabh/dframework`, an ES module Node.js library. Its default branch
  is `main`; confirm a different requested base rather than substituting one.
- Inspect status, existing branches and PRs before changing files. Preserve
  unrelated work and use a dedicated branch/worktree. Update an approved base
  with `git pull --ff-only`; do not reset or overwrite a dirty checkout.
- Make targeted changes, match surrounding code, preserve public APIs and
  optional-peer behavior, and update affected documentation/JSDoc.
- Validate only the projects and behavior touched by the change. This repository
  has no compile/build step: do not invent one or build downstream applications.
  Documentation/instruction changes need instruction checks; workflow changes
  also need workflow validation and the checks they run. Runtime changes need
  relevant offline tests and export verification; expand coverage when failures
  or shared-code changes justify it.
- Do not merge, publish a package, deploy, or connect tests to shared services
  unless the user explicitly authorizes that action. A draft PR is reviewable work.

## Toolchain and dependencies

- Use CI's Node 24.21.0 and Yarn 4.18.1 (pinned in `package.json`). Install with
  `yarn install --immutable`; commit `yarn.lock` and keep one installer's lockfile.
- Intentional dependency updates use `yarn install`; commit the manifest and
  lock together. Keep dependency scripts disabled in `.yarnrc.yml`, its age gate
  and Git-source restrictions, and the fallback `.npmrc` script restriction.
  Do not bypass these controls to make an installation pass.
- Runtime peers also appear in `devDependencies` for local tests. Include them
  in dependency inventories; consumers resolve and lock their own runtime graph.
- Do not install through a `node_modules` junction shared with another checkout.
  Dependencies may be shared read-only for isolated checks, never mutated there.

## Code conventions

- Use ES modules and explicit `.js`/`.mjs` import extensions. Follow surrounding
  export patterns: default exports for primary classes, named exports for utilities.
- Prefer async/await and meaningful errors; follow existing error-mapping and
  callback contracts rather than rewriting unrelated code.
- Use PascalCase classes, camelCase functions, existing constant/file naming,
  Pino logging through `lib/logger.js`, and the established dayjs date formats.
- Preserve existing fluent interfaces, flexible arguments, defaults and public
  signatures. Check optional dependencies before using optional integrations.

## Validation commands

Run from the repository root, using safe local configuration. Additional test
selection, baseline failures and service exclusions are in `tests/AGENTS.md`.

```text
yarn instructions:check
node --test --test-concurrency=1 tests/dependency-security.test.mjs
node tests/verify-exports.mjs
```

Do not silently treat known baseline failures as successful tests; reproduce and
report them separately. Mocked drivers do not establish live integration coverage.

## Instruction and workflow maintenance

- `yarn instructions:sync` regenerates regular Claude bridges and Copilot files
  from the root/scoped sources. `yarn instructions:check` detects missing or stale
  generated files without writing. Do not hand-edit generated copies or symlink
  them: regular files support Windows clones without symlink privileges.
- Add a scope to `scripts/sync-agent-instructions.mjs` when introducing another
  scoped `AGENTS.md`; keep the generated files committed with their source.
- `.github/actions/setup-yarn/action.yml` is the local workflow foundation:
  pinned toolchain, package-manager verification and immutable installation.
  Quality jobs use read-only permissions; do not add release secrets or write
  permissions to shared setup. Keep publishing/deployment workflows separate.
- See `docs/CONTRIBUTING.md` for the instruction layout, project map and links to
  API, usage, configuration, logging, export and report documentation.
