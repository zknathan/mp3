const express = require('express');
const { list, projection, runQuery } = require('../lib/query');
const { isId } = require('../lib/validation');
const { ApiError } = require('../lib/errors');

module.exports = function resourceRoutes(Model, save, remove, defaultLimit) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        res.json({ message: 'OK', data: await list(Model, req.query, defaultLimit) });
    });
    router.post('/', async (req, res) => {
        const data = await save(req.body, undefined, Boolean(req.is('application/x-www-form-urlencoded')));
        res.status(201).json({ message: `${Model.modelName} created.`, data });
    });
    router.get('/:id', async (req, res) => {
        if (!isId(req.params.id)) throw new ApiError(404, `${Model.modelName} not found.`);
        // Only select applies on individual resources; other parameters are ignored.
        const data = await runQuery(Model.findById(req.params.id).select(projection(req.query)).lean());
        if (!data) throw new ApiError(404, `${Model.modelName} not found.`);
        res.json({ message: 'OK', data });
    });
    router.put('/:id', async (req, res) => {
        const data = await save(req.body, req.params.id, Boolean(req.is('application/x-www-form-urlencoded')));
        res.json({ message: `${Model.modelName} updated.`, data });
    });
    router.delete('/:id', async (req, res) => {
        await remove(req.params.id);
        // HTTP 204 responses have no body.
        res.status(204).end();
    });
    return router;
};
