process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://watcher:watcher@localhost:5432/watcher_test';
process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-at-least-32-characters';
process.env.BCRYPT_COST = '4';
process.env.ALLOW_PRIVATE_TARGETS = 'false';
