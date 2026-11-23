// Pruebas del núcleo de autenticación de /api (visitas y bitácora).
// Corre con el ejecutor integrado de Node (>= 22.18 carga .ts quitando tipos):
//   npm test
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestUser, restrictedEmail, isUuid, isStale } from './api-auth-core.ts';

// Misma regla que lib/user-role.ts, reducida a lo que las pruebas necesitan.
const getRole = (email) =>
  email.endsWith('@gdo.com.co') ? 'admin' : email === 'o@surtigas.co' ? 'operativo' : 'user';

const deps = (over = {}) => ({
  getEmailFromBearer: mock.fn(async () => null),
  getEmailFromCookies: mock.fn(async () => null),
  canAccess: mock.fn(async () => ({ ok: true })),
  registerPending: mock.fn(async () => {}),
  getRole,
  authDisabled: false,
  ...over,
});

describe('resolveRequestUser', () => {
  it('sin token ni cookie → 401', async () => {
    const r = await resolveRequestUser(null, deps());
    assert.deepEqual(r, { ok: false, status: 401, body: { error: 'No autenticado' } });
  });

  it('Bearer inválido → 401 y no cae a la cookie', async () => {
    const d = deps({ getEmailFromCookies: mock.fn(async () => 'a@gdo.com.co') });
    const r = await resolveRequestUser('Bearer malo', d);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(d.getEmailFromCookies.mock.callCount(), 0);
  });

  it('Bearer válido de admin → admin, sin consultar allowlist', async () => {
    const d = deps({ getEmailFromBearer: mock.fn(async () => 'Ana@GDO.com.co') });
    const r = await resolveRequestUser('Bearer t0k3n', d);
    assert.deepEqual(r, { ok: true, user: { email: 'ana@gdo.com.co', role: 'admin' } });
    assert.deepEqual(d.getEmailFromBearer.mock.calls[0].arguments, ['t0k3n']);
    assert.equal(d.canAccess.mock.callCount(), 0);
  });

  it('operativo no pasa por la allowlist', async () => {
    const d = deps({ getEmailFromCookies: mock.fn(async () => 'o@surtigas.co') });
    const r = await resolveRequestUser(null, d);
    assert.deepEqual(r, { ok: true, user: { email: 'o@surtigas.co', role: 'operativo' } });
    assert.equal(d.canAccess.mock.callCount(), 0);
  });

  it('cookie de contratista habilitado → user', async () => {
    const r = await resolveRequestUser(null, deps({ getEmailFromCookies: mock.fn(async () => 'c@x.com') }));
    assert.deepEqual(r, { ok: true, user: { email: 'c@x.com', role: 'user' } });
  });

  it('contratista no listado → 403 pending y se registra', async () => {
    const d = deps({
      getEmailFromCookies: mock.fn(async () => 'c@x.com'),
      canAccess: mock.fn(async () => ({ ok: false, reason: 'not_listed' })),
    });
    const r = await resolveRequestUser(null, d);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'pending');
    assert.deepEqual(d.registerPending.mock.calls[0].arguments, ['c@x.com']);
  });

  it('contratista pendiente → 403 pending, sin volver a registrar', async () => {
    const d = deps({
      getEmailFromCookies: mock.fn(async () => 'c@x.com'),
      canAccess: mock.fn(async () => ({ ok: false, reason: 'pending' })),
    });
    const r = await resolveRequestUser(null, d);
    assert.equal(r.body.reason, 'pending');
    assert.equal(d.registerPending.mock.callCount(), 0);
  });

  it('contratista deshabilitado → 403 disabled, sin registrar', async () => {
    const d = deps({
      getEmailFromCookies: mock.fn(async () => 'c@x.com'),
      canAccess: mock.fn(async () => ({ ok: false, reason: 'disabled' })),
    });
    const r = await resolveRequestUser(null, d);
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'disabled');
    assert.equal(d.registerPending.mock.callCount(), 0);
  });

  it('authDisabled sin sesión → pasa con user null', async () => {
    assert.deepEqual(await resolveRequestUser(null, deps({ authDisabled: true })), { ok: true, user: null });
  });

  it('authDisabled con Bearer inválido → sigue siendo 401', async () => {
    const r = await resolveRequestUser('Bearer malo', deps({ authDisabled: true }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });

  it('cabecera Authorization que no es Bearer se ignora y usa la cookie', async () => {
    const d = deps({ getEmailFromCookies: mock.fn(async () => 'a@gdo.com.co') });
    const r = await resolveRequestUser('Basic abc', d);
    assert.equal(r.ok, true);
    assert.equal(d.getEmailFromBearer.mock.callCount(), 0);
  });
});

describe('restrictedEmail', () => {
  it('solo restringe al rol user', () => {
    assert.equal(restrictedEmail({ email: 'c@x.com', role: 'user' }), 'c@x.com');
    assert.equal(restrictedEmail({ email: 'a@gdo.com.co', role: 'admin' }), null);
    assert.equal(restrictedEmail({ email: 'o@surtigas.co', role: 'operativo' }), null);
    assert.equal(restrictedEmail(null), null);
  });
});

describe('isUuid', () => {
  it('acepta UUID y rechaza lo demás', () => {
    assert.equal(isUuid('3f2b8c1e-9d4a-4f6b-8a7c-1e2d3c4b5a69'), true);
    assert.equal(isUuid('3F2B8C1E-9D4A-4F6B-8A7C-1E2D3C4B5A69'), true);
    assert.equal(isUuid('no-uuid'), false);
    assert.equal(isUuid("3f2b8c1e-9d4a-4f6b-8a7c-1e2d3c4b5a69'; drop table x"), false);
    assert.equal(isUuid(undefined), false);
    assert.equal(isUuid(null), false);
    assert.equal(isUuid(123), false);
  });
});

describe('isStale', () => {
  it('sin base no hay conflicto', () => {
    assert.equal(isStale(undefined, '2026-11-23T10:00:00+00:00'), false);
    assert.equal(isStale('', '2026-11-23T10:00:00+00:00'), false);
    assert.equal(isStale(null, '2026-11-23T10:00:00+00:00'), false);
  });
  it('mismo instante en formatos distintos no es conflicto', () => {
    assert.equal(isStale('2026-11-23T10:00:00.000Z', '2026-11-23T10:00:00+00:00'), false);
  });
  it('misma marca con microsegundos de Postgres no es conflicto', () => {
    assert.equal(isStale('2026-11-23T10:00:00.123456+00:00', '2026-11-23T10:00:00.123456+00:00'), false);
  });
  it('instantes distintos es conflicto', () => {
    assert.equal(isStale('2026-11-23T10:00:00.000Z', '2026-11-23T10:00:05+00:00'), true);
  });
  it('base ilegible es conflicto', () => {
    assert.equal(isStale('ayer', '2026-11-23T10:00:00+00:00'), true);
  });
  it('fila sin updated_at no bloquea', () => {
    assert.equal(isStale('2026-11-23T10:00:00.000Z', null), false);
  });
});
