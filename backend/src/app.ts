import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttpModule from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { monitorRouter } from './modules/monitors/monitor.routes.js';
import type { ResultQueue } from './queue/types.js';
import { redisIsUp } from './redis/client.js';
import { createSystemRouter } from './modules/system/system.routes.js';

export function buildApp(queue?:ResultQueue) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(pinoHttpModule.default({ logger }));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const allowed = env.CORS_ORIGINS.split(',').map((item) => item.trim());
      callback(allowed.includes(origin) ? null : new Error('Origin not allowed'), allowed.includes(origin));
    }
  }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
      return;
    }
    const [redisUp,queueStats]=await Promise.all([
      redisIsUp().catch(()=>false),
      queue?queue.getStats().catch(()=>({connected:false,lag:null,dlqDepth:null}))
        :Promise.resolve({connected:false,lag:null,dlqDepth:null})
    ]);
    const queueUp=queueStats.connected;
    res.status(200).json({
      status:redisUp&&queueUp?'ok':'degraded',db:'up',
      redis:redisUp?'up':'down',queue:queueUp?'up':'down',
      uptimeSeconds:Math.floor(process.uptime()),version:'2.0.0'
    });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/monitors', monitorRouter);
  if(queue)app.use('/api/system',createSystemRouter(queue));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
