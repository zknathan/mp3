require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const User = require('./models/user');
const Task = require('./models/task');

async function start() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI);
    // Build collections and the unique index before transactions accept requests.
    await User.init();
    await Task.init();
    const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
        console.log(`Server running on port ${server.address().port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => server.close(async () => {
            await mongoose.disconnect();
            process.exit(0);
        }));
    }
}
start().catch(() => {
    // Never print credentials or raw database errors.
    console.error('Startup failed. Check MONGODB_URI, database access, and network settings.');
    process.exitCode = 1;
});
