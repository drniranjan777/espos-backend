/** Context passed to services for auditing when no authenticated user exists yet (e.g. login). */
export function anonymousContext(req) {
  return { userId: null, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 255) };
}
