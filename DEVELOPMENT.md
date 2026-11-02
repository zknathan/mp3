# Running and checking MP3

Use Node 24. The existing Render commands (`npm i`, `npm start`) work without changes.
Set `MONGODB_URI` in Render's environment settings; credentials are never stored in source.
The database must support transactions (MongoDB Atlas replica-set clusters do).
The server initializes its collections and unique email index before accepting requests.
The URI can omit a database name, in which case MongoDB's default database is used.

For local development:

```bash
cp .env.example .env
# Set MONGODB_URI in .env.
npm ci
npm start
```

GET `/` and `/api` return an API status/directory. Assignment endpoints are under
`/api/users` and `/api/tasks`. No frontend is required by the assignment.
Successful DELETE requests return HTTP 204 with an empty body; other responses
use `{ "message": "...", "data": ... }`.

PUT replaces writable fields and resets omitted optional fields to their defaults.
Client-supplied `_id` and `dateCreated` are ignored. Dates are set on creation and
preserved on replacement. The API validates JSON body types; URL-encoded task
bodies also accept `completed=true` and `completed=false`.

All user/task writes use MongoDB transactions so validation or database failures
roll back changes to both collections. Email uniqueness is enforced by a database
index. List filtering, projection, ordering, pagination and counts run in MongoDB
through Mongoose. `count=true` counts all matching documents before pagination.

## Tests

```bash
npm ci
npm test
```

Tests start a temporary MongoDB 7 replica set and exercise the real Express API.
They download a MongoDB binary on the first run and do not connect to Atlas or
use Render environment variables. On Ubuntu 24, use the compatible Ubuntu 22
binary if needed: `MONGOMS_DISTRO=ubuntu-22.04 npm test`.

The integration suite covers creation/defaults, strict validation, error precedence,
assignment/reassignment, completed tasks, user renaming, full PUT replacement,
query combinations, default limits, deletions, failed-request immutability,
transaction rollback, concurrent requests, URL-encoded input, CORS and error envelopes.

## Render and the course self-check

Deploy the latest `main` commit, keeping `MONGODB_URI` set. Check
`https://mp3-twrv.onrender.com/api/users` and `/api/tasks` after deployment.
Then run:

```bash
npm run submit
```

`submit.js` already uses `https://mp3-twrv.onrender.com` as its base URL.
The grader address is unchanged. This command runs the course self-check; it does
not submit the assignment. The grader creates and deletes its own test records.

Keep the service and database available for grading. Per the assignment's LLM
policy, retain the development chatlog and disclose LLM use in the grading form.
