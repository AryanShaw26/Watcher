import { api } from './client';
export type User = { id: string; email: string };
export async function register(email: string, password: string) {
  return (await api.post('/auth/register', { email, password })).data as {
    accessToken: string;
    user: User;
  };
}
export async function login(email: string, password: string) {
  return (await api.post('/auth/login', { email, password })).data as {
    accessToken: string;
    user: User;
  };
}
export async function logout() {
  await api.post('/auth/logout');
}
