import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './openapi.js';

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => res.json(openapi));
docsRouter.use(
  '/docs',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  }),
  swaggerUi.serve,
  swaggerUi.setup(openapi),
);
