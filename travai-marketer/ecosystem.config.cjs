module.exports = {
  apps: [
    {
      name: 'travai-app',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/home/ubuntu/travai-app/travai-marketer',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'travai-scheduler',
      script: 'bridge/scheduler.js',
      cwd: '/home/ubuntu/travai-app/travai-marketer',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
