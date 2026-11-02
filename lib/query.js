const { ApiError } = require('./errors');

function parameter(query, name, fallback) {
    if (query[name] === undefined) return fallback;
    try {
        if (typeof query[name] !== 'string') throw new Error();
        return JSON.parse(query[name]);
    } catch {
        throw new ApiError(400, `${name} must contain a valid JSON value.`);
    }
}

function objectParameter(query, name, fallback = {}) {
    const value = parameter(query, name, fallback);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, `${name} must be a JSON object.`);
    }
    return value;
}

function projection(query) {
    const select = objectParameter(query, 'select');
    const entries = Object.entries(select);
    if (entries.some(([, value]) => value !== 0 && value !== 1)) {
        throw new ApiError(400, 'select values must be 0 or 1.');
    }
    const modes = new Set(entries.filter(([key]) => key !== '_id').map(([, value]) => value));
    if (modes.size > 1) throw new ApiError(400, 'select cannot mix included and excluded fields, except _id.');
    return select;
}

function pagination(query, name, fallback) {
    const value = parameter(query, name, fallback);
    if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${name} must be a non-negative integer.`);
    return value;
}

async function runQuery(query) {
    try {
        return await query.exec();
    } catch (error) {
        // Invalid query values are client errors; connection failures remain server errors.
        if (error.name === 'CastError' || error.name === 'StrictModeError' ||
            [2, 9, 14, 72, 15974, 16410, 16872, 31253, 31254].includes(error.code)) {
            throw new ApiError(400, 'The query contains an invalid field value or operation.');
        }
        throw error;
    }
}

async function list(Model, query, defaultLimit) {
    const where = objectParameter(query, 'where');
    const sort = objectParameter(query, 'sort');
    if (Object.values(sort).some(value => value !== 1 && value !== -1)) throw new ApiError(400, 'sort values must be 1 or -1.');
    const select = projection(query);
    const skip = pagination(query, 'skip', 0);
    const limit = pagination(query, 'limit', defaultLimit);
    const count = parameter(query, 'count', false);
    if (typeof count !== 'boolean') throw new ApiError(400, 'count must be true or false.');
    if (count) return runQuery(Model.countDocuments(where));
    return runQuery(Model.find(where).sort(sort).select(select).skip(skip).limit(limit).lean());
}
module.exports = { list, projection, runQuery };
