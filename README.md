# Gatekeeper

Gatekeeper tracks APQP documents, engineering requirements, DFMEA failure modes, and Design Verification Plan & Report (DVP&R) tests through five product development gates. Each project has its own document template, traceability matrix, and gate decisions. Founders can also track contributions, expenses, and reimbursements in a shared ledger.

## Run with Docker Compose

The Compose stack includes the app and PostgreSQL 17. With Docker and the Compose plugin installed, copy the example environment file from the repository.

```sh
cp .env.example .env
```

Set `POSTGRES_PASSWORD` in `.env` to a strong, unique password. Build and start the stack.

```sh
docker compose up -d --build
docker compose ps
```

The app connects to PostgreSQL automatically and stores its data in the `postgres-data` named volume. Change `APP_PORT` in `.env` if the default port is in use. The example uses `AUTH_MODE=trusted` for loopback testing with the sample Orion Drive Assembly project. [Open Gatekeeper](http://localhost:8080).

For a shared Docker installation, set `AUTH_MODE=oidc` in `.env`, complete the Authentik settings below, and use an HTTPS reverse proxy. Point the proxy to the configured host port.

## Configure Authentik

1. Create the `gatekeeper-founders` and `gatekeeper-admins` groups in Authentik, then assign each person their group. Membership in either group grants access. Membership in the admin group grants the administrator role. [Authentik group management](https://docs.goauthentik.io/users-sources/groups/manage_groups/).
2. Create an Authentik application with the slug `gatekeeper` and a confidential OAuth2/OpenID Connect provider. Keep the per-provider issuer mode. Register the exact redirect URI `https://gatekeeper.example.com/auth/callback`, substituting your Gatekeeper hostname. Use the `profile` and `email` scope mappings. The built-in `profile` mapping supplies the `groups` claim. Select an RSA **Signing Key** such as the default Authentik certificate so Gatekeeper can verify the ID token signature. [Authentik OAuth2 provider settings](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).
3. Bind both groups to the Authentik application and set its policy engine mode to **Any**, so either group can reach the application. [Authentik application bindings](https://docs.goauthentik.io/add-secure-apps/applications/manage_apps/).
4. Set the values below in `.env` for Docker Compose or in the TrueNAS YAML. Use the issuer value from the provider's OpenID configuration, including its trailing slash when present.
5. Configure the HTTPS reverse proxy to forward the Gatekeeper hostname and all request paths to the application. Open Gatekeeper at the same HTTPS origin as `AUTH_APP_URL`. Both the Gatekeeper container and the browser need to reach the Authentik issuer over HTTPS with a trusted certificate.

| Setting | Value |
| --- | --- |
| `AUTH_MODE` | `oidc` |
| `AUTH_ISSUER` | Authentik's HTTPS issuer. Example `https://auth.example.com/application/o/gatekeeper/` |
| `AUTH_CLIENT_ID` | Confidential provider's client ID |
| `AUTH_CLIENT_SECRET` | Confidential provider's client secret |
| `AUTH_APP_URL` | The app's HTTPS origin. Example `https://gatekeeper.example.com` |
| `AUTH_ALLOWED_GROUP` | Authentik founder group name. Default `gatekeeper-founders` |
| `AUTH_ADMIN_GROUP` | Authentik administrator group name. Default `gatekeeper-admins` |

Gatekeeper sessions expire after eight hours. Authentik group changes apply at the next sign-in. Signing out revokes the current Gatekeeper session.

## Install on TrueNAS SCALE

Use a Docker-based TrueNAS SCALE release (24.10 or later) with Apps configured. Choose **Apps → Discover Apps → Install via YAML** and name the application `gatekeeper`. Paste the template into the YAML editor. [TrueNAS Compose template](truenas/compose.yaml) · [TrueNAS custom apps documentation](https://apps.truenas.com/managing-apps/installing-custom-apps/).

Set the database password and fill in the Authentik values at the top of the YAML. Compose treats `$$` in YAML values as a literal dollar sign. The NAS builds the Gatekeeper image from the Git ref in `build.context`, which defaults to `main`. To install a branch, tag, or pinned commit, replace `main` after the `#`. [Docker Compose build contexts](https://docs.docker.com/reference/compose-file/build/) · [Compose variable interpolation](https://docs.docker.com/reference/compose-file/interpolation/).

The TrueNAS template publishes the application to `127.0.0.1:18080` for a reverse proxy that can reach the NAS host's loopback interface. If your proxy runs separately, change the publish address to the NAS's private IP and use that address in the proxy's upstream configuration. When the app is healthy, open its HTTPS hostname and sign in with Authentik. A fresh Authentik deployment opens an empty workspace.

To use a locally built image, run the following command from a source checkout on the NAS or on a Docker host with the same CPU architecture.

```sh
docker build -t gatekeeper:local .
```

Load the image on TrueNAS with `docker save` and `docker load` if it was built on a separate host. In the TrueNAS YAML, replace the `build` block with `image: gatekeeper:local` and set `pull_policy: never`.

TrueNAS retains PostgreSQL data in the app's named database volume. To update Gatekeeper, update the build ref and redeploy the existing application.

## Develop or use browser storage

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Browser-local mode stores data in that browser's localStorage. A production build can also run without PostgreSQL by leaving `POSTGRES_HOST` unset.

```sh
npm run build
AUTH_MODE=local npm start
```

Use the application's import and export controls to move a versioned JSON workspace between browsers or storage modes. Export a backup before replacing the workspace with an import.

## Engineering workflow

1. Create or select a project. New projects receive all 19 standard program documents, including documents shared across gates.
2. Edit system requirements in the RTM and link them to their DFMEA failure modes.
3. Link each DVP&R test to the failure modes it verifies. Record the method, conditions, sample size, acceptance criteria, test house, due date, and result.
4. Update a test's status. The RTM recalculates requirements as soon as the result changes. A failed linked test takes precedence. All linked tests must pass to verify the requirement.
5. Review documents, attachment details, document links, and revisions in the repository. Approve or release the mandatory documents before signing off a gate.

Shared document families can count toward more than one gate. Attachment entries record file details for reference.

## Founder finance

Open **Founder finance** from a project to see its pooled cash, contributions, spending, and reimbursements due. Use **Record contribution** for money already deposited into the pool and **Add expense** for a purchase paid personally. Entries are attributed to the signed-in founder.

Administrators can set the currency before the first entry, record expenses paid directly from pooled funds, and record reimbursement payments against a founder's outstanding balance. For corrections, founders can void their own personal entries and administrators can void any entry. Each void keeps the original record and its reason in the ledger.

Shared ledger edits require a signed-in Authentik account. Browser-local mode lets you try the ledger with the sample identity. The ledger is read-only in trusted Docker mode.

## Shared storage and backups

The Node server serves the React build and a same-origin workspace API. The API validates the entire workspace and writes it to PostgreSQL as a revisioned JSONB snapshot. A stale revision returns a conflict so that one browser cannot silently overwrite another browser's saved changes.

`GET /api/health` checks the authentication configuration and PostgreSQL when enabled. Run the following command to back up the database from a running Compose stack.

```sh
docker compose exec -T db pg_dump -U gatekeeper -d gatekeeper > gatekeeper.sql
```

A JSON workspace export provides a portable copy. Shared workspace imports must preserve existing finance history. Use a PostgreSQL backup for a full database restore, including the ledger.

## Checks

Run `npm test` for the domain tests. Run `node tests/postgres-smoke.mjs` to build and exercise an isolated Compose stack. The smoke check covers database setup, input validation, simultaneous saves, and data persistence across container recreation.

Run `npm run build` followed by `node tests/auth-smoke.mjs` to check the login flow and finance permissions against a test OpenID provider and a temporary PostgreSQL container. This check requires Docker and OpenSSL.
