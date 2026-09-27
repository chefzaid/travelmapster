# Code Quality

Tests and coverage are described in the [testing guide](testing.md). This guide covers the two
report-only analyses in GitLab: SonarQube and Trivy. Neither blocks a release.

## SonarQube

Project `swirlit:travelmapster` analyzes `src/`, `public/js/`, `public/index.html` and
`public/styles.css`, with `test/` as tests and coverage from `coverage/lcov.info`. Bundled data
and vendor files are excluded. Settings live in [sonar-project.properties](../sonar-project.properties).

`01-quality` downloads the coverage artifact from `01-test` and submits the analysis without
waiting for the quality gate. It needs `SONAR_TOKEN`, a protected variable, so it only succeeds
on the protected `main` branch; elsewhere it reports the missing token and fails visibly.

| Trigger | When `01-quality` runs |
|---|---|
| Push to `main` | Automatically |
| `PIPELINE_MODE=full` pipeline | Automatically |
| Other branches and merge requests | Manual |
| Platform discovery | A `SONAR_SCAN_ONLY=true` pipeline when no analysis exists or the last one is over 24 hours old |

bm-cluster's discovery job provisions the Sonar project and token and requests the periodic
scans; see its [source-analysis guide](https://github.com/chefzaid/bm-cluster/blob/main/docs/observability.md#source-analysis).
[.sonar-auto.json](../.sonar-auto.json) declares the contract it relies on: the quality job name
and the scan-only variable.

### Manual Scan

Run a pipeline on `main` with `SONAR_SCAN_ONLY=true`. Only `01-test` and `01-quality` run;
packaging, security, release and deploy jobs are excluded by their rules.

## Trivy

`02-security` scans the repository for vulnerable dependencies, misconfigurations and secrets,
keeps `security-reports/trivy.json` for seven days and fails on HIGH or CRITICAL findings, as a
non-blocking job. It is manual on normal pipelines and automatic in `full` mode. GitHub Actions
additionally scans the built image ([testing](testing.md#continuous-integration)).

## Keeping The Contract

When renaming the quality job, moving sources or adding a scanned path, update
`sonar-project.properties`, `.sonar-auto.json` and the job rules together, keep every publishing
job excluded when `SONAR_SCAN_ONLY=true`, then check that a scan-only pipeline reports the
expected files and coverage in Sonar.
