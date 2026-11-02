class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = 500;
    let message = 'The request could not be completed. Please try again.';
    if (error instanceof ApiError) {
        status = error.status;
        message = error.message;
    } else if (error.type === 'entity.parse.failed') {
        status = 400;
        message = 'The request body must contain valid JSON.';
    } else if (error.type === 'entity.too.large') {
        status = 400;
        message = 'The request body is too large.';
    } else if (error.code === 11000) {
        status = 400;
        message = 'That email address is already in use.';
    } else if (error.name === 'ValidationError' || error.name === 'CastError') {
        status = 400;
        message = 'One or more fields have an invalid value.';
    }
    res.status(status).json({ message, data: null });
}
module.exports = { ApiError, errorHandler };
