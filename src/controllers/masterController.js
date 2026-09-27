import { sendCreated, sendSuccess } from '../utils/apiResponse.js';

/** Builds standard CRUD handlers around a master service. */
export function createMasterController(service, entityName) {
  return {
    async list(req, res) {
      return sendSuccess(res, await service.list(req.validated.query));
    },
    async get(req, res) {
      return sendSuccess(res, await service.getById(req.validated.params.id));
    },
    async create(req, res) {
      return sendCreated(
        res,
        await service.create(req.validated.body, req.context),
        `${entityName} created`,
      );
    },
    async update(req, res) {
      const record = await service.update(req.validated.params.id, req.validated.body, req.context);
      return sendSuccess(res, record, { message: `${entityName} updated` });
    },
    async remove(req, res) {
      await service.remove(req.validated.params.id, req.context);
      return sendSuccess(res, null, { message: `${entityName} deleted` });
    },
  };
}
