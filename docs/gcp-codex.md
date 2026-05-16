# GCP Project Setup For Codex

This workspace targets Google Cloud project `nodal-talon-495310-p0`.
The helper scripts use `~/.gcloud-config` for Google CLI state so they do not depend on `~/.config/gcloud`.

## Repo helpers

Run the bootstrap command to pin the project ID:

```bash
npm run gcp:bootstrap
```

Run the doctor command to see what is still missing:

```bash
npm run gcp:doctor
```

## Machine-level steps

Codex can use Google Cloud tools once the local machine has:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project nodal-talon-495310-p0
gcloud auth application-default set-quota-project nodal-talon-495310-p0
```

If `gcloud` is not installed yet, install Google Cloud CLI first.

If you run the commands manually, export this first:

```bash
export CLOUDSDK_CONFIG="$HOME/.gcloud-config"
```
