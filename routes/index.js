const User = require('../models/user');
const Task = require('../models/task');
const resourceRoutes = require('./resources');
const { saveUser, saveTask, deleteUser, deleteTask } = require('../services/resources');
module.exports = function (app, router) {
    app.use('/api', require('./home')(router));
    app.use('/api/users', resourceRoutes(User, saveUser, deleteUser, 0));
    app.use('/api/tasks', resourceRoutes(Task, saveTask, deleteTask, 100));
};
