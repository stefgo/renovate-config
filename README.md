# renovate-config

Dependency updates for the stefgo repositories: one shared
[Renovate](https://docs.renovatebot.com/) preset and one runner that serves every
connected repository. It replaces a copied `dependabot.yml` and a separate merge
workflow in each repository.

## What it does

- **Runs** once a day at noon (Europe/Berlin).
- **Proposes** updates once a week, on Monday's run, as pull requests: the minor
  and patch updates of the running system in one, all other minor and patch
  updates in a second, each major update in its own.
- **Merges** a pull request itself, squashed, on the first run after *every*
  check on it is green — usually Tuesday's. A red pull request stays open for a human, and so does an update of
  the Python or Node version — in a workflow, in `.nvmrc` or in a Dockerfile.
- **Waits** three days before it takes an npm release. Security updates do not wait.
- **Covers** GitHub Actions, npm, Python requirements, pre-commit hooks and, in
  the React projects, Dockerfiles and Compose files.
- **Makes an update of the running system releasable:** an npm `dependency`
  (not a `devDependency`), the base image of a shipped Dockerfile (not `*.dev`)
  and the lock file refresh are committed as `fix(deps): …`, so `bump: auto`
  releases them as a patch, and noted in `.release/next.md`, so the release is
  not refused for want of a hand-written part. Everything else stays
  `ci(deps): …` (single action updates) or `chore(deps): …` and cuts no release.
- Opens a pull request for a **security update** right away, outside the Monday
  window, as soon as GitHub reports a vulnerable version.
- Keeps a **Dependency Dashboard** issue in each repository: pending, blocked and
  scheduled updates, with checkboxes to start one right away.

## Files

| File | Purpose |
|---|---|
| `default.json` | The shared preset every repository extends |
| `react.json` | The preset of the React projects, on top of `default.json` |
| `scripts/release-note.mjs` | Writes an update of the running system into the project's `.release/next.md` |
| `.github/workflows/renovate.yml` | The runner, daily at noon and on demand |
| `.github/workflows/ci.yml` | Tests the script and validates the presets |
| `renovate.json` | This repository's own config, so the runner's actions stay current too |

### Why the preset looks the way it does

- `platformAutomerge: false` — the repositories have no branch protection, so
  GitHub's native auto-merge would merge at once without waiting for checks.
  Renovate checks the status itself and merges on its next run.
- `semanticCommitType: chore` for npm, pip and pre-commit — a `fix` commit cuts a
  patch release, and a build tool, a test or a linter changes nothing a user
  runs. The runtime rule below makes what does reach the running system a `fix`.
- The runtime rule — npm `dependencies`, the base images of the Dockerfiles that
  are shipped, the lock file refresh. They end up in the image (after
  `npm prune --omit=dev`) or in a card's bundle, so an update of them is a change
  a user gets and is worth a release: `fix(deps)`. The stefgo release workflow
  refuses a release whose `.release/next.md` is empty, though, so a postUpgradeTask
  runs `scripts/release-note.mjs` before Renovate commits, and the update arrives
  together with its line:
  ```markdown
  ### Dependency updates

  - `fastify` 5.6.1 → 5.7.0
  - `node` image 22 → 24
  ```
  A dependency already listed keeps the version it came from and takes the new
  target, so the list does not grow until the next stable release empties the
  file. The script only writes what is runtime by the same condition as the rule:
  the Node major also carries `.nvmrc` and `@types/node`, and those stay out. In a
  branch that mixes, the highest type wins (`fix` over `chore`). A repository
  without `.release/next.md` is left alone. Hand-written text in the file stays as
  it is; the section is kept at its place or added at the end.
- No automerge for the Python and Node versions, wherever they are set — the
  workflows (`setup-python`, `setup-node`), `.nvmrc`, a Dockerfile's base image
  (`node:22-bookworm`). They follow what Home Assistant, the card toolchain and
  a package's `engines` support, not the newest release, and a Node major in
  the image without the others is a project half moved. The pull request is
  opened and waits for a human.
- `minimumReleaseAge: 3 days` for npm — a hijacked maintainer account publishes
  a release that is usually found and pulled within hours. Three days keep it
  out at the cost of a slightly later update; with the Monday window most
  releases are older than that anyway. Security updates ignore the wait.
- Python held below 3.15 in the workflows — Home Assistant decides the Python
  its test package installs on, and on a Python it has left behind pip quietly
  resolves an old Home Assistant instead of failing. The bound moves when HA
  moves; the ruff and mypy target versions in each repository stay at the
  oldest Python its supported HA releases run on.
- `rangeStrategy: replace` for pip — the test requirements are open ranges (`>=`);
  an update inside the range needs no pull request.
- Two groups for the minor and patch updates, runtime and development —
  Renovate merges a single pull request per run and then stops, so the rest go
  against the new base branch on the next one. With a daily run, six separate
  pull requests took six days; the two groups take two. They are kept apart
  because the runtime group is a `fix` that writes the release notes and the
  development group is neither — in one group, every `eslint` update would cut a
  release. If an update in a group breaks the checks, the whole group waits for a
  human. Major updates stay separate so each can be judged on its own. The Python
  and Node versions stay out of both groups, because they are merged by hand and
  would hold everything else back. The development group is committed as
  `chore(deps)`, since it mixes action updates with the rest.

### The React projects (`react.json`)

dns-provider-manager and its siblings are npm workspaces that ship a container
image, and they share two more rules:

- **Updates go to `dev`**, not `main` (`baseBranchPatterns`). `dev` takes every
  change first; a push there builds the developer image and runs its smoke test,
  so a bad update breaks that image instead of the released one. Renovate still
  reads the repository's config from the default branch.
- **The lock file is refreshed every Monday** (`lockFileMaintenance`), merged
  like any other pull request once it is green. Renovate fixes a vulnerability
  only in a dependency a `package.json` names; one that comes in through another
  package (`postcss-selector-parser` through `tailwindcss`) is fixed by nothing
  else, as Dependabot did. The refresh takes the newest version every range
  allows, so such a fix arrives within a week. It cannot apply the three-day
  wait of `minimumReleaseAge`. The schedule is set to `on monday` because the
  default (`before 4am on monday`) never meets the runner's noon run. Like any
  runtime update it is a `fix(deps)` and leaves a line in `.release/next.md`.

Everything else comes from `default.json`. The `@stefgo/*` packages they install
from GitHub Packages are reached through the runner (see below).

## Connecting a repository

1. Add the repository to the GitHub App's installation
   (App → *Install App* → *Configure* → *Only select repositories*).
2. Add `.github/renovate.json5` to the repository:
   ```json5
   {
     extends: ["github>stefgo/renovate-config"],
   }
   ```
   A React project extends `github>stefgo/renovate-config:react` instead.
   Repository-specific rules (groups, held versions) go below `extends`.
3. Remove `.github/dependabot.yml` and any Dependabot merge workflow.
4. Add the repository to `RENOVATE_REPOSITORIES` in the workflow.

A repository without a renovate config is skipped, so removing the file
disconnects it.

## Setup of the runner

The runner authenticates as a GitHub App, not with `GITHUB_TOKEN`: pull requests
opened with `GITHUB_TOKEN` start no workflows, so their checks would never run.

- **App permissions** (repository): Contents, Pull requests, Issues and Workflows
  read & write; Checks, Commit statuses, Dependabot alerts and Metadata read. No
  webhook. Without *Dependabot alerts* Renovate cannot see a vulnerability and
  opens no security update.
- **This repository:** variable `RENOVATE_CLIENT_ID` (the app's Client ID) and
  secret `RENOVATE_APP_PRIVATE_KEY` (a private key generated for the app).
- **GitHub Packages:** the npm registry there asks for a token even for a public
  package. The runner hands Renovate its own `GITHUB_TOKEN` (`packages: read`),
  as a host rule for the lookups and as `NPM_TOKEN` for the lock file update.
  If an `@stefgo/*` package ever becomes private, a classic PAT with
  `read:packages` takes its place.
- **The release note script:** Renovate runs in a container and clones the
  repositories there, so the job checks out `scripts/` and mounts it at
  `/opt/renovate-config/scripts` (`docker-volumes`, next to the default
  `/tmp:/tmp`). `RENOVATE_ALLOWED_COMMANDS` admits exactly
  `node /opt/renovate-config/scripts/release-note.mjs` and nothing else; it runs
  without a shell. A change to the script reaches every repository on the next run.
- In a connected repository, turn off *Dependabot security updates*
  (*Settings → Code security*) and leave *Dependabot alerts* on: the alerts are
  what Renovate reads, and the security updates would be a second pull request
  for the same fix.

## Running it by hand

*Actions → Renovate → Run workflow*, optionally with log level `debug`. A run by
hand merges green pull requests without waiting for the next noon. To force an
update outside the Monday window, tick it in the repository's Dependency
Dashboard issue; the next run opens the pull request.
