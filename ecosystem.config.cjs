module.exports = {
  apps: [{
    name: 'dax-scorecard',
    script: 'src/server.js',
    cwd: '/var/www/dax-scorecard',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 4173
    },
    max_memory_restart: '256M',
    error_file: '/var/log/dax-scorecard/error.log',
    out_file: '/var/log/dax-scorecard/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000
  }]
};
