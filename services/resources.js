const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('../lib/errors');
const { isId, userFields, taskFields } = require('../lib/validation');

async function existing(Model, id, session) {
    if (!isId(id)) throw new ApiError(404, `${Model.modelName} not found.`);
    const document = await Model.findById(id).session(session);
    if (!document) throw new ApiError(404, `${Model.modelName} not found.`);
    return document;
}

// Transactions commit related documents together and retry concurrent write conflicts.
async function atomic(operation) {
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(() => operation(session));
    } finally {
        await session.endSession();
    }
}

async function saveUser(body, id) {
    return atomic(async session => {
        // URL existence takes precedence over body validation.
        const user = id === undefined ? new User() : await existing(User, id, session);
        const fields = userFields(body);
        const duplicate = await User.exists({ email: fields.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) throw new ApiError(400, 'That email address is already in use.');
        const tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).session(session);
        if (tasks.some(task => task.completed)) throw new ApiError(400, 'Completed tasks cannot be included in pendingTasks.');
        if (tasks.length !== fields.pendingTasks.length) throw new ApiError(404, 'One or more tasks were not found.');
        const userId = user._id.toString();
        const removed = user.pendingTasks.filter(taskId => !fields.pendingTasks.includes(taskId));
        user.set(fields);
        await user.save({ session });
        await Task.updateMany({ _id: { $in: removed }, assignedUser: userId }, {
            $set: { assignedUser: '', assignedUserName: 'unassigned' }
        }, { session });
        await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: fields.pendingTasks } }, {
            $pull: { pendingTasks: { $in: fields.pendingTasks } }
        }, { session });
        await Task.updateMany({ _id: { $in: fields.pendingTasks } }, {
            $set: { assignedUser: userId, assignedUserName: user.name }
        }, { session });
        // Completed tasks keep their assignment and follow user renames too.
        await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: user.name } }, { session });
        return user.toObject();
    });
}

async function saveTask(body, id, formEncoded) {
    return atomic(async session => {
        const task = id === undefined ? new Task() : await existing(Task, id, session);
        const fields = taskFields(body, formEncoded);
        if (fields.assignedUser) {
            const user = await User.findById(fields.assignedUser).session(session);
            if (!user) throw new ApiError(404, 'Assigned user not found.');
            if (fields.assignedUserName !== undefined && fields.assignedUserName !== user.name) {
                throw new ApiError(400, 'assignedUserName must match the assigned user\'s name.');
            }
            fields.assignedUserName = user.name;
        } else fields.assignedUserName = 'unassigned';
        task.set(fields);
        await task.save({ session });
        const taskId = task._id.toString();
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session });
        if (task.assignedUser && !task.completed) {
            await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } }, { session });
        }
        return task.toObject();
    });
}

async function deleteUser(id) {
    return atomic(async session => {
        const user = await existing(User, id, session);
        await Task.updateMany({ assignedUser: user._id.toString() }, {
            $set: { assignedUser: '', assignedUserName: 'unassigned' }
        }, { session });
        await user.deleteOne({ session });
    });
}

async function deleteTask(id) {
    return atomic(async session => {
        const task = await existing(Task, id, session);
        await User.updateMany({ pendingTasks: task._id.toString() }, {
            $pull: { pendingTasks: task._id.toString() }
        }, { session });
        await task.deleteOne({ session });
    });
}
module.exports = { saveUser, saveTask, deleteUser, deleteTask };
