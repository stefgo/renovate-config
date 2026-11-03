# renovate-config

Dependency updates for the stefgo repositories: one shared
[Renovate](https://docs.renovatebot.com/) preset and one runner that serves every
connected repository. It replaces a copied `dependabot.yml` and a separate merge
workflow in each repository.

## What it does

- **Proposes** updates once a week, Monday before 6 am (Europe/Berlin), as pull requests.
- **Merges** a pull request itself, squashed, as soon as *every* check on it is
  green. A red pull request stays open for a human.
- **Covers** GitHub Actions, npm, Python requirements and pre-commit hooks.
- **Releases nothing by itself:** action updates are committed as `ci(deps): …`,
  everything else as `chore(deps): …`. Neither type cuts a release.
- Keeps a **Dependency Dashboard** issue in each repository: pending, blocked and
  scheduled updates, with checkboxes to start one right away.

## Files

| File | Purpose |
|---|---|
| `default.json` | The shared preset every repository extends |
| `.github/workflows/renovate.yml` | The runner, hourly and on demand |
| `renovate.json` | This repository's own config, so the runner's actions stay current too |

### Why the preset looks the way it does

- `platformAutomerge: false` — the repositories have no branch protection, so
  GitHub's native auto-merge would merge at once without waiting for checks.
  Renovate checks the status itself and merges on its next run.
- `semanticCommitType: chore` for npm, pip and pre-commit — `config:recommended`
  marks runtime dependencies as `fix(deps)`, and a `fix` commit cuts a patch release.
- `rangeStrategy: replace` for pip — the test requirements are open ranges (`>=`);
  an update inside the range needs no pull request.

## Connecting a repository

1. Add the repository to the GitHub App's installation
   (App → *Install App* → *Configure* → *Only select repositories*).
2. Add `.github/renovate.json5` to the repository:
   ```json5
   {
     extends: ["github>stefgo/renovate-config"],
   }
   ```
   Repository-specific rules (groups, held versions) go below `extends`.
3. Remove `.github/dependabot.yml` and any Dependabot merge workflow.
4. Add the repository to `RENOVATE_REPOSITORIES` in the workflow.

A repository without a renovate config is skipped, so removing the file
disconnects it.

## Setup of the runner

The runner authenticates as a GitHub App, not with `GITHUB_TOKEN`: pull requests
opened with `GITHUB_TOKEN` start no workflows, so their checks would never run.

- **App permissions** (repository): Contents, Pull requests, Issues and Workflows
  read & write; Checks, Commit statuses and Metadata read. No webhook.
- **This repository:** variable `RENOVATE_CLIENT_ID` (the app's Client ID) and
  secret `RENOVATE_APP_PRIVATE_KEY` (a private key generated for the app).

## Running it by hand

*Actions → Renovate → Run workflow*, optionally with log level `debug`. To force
an update outside the Monday window, tick it in the repository's Dependency
Dashboard issue; the next run opens the pull request.
