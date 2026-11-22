# SupportFlow Frontend — ResolveIQ

A role-aware frontend using plain HTML, CSS and JavaScript. It connects to the actual FastAPI authentication, ticket, analysis and administrator routes in this project. No Node.js, React, npm install or build step is required.

## Run

Start the backend from the project root:

```powershell
docker compose up --build -d
```

Then run the frontend in a separate terminal:

```powershell
cd frontend
python -m http.server 5500
```

Open <http://127.0.0.1:5500/?build=3>. The v3 UI loads the separately named `styles-v3.css` file to avoid an old cached stylesheet.

API URL and route definitions are in `config.js`. The default API URL is `http://127.0.0.1:8001`.

## Sign-in and roles

There is one email/password sign-in form for customer, agent and admin accounts. After login, the frontend fetches `/auth/me`; the returned backend role determines the workspace. A role is never selected or trusted from a browser field.

- Customer: public self-registration; creates role `customer`.
- Agent: provisioned by an administrator using People & access.
- Admin: provisioned from a trusted shell using `docker compose exec api python -m scripts.create_admin`.

## Connected backend operations

- Authentication: register, login, current-user lookup.
- Customer: create/list/view/update owned tickets.
- Agent: dashboard, assigned/unassigned queues, claim ticket, view ticket, status/priority updates, ResolveIQ analysis, analysis history, priority approval, edited-reply approval.
- Admin: dashboard, all tickets, assignment/reassignment, user list/create/role updates, global analysis history.

See the root `README.md` for the method/path API matrix and role permissions.

## Configuration

The default API URL is derived from the page hostname and uses port `8001`. For a different API host, define `window.SUPPORTFLOW_API_BASE_URL` before `config.js` loads. The local FastAPI CORS allow-list includes both `http://localhost:5500` and `http://127.0.0.1:5500`. Never put Gemini keys, database credentials or the JWT signing secret in frontend files.

The frontend never contains Gemini keys, database credentials or the JWT signing secret. The access token is held in `sessionStorage` for the browser tab session.
