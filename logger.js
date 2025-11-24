import pino from 'pino';

// LOG_LEVEL takes precedence, then DEBUG (boolean), default to 'info'
const level = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info');

const pretty = process.env.LOG_PRETTY && process.env.LOG_PRETTY !== '0';

const options = { level };

if (pretty) {
    // Basic pretty printing in development when LOG_PRETTY is set
    options.transport = {
        target: 'pino-pretty',
        options: { colorize: true }
    };
}

const logger = pino(options);
export default logger;
