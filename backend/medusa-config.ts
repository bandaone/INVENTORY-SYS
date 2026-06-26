import { defineConfig, loadEnv } from "@medusajs/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      connection: {
        ssl: process.env.DATABASE_SSL === "true" 
          ? { rejectUnauthorized: false }
          : false,
      },
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:3000,http://localhost:7001",
      authCors: process.env.AUTH_CORS || "http://localhost:3000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    backendUrl: process.env.BACKEND_URL || "http://localhost:9000",
  },
  modules: [
    {
      resolve: "@medusajs/product",
      options: {
        enableUI: true,
      },
    },
    {
      resolve: "@medusajs/inventory",
      options: {
        enableUI: true,
      },
    },
    {
      resolve: "@medusajs/order",
      options: {
        enableUI: true,
      },
    },
    {
      resolve: "@medusajs/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/auth-emailpass",
            id: "emailpass",
            options: {},
          },
        ],
      },
    },
    {
      resolve: "@medusajs/stock-location",
      options: {
        enableUI: true,
      },
    },
    // Custom Modules
    {
      resolve: "./src/modules/serial-tracking",
    },
    {
      resolve: "./src/modules/sync-engine",
    },
    {
      resolve: "./src/modules/zra-invoice",
    },
    {
      resolve: "./src/modules/stocktake",
    },
    {
      resolve: "./src/modules/audit-trail",
    },
  ],
  plugins: [],
})
