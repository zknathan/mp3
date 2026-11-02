const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../app');
const User = require('../models/user');
const Task = require('../models/task');
const { errorHandler } = require('../lib/errors');
let replica, server, base;
const missingId = () => new mongoose.Types.ObjectId().toString();
const taskBody = (extra = {}) => ({ name: 'Task', deadline: '2026-12-01', ...extra });
const userBody = (extra = {}) => ({ name: 'Alice', email: 'alice@example.com', ...extra });
async function request(method, path, body, expected = 200) {
    const response = await fetch(base + '/api' + path, {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    if (expected === 204) assert.equal(text, '');
    else {
        assert.equal(typeof result.message, 'string');
        assert.ok(Object.hasOwn(result, 'data'));
    }
    return result?.data;
}
const get = path => request('GET', path);
const user = body => request('POST', '/users', userBody(body), 201);
const task = body => request('POST', '/tasks', taskBody(body), 201);
const query = values => '?' + new URLSearchParams(Object.entries(values).map(([k,v]) => [k,JSON.stringify(v)]));
async function consistent() {
    const users = await User.find().lean();
    const tasks = await Task.find().lean();
    for (const u of users) {
        assert.equal(new Set(u.pendingTasks).size, u.pendingTasks.length);
        const expected = tasks.filter(t => t.assignedUser === String(u._id) && !t.completed).map(t => String(t._id)).sort();
        assert.deepEqual([...u.pendingTasks].sort(), expected);
    }
    for (const t of tasks) {
        if (!t.assignedUser) assert.equal(t.assignedUserName, 'unassigned');
        else assert.equal(t.assignedUserName, users.find(u => String(u._id) === t.assignedUser)?.name);
    }
}
before(async () => {
    replica = await MongoMemoryReplSet.create({
        replSet: { count: 1 }, binary: { version: '7.0.24' },
        instanceOpts: [{ args: ['--nounixsocket'] }]
    });
    await mongoose.connect(replica.getUri(), { dbName: 'mp3_tests' });
    await User.init();
    await Task.init();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await Task.deleteMany({}); await User.deleteMany({}); });
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (replica) await replica.stop();
});

test('creation returns complete defaults and server-owned dates', async () => {
    const u = await user({ dateCreated: '2000-01-01', _id: missingId() });
    assert.deepEqual(u.pendingTasks, []);
    assert.ok(new Date(u.dateCreated).getFullYear() >= 2026);
    const t = await task({ dateCreated: '2000-01-01' });
    assert.equal(t.description, ''); assert.equal(t.completed, false);
    assert.equal(t.assignedUser, ''); assert.equal(t.assignedUserName, 'unassigned');
    assert.ok(new Date(t.dateCreated).getFullYear() >= 2026);
});

test('validates required fields, types, ids, unique emails and references', async () => {
    const u = await user();
    for (const body of [{}, { name: 'A' }, { email: 'x' }, { name: 4, email: 'x' }, { name: ' ', email: 'x' }, userBody(), userBody({ email: 'new', pendingTasks: 'bad' }), userBody({ email: 'new', pendingTasks: ['bad'] })]) {
        await request('POST', '/users', body, 400);
    }
    for (const body of [{}, { name: 'T' }, { deadline: '2026-01-01' }, taskBody({ name: [] }), taskBody({ deadline: null }), taskBody({ deadline: 'bad' }), taskBody({ completed: 'false' }), taskBody({ description: 42 }), taskBody({ assignedUser: 'bad' }), taskBody({ assignedUser: u._id, assignedUserName: 'Wrong' }), taskBody({ assignedUser: u._id, assignedUserName: null })]) {
        await request('POST', '/tasks', body, 400);
    }
    await request('POST', '/tasks', taskBody({ assignedUser: missingId() }), 404);
    await request('POST', '/users', userBody({ email: 'new', pendingTasks: [missingId()] }), 404);
    assert.equal(await User.countDocuments(), 1); assert.equal(await Task.countDocuments(), 0);
});

test('URL id checks precede body validation; missing collection matches return success', async () => {
    for (const resource of ['users', 'tasks']) {
        for (const id of ['bad', missingId()]) {
            await request('GET', `/${resource}/${id}`, undefined, 404);
            await request('PUT', `/${resource}/${id}`, {}, 404);
            await request('DELETE', `/${resource}/${id}`, undefined, 404);
        }
        assert.deepEqual(await get(`/${resource}${query({ where: { _id: missingId() } })}`), []);
        assert.equal(await get(`/${resource}${query({ count: true })}`), 0);
    }
});

test('task assignment, completion, reopening, moving, and replacement defaults', async () => {
    const a = await user(); const b = await user({ name: 'Bob', email: 'bob@example.com' });
    const t = await task({ assignedUser: a._id, description: 'old' });
    assert.equal(t.assignedUserName, 'Alice'); await consistent();
    const completed = await request('PUT', '/tasks/' + t._id, taskBody({ completed: true, assignedUser: a._id }));
    assert.equal(completed.description, ''); assert.equal(completed.dateCreated, t.dateCreated); await consistent();
    await request('PUT', '/tasks/' + t._id, taskBody({ completed: true, assignedUser: b._id })); await consistent();
    await request('PUT', '/tasks/' + t._id, taskBody({ assignedUser: b._id })); await consistent();
    const reset = await request('PUT', '/tasks/' + t._id, taskBody());
    assert.equal(reset.assignedUser, ''); assert.deepEqual((await get('/users/' + b._id)).pendingTasks, []); await consistent();
});

test('user replacement moves tasks, removes old tasks and renames completed tasks', async () => {
    const a = await user(); const b = await user({ name: 'Bob', email: 'bob@example.com' });
    const ta = await task({ assignedUser: a._id }); const tb = await task({ assignedUser: b._id });
    const completed = await task({ assignedUser: a._id, completed: true });
    const update = await request('PUT', '/users/' + a._id, userBody({ name: 'Alicia', pendingTasks: [tb._id], dateCreated: '2000-01-01' }));
    assert.equal(update.dateCreated, a.dateCreated);
    assert.equal((await get('/tasks/' + ta._id)).assignedUser, '');
    assert.equal((await get('/tasks/' + tb._id)).assignedUser, a._id);
    assert.equal((await get('/tasks/' + completed._id)).assignedUserName, 'Alicia');
    assert.deepEqual((await get('/users/' + b._id)).pendingTasks, []); await consistent();
    await request('PUT', '/users/' + a._id, userBody({ name: 'Alicia' })); await consistent();
    assert.equal((await get('/tasks/' + tb._id)).assignedUser, '');
});

test('POST users takes pending tasks from another user and deduplicates ids', async () => {
    const a = await user(); const t = await task({ assignedUser: a._id });
    const b = await user({ name: 'Bob', email: 'bob@example.com', pendingTasks: [t._id, t._id] });
    assert.deepEqual(b.pendingTasks, [t._id]);
    assert.equal((await get('/tasks/' + t._id)).assignedUser, b._id); await consistent();
});

test('failed updates do not mutate any documents', async () => {
    const a = await user(); const b = await user({ email: 'bob@example.com' });
    const pending = await task({ assignedUser: a._id }); const done = await task({ completed: true });
    const snapshot = async () => JSON.stringify({ users: await User.find().sort('_id').lean(), tasks: await Task.find().sort('_id').lean() });
    const before = await snapshot();
    await request('PUT', '/users/' + a._id, userBody({ name: 'Changed', pendingTasks: [done._id] }), 400);
    await request('PUT', '/users/' + a._id, userBody({ email: b.email, pendingTasks: [pending._id] }), 400);
    await request('PUT', '/users/' + a._id, userBody({ pendingTasks: [pending._id, missingId()] }), 404);
    await request('PUT', '/tasks/' + pending._id, taskBody({ assignedUser: b._id, assignedUserName: 'Wrong' }), 400);
    assert.equal(await snapshot(), before); await consistent();
});

test('transaction rolls back earlier writes when a later database operation fails', async () => {
    const a = await user(); const t = await task({ assignedUser: a._id });
    const original = Task.updateMany;
    Task.updateMany = async () => { throw new Error('simulated database failure'); };
    try {
        await request('PUT', '/users/' + a._id, userBody({ name: 'Should roll back' }), 500);
    } finally { Task.updateMany = original; }
    assert.equal((await get('/users/' + a._id)).name, 'Alice');
    assert.equal((await get('/tasks/' + t._id)).assignedUser, a._id); await consistent();
});

test('concurrent task changes preserve references and unique emails', async () => {
    const a = await user(); const b = await user({ email: 'bob@example.com' }); const t = await task();
    await Promise.all([a,b].map(u => request('PUT', '/tasks/' + t._id, taskBody({ assignedUser: u._id }))));
    await consistent();
    const responses = await Promise.all([1,2].map(() => fetch(base + '/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userBody({ email: 'race@example.com' }))
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [201,400]);
    for (const r of responses) await r.text();
});

test('combined collection queries and projections on individual resources', async () => {
    const u = await user();
    const tasks = [];
    for (const name of ['C','A','B']) tasks.push(await task({ name }));
    await task({ name: 'Done', completed: true });
    const result = await get('/tasks' + query({ where: { completed: false }, sort: { name: 1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1, count: false }));
    assert.deepEqual(result, [{ name: 'B' }]);
    assert.equal(await get('/tasks' + query({ where: { completed: false }, count: true, skip: 99, limit: 1 })), 3);
    assert.equal((await get('/tasks' + query({ where: { _id: { $in: tasks.slice(0,2).map(t => t._id) } } }))).length, 2);
    assert.deepEqual(await get('/users/' + u._id + query({ select: { name: 1, _id: 0 } }) + '&where=bad&count=bad'), { name: 'Alice' });
    assert.deepEqual(await get('/tasks/' + tasks[0]._id + query({ select: { name: 1, _id: 0 } })), { name: 'C' });
    assert.equal((await get('/users' + query({ select: { _id: 0 } })))[0]._id, undefined);
});

test('task default limit is 100, users unlimited, explicit limit zero is unlimited', async () => {
    await Task.insertMany(Array.from({ length: 102 }, (_, i) => taskBody({ name: String(i) })));
    await User.insertMany(Array.from({ length: 102 }, (_, i) => userBody({ email: `u${i}@example.com` })));
    assert.equal((await get('/tasks')).length, 100);
    assert.equal((await get('/tasks?limit=0')).length, 102);
    assert.equal((await get('/users')).length, 102);
    assert.equal(await get('/tasks?count=true'), 102);
});

test('malformed and wrong-type query parameters return readable 400s', async () => {
    for (const path of ['?where={', '?sort={', '?select={', '?skip=bad', '?limit=bad', '?count=bad', '?skip=-1', '?limit=1.2', '?where=[]', '?sort={"name":2}', '?select={"name":1,"email":0}', '?where={"_id":"bad"}', '?where={"$bogus":1}', '?count=1']) {
        await request('GET', '/tasks' + path, undefined, 400);
    }
});

test('DELETE cleans both directions, including completed tasks', async () => {
    const u = await user(); const pending = await task({ assignedUser: u._id });
    const done = await task({ assignedUser: u._id, completed: true });
    await request('DELETE', '/tasks/' + pending._id, undefined, 204);
    await request('GET', '/tasks/' + pending._id, undefined, 404); await consistent();
    await request('DELETE', '/users/' + u._id, undefined, 204);
    await request('GET', '/users/' + u._id, undefined, 404);
    assert.equal((await get('/tasks/' + done._id)).assignedUser, ''); await consistent();
});

test('JSON errors, URL-encoded input, unknown routes, CORS, and safe 500 envelope', async () => {
    const malformed = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).data, null);
    const form = await fetch(base + '/api/tasks', { method: 'POST', body: new URLSearchParams({ name: 'Form', deadline: '2026-12-01', completed: 'false' }) });
    assert.equal(form.status, 201); assert.equal((await form.json()).data.completed, false);
    await request('GET', '/missing', undefined, 404);
    const options = await fetch(base + '/api/tasks', { method: 'OPTIONS' });
    assert.equal(options.status, 204); assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
    let status, output;
    errorHandler(new Error('database password secret'), {}, { headersSent: false, status(code) { status = code; return this; }, json(value) { output = value; } }, () => {});
    assert.equal(status, 500); assert.equal(output.data, null); assert.ok(!JSON.stringify(output).includes('secret'));
});
