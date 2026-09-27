import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, resetDatabase } from '../helpers/db.js';
import { ADMIN, SALESMAN, WAREHOUSE, app, as, request } from '../helpers/api.js';

beforeAll(resetDatabase);
afterAll(() => db.destroy());

function refreshCookie(res) {
  return res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
}

describe('auth', () => {
  it('logs in with valid credentials and returns permissions', async () => {
    const res = await request(app).post('/api/v1/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.permissions).toContain('settings.manage');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(refreshCookie(res)).toMatch(/HttpOnly/);
  });

  it('accepts the username case-insensitively', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ ...ADMIN, login: 'ADMIN' });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ login: 'admin', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown user with the same message', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ login: 'ghost', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid username or password');
  });

  it('validates the login body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a token for protected routes', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
  });

  it('returns the current user from /me', async () => {
    const client = await as(WAREHOUSE);
    const res = await client.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('warehouse');
    expect(res.body.data.permissions).toContain('inventory.in');
    expect(res.body.data.permissions).not.toContain('invoice.create');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send(SALESMAN);
    const first = refreshCookie(loginRes).split(';')[0];

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(refreshed.status).toBe(200);
    const second = refreshCookie(refreshed).split(';')[0];
    expect(second).not.toBe(first);

    // Replaying the old token revokes every session of the user.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(replay.status).toBe(401);
    const afterReuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', second);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const cookie = refreshCookie(loginRes).split(';')[0];
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('blocks deactivated users immediately, even with a valid access token', async () => {
    const admin = await as(ADMIN);
    const salesman = await as(SALESMAN);
    const user = (await admin.get('/users?search=salesman')).body.data[0];

    expect((await admin.patch(`/users/${user.id}`, { isActive: false })).status).toBe(200);
    expect((await salesman.get('/auth/me')).status).toBe(401);
    const relogin = await request(app).post('/api/v1/auth/login').send(SALESMAN);
    expect(relogin.status).toBe(403);

    await admin.patch(`/users/${user.id}`, { isActive: true });
  });

  it('changes the password and requires the current one', async () => {
    const client = await as(WAREHOUSE);
    const wrong = await client.patch('/auth/change-password', {
      currentPassword: 'wrong',
      newPassword: 'NewPass@456',
    });
    expect(wrong.status).toBe(400);

    const ok = await client.patch('/auth/change-password', {
      currentPassword: WAREHOUSE.password,
      newPassword: 'NewPass@456',
    });
    expect(ok.status).toBe(200);
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'warehouse', password: 'NewPass@456' });
    expect(relogin.status).toBe(200);
  });
});
