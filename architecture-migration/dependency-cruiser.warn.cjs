module.exports = {
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+'
      }
    }
  },
  forbidden: [
    {
      name: 'warn-circular',
      severity: 'warn',
      comment: 'WARN ONLY: dependency cycles must be removed before enforcement is promoted.',
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: 'warn-frontend-backend-import',
      severity: 'warn',
      comment: 'WARN ONLY: frontend must not import backend internals.',
      from: {
        path: '^(components|hooks|pages)/',
        pathNot: '^pages/api/'
      },
      to: {
        path: '^backend/'
      }
    }
  ]
};
