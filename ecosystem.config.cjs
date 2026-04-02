module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      error_file: '/home/user/webapp/logs/err.log',
      out_file: '/home/user/webapp/logs/out.log'
    }
  ]
}
