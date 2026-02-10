import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import mongoSanitize from 'express-mongo-sanitize';
// import rateLimit from 'express-rate-limit';
import { createServer, Server as HTTPServer } from 'http';
import { validateEnv, getCorsConfig } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';
import logger from './config/logger';

const env = validateEnv();

export function createApp(): { app: Application; httpServer: HTTPServer } {
  const app = express();

  // Security middleware
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(cors(getCorsConfig(env)));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression
  app.use(compression());

  // Logging
  if (env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', {
      stream: {
        write: (message: string) => logger.info(message.trim())
      }
    }));
  }

  // Sanitize data
  app.use(mongoSanitize());

  // Serve uploaded files (for local file storage)
  // This allows files to be accessed via http://localhost:4002/uploads/...
  const uploadsPath = process.env.LOCAL_STORAGE_DIR || 'uploads';
  app.use('/uploads', (req, res, next) => {
    // Log upload requests to ensure the request object is used
    logger.debug(`Serving upload request for ${req.method} ${req.originalUrl}`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  app.use('/uploads', express.static(uploadsPath));
  logger.info(`📁 Serving static files from: ${uploadsPath} at /uploads`);

  // Rate limiting
  // const limiter = rateLimit({
  //   windowMs: env.RATE_LIMIT_WINDOW_MS,
  //   max: env.RATE_LIMIT_MAX_REQUESTS,
  //   message: 'Too many requests from this IP, please try again later.',
  //   standardHeaders: true,
  //   legacyHeaders: false,
  // });
  // app.use('/api/', limiter);

  // Routes
  app.use('/api/v1', routes);

  // 404 handler (only for unmatched routes)
  app.use((req, res) => {
    // Only send 404 if headers haven't been sent
    if (!res.headersSent) {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
      });
    }
  });

  // Error handler (must be last)
  app.use(errorHandler);

  // Create HTTP server for Socket.IO
  const httpServer = createServer(app);

  return { app, httpServer };
}

