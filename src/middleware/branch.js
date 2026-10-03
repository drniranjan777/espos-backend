import { ApiError } from '../utils/ApiError.js';

export const BRANCH_HEADER = 'x-branch-id';

/**
 * Resolves the branch the request works in from the `X-Branch-Id` header and checks the
 * user may use it. Without the header the user's first branch (default branch first) is
 * used. Sets `req.branch` and `req.context.warehouseId` for services.
 */
export function resolveBranch(req, _res, next) {
  const branches = req.user?.branches ?? [];
  const header = req.get(BRANCH_HEADER);

  let branch;
  if (header) {
    const id = Number(header);
    if (!Number.isInteger(id) || id <= 0) {
      return next(ApiError.badRequest('Invalid branch'));
    }
    branch = branches.find((b) => b.id === id);
    if (!branch) {
      return next(new ApiError(403, 'BRANCH_FORBIDDEN', 'You do not have access to this branch'));
    }
  } else {
    branch = branches[0];
  }

  if (!branch) {
    return next(
      new ApiError(
        403,
        'NO_BRANCH',
        'No branch is assigned to your account. Contact an administrator.',
      ),
    );
  }

  req.branch = branch;
  req.context.warehouseId = branch.id;
  return next();
}

/** True when the user may work in the given branch. */
export function canAccessBranch(user, warehouseId) {
  return (user.branches ?? []).some((b) => b.id === warehouseId);
}
