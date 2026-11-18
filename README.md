# Gatekeeper

Gatekeeper tracks APQP documents, engineering requirements, DFMEA failure modes, and Design Verification Plan & Report (DVP&R) tests through five product development gates. Each project has its own document template, traceability matrix, and gate decisions. The sample Orion Drive Assembly project demonstrates the workflow.

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

Open [http://localhost:8080](http://localhost:8080). The app connects to PostgreSQL automatically. Database files persist in the `postgres-data` named volume. Change `APP_PORT` in `.env` if the default port is in use. The default bind address limits access to the Docker host.

## Install on TrueNAS SCALE

Use a Docker-based TrueNAS SCALE release (24.10 or later) with Apps configured. Choose **Apps → Discover Apps → Install via YAML**, name the application `gatekeeper`, and paste the [TrueNAS Compose file](truenas/compose.yaml). See the [TrueNAS custom apps documentation](https://apps.truenas.com/managing-apps/installing-custom-apps/).

Set the password at the top of the YAML and adjust the published port if needed. The NAS builds the Gatekeeper image from this GitHub repository using the Git ref in `build.context`. The default ref is `main`. When installing from a feature branch, tag, or pinned commit, replace `main` after the `#` in the build URL. When the app is healthy, open `http://<truenas-address>:18080`. [Docker Compose build contexts](https://docs.docker.com/reference/compose-file/build/)

To use a locally built image, run the following command from a source checkout on the NAS or on a Docker host with the same CPU architecture.

```sh
docker build -t gatekeeper:local .
```

Load the image on TrueNAS with `docker save` and `docker load` if it was built on a separate host. In the TrueNAS YAML, replace the `build` block with `image: gatekeeper:local` and set `pull_policy: never`.

TrueNAS retains PostgreSQL data in the app's named database volume. To update Gatekeeper, update the build ref and redeploy the existing application. Keep the app on a trusted network. Anyone who can reach the app can access the shared workspace.

## Develop or use browser storage

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Browser-local mode stores data in that browser's localStorage. A production build can also run without PostgreSQL by leaving `POSTGRES_HOST` unset.

```sh
npm run build
npm start
```

Use the application's import and export controls to move a versioned JSON workspace between browsers or storage modes. Export a backup before replacing the workspace with an import.

## Engineering workflow

1. Create or select a project. New projects receive all 19 standard program documents, including documents shared across gates.
2. Edit system requirements in the RTM and link them to their DFMEA failure modes.
3. Link each DVP&R test to the failure modes it verifies. Record the method, conditions, sample size, acceptance criteria, test house, due date, and result.
4. Update a test's status. The RTM recalculates requirements as soon as the result changes. A failed linked test takes precedence. All linked tests must pass to verify the requirement.
5. Review documents, attachment details, document links, and revisions in the repository. Approve or release the mandatory documents before signing off a gate.

Shared document families can count toward more than one gate. Attachment entries record file details for reference.

## Shared storage and backups

The Node server serves the React build and a same-origin workspace API. The API validates the entire workspace and writes it to PostgreSQL as a revisioned JSONB snapshot. A stale revision returns a conflict so that one browser cannot silently overwrite another browser's saved changes.

`GET /api/health` reports the active storage configuration and checks PostgreSQL when enabled. Run the following command to back up the database from a running Compose stack.

```sh
docker compose exec -T db pg_dump -U gatekeeper -d gatekeeper > gatekeeper.sql
```

A JSON workspace export provides a portable application-level backup. Back up the data before removing the PostgreSQL volume.

## Checks

Run `npm test` for the domain tests. Run `node tests/postgres-smoke.mjs` to build and exercise an isolated Compose stack. The smoke check covers database setup, input validation, simultaneous saves, and data persistence across container recreation.
