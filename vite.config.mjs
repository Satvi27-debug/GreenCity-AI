import { defineConfig, loadEnv } from 'vite';
import { handleApi } from './api/handler.mjs';

function greenCityApiPlugin() {
  return {
    name: 'green-city-ai-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => handleApi(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => handleApi(req, res, next));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (!process.env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  return {
    plugins: [greenCityApiPlugin()],
    server: {
      host: '127.0.0.1',
    },
    preview: {
      host: '127.0.0.1',
    },
  };
});
