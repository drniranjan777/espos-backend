import request from 'supertest';
import { createApp } from '../../src/app.js';

export const app = createApp();

export const ADMIN = { login: 'admin', password: 'Admin@123' };
export const WAREHOUSE = { login: 'warehouse', password: 'Password@123' };
export const SALESMAN = { login: 'salesman', password: 'Password@123' };

export async function login(credentials) {
  const res = await request(app).post('/api/v1/auth/login').send(credentials);
  if (res.status !== 200) throw new Error(`Login failed for ${credentials.login}: ${res.text}`);
  return res.body.data.accessToken;
}

/** Returns a small HTTP client that sends the given user's access token. */
export async function as(credentials) {
  const token = await login(credentials);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    token,
    get: (url) => withAuth(request(app).get(`/api/v1${url}`)),
    post: (url, body) => withAuth(request(app).post(`/api/v1${url}`)).send(body),
    put: (url, body) => withAuth(request(app).put(`/api/v1${url}`)).send(body),
    patch: (url, body) => withAuth(request(app).patch(`/api/v1${url}`)).send(body),
    delete: (url) => withAuth(request(app).delete(`/api/v1${url}`)),
  };
}

export { request };
