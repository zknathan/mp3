const { ApiError } = require('./errors');
const isId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const bad = message => { throw new ApiError(400, message); };

function bodyObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) bad('The request body must be an object.');
}

function stringField(body, field, required = false, fallback = '') {
    const value = body[field];
    if (value === undefined && !required) return fallback;
    if (typeof value !== 'string' || (required && !value.trim())) {
        bad(`${field} must be a${required ? ' non-empty' : ''} string.`);
    }
    return value;
}

function userFields(body) {
    bodyObject(body);
    const name = stringField(body, 'name', true);
    const email = stringField(body, 'email', true);
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(isId)) {
        bad('pendingTasks must be an array of valid task ids.');
    }
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}

function taskFields(body, formEncoded = false) {
    bodyObject(body);
    const name = stringField(body, 'name', true);
    const description = stringField(body, 'description');
    const value = body.deadline;
    if (!['string', 'number'].includes(typeof value) || value === '' ||
        !Number.isFinite(new Date(value).getTime())) bad('deadline must be a valid date.');
    let completed = body.completed === undefined ? false : body.completed;
    if (formEncoded && (completed === 'true' || completed === 'false')) completed = completed === 'true';
    if (typeof completed !== 'boolean') bad('completed must be a boolean.');
    const assignedUser = stringField(body, 'assignedUser');
    const assignedUserName = body.assignedUserName === undefined ? undefined : stringField(body, 'assignedUserName');
    if (assignedUser !== '' && !isId(assignedUser)) bad('assignedUser must be a valid user id or an empty string.');
    return { name, description, deadline: new Date(value), completed,
        assignedUser: assignedUser.toLowerCase(), assignedUserName };
}
module.exports = { isId, userFields, taskFields };
