# Production deployment

Agar Protocol is built into a static nginx container and deployed through the
shared, signed, exact-SHA Deploy Manager at `deploy.alirezaafshan.com`.

The production contract is intentionally state-free:

- public hostname: `agar.alirezaafshan.com`
- Deploy Manager app ID: `agar`
- production/candidate ports: `3080` / `3081`, loopback only
- container port: `8080`
- health endpoint: `/healthz`
- no Docker network, database, runtime environment, or volumes

## One-time bootstrap

From an authenticated Windows PowerShell session at the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\bootstrap-vps.ps1
```

The wrapper stages the root script over the configured SSH connection, prompts
once for sudo, registers and initially deploys the app, transfers the generated
webhook secret directly into GitHub Actions, enables CD, removes the temporary
secret, and checks the public health endpoint.

The root script validates ports and existing entries, backs up every shared
control-plane file before editing it, validates Caddy before installation, and
restores the previous files if setup fails. Re-running it is safe when the
existing Agar configuration matches this contract.

After bootstrap, a green push to `main` sends a signed exact-SHA request to
`/deploy/agar`. Deploy Manager builds and probes a candidate before replacing
production, then restores the previous image if the production health check
fails.
