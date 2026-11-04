# renovate-config

Dependency updates for the stefgo repositories: one shared
[Renovate](https://docs.renovatebot.com/) preset and one runner that serves every
connected repository. It replaces a copied `dependabot.yml` and a separate merge
workflow in each repository.

## What it does

- **Runs** once a day at noon (Europe/Berlin).
- **Proposes** updates once a week, on Monday's run, as pull requests: every
  minor and patch update together in one, each major update in its own.
- **Merges** a pull request itself, squashed, on the first run after *every*
  check on it is green — usually Tuesday's. A red pull request stays open for a human, and so does an update of
  the Python or Node version — in a workflow, in `.nvmrc` or in a Dockerfile.
- **Waits** three days before it takes an npm release. Security updates do not wait.
- **Covers** GitHub Actions, npm, Python requirements, pre-commit hooks and, in
  the React projects, Dockerfiles and Compose files.
- **Releases nothing by itself:** single action updates are committed as
  `ci(deps): …`, everything else as `chore(deps): …`. Neither type cuts a release.
- Opens a pull request for a **security update** right away, outside the Monday
  window, as soon as GitHub reports a vulnerable version.
- Keeps a **Dependency Dashboard** issue in each repository: pending, blocked and
  scheduled updates, with checkboxes to start one right away.

## Files

| File | Purpose |
|---|---|
| `default.json` | The shared preset every repository extends |
| `react.json` | The preset of the React projects, on top of `default.json` |
| `.github/workflows/renovate.yml` | The runner, daily at noon and on demand |
| `renovate.json` | This repository's own config, so the runner's actions stay current too |

### Why the preset looks the way it does

- `platformAutomerge: false` — the repositories have no branch protection, so
  GitHub's native auto-merge would merge at once without waiting for checks.
  Renovate checks the status itself and merges on its next run.
- `semanticCommitType: chore` for npm, pip and pre-commit — `config:recommended`
  marks runtime dependencies as `fix(deps)`, and a `fix` commit cuts a patch release.
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
- One group for all minor and patch updates — Renovate merges a single pull
  request per run and then stops, so the rest go against the new base branch on
  the next one. With a daily run, six separate pull requests took six days. The
  group is one pull request and one day; if an update in it breaks the checks,
  the whole group waits for a human. Major updates stay separate so each can be
  judged on its own. The Python and Node versions stay out of the group, because
  they are merged by hand and would hold everything else back. The group is
  committed as `chore(deps)`, since it mixes action updates with the rest.

### The React projects (`react.json`)

dns-provider-manager and its siblings are npm workspaces that ship a container
image, and they share one more rule:

- **Updates go to `dev`**, not `main` (`baseBranchPatterns`). `dev` takes every
  change first; a push there builds the developer image and runs its smoke test,
  so a bad update breaks that image instead of the released one. Renovate still
  reads the repository's config from the default branch.

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
- In a connected repository, turn off *Dependabot security updates*
  (*Settings → Code security*) and leave *Dependabot alerts* on: the alerts are
  what Renovate reads, and the security updates would be a second pull request
  for the same fix.

## Running it by hand

*Actions → Renovate → Run workflow*, optionally with log level `debug`. A run by
hand merges green pull requests without waiting for the next noon. To force an
update outside the Monday window, tick it in the repository's Dependency
Dashboard issue; the next run opens the pull request.
